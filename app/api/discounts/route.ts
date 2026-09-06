import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';
import { normalizeCode } from '@/lib/discounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * مدیریت کدهای تخفیف.
 *
 * تخفیف مبلغی است نه درصدی. کد یا برای همه مشتریان است (customer_id
 * تهی) یا فقط برای یکی.
 *
 * کدی که استفاده شده حذف نمی‌شود، فقط غیرفعال: ردیف‌های مصرف به آن
 * ارجاع دارند و حذفش سابقه را قطع می‌کند.
 */

function validate(body: Record<string, unknown>) {
  const code = normalizeCode(body.code);
  if (!code) return { error: 'کد تخفیف را وارد کنید' };
  if (!/^[A-Z0-9._-]{3,60}$/.test(code)) {
    return { error: 'کد فقط می‌تواند حرف انگلیسی، عدد، خط تیره و نقطه داشته باشد (حداقل ۳ نویسه)' };
  }

  const amount = Math.round(Number(body.amount_toman));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'مبلغ تخفیف باید بیشتر از صفر باشد' };
  }
  if (amount > 10_000_000_000) return { error: 'مبلغ تخفیف بیش از حد بزرگ است' };

  const scope = String(body.scope ?? 'all');
  if (!['all', 'traffic', 'product'].includes(scope)) {
    return { error: 'دامنه کد نامعتبر است' };
  }

  const minAmount = Math.round(Number(body.min_amount_toman) || 0);
  if (!Number.isFinite(minAmount) || minAmount < 0) {
    return { error: 'حداقل مبلغ خرید نامعتبر است' };
  }

  // رشته خالی یعنی نامحدود؛ صفر یعنی هیچ‌کس نمی‌تواند استفاده کند و
  // آن تقریبا همیشه اشتباه تایپی است
  const rawMax = body.max_uses;
  const maxUses =
    rawMax === null || rawMax === undefined || String(rawMax).trim() === ''
      ? null
      : Number(rawMax);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    return { error: 'سقف استفاده باید عددی بزرگ‌تر از صفر باشد، یا خالی برای نامحدود' };
  }

  const dateOk = (v: unknown) => {
    const t = String(v ?? '').trim();
    return t === '' || /^\d{4}-\d{2}-\d{2}$/.test(t);
  };
  if (!dateOk(body.starts_at) || !dateOk(body.expires_at)) {
    return { error: 'تاریخ باید به شکل ۲۰۲۶-۰۹-۲۰ باشد' };
  }

  // هدف کد: یک محصول، یک بسته، یا هیچ‌کدام (یعنی همه).
  //
  // هر دو با هم بی‌معنی است — هیچ خریدی همزمان محصول و بسته نیست — و
  // خود دیتابیس هم قیدش را دارد. اینجا پیام قابل خواندن می‌دهیم.
  const pick = (v: unknown) =>
    v === null || v === undefined || String(v).trim() === '' ? null : Number(v);

  const productId = pick(body.product_id);
  const packageId = pick(body.package_id);

  if (productId !== null && packageId !== null) {
    return { error: 'کد نمی‌تواند همزمان به یک محصول و یک بسته بسته شود' };
  }
  if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) {
    return { error: 'محصول نامعتبر است' };
  }
  if (packageId !== null && (!Number.isInteger(packageId) || packageId <= 0)) {
    return { error: 'بسته نامعتبر است' };
  }

  const rawCustomer = body.customer_id;
  const customerId =
    rawCustomer === null || rawCustomer === undefined || String(rawCustomer).trim() === ''
      ? null
      : Number(rawCustomer);
  if (customerId !== null && (!Number.isInteger(customerId) || customerId <= 0)) {
    return { error: 'مشتری نامعتبر است' };
  }

  return {
    value: {
      code,
      title: String(body.title ?? '').trim(),
      amount,
      customerId,
      // بستن کد به یک محصول یا بسته، دامنه را هم مشخص می‌کند
      scope: productId !== null ? 'product' : packageId !== null ? 'traffic' : scope,
      productId,
      packageId,
      minAmount,
      maxUses,
      oncePerCustomer: body.once_per_customer !== false && body.once_per_customer !== 'false',
      startsAt: String(body.starts_at ?? '').trim(),
      expiresAt: String(body.expires_at ?? '').trim(),
      isActive: body.is_active !== false && body.is_active !== 'false',
      note: String(body.note ?? '').trim(),
    },
  };
}

export async function GET() {
  return handle(async () => {
    await requireUser();
    const discounts = await query(
      `SELECT d.id, d.code, d.title, d.amount_toman::float8 AS amount_toman,
              d.customer_id, c.name AS customer_name,
              d.scope, d.product_id, d.package_id,
              p.name AS product_name, tp.name AS package_name,
              d.min_amount_toman::float8 AS min_amount_toman,
              d.max_uses, d.used_count, d.once_per_customer,
              to_char(d.starts_at, 'YYYY-MM-DD')  AS starts_at,
              to_char(d.expires_at, 'YYYY-MM-DD') AS expires_at,
              d.is_active, d.note, d.created_at,
              COALESCE(u.total, 0)::float8 AS discounted_total
         FROM discount_codes d
         LEFT JOIN customers c ON c.id = d.customer_id
         LEFT JOIN products p ON p.id = d.product_id
         LEFT JOIN traffic_packages tp ON tp.id = d.package_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount_toman) AS total FROM discount_uses x WHERE x.code_id = d.id
         ) u ON TRUE
        ORDER BY d.is_active DESC, d.created_at DESC`,
    );
    return ok({ discounts });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = await requireUser();
    const parsed = validate(await readJson<Record<string, unknown>>(req));
    if (parsed.error) return fail(parsed.error, 400);
    const v = parsed.value!;

    const exists = await queryOne<{ id: number }>(
      `SELECT id FROM discount_codes WHERE code = $1`,
      [v.code],
    );
    if (exists) return fail('این کد از قبل وجود دارد', 409);

    const row = await queryOne<{ id: number }>(
      `INSERT INTO discount_codes
         (code, title, amount_toman, customer_id, scope, product_id, package_id,
          min_amount_toman, max_uses, once_per_customer, starts_at, expires_at,
          is_active, note, created_by)
       VALUES ($1, NULLIF($2,''), $3, $4, $5, $6, $7, $8, $9, $10,
               NULLIF($11,'')::date, NULLIF($12,'')::date, $13, NULLIF($14,''), $15)
       RETURNING id`,
      [
        v.code, v.title, v.amount, v.customerId, v.scope, v.productId, v.packageId,
        v.minAmount, v.maxUses, v.oncePerCustomer, v.startsAt, v.expiresAt,
        v.isActive, v.note, session.uid,
      ],
    );
    return ok({ id: row?.id }, { status: 201 });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه کد نامعتبر است', 400);

    const parsed = validate(body);
    if (parsed.error) return fail(parsed.error, 400);
    const v = parsed.value!;

    const clash = await queryOne<{ id: number }>(
      `SELECT id FROM discount_codes WHERE code = $1 AND id <> $2`,
      [v.code, id],
    );
    if (clash) return fail('این کد از قبل وجود دارد', 409);

    const rows = await query<{ id: number }>(
      `UPDATE discount_codes
          SET code = $2, title = NULLIF($3,''), amount_toman = $4, customer_id = $5,
              scope = $6, product_id = $7, package_id = $8,
              min_amount_toman = $9, max_uses = $10, once_per_customer = $11,
              starts_at = NULLIF($12,'')::date, expires_at = NULLIF($13,'')::date,
              is_active = $14, note = NULLIF($15,'')
        WHERE id = $1 RETURNING id`,
      [
        id, v.code, v.title, v.amount, v.customerId, v.scope, v.productId, v.packageId,
        v.minAmount, v.maxUses, v.oncePerCustomer, v.startsAt, v.expiresAt,
        v.isActive, v.note,
      ],
    );
    if (!rows.length) return fail('کد پیدا نشد', 404);
    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = idParam(new URL(req.url), 'id');
    if (id === null) return fail('شناسه کد نامعتبر است', 400);

    // کدی که استفاده شده حذف نمی‌شود؛ ردیف‌های مصرف به آن ارجاع دارند
    const used = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM discount_uses WHERE code_id = $1`,
      [id],
    );

    if (Number(used?.cnt) > 0) {
      await query(`UPDATE discount_codes SET is_active = FALSE WHERE id = $1`, [id]);
      return ok({ ok: true, deactivated: true });
    }

    await query(`DELETE FROM discount_codes WHERE id = $1`, [id]);
    return ok({ ok: true, deactivated: false });
  });
}
