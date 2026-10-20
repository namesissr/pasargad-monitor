import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { currentMonth, type Calendar } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * جزئیات یک سوییچ: منابع، محیط، همه پورت‌ها با مصرف امروز و ماه جاری،
 * و تاریخچه shut/no shut.
 *
 * مصرف امروز و ماه از تجمیع روزانه پورت می‌آید، پس مثل گزارش سرورها
 * حداکثر پنج دقیقه عقب است. سرعت لحظه‌ای از آخرین خواندن.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه سوییچ نامعتبر است', 400);

    const sw = await queryOne(
      `SELECT w.id, w.name, w.url, w.username, w.insecure_tls, w.datacenter_id, dc.name AS datacenter_name,
              w.location, w.notes, w.is_active, w.hostname, w.model, w.serial, w.os_version,
              w.uptime_sec::float8 AS uptime_sec, w.status, w.last_seen_at, w.last_poll_at,
              w.last_poll_ms, w.last_error, w.fail_streak, w.cpu_percent,
              w.mem_used_bytes::float8 AS mem_used_bytes, w.mem_total_bytes::float8 AS mem_total_bytes,
              w.load1, w.max_temp_c, w.env, w.env_ok, w.env_checked_at,
              (w.password <> '') AS has_password
         FROM switches w
         LEFT JOIN datacenters dc ON dc.id = w.datacenter_id
        WHERE w.id = $1`,
      [id],
    );
    if (!sw) return fail('سوییچ پیدا نشد', 404);

    const calendar = ((await getSetting('traffic_calendar', 'jalali')) as Calendar) || 'jalali';
    const period = currentMonth(calendar);

    const ports = await query(
      `SELECT p.id, p.name, p.kind, p.description, p.admin_up, p.oper_up, p.oper_reason, p.speed_mbps,
              p.mtu, p.mode, p.vlan, p.mac, p.member_of, p.hw_type, p.xcvr_type, p.last_flap,
              p.in_bps::float8 AS in_bps, p.out_bps::float8 AS out_bps,
              p.in_errors::float8 AS in_errors, p.out_errors::float8 AS out_errors,
              p.crc_errors::float8 AS crc_errors,
              p.in_discards::float8 AS in_discards, p.out_discards::float8 AS out_discards,
              p.transceiver, p.server_id, s.name AS server_name, host(s.main_ip) AS server_ip,
              c.name AS customer_name,
              p.count_traffic, p.count_since, p.is_protected, p.alert_down, p.note,
              p.is_present, p.last_change_at, p.counters_at,
              COALESCE(t.in_bytes, 0)::float8  AS today_in,
              COALESCE(t.out_bytes, 0)::float8 AS today_out,
              COALESCE(m.in_bytes, 0)::float8  AS month_in,
              COALESCE(m.out_bytes, 0)::float8 AS month_out,
              COALESCE(m.errors, 0)::float8    AS month_errors,
              EXISTS (SELECT 1 FROM incidents i
                       WHERE i.switch_port_id = p.id AND i.resolved_at IS NULL) AS has_incident,
              (SELECT a.status FROM switch_actions a
                WHERE a.port_id = p.id AND a.status IN ('pending', 'running')
                LIMIT 1) AS pending_action
         FROM switch_ports p
         LEFT JOIN servers s   ON s.id = p.server_id
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN switch_port_daily t ON t.port_id = p.id AND t.day = CURRENT_DATE
         LEFT JOIN LATERAL (
           SELECT SUM(d.in_bytes) AS in_bytes, SUM(d.out_bytes) AS out_bytes, SUM(d.errors) AS errors
             FROM switch_port_daily d
            WHERE d.port_id = p.id AND d.day BETWEEN $2::date AND $3::date
         ) m ON TRUE
        WHERE p.switch_id = $1
        ORDER BY p.is_present DESC,
                 CASE p.kind WHEN 'ethernet' THEN 0 WHEN 'port-channel' THEN 1 WHEN 'mgmt' THEN 2
                             WHEN 'vlan' THEN 3 ELSE 4 END,
                 -- Ethernet1/2 پیش از Ethernet1/10: مرتب‌سازی عددی تکه‌ها
                 (SELECT array_agg(rm.x[1]::bigint) FROM regexp_matches(p.name, '(\d+)', 'g') AS rm(x)),
                 p.name`,
      [id, period.from, period.to],
    );

    const actions = await query(
      `SELECT a.id, a.port_id, a.port_name, a.action, a.save_config, a.reason, a.status,
              a.requested_by_name, a.requested_at, a.started_at, a.finished_at, a.result
         FROM switch_actions a
        WHERE a.switch_id = $1
        ORDER BY a.requested_at DESC
        LIMIT 30`,
      [id],
    );

    const incidents = await query(
      `SELECT i.id, i.kind, i.severity, i.message, i.started_at, i.ack_at, i.switch_port_id
         FROM incidents i
        WHERE i.switch_id = $1 AND i.resolved_at IS NULL
        ORDER BY i.started_at DESC`,
      [id],
    );

    return ok({ switch: sw, ports, actions, incidents, period });
  });
}
