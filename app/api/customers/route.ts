import { query, queryOne } from '@/lib/db';
import { hashPassword, requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * مشتریان و حساب ورودشان.
 *
 * حساب مشتری در همان جدول users می‌نشیند با نقش «customer». دلیلش این
 * است که یک سازوکار نشست، یک صفحه ورود و یک مسیر خروج کافی باشد؛ سیستم
 * احراز هویت دوم یعنی دو جای ممکن برای اشتباه امنیتی.
 *
 * گذرواژه هرگز برگردانده نمی‌شود — فقط اینکه حسابی هست یا نه.
 */

const SELECT = `
  SELECT c.id, c.name, c.first_name, c.last_name, c.company, c.phone, c.email, c.national_id,
         c.address, c.notes, c.is_active, c.created_at,
         u.id AS user_id, u.username, u.is_active AS user_active, u.last_login_at,
         (SELECT COUNT(*)::int FROM servers s WHERE s.customer_id = c.id) AS server_count
    FROM customers c
    LEFT JOIN users u ON u.customer_id = c.id
   ORDER BY c.name`;

export async function GET() {
  return handle(async () => {
    await requireUser();
    const customers = await query(SELECT);
    return ok({ customers });
  });
}

type Clean =
  | { ok: false; error: string }
  | {
      ok: true;
      value: {
        name: string;
        firstName: string | null;
        lastName: string | null;
        company: string | null;
        phone: string | null;
        email: string | null;
        nationalId: string | null;
        address: string | null;
        notes: string | null;
        isActive: boolean;
      };
    };

function clean(body: Record<string, unknown>): Clean {
  const text = (key: string) => {
    const v = String(body[key] ?? '').trim();
    return v || null;
  };

  const firstName = text('first_name');
  const lastName = text('last_name');

  // نام نمایشی از نام و نام خانوادگی ساخته می‌شود. اگر هیچ‌کدام نبود،
  // فیلد «نام» مستقیم استفاده می‌شود — برای مشتری حقوقی که نام و نام
  // خانوادگی ندارد.
  const name =
    [firstName, lastName].filter(Boolean).join(' ').trim() || String(body.name ?? '').trim();
  if (!name) return { ok: false, error: 'نام و نام خانوادگی را وارد کنید' };

  const nationalId = text('national_id');
  if (nationalId && !/^\d{10}$/.test(nationalId)) {
    return { ok: false, error: 'کد ملی باید ده رقم باشد' };
  }

  const email = text('email');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'ایمیل معتبر نیست' };
  }

  return {
    ok: true,
    value: {
      name,
      firstName,
      lastName,
      company: text('company'),
      phone: text('phone'),
      email,
      nationalId,
      address: text('address'),
      notes: text('notes'),
      isActive: body.is_active !== false,
    },
  };
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const parsed = clean(await readJson<Record<string, unknown>>(req));
    if (!parsed.ok) return fail(parsed.error, 400);
    const c = parsed.value;

    const row = await queryOne<{ id: number }>(
      `INSERT INTO customers (name, first_name, last_name, company, phone, email,
                              national_id, address, notes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        c.name, c.firstName, c.lastName, c.company, c.phone, c.email,
        c.nationalId, c.address, c.notes, c.isActive,
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
    if (!Number.isInteger(id)) return fail('شناسه مشتری نامعتبر است', 400);

    const parsed = clean(body);
    if (!parsed.ok) return fail(parsed.error, 400);
    const c = parsed.value;

    await query(
      `UPDATE customers
          SET name = $2, first_name = $3, last_name = $4, company = $5, phone = $6,
              email = $7, national_id = $8, address = $9, notes = $10,
              is_active = $11, updated_at = now()
        WHERE id = $1`,
      [
        id, c.name, c.firstName, c.lastName, c.company, c.phone, c.email,
        c.nationalId, c.address, c.notes, c.isActive,
      ],
    );

    // مشتری غیرفعال نباید بتواند وارد شود. بدون این، «غیرفعال‌کردن» فقط
    // یک برچسب بود و حسابش همچنان کار می‌کرد.
    if (!c.isActive) {
      await query(`UPDATE users SET is_active = FALSE WHERE customer_id = $1`, [id]);
    }

    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id)) return fail('شناسه مشتری نامعتبر است', 400);

    // سرورها می‌مانند و فقط تخصیصشان پاک می‌شود؛ حساب ورود با مشتری
    // می‌رود چون حساب بی‌صاحب یعنی دسترسی بدون مالک.
    await query('DELETE FROM customers WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}

/** ساخت یا بازنشانی حساب ورود مشتری */
export async function PUT(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<{ id?: number; username?: string; password?: string; is_active?: boolean }>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id)) return fail('شناسه مشتری نامعتبر است', 400);

    const customer = await queryOne<{ id: number; name: string }>(
      `SELECT id, name FROM customers WHERE id = $1`,
      [id],
    );
    if (!customer) return fail('مشتری پیدا نشد', 404);

    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE customer_id = $1`,
      [id],
    );

    const password = String(body.password ?? '');
    const username = String(body.username ?? '').trim();

    if (!existing) {
      if (!username) return fail('نام کاربری را وارد کنید', 400);
      if (password.length < 8) return fail('گذرواژه باید حداقل ۸ کاراکتر باشد', 400);

      const dup = await queryOne<{ id: number }>(
        `SELECT id FROM users WHERE lower(username) = lower($1)`,
        [username],
      );
      if (dup) return fail('این نام کاربری از قبل استفاده شده است', 409);

      await query(
        `INSERT INTO users (username, password_hash, full_name, role, customer_id, is_active)
         VALUES ($1, $2, $3, 'customer', $4, TRUE)`,
        [username, await hashPassword(password), customer.name, id],
      );
      return ok({ created: true });
    }

    // حساب موجود: گذرواژه فقط وقتی عوض می‌شود که مقدار تازه‌ای داده شود
    if (password && password.length < 8) {
      return fail('گذرواژه باید حداقل ۸ کاراکتر باشد', 400);
    }

    await query(
      `UPDATE users
          SET is_active = $2,
              password_hash = CASE WHEN $3 = '' THEN password_hash ELSE $3 END
        WHERE id = $1`,
      [existing.id, body.is_active !== false, password ? await hashPassword(password) : ''],
    );

    return ok({ created: false });
  });
}
