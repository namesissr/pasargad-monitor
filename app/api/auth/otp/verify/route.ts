import { fail, handle, ok, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { verifyOtp } from '@/lib/otp';
import { startSession } from '@/lib/signin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * تأیید کد و بازکردن نشست.
 *
 * ── این مسیر عمدا باز است ──────────────────────────────────
 *
 * همان دلیل مسیر درخواست کد: کسی که وارد می‌شود هنوز نشستی ندارد.
 *
 * سقف اصلی روی **خود کد** است (پنج تلاش، در lib/otp.ts) نه اینجا. آن
 * سقف حمله آهسته از چند آی‌پی را هم می‌گیرد، چون شمارنده روی کد نشسته
 * نه روی درخواست‌کننده. سقف آی‌پیِ اینجا فقط لایه اول است.
 *
 * ── نشست از همان startSession باز می‌شود ───────────────────
 *
 * سه جا نشست باز می‌کنند: ورود با گذرواژه، ورود با کد، و پرداخت
 * فروشگاه. اگر هرکدام کوکی خودش را می‌ساخت، دیر یا زود یکی‌شان
 * httpOnly یا cid را جا می‌انداخت.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const limit = rateLimit(`otp-verify:${clientIp(req)}`, 20, 900);
    if (!limit.ok) {
      return fail(`تلاش بیش از حد. ${limit.retryAfter} ثانیه دیگر امتحان کنید.`, 429);
    }

    const body = await readJson<{ phone?: unknown; code?: unknown }>(req);
    const result = await verifyOtp(body.phone, body.code);

    if (!result.ok || !result.user) {
      return fail(result.error || 'کد وارد‌شده درست نیست', result.status ?? 401);
    }

    await startSession(result.user);

    return ok({
      username: result.user.username,
      role: result.user.role,
      redirect: '/portal',
    });
  });
}
