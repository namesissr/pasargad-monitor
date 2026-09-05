import { query, queryOne } from '@/lib/db';
import { requireOwnedServer } from '@/lib/portal-guard';
import { fail, handle, ok } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { currentMonth, lastMonths, type Calendar } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * صفحه کامل یک سرور، برای مشتری.
 *
 * مالکیت سرور در requireOwnedServer تأیید می‌شود و بعد از آن همه
 * کوئری‌ها روی همان شناسه تأییدشده کار می‌کنند — نه روی عددی که از آدرس
 * آمده.
 *
 * چیزهایی که عمدا برنمی‌گردند: قیمت تمام‌شده، هزینه ماهانه، دیتاسنتر،
 * توکن ایجنت، یادداشت داخلی، و نام هایپروایزر. مشتری وضعیت سرور خودش
 * را می‌بیند، نه اقتصاد و زیرساخت ما را.
 */

type RangeKey = '24h' | '7d' | '30d' | '90d';

const RANGES: Record<RangeKey, { source: 'raw' | 'hourly' | 'daily'; interval: string }> = {
  '24h': { source: 'raw', interval: '24 hours' },
  '7d': { source: 'hourly', interval: '7 days' },
  '30d': { source: 'hourly', interval: '30 days' },
  '90d': { source: 'daily', interval: '90 days' },
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { serverId } = await requireOwnedServer(params.id);

    const url = new URL(req.url);
    const rangeKey = (url.searchParams.get('range') || '24h') as RangeKey;
    const range = RANGES[rangeKey];
    if (!range) return fail('بازه زمانی نامعتبر است', 400);

    const s = await getSettings();
    const calendar: Calendar = s.traffic_calendar === 'gregorian' ? 'gregorian' : 'jalali';
    const month = currentMonth(calendar);

    const server = await queryOne(
      `SELECT s.id, s.name, s.hostname, host(s.main_ip) AS main_ip, s.status,
              s.os, s.cpu_model, s.cpu_cores, s.location, s.port_mbps,
              s.ram_total_bytes::float8  AS ram_total_bytes,
              s.disk_total_bytes::float8 AS disk_total_bytes,
              s.last_seen_at, s.renews_at, s.created_at,
              to_char(s.traffic_counted_from, 'YYYY-MM-DD') AS traffic_counted_from,
              tp.purchased::float8 AS traffic_purchased_gb,
              (tp.used_bytes / 1073741824 + s.traffic_used_before_gb)::float8
                AS traffic_used_gb,
              (tp.purchased - tp.used_bytes / 1073741824 - s.traffic_used_before_gb)::float8
                AS traffic_balance_gb,
              m.ts AS metric_ts, m.cpu_percent,
              m.ram_used_bytes::float8  AS ram_used_bytes,
              m.disk_used_bytes::float8 AS disk_used_bytes,
              m.load1, m.load5, m.load15,
              m.rx_bps::float8 AS rx_bps, m.tx_bps::float8 AS tx_bps,
              m.uptime_sec::float8 AS uptime_sec
         FROM servers s
         LEFT JOIN LATERAL (
           SELECT * FROM server_metrics sm WHERE sm.server_id = s.id
            ORDER BY sm.ts DESC LIMIT 1
         ) m ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE((SELECT SUM(gb) FROM traffic_topups tt
                             WHERE tt.server_id = s.id), 0)::float8 AS purchased,
                  COALESCE((SELECT SUM(d.rx_bytes) FROM server_metrics_daily d
                             WHERE d.server_id = s.id
                               AND s.traffic_counted_from IS NOT NULL
                               AND d.day >= s.traffic_counted_from), 0)::float8 AS used_bytes
         ) tp ON TRUE
        WHERE s.id = $1`,
      [serverId],
    );

    // نمودار همان بازه‌ای که کاربر خواسته
    let points;
    if (range.source === 'raw') {
      points = await query(
        `SELECT to_char(bucket, 'YYYY-MM-DD HH24:MI') AS t, cpu, ram_pct, rx_bps, tx_bps
           FROM (
             SELECT to_timestamp(floor(extract(epoch FROM ts) / 600) * 600) AS bucket,
                    AVG(cpu_percent)::float8 AS cpu,
                    AVG(CASE WHEN ram_total_bytes > 0
                             THEN ram_used_bytes::float8 / ram_total_bytes * 100 END)::float8
                      AS ram_pct,
                    AVG(rx_bps)::float8 AS rx_bps,
                    AVG(tx_bps)::float8 AS tx_bps
               FROM server_metrics
              WHERE server_id = $1 AND ts >= now() - $2::interval
              GROUP BY 1
           ) q
          ORDER BY bucket`,
        [serverId, range.interval],
      );
    } else if (range.source === 'hourly') {
      points = await query(
        `SELECT to_char(hour, 'YYYY-MM-DD HH24:MI') AS t,
                cpu_avg::float8 AS cpu, ram_pct_avg::float8 AS ram_pct,
                rx_bps_avg::float8 AS rx_bps, tx_bps_avg::float8 AS tx_bps,
                rx_bytes::float8 AS rx_bytes, tx_bytes::float8 AS tx_bytes
           FROM server_metrics_hourly
          WHERE server_id = $1 AND hour >= now() - $2::interval
          ORDER BY hour`,
        [serverId, range.interval],
      );
    } else {
      points = await query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS t,
                cpu_avg::float8 AS cpu, ram_pct_avg::float8 AS ram_pct,
                rx_bps_max::float8 AS rx_bps, tx_bps_max::float8 AS tx_bps,
                rx_bytes::float8 AS rx_bytes, tx_bytes::float8 AS tx_bytes
           FROM server_metrics_daily
          WHERE server_id = $1 AND day >= (now() - $2::interval)::date
          ORDER BY day`,
        [serverId, range.interval],
      );
    }

    // مصرف روزانه سی روز اخیر — همان جدولی که مبنای صورتحساب است
    const daily = await query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day,
              rx_bytes::float8 AS rx, tx_bytes::float8 AS tx,
              uptime_ratio::float8 AS uptime_ratio
         FROM server_metrics_daily
        WHERE server_id = $1 AND day >= (now() - interval '30 days')::date
        ORDER BY day DESC`,
      [serverId],
    );

    // گزارش ماهانه: دوازده دوره اخیر
    const periods = lastMonths(12, calendar);
    const monthly = await query(
      `SELECT p.label,
              COALESCE(SUM(d.rx_bytes), 0)::float8 AS rx,
              COALESCE(SUM(d.tx_bytes), 0)::float8 AS tx,
              COUNT(d.day)::int AS days
         FROM (SELECT unnest($2::text[]) AS label,
                      unnest($3::date[]) AS from_day,
                      unnest($4::date[]) AS to_day) p
         LEFT JOIN server_metrics_daily d
                ON d.server_id = $1 AND d.day BETWEEN p.from_day AND p.to_day
        GROUP BY p.label, p.from_day
        ORDER BY p.from_day DESC`,
      [
        serverId,
        periods.map((p) => p.label),
        periods.map((p) => p.from),
        periods.map((p) => p.to),
      ],
    );

    const topups = await query(
      `SELECT id, gb::float8 AS gb, note, created_at
         FROM traffic_topups
        WHERE server_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [serverId],
    );

    // آی‌پی‌ها بدون یادداشت داخلی و بدون وضعیت دسترسی از ایران —
    // آن دومی داده عملیاتی ماست، نه چیزی که مشتری با آن کاری دارد
    const ips = await query(
      `SELECT host(ip) AS ip, ptr, is_primary
         FROM ip_addresses
        WHERE server_id = $1
        ORDER BY ip`,
      [serverId],
    );

    // رویدادهای همین سرور، برای پاسخ به «چرا قطع بود؟»
    const incidents = await query(
      `SELECT id, kind, severity, message, started_at, resolved_at,
              duration_sec::float8 AS duration_sec
         FROM incidents
        WHERE server_id = $1
        ORDER BY started_at DESC
        LIMIT 20`,
      [serverId],
    );

    const period = await queryOne<{ rx: number; tx: number }>(
      `SELECT COALESCE(SUM(rx_bytes), 0)::float8 AS rx,
              COALESCE(SUM(tx_bytes), 0)::float8 AS tx
         FROM server_metrics_daily
        WHERE server_id = $1 AND day BETWEEN $2::date AND $3::date`,
      [serverId, month.from, month.to],
    );

    return ok({
      server,
      range: rangeKey,
      points,
      daily,
      monthly,
      topups,
      ips,
      incidents,
      period: { label: month.label, from: month.from, to: month.to, ...period },
    });
  });
}
