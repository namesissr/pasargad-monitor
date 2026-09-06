import { query, queryOne } from '@/lib/db';
import { hashPassword, requireCustomer, verifyPassword } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { isValidEmail, PASSWORD_MIN } from '@/lib/register';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * پروفایل مشتری.
 *
 * ── چه چیزی مشتری می‌تواند عوض کند ─────────────────────────
 *
 * نام، شرکت، ایمیل، شناسه ملی، نشانی، و گذرواژه.
 *
 * **شماره موبایل عوض نمی‌شود.** نام کاربری‌اش همان شماره است و پیامک
 * هشدار هم به همان می‌رود. عوض‌کردنش یعنی نام کاربری هم باید عوض شود، و
 * اگر شماره تازه مال کس دیگری باشد دو حساب به هم می‌خورند. تغییرش کار
 * پشتیبانی است — با تیکت.
 *
 * **وضعیت فعال‌بودن هم عوض نمی‌شود.** اگر مشتری بتواند is_active خودش
 * را بزند، حساب غیرفعال‌شده دوباره فعال می‌شود.
 */

type ProfileRow = {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  national_id: string | null;
  address: string | null;
  created_at: string;
};

export async function GET() {
  return handle(async () => {
    const { session, customerId } = await requireCustomer();

    const customer = await queryOne<ProfileRow>(
      `SELECT id, name, company, phone, email, national_id, address, created_at
         FROM customers WHERE id = $1`,
      [customerId],
    );
    if (!customer) return fail('حساب پیدا نشد', 404);

    const account = await queryOne<{ username: string; last_login_at: string | null }>(
      `SELECT username, last_login_at FROM users WHERE id = $1`,
      [session.uid],
    );

    // چند عدد برای اینکه صفحه پروفایل فقط یک فرم خالی نباشد
    const stats = await queryOne<{ servers: number; invoices: number; unpaid: number }>(
      `SELECT
         (SELECT COUNT(*) FROM servers WHERE customer_id = $1 AND is_active)::int AS servers,
         (SELECT COUNT(*) FROM invoices WHERE customer_id = $1 AND status = 'paid')::int AS invoices,
         (SELECT COUNT(*) FROM invoices WHERE customer_id = $1 AND status = 'unpaid')::int AS unpaid`,
      [customerId],
    );

    return ok({ customer, account, stats });
  });
}

/** ویرایش مشخصات */
export async function PATCH(req: Request) {
  return handle(async () => {
    const { customerId } = await requireCustomer();
    const body = await readJson<Record<string, unknown>>(req);

    const name = String(body.name ?? '').trim().slice(0, 120);
    if (name.length < 3) return fail('نام و نام خانوادگی را کامل بنویسید', 400);

    const email = String(body.email ?? '').trim().slice(0, 200);
    if (email && !isValidEmail(email)) return fail('نشانی ایمیل معتبر نیست', 400);

    await query(
      `UPDATE customers
          SET name = $2,
              company = NULLIF($3,''),
              email = NULLIF($4,''),
              national_id = NULLIF($5,''),
              address = NULLIF($6,''),
              updated_at = now()
        WHERE id = $1`,
      [
        customerId,
        name,
        String(body.company ?? '').trim().slice(0, 120),
        email,
        String(body.national_id ?? '').trim().slice(0, 20),
        String(body.address ?? '').trim().slice(0, 500),
      ],
    );

    // نام و ایمیل روی حساب ورود هم به‌روز می‌شوند، وگرنه ایمیل تیکت و
    // فاکتور از دو جای متفاوت خوانده می‌شود و یکی‌شان کهنه می‌ماند
    await query(
      `UPDATE users SET full_name = $2, email = NULLIF($3,'') WHERE customer_id = $1`,
      [customerId, name, email],
    );

    return ok({ ok: true });
  });
}

/** تغییر گذرواژه */
export async function POST(req: Request) {
  return handle(async () => {
    const { session } = await requireCustomer();
    const body = await readJson<Record<string, unknown>>(req);

    const current = String(body.current_password ?? '');
    const next = String(body.new_password ?? '');

    if (next.length < PASSWORD_MIN) {
      return fail(`گذرواژه تازه باید دست‌کم ${PASSWORD_MIN} کاراکتر باشد`, 400);
    }

    const user = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [session.uid],
    );
    if (!user) return fail('حساب پیدا نشد', 404);

    // گذرواژه فعلی لازم است. بدون آن، هر کسی که چند لحظه پشت مرورگر باز
    // بنشیند حساب را برای همیشه می‌گیرد.
    if (!(await verifyPassword(current, user.password_hash))) {
      return fail('گذرواژه فعلی درست نیست', 403);
    }

    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
      session.uid,
      await hashPassword(next),
    ]);

    return ok({ ok: true });
  });
}
