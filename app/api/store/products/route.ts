import { query } from '@/lib/db';
import { handle, idParam, ok } from '@/lib/http';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * کاتالوگ عمومی محصولات — بدون ورود.
 *
 * ── این مسیر عمدا باز است ──────────────────────────────────
 *
 * مشتری تازه باید بتواند پیش از ثبت‌نام محصولات را ببیند. مسیر در
 * PUBLIC_PATHS میان‌افزار و در OPEN_ROUTES بررسی‌ها ثبت شده است.
 *
 * ── چه چیزی برنمی‌گردد ─────────────────────────────────────
 *
 * فقط ستون‌هایی که روی صفحه محصول چاپ می‌شوند. مقدار دقیق موجودی
 * برنمی‌گردد — فقط «هست» یا «نیست». دانستن اینکه سه عدد مانده برای
 * خریدار فایده‌ای ندارد و برای رقیب دارد.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const s = await getSettings();
    if (s.store_public_enabled === 'false' || s.shop_enabled === 'false') {
      return ok({ enabled: false, products: [], intro: '' });
    }

    const url = new URL(req.url);
    const id = idParam(url, 'id');

    const params: unknown[] = [];
    let where = 'WHERE is_active';
    if (id !== null) {
      params.push(id);
      where += ` AND id = $${params.length}`;
    }

    const products = await query(
      `SELECT id, name, kind, summary,
              spec_cpu, spec_ram, spec_disk, spec_bandwidth, spec_location,
              price_toman::float8 AS price_toman,
              setup_toman::float8 AS setup_toman,
              billing_months,
              (stock IS NULL OR stock > 0) AS in_stock
         FROM products
         ${where}
        ORDER BY sort_order, price_toman
        LIMIT 100`,
      params,
    );

    return ok({
      enabled: true,
      products,
      intro: s.store_intro || '',
      brand: s.invoice_seller_name || s.panel_title || 'پاسارگاد میزبان',
    });
  });
}
