import { query } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { lastMonths, type Calendar } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * گزارش مصرف ماهانه مشتری، روی همه سرورهایش.
 *
 * دوره‌ها به‌شکل آرایه به پستگرس داده می‌شوند و با unnest به جدول تبدیل
 * می‌شوند. دلیلش این است که ماه شمسی طول ثابت ندارد و date_trunc آن را
 * نمی‌شناسد؛ مرزها را باید سمت جاوااسکریپت حساب کرد.
 *
 * ماهی که هیچ داده‌ای ندارد هم با صفر برمی‌گردد. حذفش یعنی نمودار
 * پرش دارد و مشتری فکر می‌کند گزارش ناقص است.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const url = new URL(req.url);
    const count = Math.min(Math.max(Number(url.searchParams.get('months')) || 12, 1), 24);

    const s = await getSettings();
    const calendar: Calendar = s.traffic_calendar === 'gregorian' ? 'gregorian' : 'jalali';
    const periods = lastMonths(count, calendar);

    const labels = periods.map((p) => p.label);
    const froms = periods.map((p) => p.from);
    const tos = periods.map((p) => p.to);

    // جمع همه سرورهای مشتری، ماه به ماه
    const totals = await query(
      `SELECT p.label,
              to_char(p.from_day, 'YYYY-MM-DD') AS from_day,
              COALESCE(SUM(d.rx_bytes), 0)::float8 AS rx,
              COALESCE(SUM(d.tx_bytes), 0)::float8 AS tx
         FROM (SELECT unnest($2::text[]) AS label,
                      unnest($3::date[]) AS from_day,
                      unnest($4::date[]) AS to_day) p
         LEFT JOIN servers s ON s.customer_id = $1 AND s.is_active
         LEFT JOIN server_metrics_daily d
                ON d.server_id = s.id AND d.day BETWEEN p.from_day AND p.to_day
        GROUP BY p.label, p.from_day
        ORDER BY p.from_day DESC`,
      [customerId, labels, froms, tos],
    );

    // تفکیک به‌ازای سرور، برای همان دوره‌ها
    const perServer = await query(
      `SELECT s.id AS server_id, s.name AS server_name, p.label,
              COALESCE(SUM(d.rx_bytes), 0)::float8 AS rx,
              COALESCE(SUM(d.tx_bytes), 0)::float8 AS tx
         FROM servers s
         CROSS JOIN (SELECT unnest($2::text[]) AS label,
                            unnest($3::date[]) AS from_day,
                            unnest($4::date[]) AS to_day) p
         LEFT JOIN server_metrics_daily d
                ON d.server_id = s.id AND d.day BETWEEN p.from_day AND p.to_day
        WHERE s.customer_id = $1 AND s.is_active
        GROUP BY s.id, s.name, p.label, p.from_day
        ORDER BY s.name, p.from_day DESC`,
      [customerId, labels, froms, tos],
    );

    return ok({ periods: labels, totals, perServer });
  });
}
