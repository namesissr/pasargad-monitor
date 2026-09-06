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
 * ── افزودنی‌ها ─────────────────────────────────────────────
 *
 * مشتری می‌تواند هنگام سفارش، بسته ترافیک و آی‌پی اضافه هم بردارد.
 * قیمت هر دو **از دیتابیس** می‌آید: بسته از traffic_packages و آی‌پی از
 * products.extra_ip_price_toman. فقط شناسه بسته و تعداد آی‌پی از مشتری
 * می‌آید.
 *
 * تعداد آی‌پی به سقف همان محصول محدود می‌شود. بدون سقف، مشتری هزار
 * آی‌پی سفارش می‌دهد و فاکتوری صادر می‌شود که هیچ‌وقت قابل تحویل نیست.
 *
 * ترافیک **هنگام تحویل** روی سرور می‌نشیند، نه هنگام پرداخت: سرور
 * اختصاصی موقع پرداخت هنوز وجود ندارد.
 *
 * ── چرا پرداخت اینجا شروع نمی‌شود ──────────────────────────
 *
 * این تابع فقط فاکتور می‌سازد. شروع پرداخت کار مسیر آزموده‌شده
 * /api/portal/invoices/[id]/pay است. تکرار منطق درگاه در دو جا، دیر یا
 * زود دو رفتار متفاوت می‌دهد.
 */

export interface AddonLine {
  kind: 'traffic' | 'ip';
  label: string;
  qty: number;
  unit: number;
  total: number;
  packageId: number | null;
  gb: number | null;
}

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
  addons?: AddonLine[];
}

/**
 * افزودنی‌های انتخاب‌شده، با قیمت از دیتابیس.
 *
 * هرچه از مشتری می‌آید فقط شناسه و تعداد است. اگر قیمت از درخواست
 * می‌آمد، هر افزودنی رایگان می‌شد.
 */
async function resolveAddons(
  product: { id: number; extra_ip_price_toman: number; max_extra_ips: number },
  input: { packageId?: unknown; ips?: unknown },
): Promise<{ lines: AddonLine[]; error?: string }> {
  const lines: AddonLine[] = [];

  // ── بسته ترافیک ───────────────────────────────────────
  const packageId = Number(input.packageId);
  if (Number.isInteger(packageId) && packageId > 0) {
    const pack = await queryOne<{ id: number; name: string; gb: number; price_toman: number }>(
      `SELECT id, name, gb::float8 AS gb, price_toman::float8 AS price_toman
         FROM traffic_packages WHERE id = $1 AND is_active`,
      [packageId],
    );
    if (!pack) return { lines: [], error: 'بسته ترافیک انتخاب‌شده در دسترس نیست' };

    const unit = Math.round(Number(pack.price_toman));
    lines.push({
      kind: 'traffic',
      label: pack.name,
      qty: 1,
      unit,
      total: unit,
      packageId: pack.id,
      gb: Number(pack.gb),
    });
  }

  // ── آی‌پی اضافه ───────────────────────────────────────
  const ipsRaw = Number(input.ips);
  const ips = Number.isInteger(ipsRaw) && ipsRaw > 0 ? ipsRaw : 0;
  if (ips > 0) {
    const max = Number(product.max_extra_ips) || 0;
    const unit = Math.round(Number(product.extra_ip_price_toman)) || 0;

    if (max <= 0 || unit <= 0) {
      return { lines: [], error: 'این محصول آی‌پی اضافه ندارد' };
    }
    if (ips > max) {
      return { lines: [], error: `حداکثر ${max} آی‌پی اضافه برای این محصول ممکن است` };
    }

    lines.push({
      kind: 'ip',
      label: 'آی‌پی اضافه',
      qty: ips,
      unit,
      total: unit * ips,
      packageId: null,
      gb: null,
    });
  }

  return { lines };
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
  /** بسته ترافیک اضافه؛ فقط شناسه، قیمت از دیتابیس */
  addonPackageId?: unknown;
  /** تعداد آی‌پی اضافه؛ قیمت از خود محصول */
  addonIps?: unknown;
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
    extra_ip_price_toman: number;
    max_extra_ips: number;
  }>(
    `SELECT id, name, price_toman::float8 AS price_toman,
            setup_toman::float8 AS setup_toman, stock,
            extra_ip_price_toman::float8 AS extra_ip_price_toman, max_extra_ips
       FROM products WHERE id = $1 AND is_active`,
    [productId],
  );
  if (!product) return { ok: false, error: 'این محصول دیگر در دسترس نیست', status: 404 };

  // موجودی اینجا فقط بررسی می‌شود، نه رزرو. رزرو یعنی فاکتور رهاشده
  // موجودی را تا ابد قفل کند. کم‌شدن واقعی هنگام پرداخت انجام می‌شود.
  if (product.stock !== null && product.stock <= 0) {
    return { ok: false, error: 'موجودی این محصول تمام شده است', status: 409 };
  }

  const addons = await resolveAddons(product, {
    packageId: opts.addonPackageId,
    ips: opts.addonIps,
  });
  if (addons.error) return { ok: false, error: addons.error, status: 400 };

  const addonsTotal = addons.lines.reduce((a, l) => a + l.total, 0);

  // افزودنی‌ها **پیش از** تخفیف به جمع اضافه می‌شوند: کد تخفیف روی کل
  // خرید اعمال می‌شود، نه فقط روی خود سرور.
  const subtotal =
    Math.round(Number(product.price_toman) + Number(product.setup_toman)) + addonsTotal;

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

  // ردیف‌های افزودنی، با عنوان و قیمتِ همان لحظه. ویرایش بعدی بسته
  // نباید سفارشی را که مشتری پرداخت کرده عوض کند.
  for (const line of addons.lines) {
    await query(
      `INSERT INTO order_addons
         (order_id, kind, label, qty, unit_toman, total_toman, package_id, gb)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [order?.id, line.kind, line.label, line.qty, line.unit, line.total, line.packageId, line.gb],
    );
  }

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
      addons.lines.length
        ? `سفارش ${product.name} + ${addons.lines.length} افزودنی`
        : `سفارش ${product.name}`,
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
    addons: addons.lines,
  };
}
