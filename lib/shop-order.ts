import { query, queryOne } from '@/lib/db';
import { nextInvoiceNumber, settleInvoice } from '@/lib/invoices';
import { validateDiscount } from '@/lib/discounts';

/**
 * ساخت سفارش محصول و فاکتورش.
 *
 * ── قاعده‌ای که نباید شکسته شود ────────────────────────────
 *
 * **قیمت هرگز از بدنه درخواست خوانده نمی‌شود.** فقط شناسه محصول از
 * مشتری می‌آید؛ قیمت، هزینه راه‌اندازی و موجودی از دیتابیس. اگر قیمت از
 * درخواست بیاید، مشتری با عوض‌کردن یک عدد سرور را هزار تومان می‌خرد.
 *
 * ── چرا اینجاست و نه در مسیر ای‌پی‌آی ──────────────────────
 *
 * دو مسیر همین کار را می‌کنند: فروشگاه پرتال برای مشتری واردشده، و
 * فروشگاه عمومی که مشتری حین سفارش ثبت‌نام می‌کند.
 *
 * اگر هرکدام نسخه خودش را داشته باشد، همین قاعده قیمت در یکی‌شان
 * دیر یا زود شل می‌شود — و آن یکی همان است که از اینترنت باز در دسترس
 * است.
 *
 * ── چرا پرداخت اینجا شروع نمی‌شود ──────────────────────────
 *
 * این تابع فقط فاکتور می‌سازد. شروع پرداخت کار مسیر آزموده‌شده
 * /api/portal/invoices/[id]/pay است. تکرار منطق درگاه در دو جا، دیر یا
 * زود دو رفتار متفاوت می‌دهد.
 */

export interface OrderResult {
  ok: boolean;
  error?: string;
  status?: number;
  invoiceId?: number;
  number?: string;
  orderNumber?: string;
  payable?: number;
  discount?: number;
  paid?: boolean;
}

/** شماره سفارش خوانا */
export async function nextOrderNumber(): Promise<string> {
  const row = await queryOne<{ n: string }>(`SELECT nextval('order_number_seq')::text AS n`);
  return `S${new Date().getFullYear()}-${String(row?.n ?? '1').padStart(5, '0')}`;
}

/**
 * فاکتور صفر تومانی را همان‌جا تسویه می‌کند.
 *
 * تخفیفی که کل مبلغ را بپوشاند چیزی برای پرداخت نمی‌گذارد. فرستادن
 * مشتری به درگاه با مبلغ صفر فقط خطا می‌دهد؛ سرویس باید بلافاصله
 * تحویل شود.
 */
export async function settleIfFree(invoiceId: number, payable: number) {
  if (payable > 0) return { free: false as const };
  const result = await settleInvoice(invoiceId, {
    refId: null,
    paymentCode: null,
    cardNumber: null,
  });
  return { free: true as const, ok: result.ok, error: result.error };
}

export async function createProductOrder(opts: {
  customerId: number;
  productId: unknown;
  discountCode?: unknown;
  note?: unknown;
}): Promise<OrderResult> {
  const productId = Number(opts.productId);
  if (!Number.isInteger(productId) || productId <= 0) {
    return { ok: false, error: 'محصول را انتخاب کنید', status: 400 };
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
  if (!product) return { ok: false, error: 'این محصول دیگر در دسترس نیست', status: 404 };

  // موجودی اینجا فقط بررسی می‌شود، نه رزرو. رزرو یعنی فاکتور رهاشده
  // موجودی را تا ابد قفل کند. کم‌شدن واقعی هنگام پرداخت انجام می‌شود.
  if (product.stock !== null && product.stock <= 0) {
    return { ok: false, error: 'موجودی این محصول تمام شده است', status: 409 };
  }

  const subtotal = Math.round(Number(product.price_toman) + Number(product.setup_toman));

  // فقط متن کد از مشتری می‌آید؛ مبلغ تخفیف سمت سرور محاسبه می‌شود
  const discount = await validateDiscount(opts.discountCode, {
    customerId: opts.customerId,
    scope: 'product',
    subtotal,
    itemId: product.id,
  });

  // کد نامعتبر خرید را متوقف می‌کند، نه اینکه بی‌صدا نادیده گرفته شود:
  // مشتری مبلغ تخفیف‌خورده را دیده و انتظار همان را دارد.
  if (discount.reason) return { ok: false, error: discount.reason, status: 400 };

  const total = Math.max(0, subtotal - discount.discount);

  const orderNumber = await nextOrderNumber();
  const order = await queryOne<{ id: number }>(
    `INSERT INTO orders
       (number, customer_id, product_id, product_name, price_toman, note)
     VALUES ($1, $2, $3, $4, $5, NULLIF($6,''))
     RETURNING id`,
    [
      orderNumber,
      opts.customerId,
      product.id,
      product.name,
      // قیمت روی سفارش، همان مبلغی است که مشتری واقعا می‌پردازد
      total,
      String(opts.note ?? '').trim().slice(0, 500),
    ],
  );

  const number = await nextInvoiceNumber();
  const invoice = await queryOne<{ id: number }>(
    `INSERT INTO invoices
       (number, customer_id, kind, title, amount_toman,
        subtotal_toman, discount_toman, discount_code_id, order_id, due_at)
     VALUES ($1, $2, 'order', $3, $4, $5, $6, $7, $8, CURRENT_DATE)
     RETURNING id`,
    [
      number,
      opts.customerId,
      `سفارش ${product.name}`,
      total,
      subtotal,
      discount.discount,
      discount.codeId,
      order?.id,
    ],
  );

  await query(`UPDATE orders SET invoice_id = $2 WHERE id = $1`, [order?.id, invoice?.id]);

  const free = await settleIfFree(Number(invoice?.id), total);
  if (free.free && !free.ok) {
    return { ok: false, error: free.error || 'ثبت سفارش رایگان ناموفق بود', status: 500 };
  }

  return {
    ok: true,
    invoiceId: Number(invoice?.id),
    number,
    orderNumber,
    payable: total,
    discount: discount.discount,
    paid: free.free,
  };
}
