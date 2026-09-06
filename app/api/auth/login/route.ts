import { queryOne } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { startSession } from '@/lib/signin';
import { fail, handle, ok, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rate-limit';

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

    // سقف تلاش ورود از یک آی‌پی. بدون آن، حدس گذرواژه فقط به سرعت شبکه
    // محدود است. سقف روی آی‌پی است نه روی نام کاربری — وگرنه کسی با
    // فرستادن مکرر نام کاربری یک نفر دیگر، او را از حسابش قفل می‌کند.
    const limit = rateLimit(`login:${clientIp(req)}`, 10, 300);
    if (!limit.ok) {
      return fail(`تلاش بیش از حد. ${limit.retryAfter} ثانیه دیگر دوباره امتحان کنید.`, 429);
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
    await startSession(user);

    // رابط بر اساس نقش به بخش خودش می‌رود
    return ok({
      username: user.username,
      role: user.role,
      redirect: user.role === 'customer' ? '/portal' : '/',
    });
  });
}
