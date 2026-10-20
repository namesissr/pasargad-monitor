import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { lastMonths, type Calendar } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * گزارش پورت‌ها در یک بازه: حجم، اوج، صدک ۹۵، خطا و قطع و وصل.
 *
 *   ?period=current|previous   ماه جاری یا ماه قبل (تقویم تنظیمات)
 *   ?from=YYYY-MM-DD&to=…       بازه دلخواه، حداکثر ۴۰۰ روز
 *   ?switch_id=                 فقط یک سوییچ
 *   ?format=csv                 خروجی اکسل
 *
 * صدک ۹۵ از تجمیع پنج‌دقیقه‌ای است؛ اگر بازه از نگهداری آن قدیمی‌تر باشد
 * فقط روی بخشی که داده دارد حساب می‌شود و samples این را نشان می‌دهد.
 * «صدک ۹۵» در هر بازه پنج دقیقه بزرگ‌ترِ ورودی و خروجی را می‌گیرد — همان
 * روشی که بیشتر دیتاسنترها فاکتور می‌کنند.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type ReportRow = {
  port_id: number;
  switch_id: number;
  switch_name: string;
  port: string;
  kind: string;
  description: string | null;
  speed_mbps: number | null;
  server_id: number | null;
  server_name: string | null;
  customer_name: string | null;
  in_bytes: number;
  out_bytes: number;
  in_peak: number;
  out_peak: number;
  errors: number;
  discards: number;
  p95_in: number | null;
  p95_out: number | null;
  p95: number | null;
  samples: number;
  flaps: number;
  avg_util: number | null;
};

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const switchId = url.searchParams.has('switch_id') ? idParam(url, 'switch_id') : null;
    if (url.searchParams.has('switch_id') && switchId === null) return fail('سوییچ نامعتبر است', 400);

    let from = url.searchParams.get('from') ?? '';
    let to = url.searchParams.get('to') ?? '';
    let label = '';
    if (!from || !to) {
      const calendar = ((await getSetting('traffic_calendar', 'jalali')) as Calendar) || 'jalali';
      const [prev, cur] = lastMonths(2, calendar);
      const p = url.searchParams.get('period') === 'previous' ? prev : cur;
      from = p.from;
      to = p.to;
      label = p.label;
    }
    if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      return fail('تاریخ باید به شکل YYYY-MM-DD باشد', 400);
    }
    if (from > to) return fail('ابتدای بازه بعد از انتهای آن است', 400);
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 400) return fail('بازه حداکثر ۴۰۰ روز است', 400);

    const rows = await query<ReportRow>(
      `SELECT p.id AS port_id, w.id AS switch_id, w.name AS switch_name, p.name AS port, p.kind,
              p.description, p.speed_mbps, p.server_id, s.name AS server_name, c.name AS customer_name,
              COALESCE(d.in_bytes, 0)::float8  AS in_bytes,
              COALESCE(d.out_bytes, 0)::float8 AS out_bytes,
              COALESCE(d.in_peak, 0)::float8   AS in_peak,
              COALESCE(d.out_peak, 0)::float8  AS out_peak,
              COALESCE(d.errors, 0)::float8    AS errors,
              COALESCE(d.discards, 0)::float8  AS discards,
              f.p95_in::float8, f.p95_out::float8, f.p95::float8,
              COALESCE(f.samples, 0)::int AS samples,
              COALESCE(e.flaps, 0)::int AS flaps,
              CASE WHEN p.speed_mbps > 0 THEN
                GREATEST(COALESCE(d.in_bytes, 0), COALESCE(d.out_bytes, 0)) * 8
                  / NULLIF(p.speed_mbps * 1e6 * GREATEST(0, EXTRACT(EPOCH FROM
                      (LEAST(now(), $2::date + 1) - GREATEST($1::date, p.created_at)))), 0)
                  * 100
              END::float8 AS avg_util
         FROM switch_ports p
         JOIN switches w ON w.id = p.switch_id
         LEFT JOIN servers s   ON s.id = p.server_id
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN LATERAL (
           SELECT SUM(in_bytes) AS in_bytes, SUM(out_bytes) AS out_bytes,
                  MAX(in_bps_max) AS in_peak, MAX(out_bps_max) AS out_peak,
                  SUM(errors) AS errors, SUM(discards) AS discards
             FROM switch_port_daily
            WHERE port_id = p.id AND day BETWEEN $1::date AND $2::date
         ) d ON TRUE
         LEFT JOIN LATERAL (
           SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY in_bps)  AS p95_in,
                  percentile_disc(0.95) WITHIN GROUP (ORDER BY out_bps) AS p95_out,
                  percentile_disc(0.95) WITHIN GROUP (ORDER BY GREATEST(in_bps, out_bps)) AS p95,
                  COUNT(*) AS samples
             FROM switch_port_5min
            WHERE port_id = p.id AND ts >= $1::date AND ts < $2::date + 1
         ) f ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE oper_up IS NOT TRUE) AS flaps  -- قطع، یا قطع و وصل کوتاه
             FROM switch_port_events
            WHERE port_id = p.id AND ts >= $1::date AND ts < $2::date + 1
         ) e ON TRUE
        WHERE w.is_active
          AND p.kind IN ('ethernet', 'port-channel')
          AND ($3::int IS NULL OR w.id = $3)
          AND (p.is_present OR d.in_bytes > 0 OR d.out_bytes > 0)
        ORDER BY w.name,
                 CASE p.kind WHEN 'ethernet' THEN 0 ELSE 1 END,
                 (SELECT array_agg(rm.x[1]::bigint) FROM regexp_matches(p.name, '([0-9]+)', 'g') AS rm(x)),
                 p.name`,
      [from, to, switchId],
    );

    if (url.searchParams.get('format') === 'csv') return csvResponse(rows, from, to);
    return ok({ from, to, label, rows });
  });
}

const GB = Math.pow(1024, 3);
const MBPS = 1e6;

/** نقل‌قول و خنثی‌کردن فرمول اکسل؛ توضیح پورت از سوییچ می‌آید و دست‌نوشته است */
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvResponse(rows: ReportRow[], from: string, to: string) {
  const mb = (v: number | null) => (v === null ? '' : (v / MBPS).toFixed(2));
  const lines = [
    [
      'سوییچ', 'پورت', 'توضیح', 'سرور', 'مشتری', 'سرعت پورت (Mbps)',
      'ورودی (گیگابایت)', 'خروجی (گیگابایت)', 'اوج ورودی (Mbps)', 'اوج خروجی (Mbps)',
      'صدک ۹۵ ورودی (Mbps)', 'صدک ۹۵ خروجی (Mbps)', 'صدک ۹۵ (Mbps)', 'نمونه پنج‌دقیقه‌ای',
      'میانگین بهره‌وری (درصد)', 'خطا', 'دورریخته', 'قطع',
    ].join(','),
  ];
  for (const r of rows) {
    lines.push(
      [
        cell(r.switch_name), cell(r.port), cell(r.description), cell(r.server_name), cell(r.customer_name),
        cell(r.speed_mbps), (r.in_bytes / GB).toFixed(2), (r.out_bytes / GB).toFixed(2),
        mb(r.in_peak), mb(r.out_peak), mb(r.p95_in), mb(r.p95_out), mb(r.p95), r.samples,
        r.avg_util === null ? '' : r.avg_util.toFixed(2), r.errors, r.discards, r.flaps,
      ].join(','),
    );
  }
  const body = '﻿' + lines.join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="switch-ports-${from}-${to}.csv"`,
    },
  });
}
