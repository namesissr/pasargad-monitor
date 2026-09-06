import { queryOne } from '@/lib/db';
import { requireCustomer, ForbiddenError } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { nextInvoiceNumber } from '@/lib/invoices';
import { validateDiscount } from '@/lib/discounts';
import { createProductOrder, settleIfFree } from '@/lib/shop-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ساخت فاکتور برای خرید از فروشگاه.
 *
 * ── قاعده‌ای که نباید شکسته شود ────────────────────────────
 *
 * **قیمت و مقدار هرگز از بدنه درخواست خوانده نمی‌شوند.** فقط شناسه
 * بسته یا محصول از مشتری می‌آید؛ بقیه از دیتابیس. اگر قیمت از درخواست
 * بیاید، مشتری با عوض‌کردن یک عدد، سرور را هزار تومان می‌خرد.
 *
 * این همان قاعده‌ای است که در تأیید پرداخت هم هست، و همان دلیل: هرچه
 * از مرورگر می‌آید قابل دستکاری است.
 *
 * ── چرا پرداخت اینجا شروع نمی‌شود ──────────────────────────
 *
 * این مسیر فقط فاکتور می‌سازد و شناسه‌اش را برمی‌گرداند. شروع پرداخت
 * کار مسیر موجود /api/portal/invoices/[id]/pay است که آزموده شده.
 * تکرار منطق درگاه در دو جا، دیر یا زود دو رفتار متفاوت می‌دهد.
 *
 * فاکتوری که پرداخت نشود در فهرست فاکتورها می‌ماند و بعدا قابل پرداخت
 * است — که رفتار درستی است، نه یک عارضه.
 *
 * ── کد تخفیف ───────────────────────────────────────────────
 *
 * فقط **متن کد** از مشتری می‌آید؛ مبلغ تخفیف سمت سرور محاسبه می‌شود.
 * اگر مبلغ از درخواست بیاید، مشتری با عوض‌کردن یک عدد هر چیزی را
 * رایگان می‌خرد.
 *
 * کد اینجا **مصرف نمی‌شود** — فقط مبلغش روی فاکتور می‌نشیند. مصرف
 * واقعی هنگام پرداخت موفق انجام می‌شود، وگرنه با شروع و لغو مکرر
 * ظرفیت کد می‌سوخت.
 */

export async function POST(req: Request) {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const s = await getSettings();
    if (s.shop_enabled === 'false') return fail('فروشگاه در دسترس نیست', 503);

    const body = await readJson<Record<string, unknown>>(req);
    const type = String(body.type ?? '');

    // ── بسته ترافیک ───────────────────────────────────────
    if (type === 'traffic') {
      const packageId = Number(body.package_id);
      if (!Number.isInteger(packageId) || packageId <= 0) {
        return fail('بسته را انتخاب کنید', 400);
      }

      const serverId = Number(body.server_id);
      if (!Number.isInteger(serverId) || serverId <= 0) {
        return fail('سرور مقصد را انتخاب کنید', 400);
      }

      // سرور باید مال همین مشتری باشد. بدون این، مشتری با عوض‌کردن
      // یک عدد، ترافیک را روی سرور کس دیگری می‌ریزد.
      const server = await queryOne<{ id: number; name: string }>(
        `SELECT id, name FROM servers WHERE id = $1 AND customer_id = $2 AND is_active`,
        [serverId, customerId],
      );
      if (!server) throw new ForbiddenError('سرور پیدا نشد');

      const pack = await queryOne<{ id: number; name: string; gb: number; price_toman: number }>(
        `SELECT id, name, gb::float8 AS gb, price_toman::float8 AS price_toman
           FROM traffic_packages WHERE id = $1 AND is_active`,
        [packageId],
      );
      if (!pack) return fail('این بسته دیگر در دسترس نیست', 404);

      // قیمت از بسته، نه از درخواست
      const subtotal = Math.round(Number(pack.price_toman));
      const discount = await validateDiscount(body.discount_code, {
        customerId,
        scope: 'traffic',
        subtotal,
        itemId: pack.id,
      });

      // کد نامعتبر خرید را متوقف می‌کند، نه اینکه بی‌صدا نادیده گرفته
      // شود: مشتری مبلغ تخفیف‌خورده را دیده و انتظار همان را دارد.
      if (discount.reason) return fail(discount.reason, 400);

      const payable = Math.max(0, subtotal - discount.discount);

      const number = await nextInvoiceNumber();
      const row = await queryOne<{ id: number }>(
        `INSERT INTO invoices
           (number, customer_id, server_id, kind, title, amount_toman,
            subtotal_toman, discount_toman, discount_code_id,
            traffic_package_id, traffic_gb, due_at)
         VALUES ($1, $2, $3, 'traffic', $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE)
         RETURNING id`,
        [
          number,
          customerId,
          serverId,
          `${pack.name} — سرور «${server.name}»`,
          payable,
          subtotal,
          discount.discount,
          discount.codeId,
          pack.id,
          // مقدار گیگ روی فاکتور کپی می‌شود: ویرایش بعدی بسته نباید
          // شرایط فاکتور صادرشده را عوض کند
          Number(pack.gb),
        ],
      );

      const free = await settleIfFree(Number(row?.id), payable);
      if (free.free && !free.ok) return fail(free.error || 'تحویل رایگان ناموفق بود', 500);

      return ok(
        { invoiceId: row?.id, number, payable, discount: discount.discount, paid: free.free },
        { status: 201 },
      );
    }

    // ── محصول ─────────────────────────────────────────────
    //
    // منطقش در lib/shop-order.ts است چون فروشگاه عمومی هم همان را صدا
    // می‌زند. قاعده «قیمت از دیتابیس، نه از درخواست» باید یک جا باشد.
    if (type === 'product') {
      const result = await createProductOrder({
        customerId,
        productId: body.product_id,
        discountCode: body.discount_code,
        note: body.note,
        addonPackageId: body.addon_package_id,
        addonIps: body.addon_ips,
      });
      if (!result.ok) return fail(result.error || 'ثبت سفارش ناموفق بود', result.status ?? 400);

      return ok(
        {
          invoiceId: result.invoiceId,
          number: result.number,
          orderNumber: result.orderNumber,
          payable: result.payable,
          discount: result.discount,
          paid: result.paid,
        },
        { status: 201 },
      );
    }

    return fail('نوع خرید نامعتبر است', 400);
  });
}
