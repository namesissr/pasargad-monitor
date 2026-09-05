import { IS_MONITOR_SERVER, NOT_ANCHOR_SERVER, query, queryOne } from '@/lib/db';
import { generateAgentToken, requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { currentMonth, type Calendar } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * فهرست سرورها همراه آخرین متریک و مصرف دوره جاری.
 *
 * مصرف دوره از جدول تجمیع روزانه می‌آید نه از نمونه‌های خام؛ با ده‌ها سرور
 * و میلیون‌ها ردیف خام، جمع‌زدن خام کوئری را از پا درمی‌آورد.
 */

const LIST_SQL = `
SELECT
  s.id, s.name, s.hostname, host(s.main_ip) AS main_ip, s.ssh_port,
  s.provider, s.location, s.os, s.cpu_model, s.cpu_cores,
  s.datacenter_id, dc.name AS datacenter_name,
  s.ram_total_bytes::float8  AS ram_total_bytes,
  s.disk_total_bytes::float8 AS disk_total_bytes,
  s.port_mbps, s.traffic_quota_gb::float8 AS traffic_quota_gb,
  tp.purchased::float8                      AS traffic_purchased_gb,
  (tp.used_bytes / 1073741824)::float8      AS traffic_used_gb,
  (tp.purchased - tp.used_bytes / 1073741824)::float8 AS traffic_balance_gb,
  s.monthly_cost::float8 AS monthly_cost, s.customer,
  s.status, s.last_seen_at, s.boot_time, s.is_active, s.notes, s.created_at,
  m.ts                       AS metric_ts,
  m.cpu_percent,
  m.ram_used_bytes::float8   AS ram_used_bytes,
  m.disk_used_bytes::float8  AS disk_used_bytes,
  m.swap_used_bytes::float8  AS swap_used_bytes,
  m.swap_total_bytes::float8 AS swap_total_bytes,
  m.load1, m.load5, m.load15,
  m.rx_bps::float8           AS rx_bps,
  m.tx_bps::float8           AS tx_bps,
  m.uptime_sec::float8       AS uptime_sec,
  m.process_count, m.tcp_conn_count,
  COALESCE(t.rx, 0)::float8  AS period_rx,
  COALESCE(t.tx, 0)::float8  AS period_tx,
  COALESCE(ipc.cnt, 0)::int  AS ip_count,
  COALESCE(inc.cnt, 0)::int  AS open_incidents,
  s.is_monitor,
  EXISTS (SELECT 1 FROM vz_anchors va WHERE va.bind_server_id = s.id) AS is_anchor
FROM servers s
LEFT JOIN datacenters dc ON dc.id = s.datacenter_id
LEFT JOIN LATERAL (
  SELECT * FROM server_metrics sm WHERE sm.server_id = s.id ORDER BY sm.ts DESC LIMIT 1
) m ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(rx_bytes) AS rx, SUM(tx_bytes) AS tx
  FROM server_metrics_daily d
  WHERE d.server_id = s.id AND d.day BETWEEN $1::date AND $2::date
) t ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt FROM ip_addresses i WHERE i.server_id = s.id
) ipc ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt FROM incidents x WHERE x.server_id = s.id AND x.resolved_at IS NULL
) inc ON TRUE
LEFT JOIN LATERAL (
  -- ترافیک پیش‌خرید: مجموع خریدها، و مصرف از تاریخ شروع شمارش.
  -- تاریخ تهی یعنی هنوز خریدی نبوده، پس مصرفی هم شمرده نمی‌شود.
  SELECT COALESCE((SELECT SUM(gb) FROM traffic_topups tt WHERE tt.server_id = s.id), 0)::float8
           AS purchased,
         COALESCE((SELECT SUM(d.rx_bytes) FROM server_metrics_daily d
                    WHERE d.server_id = s.id
                      AND s.traffic_counted_from IS NOT NULL
                      AND d.day >= s.traffic_counted_from), 0)::float8
           AS used_bytes
) tp ON TRUE
`;

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();

    const url = new URL(req.url);
    const includeInactive = url.searchParams.get('all') === '1';
    const search = (url.searchParams.get('q') || '').trim();
    const datacenterId = url.searchParams.get('datacenter_id') || '';

    const calendar = ((await getSetting('traffic_calendar', 'jalali')) as Calendar) || 'jalali';
    const period = currentMonth(calendar);

    const where: string[] = [];
    const params: unknown[] = [period.from, period.to];

    if (!includeInactive) where.push('s.is_active');

    // سه نما: سرور اختصاصی (پیش‌فرض)، سرور پایش، و همه.
    //
    // «همه» برای فرم‌هایی است که باید لنگر از قبل انتخاب‌شده را هم ببینند،
    // وگرنه در فهرست خودش پیدا نمی‌شد.
    const role =
      url.searchParams.get('role') ||
      (url.searchParams.get('anchors') === '1' ? 'all' : 'dedicated');
    if (role === 'monitor') where.push(IS_MONITOR_SERVER);
    else if (role !== 'all') where.push(NOT_ANCHOR_SERVER);
    if (datacenterId === 'none') {
      where.push('s.datacenter_id IS NULL');
    } else if (datacenterId && datacenterId !== 'all') {
      params.push(Number(datacenterId));
      where.push(`s.datacenter_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(s.name ILIKE $${params.length} OR s.hostname ILIKE $${params.length}
          OR host(s.main_ip) ILIKE $${params.length} OR s.customer ILIKE $${params.length}
          OR s.provider ILIKE $${params.length} OR dc.name ILIKE $${params.length})`,
      );
    }

    const sql =
      LIST_SQL +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY dc.name NULLS LAST, (s.status = 'down') DESC, s.name ASC`;

    const servers = await query(sql, params);
    return ok({ servers, period: { label: period.label, from: period.from, to: period.to } });
  });
}

/** افزودن سرور جدید */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Record<string, unknown>>(req);

    const name = String(b.name ?? '').trim();
    const mainIp = String(b.main_ip ?? '').trim();

    if (!name) return fail('نام سرور را وارد کنید', 400);
    if (!mainIp) return fail('آی‌پی اصلی سرور را وارد کنید', 400);

    const dup = await queryOne('SELECT id FROM servers WHERE main_ip = $1::inet', [mainIp]).catch(() => {
      throw new Error('قالب آی‌پی درست نیست');
    });
    if (dup) return fail('سروری با همین آی‌پی از قبل ثبت شده است', 409);

    const token = generateAgentToken();

    const row = await queryOne<{ id: number; agent_token: string }>(
      `INSERT INTO servers
         (name, hostname, main_ip, ssh_port, provider, location,
          port_mbps, traffic_quota_gb, monthly_cost, customer, notes, agent_token, datacenter_id)
       VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, agent_token`,
      [
        name,
        String(b.hostname ?? '').trim() || null,
        mainIp,
        Number(b.ssh_port) || 22,
        String(b.provider ?? '').trim() || null,
        String(b.location ?? '').trim() || null,
        Number(b.port_mbps) || 1000,
        Number(b.traffic_quota_gb) || 0,
        Number(b.monthly_cost) || 0,
        String(b.customer ?? '').trim() || null,
        String(b.notes ?? '').trim() || null,
        token,
        b.datacenter_id ? Number(b.datacenter_id) : null,
      ],
    );

    // آی‌پی اصلی خودکار در فهرست آی‌پی‌ها ثبت می‌شود تا جایی جا نماند
    await query(
      `INSERT INTO ip_addresses (ip, version, server_id, status, is_monitored)
       VALUES ($1::inet, CASE WHEN $1::text LIKE '%:%' THEN 6 ELSE 4 END, $2, 'assigned', TRUE)
       ON CONFLICT (ip) DO UPDATE SET server_id = EXCLUDED.server_id, status = 'assigned'`,
      [mainIp, row!.id],
    );

    return ok({ id: row!.id, agent_token: row!.agent_token }, { status: 201 });
  });
}
