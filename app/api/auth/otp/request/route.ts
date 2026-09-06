import { fail, handle, ok, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { OTP_RESEND_SEC, OTP_TTL_SEC, requestOtp } from '@/lib/otp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * درخواست کد ورود.
 *
 * ── این مسیر عمدا باز است ──────────────────────────────────
 *
 * کسی که می‌خواهد وارد شود هنوز نشستی ندارد. امنیتش سه لایه است و
 * هیچ‌کدام به نگهبان احراز هویت ربطی ندارد:
 *
 *   ۱. سقف نرخ آی‌پی، همین‌جا
 *   ۲. فاصله بین دو درخواست و سقف ساعتی هر شماره، در lib/otp.ts
 *   ۳. سقف تلاش روی خود کد، هنگام تأیید
 *
 * ── پاسخ برای شماره بی‌حساب هم موفق است ────────────────────
 *
 * وگرنه این مسیر می‌شود ابزاری برای فهمیدن اینکه کدام شماره‌ها مشتری
 * ما هستند. کدی فرستاده نمی‌شود ولی پاسخ فرقی نمی‌کند.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const ip = clientIp(req);

    // سقف آی‌پی سخت‌گیرانه‌تر از سقف شماره است: یک آی‌پی که برای ده
    // شماره مختلف کد می‌خواهد، کاربر نیست.
    const limit = rateLimit(`otp-request:${ip}`, 10, 900);
    if (!limit.ok) {
      return fail(`درخواست بیش از حد. ${limit.retryAfter} ثانیه دیگر امتحان کنید.`, 429);
    }

    const body = await readJson<{ phone?: unknown }>(req);
    const result = await requestOtp(body.phone, ip);

    if (!result.ok) {
      // «کد قبلی هنوز معتبر است» خطای واقعی نیست؛ رابط باید بتواند
      // شمارش معکوس را نشان بدهد، پس ثانیه مانده هم برمی‌گردد.
      if (result.retryAfter) {
        return Response.json(
          { message: result.error, retryAfter: result.retryAfter },
          { status: result.status ?? 429 },
        );
      }
      return fail(result.error || 'ارسال کد ناموفق بود', result.status ?? 400);
    }

    return ok({
      sent: true,
      ttl: OTP_TTL_SEC,
      resendAfter: OTP_RESEND_SEC,
      // فقط در حالت توسعه پر است، تا آزمودن بدون پیامک ممکن باشد
      ...(result.devCode ? { devCode: result.devCode } : {}),
    });
  });
}
