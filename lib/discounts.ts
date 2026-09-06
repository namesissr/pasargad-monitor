import { queryOne } from '@/lib/db';

/**
 * کد تخفیف.
 *
 * تخفیف **مبلغی** است نه درصدی: مبلغ ثابت از فاکتور کم می‌شود.
 *
 * ── چرا یک تابع، نه دو ─────────────────────────────────────
 *
 * هم پیش‌نمایش (وقتی مشتری کد را وارد می‌کند) و هم خود خرید، از همین
 * تابع استفاده می‌کنند. دو پیاده‌سازی یعنی مشتری یک مبلغ می‌بیند و
 * فاکتوری با مبلغ دیگر می‌گیرد — و آن اختلاف را تا لحظه پرداخت
 * نمی‌فهمد.
 *
 * ── چه چیزی هرگز از مرورگر نمی‌آید ─────────────────────────
 *
 * فقط **متن کد** از مشتری می‌آید. مبلغ تخفیف، مبلغ خرید، و شناسه مشتری
 * همه سمت سرور محاسبه می‌شوند. اگر مبلغ تخفیف از درخواست بیاید، مشتری
 * با عوض‌کردن یک عدد هر چیزی را رایگان می‌خرد.
 */

export type DiscountScope = 'traffic' | 'product';

export interface DiscountResult {
  ok: boolean;
  /** مبلغ تخفیف به تومان؛ هرگز بیشتر از مبلغ خرید نمی‌شود */
  discount: number;
  codeId: number | null;
  code: string | null;
  title: string | null;
  reason?: string;
}

const NO_DISCOUNT: DiscountResult = {
  ok: false,
  discount: 0,
  codeId: null,
  code: null,
  title: null,
};

/**
 * یکسان‌سازی متن کد.
 *
 * حروف بزرگ و بدون فاصله. بدون این، «tp2026» و «TP2026 » دو کد متفاوت
 * حساب می‌شوند و مشتری فکر می‌کند کدش کار نمی‌کند.
 */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 60);
}

/**
 * اعتبارسنجی کد برای یک خرید مشخص.
 *
 * subtotal مبلغ پیش از تخفیف است و همیشه سمت سرور محاسبه شده.
 */
export async function validateDiscount(
  rawCode: unknown,
  opts: {
    customerId: number;
    scope: DiscountScope;
    subtotal: number;
    /** شناسه همان محصول یا بسته‌ای که خریده می‌شود */
    itemId: number;
  },
): Promise<DiscountResult> {
  const code = normalizeCode(rawCode);
  if (!code) return NO_DISCOUNT;

  const row = await queryOne<{
    id: number;
    code: string;
    title: string | null;
    amount_toman: number;
    customer_id: number | null;
    scope: string;
    product_id: number | null;
    package_id: number | null;
    min_amount_toman: number;
    max_uses: number | null;
    used_count: number;
    once_per_customer: boolean;
    starts_at: string | null;
    expires_at: string | null;
    is_active: boolean;
  }>(
    `SELECT id, code, title, amount_toman::float8 AS amount_toman, customer_id, scope,
            product_id, package_id,
            min_amount_toman::float8 AS min_amount_toman,
            max_uses, used_count, once_per_customer,
            to_char(starts_at, 'YYYY-MM-DD') AS starts_at,
            to_char(expires_at, 'YYYY-MM-DD') AS expires_at,
            is_active
       FROM discount_codes WHERE code = $1`,
    [code],
  );

  // پیام «کد پیدا نشد» برای همه حالت‌های نامعتبر یکسان نیست — مشتری
  // باید بفهمد مشکل کجاست. ولی هیچ پیامی نباید بگوید کد مال مشتری
  // دیگری است؛ آن اطلاعات ما نیست که فاش کنیم.
  if (!row || !row.is_active) {
    return { ...NO_DISCOUNT, reason: 'کد تخفیف معتبر نیست' };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (row.starts_at && today < row.starts_at) {
    return { ...NO_DISCOUNT, reason: 'زمان استفاده از این کد هنوز نرسیده است' };
  }
  if (row.expires_at && today > row.expires_at) {
    return { ...NO_DISCOUNT, reason: 'این کد منقضی شده است' };
  }

  if (row.customer_id !== null && row.customer_id !== opts.customerId) {
    return { ...NO_DISCOUNT, reason: 'کد تخفیف معتبر نیست' };
  }

  if (row.scope !== 'all' && row.scope !== opts.scope) {
    return {
      ...NO_DISCOUNT,
      reason:
        row.scope === 'traffic'
          ? 'این کد فقط برای بسته ترافیک است'
          : 'این کد فقط برای محصولات است',
    };
  }

  // کد بسته‌شده به یک محصول یا یک بسته مشخص.
  //
  // تهی‌بودن یعنی همه — پس کدهای قدیمی که این ستون‌ها را ندارند
  // دست‌نخورده کار می‌کنند.
  if (row.product_id !== null) {
    if (opts.scope !== 'product' || row.product_id !== opts.itemId) {
      return { ...NO_DISCOUNT, reason: 'این کد برای این محصول نیست' };
    }
  }
  if (row.package_id !== null) {
    if (opts.scope !== 'traffic' || row.package_id !== opts.itemId) {
      return { ...NO_DISCOUNT, reason: 'این کد برای این بسته نیست' };
    }
  }

  if (Number(row.min_amount_toman) > opts.subtotal) {
    return {
      ...NO_DISCOUNT,
      reason: `این کد برای خرید بالای ${Number(row.min_amount_toman).toLocaleString('fa-IR')} تومان است`,
    };
  }

  if (row.max_uses !== null && Number(row.used_count) >= Number(row.max_uses)) {
    return { ...NO_DISCOUNT, reason: 'ظرفیت این کد تمام شده است' };
  }

  if (row.once_per_customer) {
    const used = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM discount_uses
        WHERE code_id = $1 AND customer_id = $2`,
      [row.id, opts.customerId],
    );
    if (Number(used?.cnt) > 0) {
      return { ...NO_DISCOUNT, reason: 'شما قبلا از این کد استفاده کرده‌اید' };
    }
  }

  // تخفیف هرگز بیشتر از مبلغ خرید نمی‌شود. بدون این، فاکتور مبلغ منفی
  // می‌گرفت و درگاه هم آن را نمی‌پذیرفت.
  const discount = Math.min(Math.round(Number(row.amount_toman)), Math.round(opts.subtotal));

  return {
    ok: true,
    discount,
    codeId: row.id,
    code: row.code,
    title: row.title,
  };
}
