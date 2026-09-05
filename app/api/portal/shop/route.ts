import { query } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { paypingConfig } from '@/lib/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * فروشگاه مشتری: بسته‌های ترافیک و محصولات.
 *
 * فقط ردیف‌های فعال برمی‌گردند. ردیف غیرفعال یعنی «دیگر نمی‌فروشیم» و
 * نباید حتی دیده شود، وگرنه مشتری چیزی می‌بیند که خریدنش خطا می‌دهد.
 *
 * سرورهای مشتری هم می‌آیند، چون خرید بسته ترافیک بدون انتخاب سرور
 * معنایی ندارد.
 */
export async function GET() {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const s = await getSettings();
    const cfg = await paypingConfig();

    const packages = await query(
      `SELECT id, name, gb::float8 AS gb, price_toman::float8 AS price_toman, description
         FROM traffic_packages
        WHERE is_active
        ORDER BY sort_order, gb`,
    );

    const products = await query(
      `SELECT id, name, kind, summary,
              spec_cpu, spec_ram, spec_disk, spec_bandwidth, spec_location,
              price_toman::float8 AS price_toman,
              setup_toman::float8 AS setup_toman,
              billing_months,
              -- موجودی دقیق به مشتری نشان داده نمی‌شود؛ فقط اینکه هست
              -- یا نه. عدد دقیق موجودی، اطلاعات کسب‌وکار ماست.
              (stock IS NULL OR stock > 0) AS in_stock
         FROM products
        WHERE is_active
        ORDER BY sort_order, price_toman`,
    );

    // سرورهای مشتری، با وضعیت ترافیکشان — تا هنگام خرید بسته معلوم
    // باشد کدام سرور کم آورده
    const servers = await query(
      `SELECT s.id, s.name, host(s.main_ip) AS main_ip,
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

    return ok({
      enabled: s.shop_enabled !== 'false',
      gatewayReady: cfg.enabled,
      packages,
      products,
      servers,
    });
  });
}
