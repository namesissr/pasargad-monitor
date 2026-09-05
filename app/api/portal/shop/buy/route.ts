import { query, queryOne } from '@/lib/db';
import { requireCustomer, ForbiddenError } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { nextInvoiceNumber } from '@/lib/invoices';

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
 */

/** شماره سفارش خوانا */
async function nextOrderNumber(): Promise<string> {
  const row = await queryOne<{ n: string }>(`SELECT nextval('order_number_seq')::text AS n`);
  return `S${new Date().getFullYear()}-${String(row?.n ?? '1').padStart(5, '0')}`;
}

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

      const number = await nextInvoiceNumber();
      const row = await queryOne<{ id: number }>(
        `INSERT INTO invoices
           (number, customer_id, server_id, kind, title, amount_toman,
            traffic_package_id, traffic_gb, due_at)
         VALUES ($1, $2, $3, 'traffic', $4, $5, $6, $7, CURRENT_DATE)
         RETURNING id`,
        [
          number,
          customerId,
          serverId,
          `${pack.name} — سرور «${server.name}»`,
          // قیمت از بسته، نه از درخواست
          Math.round(Number(pack.price_toman)),
          pack.id,
          // مقدار گیگ روی فاکتور کپی می‌شود: ویرایش بعدی بسته نباید
          // شرایط فاکتور صادرشده را عوض کند
          Number(pack.gb),
        ],
      );

      return ok({ invoiceId: row?.id, number }, { status: 201 });
    }

    // ── محصول ─────────────────────────────────────────────
    if (type === 'product') {
      const productId = Number(body.product_id);
      if (!Number.isInteger(productId) || productId <= 0) {
        return fail('محصول را انتخاب کنید', 400);
      }

      const product = await queryOne<{
        id: number;
        name: string;
        price_toman: number;
        setup_toman: number;
        stock: number | null;
      }>(
        `SELECT id, name, price_toman::float8 AS price_toman,
                setup_toman::float8 AS setup_toman, stock
           FROM products WHERE id = $1 AND is_active`,
        [productId],
      );
      if (!product) return fail('این محصول دیگر در دسترس نیست', 404);

      // موجودی اینجا فقط بررسی می‌شود، نه رزرو. رزرو یعنی فاکتور
      // رهاشده موجودی را تا ابد قفل کند. کم‌شدن واقعی هنگام پرداخت
      // انجام می‌شود.
      if (product.stock !== null && product.stock <= 0) {
        return fail('موجودی این محصول تمام شده است', 409);
      }

      const total = Math.round(Number(product.price_toman) + Number(product.setup_toman));

      const orderNumber = await nextOrderNumber();
      const order = await queryOne<{ id: number }>(
        `INSERT INTO orders
           (number, customer_id, product_id, product_name, price_toman, note)
         VALUES ($1, $2, $3, $4, $5, NULLIF($6,''))
         RETURNING id`,
        [
          orderNumber,
          customerId,
          product.id,
          product.name,
          total,
          String(body.note ?? '').trim().slice(0, 500),
        ],
      );

      const number = await nextInvoiceNumber();
      const invoice = await queryOne<{ id: number }>(
        `INSERT INTO invoices
           (number, customer_id, kind, title, amount_toman, order_id, due_at)
         VALUES ($1, $2, 'order', $3, $4, $5, CURRENT_DATE)
         RETURNING id`,
        [number, customerId, `سفارش ${product.name}`, total, order?.id],
      );

      await query(`UPDATE orders SET invoice_id = $2 WHERE id = $1`, [order?.id, invoice?.id]);

      return ok({ invoiceId: invoice?.id, number, orderNumber }, { status: 201 });
    }

    return fail('نوع خرید نامعتبر است', 400);
  });
}
