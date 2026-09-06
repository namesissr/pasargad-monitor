import { queryOne } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { validateDiscount, type DiscountScope } from '@/lib/discounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * بررسی کد تخفیف، پیش از خرید.
 *
 * فقط پیش‌نمایش است و چیزی را مصرف نمی‌کند. مبلغ خرید از دیتابیس
 * خوانده می‌شود، نه از درخواست — وگرنه مشتری با فرستادن مبلغ بزرگ،
 * تخفیفی می‌گیرد که شرط حداقل خرید را دور زده.
 *
 * همان تابعی صدا زده می‌شود که خودِ خرید استفاده می‌کند. دو پیاده‌سازی
 * یعنی مشتری یک مبلغ می‌بیند و فاکتوری با مبلغ دیگر می‌گیرد.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { customerId } = await requireCustomer();
    const body = await readJson<Record<string, unknown>>(req);

    const type = String(body.type ?? '');
    let subtotal = 0;
    let itemId = 0;
    let scope: DiscountScope;

    if (type === 'traffic') {
      scope = 'traffic';
      const packageId = Number(body.package_id);
      if (!Number.isInteger(packageId) || packageId <= 0) {
        return fail('بسته را انتخاب کنید', 400);
      }
      const pack = await queryOne<{ id: number; price_toman: number }>(
        `SELECT id, price_toman::float8 AS price_toman FROM traffic_packages
          WHERE id = $1 AND is_active`,
        [packageId],
      );
      if (!pack) return fail('این بسته در دسترس نیست', 404);
      subtotal = Math.round(Number(pack.price_toman));
      itemId = pack.id;
    } else if (type === 'product') {
      scope = 'product';
      const productId = Number(body.product_id);
      if (!Number.isInteger(productId) || productId <= 0) {
        return fail('محصول را انتخاب کنید', 400);
      }
      const product = await queryOne<{ id: number; price_toman: number; setup_toman: number }>(
        `SELECT id, price_toman::float8 AS price_toman, setup_toman::float8 AS setup_toman
           FROM products WHERE id = $1 AND is_active`,
        [productId],
      );
      if (!product) return fail('این محصول در دسترس نیست', 404);
      subtotal = Math.round(Number(product.price_toman) + Number(product.setup_toman));
      itemId = product.id;
    } else {
      return fail('نوع خرید نامعتبر است', 400);
    }

    const result = await validateDiscount(body.code, { customerId, scope, subtotal, itemId });

    if (!result.ok) {
      return ok({ ok: false, reason: result.reason || 'کد تخفیف معتبر نیست' });
    }

    return ok({
      ok: true,
      code: result.code,
      title: result.title,
      subtotal,
      discount: result.discount,
      payable: Math.max(0, subtotal - result.discount),
    });
  });
}
