import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * سری زمانی سوییچ یا یک پورتش.
 *
 * بدون port_id: پردازنده، حافظه و دمای خود سوییچ.
 * با port_id: سرعت و حجم ورودی/خروجی پورت.
 * با port_id و view=daily: مصرف روزانه پورت برای جدول.
 * با port_id و view=events: تاریخچه قطع و وصل پورت.
 *
 * منبع با طول بازه عوض می‌شود — همان قاعده نمودار سرورها.
 */

type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d' | '90d';

const RANGES: Record<RangeKey, { source: 'raw' | 'hourly' | 'daily'; interval: string; bucket: number }> = {
  '1h':  { source: 'raw',    interval: '1 hour',   bucket: 30 },
  '6h':  { source: 'raw',    interval: '6 hours',  bucket: 120 },
  '24h': { source: 'raw',    interval: '24 hours', bucket: 600 },
  '7d':  { source: 'hourly', interval: '7 days',   bucket: 3600 },
  '30d': { source: 'hourly', interval: '30 days',  bucket: 3600 },
  '90d': { source: 'daily',  interval: '90 days',  bucket: 86400 },
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه سوییچ نامعتبر است', 400);

    const url = new URL(req.url);
    const portId = idParam(url, 'port_id');

    if (portId !== null) {
      // پورت باید مال همین سوییچ باشد
      const port = await queryOne(`SELECT id FROM switch_ports WHERE id = $1 AND switch_id = $2`, [portId, id]);
      if (!port) return fail('پورت پیدا نشد', 404);

      if (url.searchParams.get('view') === 'daily') {
        const days = Math.min(400, Math.max(1, Number(url.searchParams.get('days')) || 31));
        const rows = await query(
          `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                  in_bytes::float8 AS in_bytes, out_bytes::float8 AS out_bytes,
                  in_bps_max::float8 AS in_peak, out_bps_max::float8 AS out_peak,
                  errors::float8 AS errors, discards::float8 AS discards
             FROM switch_port_daily
            WHERE port_id = $1 AND day > CURRENT_DATE - $2::int
            ORDER BY day DESC`,
          [portId, days],
        );
        return ok({ days: rows });
      }

      if (url.searchParams.get('view') === 'events') {
        const events = await query(
          `SELECT ts, oper_up, detail FROM switch_port_events
            WHERE port_id = $1 ORDER BY ts DESC LIMIT 100`,
          [portId],
        );
        const counts = await queryOne(
          `SELECT COUNT(*) FILTER (WHERE ts >= now() - interval '1 hour')::int  AS last_hour,
                  COUNT(*) FILTER (WHERE ts >= now() - interval '24 hours')::int AS last_day,
                  COUNT(*) FILTER (WHERE ts >= now() - interval '7 days')::int   AS last_week
             FROM switch_port_events WHERE port_id = $1`,
          [portId],
        );
        return ok({ events, counts });
      }
    }

    const key = (url.searchParams.get('range') || '6h') as RangeKey;
    const cfg = RANGES[key];
    if (!cfg) return fail('بازه زمانی نامعتبر است', 400);

    let points;
    if (portId !== null) {
      if (cfg.source === 'raw') {
        points = await query(
          `SELECT to_char(to_timestamp(floor(extract(epoch FROM ts) / $3) * $3), 'YYYY-MM-DD HH24:MI') AS t,
                  AVG(in_bps)::float8 AS in_bps, AVG(out_bps)::float8 AS out_bps,
                  SUM(in_bytes)::float8 AS in_bytes, SUM(out_bytes)::float8 AS out_bytes,
                  SUM(errors)::float8 AS errors
             FROM switch_port_metrics
            WHERE port_id = $1 AND ts >= now() - $2::interval
            GROUP BY 1 ORDER BY 1`,
          [portId, cfg.interval, cfg.bucket],
        );
      } else if (cfg.source === 'hourly') {
        points = await query(
          `SELECT to_char(hour, 'YYYY-MM-DD HH24:MI') AS t,
                  in_bps_avg::float8 AS in_bps, out_bps_avg::float8 AS out_bps,
                  in_bytes::float8 AS in_bytes, out_bytes::float8 AS out_bytes,
                  errors::float8 AS errors
             FROM switch_port_hourly
            WHERE port_id = $1 AND hour >= now() - $2::interval
            ORDER BY hour`,
          [portId, cfg.interval],
        );
      } else {
        points = await query(
          `SELECT to_char(day, 'YYYY-MM-DD') AS t,
                  in_bps_max::float8 AS in_bps, out_bps_max::float8 AS out_bps,
                  in_bytes::float8 AS in_bytes, out_bytes::float8 AS out_bytes,
                  errors::float8 AS errors
             FROM switch_port_daily
            WHERE port_id = $1 AND day >= (now() - $2::interval)::date
            ORDER BY day`,
          [portId, cfg.interval],
        );
      }
      return ok({ range: key, source: cfg.source, points });
    }

    if (cfg.source === 'raw') {
      points = await query(
        `SELECT to_char(to_timestamp(floor(extract(epoch FROM ts) / $3) * $3), 'YYYY-MM-DD HH24:MI') AS t,
                AVG(cpu_percent)::float8 AS cpu,
                AVG(CASE WHEN mem_total_bytes > 0
                         THEN mem_used_bytes::float8 / mem_total_bytes * 100 END)::float8 AS mem_pct,
                MAX(max_temp_c)::float8 AS temp
           FROM switch_metrics
          WHERE switch_id = $1 AND ts >= now() - $2::interval
          GROUP BY 1 ORDER BY 1`,
        [id, cfg.interval, cfg.bucket],
      );
    } else {
      // تجمیع روزانه برای منابع سوییچ نداریم؛ بازه ۹۰ روزه هم از ساعتی
      // خوانده و روزانه گروه می‌شود
      points = await query(
        `SELECT to_char(date_trunc($3, hour), 'YYYY-MM-DD HH24:MI') AS t,
                AVG(cpu_avg)::float8 AS cpu,
                AVG(mem_pct_avg)::float8 AS mem_pct,
                MAX(temp_max)::float8 AS temp
           FROM switch_metrics_hourly
          WHERE switch_id = $1 AND hour >= now() - $2::interval
          GROUP BY 1 ORDER BY 1`,
        [id, cfg.interval, cfg.source === 'daily' ? 'day' : 'hour'],
      );
    }
    return ok({ range: key, source: cfg.source, points });
  });
}
