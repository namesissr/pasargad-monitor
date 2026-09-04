import { NOT_ANCHOR_SERVER, query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { currentMonth, type Calendar } from '@/lib/period';
import { computeMonthCost, effectiveRates } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * تصویر لحظه‌ای برای داشبورد. هر ۵ ثانیه صدا زده می‌شود، پس عمداً سبک است:
 * فقط آخرین نمونه هر سرور و چند شمارش.
 */
export async function GET() {
  return handle(async () => {
    await requireUser();

    const calendar = ((await getSetting('traffic_calendar', 'jalali')) as Calendar) || 'jalali';
    const period = currentMonth(calendar);

    const servers = await query(
      `SELECT s.id, s.name, host(s.main_ip) AS main_ip, s.status, s.location, s.provider,
              s.datacenter_id, dc.name AS datacenter_name,
              s.last_seen_at,
              s.monthly_cost::float8      AS rent,
              dc.price_per_tb::float8     AS dc_price_per_tb,
              dc.price_per_ip::float8     AS dc_price_per_ip,
              dc.included_tb::float8      AS dc_included_tb,
              dc.included_ips             AS dc_included_ips,
              dc.billing_direction, dc.tb_base,
              s.price_per_tb::float8      AS s_price_per_tb,
              s.price_per_ip::float8      AS s_price_per_ip,
              s.included_tb::float8       AS s_included_tb,
              s.included_ips              AS s_included_ips,
              COALESCE(ipc.cnt, 0)::int   AS ip_count,
              s.ram_total_bytes::float8  AS ram_total_bytes,
              s.disk_total_bytes::float8 AS disk_total_bytes,
              s.port_mbps,
              s.traffic_quota_gb::float8 AS traffic_quota_gb,
              m.ts AS metric_ts, m.cpu_percent,
              m.ram_used_bytes::float8  AS ram_used_bytes,
              m.disk_used_bytes::float8 AS disk_used_bytes,
              m.load1,
              m.rx_bps::float8 AS rx_bps,
              m.tx_bps::float8 AS tx_bps,
              m.uptime_sec::float8 AS uptime_sec,
              COALESCE(t.rx, 0)::float8 AS period_rx,
              COALESCE(t.tx, 0)::float8 AS period_tx
         FROM servers s
         LEFT JOIN datacenters dc ON dc.id = s.datacenter_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS cnt FROM ip_addresses i WHERE i.server_id = s.id
         ) ipc ON TRUE
         LEFT JOIN LATERAL (
           SELECT * FROM server_metrics sm WHERE sm.server_id = s.id ORDER BY sm.ts DESC LIMIT 1
         ) m ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(rx_bytes) AS rx, SUM(tx_bytes) AS tx
             FROM server_metrics_daily d
            WHERE d.server_id = s.id AND d.day BETWEEN $1::date AND $2::date
         ) t ON TRUE
        WHERE s.is_active AND ${NOT_ANCHOR_SERVER}
        ORDER BY (s.status = 'down') DESC, s.name`,
      [period.from, period.to],
    );

    const ipStats = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*)::int AS cnt FROM ip_addresses GROUP BY status`,
    );

    const incidents = await query(
      `SELECT i.id, i.server_id, s.name AS server_name, i.kind, i.severity, i.message,
              i.started_at, i.ack_at
         FROM incidents i
         LEFT JOIN servers s ON s.id = i.server_id
        WHERE i.resolved_at IS NULL
        ORDER BY i.started_at DESC
        LIMIT 30`,
    );

    // هزینه دوره جاری با همان منطق صفحه حسابداری، از روی داده‌ای که
    // همین کوئری برگردانده — بدون رفت‌وبرگشت اضافه به دیتابیس.
    const cost = { rent: 0, traffic: 0, ip: 0, total: 0 };
    for (const s of servers as Record<string, unknown>[]) {
      const rates = effectiveRates(
        {
          price_per_tb: s.s_price_per_tb as number | null,
          price_per_ip: s.s_price_per_ip as number | null,
          included_tb: s.s_included_tb as number | null,
          included_ips: s.s_included_ips as number | null,
        },
        {
          price_per_tb: (s.dc_price_per_tb as number) ?? 0,
          price_per_ip: (s.dc_price_per_ip as number) ?? 0,
          included_tb: (s.dc_included_tb as number) ?? 0,
          included_ips: (s.dc_included_ips as number) ?? 1,
          billing_direction: (s.billing_direction as 'total') ?? 'total',
          tb_base: (s.tb_base as number) ?? 1000,
        },
      );
      const c = computeMonthCost({
        rx: Number(s.period_rx) || 0,
        tx: Number(s.period_tx) || 0,
        ipCount: Number(s.ip_count) || 0,
        rent: Number(s.rent) || 0,
        rates,
      });
      cost.rent += c.rent;
      cost.traffic += c.traffic_cost;
      cost.ip += c.ip_cost;
      cost.total += c.total;
    }

    return ok({
      servers,
      ipStats,
      incidents,
      cost,
      monthlyCost: cost.total,
      period: { label: period.label, from: period.from, to: period.to },
      now: new Date().toISOString(),
    });
  });
}
