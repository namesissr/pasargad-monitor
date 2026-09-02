import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * سری زمانی برای نمودارها.
 *
 * منبع داده با طول بازه عوض می‌شود: بازه کوتاه از نمونه خام، بازه چندروزه از
 * تجمیع ساعتی و بازه چندماهه از تجمیع روزانه. اگر همه را از خام بخوانیم،
 * نمودار یک‌ماهه ده‌ها هزار نقطه می‌شود و مرورگر می‌خوابد.
 */

type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d' | '90d' | '1y';

const RANGES: Record<RangeKey, { source: 'raw' | 'hourly' | 'daily'; interval: string; bucket?: string }> = {
  '1h':  { source: 'raw',    interval: '1 hour',   bucket: '30 seconds' },
  '6h':  { source: 'raw',    interval: '6 hours',  bucket: '2 minutes' },
  '24h': { source: 'raw',    interval: '24 hours', bucket: '10 minutes' },
  '7d':  { source: 'hourly', interval: '7 days' },
  '30d': { source: 'hourly', interval: '30 days' },
  '90d': { source: 'daily',  interval: '90 days' },
  '1y':  { source: 'daily',  interval: '365 days' },
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();

    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه سرور نامعتبر است', 400);

    const url = new URL(req.url);
    const key = (url.searchParams.get('range') || '6h') as RangeKey;
    const cfg = RANGES[key];
    if (!cfg) return fail('بازه زمانی نامعتبر است', 400);

    let rows;

    if (cfg.source === 'raw') {
      rows = await query(
        `SELECT to_char(bucket, 'YYYY-MM-DD HH24:MI') AS t,
                cpu, ram_pct, disk_pct, rx_bps, tx_bps, load1
           FROM (
             SELECT to_timestamp(floor(extract(epoch FROM ts) / $3) * $3) AS bucket,
                    AVG(cpu_percent)::float8 AS cpu,
                    AVG(CASE WHEN ram_total_bytes > 0
                             THEN ram_used_bytes::float8 / ram_total_bytes * 100 END)::float8 AS ram_pct,
                    MAX(CASE WHEN disk_total_bytes > 0
                             THEN disk_used_bytes::float8 / disk_total_bytes * 100 END)::float8 AS disk_pct,
                    AVG(rx_bps)::float8 AS rx_bps,
                    AVG(tx_bps)::float8 AS tx_bps,
                    AVG(load1)::float8  AS load1
               FROM server_metrics
              WHERE server_id = $1 AND ts >= now() - $2::interval
              GROUP BY 1
           ) q
          ORDER BY bucket`,
        [id, cfg.interval, bucketSeconds(cfg.bucket!)],
      );
    } else if (cfg.source === 'hourly') {
      rows = await query(
        `SELECT to_char(hour, 'YYYY-MM-DD HH24:MI') AS t,
                cpu_avg::float8 AS cpu, ram_pct_avg::float8 AS ram_pct,
                disk_pct_max::float8 AS disk_pct,
                rx_bps_avg::float8 AS rx_bps, tx_bps_avg::float8 AS tx_bps,
                load_avg::float8 AS load1,
                rx_bytes::float8 AS rx_bytes, tx_bytes::float8 AS tx_bytes
           FROM server_metrics_hourly
          WHERE server_id = $1 AND hour >= now() - $2::interval
          ORDER BY hour`,
        [id, cfg.interval],
      );
    } else {
      rows = await query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS t,
                cpu_avg::float8 AS cpu, ram_pct_avg::float8 AS ram_pct,
                disk_pct_max::float8 AS disk_pct,
                rx_bps_max::float8 AS rx_bps, tx_bps_max::float8 AS tx_bps,
                load_avg::float8 AS load1,
                rx_bytes::float8 AS rx_bytes, tx_bytes::float8 AS tx_bytes,
                uptime_ratio::float8 AS uptime_ratio
           FROM server_metrics_daily
          WHERE server_id = $1 AND day >= (now() - $2::interval)::date
          ORDER BY day`,
        [id, cfg.interval],
      );
    }

    return ok({ range: key, source: cfg.source, points: rows });
  });
}

function bucketSeconds(bucket: string): number {
  const [n, unit] = bucket.split(' ');
  const mult = unit.startsWith('second') ? 1 : unit.startsWith('minute') ? 60 : 3600;
  return Number(n) * mult;
}
