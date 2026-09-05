import { query } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';
import { handle, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * تاریخچه خرید ترافیک مشتری، روی همه سرورهایش.
 *
 * مبلغ هم برمی‌گردد: این تراکنش خودِ مشتری است و پولش را داده. آنچه
 * برنمی‌گردد نام ثبت‌کننده است — کدام همکار ما آن را وارد کرده به مشتری
 * ربطی ندارد.
 *
 * قید به مشتری از راه join روی servers است، نه از پارامتر.
 */
export async function GET() {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const topups = await query(
      `SELECT t.id, t.gb::float8 AS gb, t.price_toman::float8 AS price_toman,
              t.note, t.created_at,
              s.id AS server_id, s.name AS server_name
         FROM traffic_topups t
         JOIN servers s ON s.id = t.server_id
        WHERE s.customer_id = $1 AND s.is_active
        ORDER BY t.created_at DESC
        LIMIT 200`,
      [customerId],
    );

    // وضعیت ترافیک هر سرور، کنار تاریخچه — چون سؤال بعدی همیشه همین است
    const servers = await query(
      `SELECT s.id, s.name,
              tp.purchased::float8 AS purchased_gb,
              (tp.used_bytes / 1073741824 + s.traffic_used_before_gb)::float8 AS used_gb,
              (tp.purchased - tp.used_bytes / 1073741824 - s.traffic_used_before_gb)::float8
                AS balance_gb
         FROM servers s
         LEFT JOIN LATERAL (
           SELECT COALESCE((SELECT SUM(gb) FROM traffic_topups tt
                             WHERE tt.server_id = s.id), 0)::float8 AS purchased,
                  COALESCE((SELECT SUM(d.rx_bytes) FROM server_metrics_daily d
                             WHERE d.server_id = s.id
                               AND s.traffic_counted_from IS NOT NULL
                               AND d.day >= s.traffic_counted_from), 0)::float8 AS used_bytes
         ) tp ON TRUE
        WHERE s.customer_id = $1 AND s.is_active
        ORDER BY s.name`,
      [customerId],
    );

    return ok({ topups, servers });
  });
}
