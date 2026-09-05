import { cookies } from 'next/headers';
import { query, queryOne } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/session';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// type است نه interface: کوئری pg محدودیت T extends QueryResultRow دارد
// و تایپ‌اسکریپت فقط به type alias امضای ایندکس ضمنی می‌دهد.
type Row = {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  is_active: boolean;
  customer_id: number | null;
};

export async function POST(req: Request) {
  return handle(async () => {
    const { username, password } = await readJson<{ username?: string; password?: string }>(req);

    if (!username || !password) {
      return fail('نام کاربری و گذرواژه لازم است', 400);
    }

    const user = await queryOne<Row>(
      `SELECT id, username, password_hash, role, is_active, customer_id
         FROM users WHERE lower(username) = lower($1)`,
      [username.trim()],
    );

    // پیام یکسان برای کاربر ناموجود و گذرواژه غلط، تا نام کاربری لو نرود
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return fail('نام کاربری یا گذرواژه درست نیست', 401);
    }

    // شناسه مشتری داخل توکن نشست می‌رود، نه در پارامتر درخواست. اگر از
    // پارامتر خوانده می‌شد، هر مشتری با عوض‌کردن یک عدد داده بقیه را
    // می‌دید.
    const token = await createSessionToken({
      uid: user.id,
      username: user.username,
      role: user.role,
      ...(user.role === 'customer' && user.customer_id ? { cid: user.customer_id } : {}),
    });

    cookies().set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    // رابط بر اساس نقش به بخش خودش می‌رود
    return ok({
      username: user.username,
      role: user.role,
      redirect: user.role === 'customer' ? '/portal' : '/',
    });
  });
}
