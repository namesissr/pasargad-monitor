import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';
import { ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * خروج از حساب.
 *
 * دو نوع فراخوان دارد و پاسخ باید با هرکدام بخواند:
 *
 *  • **fetch** — جیسون می‌خواهد و خودش بعدش کاربر را می‌فرستد.
 *
 *  • **پیمایش مرورگر** (فرم ساده، یا لینک وقتی جاوااسکریپت خاموش است)
 *    — اگر جیسون بگیرد، کاربر روی متن خام می‌ماند و هیچ‌وقت به صفحه
 *    ورود برنمی‌گردد.
 *
 * تفکیک با سرآیند Accept انجام می‌شود: پیمایش مرورگر همیشه text/html
 * می‌خواهد، ولی fetch این پروژه آن را نمی‌فرستد.
 *
 * ── چرا Location نسبی است، نه NextResponse.redirect ────────
 *
 * NextResponse.redirect آدرس مطلق می‌خواهد، و تنها منبعی که اینجا برای
 * ساختنش هست req.url است. پشت انجین‌ایکس، اتصال بین انجین‌ایکس و نکست
 * ساده (http) است، پس آن آدرس با طرح http ساخته می‌شود در حالی که سایت
 * https است — و اگر روزی سرآیند Host هم درست منتقل نشود، آدرس به نام
 * داخلی کانتینر می‌افتد که از مرورگر اصلا در دسترس نیست.
 *
 * مسیر نسبی هیچ‌کدام از این‌ها را لازم ندارد: مرورگر خودش آن را نسبت به
 * آدرس جاری حل می‌کند. استاندارد هم صریح اجازه‌اش را می‌دهد.
 *
 * همین دسته خطا قبلا در مسیر بازگشت درگاه پیش آمد و آنجا با خواندن
 * panel_url از تنظیمات حل شد — آنجا چاره‌ای نبود چون درخواست از سمت
 * درگاه می‌آید، ولی اینجا مسیر نسبی ساده‌تر و بی‌خطاتر است.
 *
 * ── چرا کوکی روی خود پاسخ پاک می‌شود ───────────────────────
 *
 * cookies().set از next/headers روی پاسخی که نکست خودش می‌سازد اثر
 * می‌گذارد. وقتی خودمان یک Response برمی‌گردانیم، مطمئن‌ترین راه این
 * است که کوکی را روی همان شیء پاسخ بگذاریم.
 *
 * ۳۰۳ عمدی است نه ۳۰۲: متد POST را به GET تبدیل می‌کند. با ۳۰۲ بعضی
 * مرورگرها POST را به صفحه ورود می‌برند و آنجا خطا می‌دهد.
 */

/**
 * پاسخ با کوکی نشست پاک‌شده.
 *
 * جنریک است تا نوع دقیق پاسخ ورودی حفظ شود؛ با NextResponse ساده،
 * پاسخ جیسون و پاسخ ریدایرکت باید به یک نوع تبدیل می‌شدند.
 */
function clearOn<T extends NextResponse>(res: T): T {
  res.cookies.set(SESSION_COOKIE, '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

/** ریدایرکت با مسیر نسبی */
function toLogin(): NextResponse {
  return clearOn(
    new NextResponse(null, {
      status: 303,
      headers: { Location: '/login' },
    }),
  );
}

export async function POST(req: Request) {
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) return toLogin();

  return clearOn(ok({ ok: true }));
}

/**
 * خروج با پیمایش ساده هم کار می‌کند.
 *
 * لینک خروج در بوکمارک، و مرورگری که جاوااسکریپتش خاموش است، هر دو GET
 * می‌فرستند. پاسخ‌ندادن به آن یعنی کاربر گیر می‌کند بی‌آنکه بفهمد چرا.
 */
export async function GET() {
  return toLogin();
}
