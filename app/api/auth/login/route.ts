import { cookies } from 'next/headers';
import { query, queryOne } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/session';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Row {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  is_active: boolean;
}

export async function POST(req: Request) {
  return handle(async () => {
    const { username, password } = await readJson<{ username?: string; password?: string }>(req);

    if (!username || !password) {
      return fail('نام کاربری و گذرواژه لازم است', 400);
    }

    const user = await queryOne<Row>(
      `SELECT id, username, password_hash, role, is_active FROM users WHERE lower(username) = lower($1)`,
      [username.trim()],
    );

    // پیام یکسان برای کاربر ناموجود و گذرواژه غلط، تا نام کاربری لو نرود
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return fail('نام کاربری یا گذرواژه درست نیست', 401);
    }

    const token = await createSessionToken({ uid: user.id, username: user.username, role: user.role });

    cookies().set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    return ok({ username: user.username, role: user.role });
  });
}
