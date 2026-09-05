import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * محصولات فروشگاه — سرور اختصاصی و هر چیز دیگر.
 *
 * مثل بسته‌های ترافیک، محصولی که سفارشی به آن ارجاع دارد حذف نمی‌شود
 * بلکه غیرفعال می‌شود. سفارش، نام و قیمت را در لحظه ثبت کپی کرده، پس
 * سابقه‌اش سالم می‌ماند؛ ولی ارجاع را نگه می‌داریم تا معلوم باشد از
 * کدام محصول آمده.
 */

const SPECS = ['spec_cpu', 'spec_ram', 'spec_disk', 'spec_bandwidth', 'spec_location'] as const;

function validate(body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  if (!name) return { error: 'نام محصول را وارد کنید' };

  const price = Math.round(Number(body.price_toman));
  if (!Number.isFinite(price) || price <= 0) return { error: 'قیمت باید بیشتر از صفر باشد' };
  if (price > 10_000_000_000) return { error: 'قیمت بیش از حد بزرگ است' };

  const setup = Math.round(Number(body.setup_toman) || 0);
  if (!Number.isFinite(setup) || setup < 0) return { error: 'هزینه راه‌اندازی نامعتبر است' };

  const months = Number(body.billing_months) || 1;
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    return { error: 'دوره صورتحساب باید بین ۱ تا ۶۰ ماه باشد' };
  }

  // تهی یعنی نامحدود. رشته خالی هم تهی حساب می‌شود، وگرنه فرمی که
  // فیلد را خالی گذاشته موجودی را صفر می‌کرد و محصول ناپدید می‌شد.
  const rawStock = body.stock;
  const stock =
    rawStock === null || rawStock === undefined || String(rawStock).trim() === ''
      ? null
      : Number(rawStock);
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
    return { error: 'موجودی نامعتبر است' };
  }

  const specs: Record<string, string> = {};
  for (const key of SPECS) specs[key] = String(body[key] ?? '').trim();

  return {
    value: {
      name,
      kind: String(body.kind ?? 'dedicated') === 'other' ? 'other' : 'dedicated',
      summary: String(body.summary ?? '').trim(),
      price,
      setup,
      months,
      stock,
      specs,
      is_active: body.is_active !== false && body.is_active !== 'false',
      sort_order: Number(body.sort_order) || 0,
    },
  };
}

export async function GET() {
  return handle(async () => {
    await requireUser();
    const products = await query(
      `SELECT p.id, p.name, p.kind, p.summary,
              p.spec_cpu, p.spec_ram, p.spec_disk, p.spec_bandwidth, p.spec_location,
              p.price_toman::float8 AS price_toman,
              p.setup_toman::float8 AS setup_toman,
              p.billing_months, p.stock, p.is_active, p.sort_order, p.created_at,
              COALESCE(o.cnt, 0)::int AS order_count
         FROM products p
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS cnt FROM orders x
            WHERE x.product_id = p.id AND x.status <> 'canceled'
         ) o ON TRUE
        ORDER BY p.sort_order, p.price_toman`,
    );
    return ok({ products });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const parsed = validate(await readJson<Record<string, unknown>>(req));
    if (parsed.error) return fail(parsed.error, 400);
    const v = parsed.value!;

    const row = await queryOne<{ id: number }>(
      `INSERT INTO products
         (name, kind, summary, spec_cpu, spec_ram, spec_disk, spec_bandwidth, spec_location,
          price_toman, setup_toman, billing_months, stock, is_active, sort_order)
       VALUES ($1, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''),
               NULLIF($7,''), NULLIF($8,''), $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        v.name, v.kind, v.summary,
        v.specs.spec_cpu, v.specs.spec_ram, v.specs.spec_disk,
        v.specs.spec_bandwidth, v.specs.spec_location,
        v.price, v.setup, v.months, v.stock, v.is_active, v.sort_order,
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
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه محصول نامعتبر است', 400);

    const parsed = validate(body);
    if (parsed.error) return fail(parsed.error, 400);
    const v = parsed.value!;

    const rows = await query<{ id: number }>(
      `UPDATE products
          SET name = $2, kind = $3, summary = NULLIF($4,''),
              spec_cpu = NULLIF($5,''), spec_ram = NULLIF($6,''), spec_disk = NULLIF($7,''),
              spec_bandwidth = NULLIF($8,''), spec_location = NULLIF($9,''),
              price_toman = $10, setup_toman = $11, billing_months = $12,
              stock = $13, is_active = $14, sort_order = $15, updated_at = now()
        WHERE id = $1 RETURNING id`,
      [
        id, v.name, v.kind, v.summary,
        v.specs.spec_cpu, v.specs.spec_ram, v.specs.spec_disk,
        v.specs.spec_bandwidth, v.specs.spec_location,
        v.price, v.setup, v.months, v.stock, v.is_active, v.sort_order,
      ],
    );
    if (!rows.length) return fail('محصول پیدا نشد', 404);
    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = idParam(new URL(req.url), 'id');
    if (id === null) return fail('شناسه محصول نامعتبر است', 400);

    const used = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM orders WHERE product_id = $1`,
      [id],
    );

    if (Number(used?.cnt) > 0) {
      await query(`UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = $1`, [id]);
      return ok({ ok: true, deactivated: true });
    }

    await query(`DELETE FROM products WHERE id = $1`, [id]);
    return ok({ ok: true, deactivated: false });
  });
}
