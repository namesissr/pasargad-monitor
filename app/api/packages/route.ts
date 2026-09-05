import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * بسته‌های ترافیک.
 *
 * حذف واقعی انجام نمی‌شود، فقط غیرفعال‌کردن: فاکتورهای صادرشده به بسته
 * ارجاع دارند و حذفش سابقه را قطع می‌کند. غیرفعال یعنی «دیگر
 * نمی‌فروشیم» و از فروشگاه مشتری ناپدید می‌شود.
 */

function validate(body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  if (!name) return { error: 'نام بسته را وارد کنید' };

  const gb = Number(body.gb);
  if (!Number.isFinite(gb) || gb <= 0) return { error: 'مقدار ترافیک باید بیشتر از صفر باشد' };
  if (gb > 1_000_000) return { error: 'مقدار ترافیک بیش از حد بزرگ است' };

  const price = Math.round(Number(body.price_toman));
  if (!Number.isFinite(price) || price <= 0) return { error: 'قیمت باید بیشتر از صفر باشد' };
  if (price > 10_000_000_000) return { error: 'قیمت بیش از حد بزرگ است' };

  return {
    value: {
      name,
      gb,
      price,
      description: String(body.description ?? '').trim(),
      is_active: body.is_active !== false && body.is_active !== 'false',
      sort_order: Number(body.sort_order) || 0,
    },
  };
}

export async function GET() {
  return handle(async () => {
    await requireUser();
    const packages = await query(
      `SELECT p.id, p.name, p.gb::float8 AS gb, p.price_toman::float8 AS price_toman,
              p.description, p.is_active, p.sort_order, p.created_at,
              COALESCE(sold.cnt, 0)::int AS sold_count
         FROM traffic_packages p
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS cnt FROM invoices i
            WHERE i.traffic_package_id = p.id AND i.status = 'paid'
         ) sold ON TRUE
        ORDER BY p.sort_order, p.gb`,
    );
    return ok({ packages });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const parsed = validate(await readJson<Record<string, unknown>>(req));
    if (parsed.error) return fail(parsed.error, 400);
    const v = parsed.value!;

    const row = await queryOne<{ id: number }>(
      `INSERT INTO traffic_packages (name, gb, price_toman, description, is_active, sort_order)
       VALUES ($1, $2, $3, NULLIF($4,''), $5, $6) RETURNING id`,
      [v.name, v.gb, v.price, v.description, v.is_active, v.sort_order],
    );
    return ok({ id: row?.id }, { status: 201 });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه بسته نامعتبر است', 400);

    const parsed = validate(body);
    if (parsed.error) return fail(parsed.error, 400);
    const v = parsed.value!;

    const rows = await query<{ id: number }>(
      `UPDATE traffic_packages
          SET name = $2, gb = $3, price_toman = $4, description = NULLIF($5,''),
              is_active = $6, sort_order = $7
        WHERE id = $1 RETURNING id`,
      [id, v.name, v.gb, v.price, v.description, v.is_active, v.sort_order],
    );
    if (!rows.length) return fail('بسته پیدا نشد', 404);
    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = idParam(new URL(req.url), 'id');
    if (id === null) return fail('شناسه بسته نامعتبر است', 400);

    // اگر فاکتوری به این بسته ارجاع دارد، حذف نمی‌شود — فقط غیرفعال.
    // حذفش سابقه فاکتور را قطع می‌کند.
    const used = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM invoices WHERE traffic_package_id = $1`,
      [id],
    );

    if (Number(used?.cnt) > 0) {
      await query(`UPDATE traffic_packages SET is_active = FALSE WHERE id = $1`, [id]);
      return ok({ ok: true, deactivated: true });
    }

    await query(`DELETE FROM traffic_packages WHERE id = $1`, [id]);
    return ok({ ok: true, deactivated: false });
  });
}
