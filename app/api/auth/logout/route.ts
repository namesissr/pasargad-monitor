import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session';
import { ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * خروج از حساب.
 *
 * دو نوع فراخوان دارد و پاسخ باید با هرکدام بخواند:
 *
 *  • **fetch از پنل مدیریت** — جیسون می‌خواهد و خودش بعدش کاربر را به
 *    صفحه ورود می‌فرستد.
 *
 *  • **فرم ساده در پرتال مشتری** — مرورگر خودش پیمایش می‌کند. اگر
 *    جیسون بگیرد، کاربر روی متن خام می‌ماند و هیچ‌وقت به صفحه ورود
 *    برنمی‌گردد. این دقیقا یک بار رخ داد.
 *
 * تفکیک با سرآیند Accept انجام می‌شود: پیمایش مرورگر همیشه text/html
 * می‌خواهد، ولی fetch این پروژه آن را نمی‌فرستد.
 *
 * ریدایرکت ۳۰۳ است نه ۳۰۲: متد POST را به GET تبدیل می‌کند. با ۳۰۲
 * بعضی مرورگرها POST را به صفحه ورود می‌برند و آنجا خطا می‌دهد.
 */
function clearSession() {
  cookies().set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
}

export async function POST(req: Request) {
  clearSession();

  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }

  return ok({ ok: true });
}

/**
 * خروج با پیمایش ساده هم کار می‌کند.
 *
 * لینک خروج در بوکمارک، و مرورگری که جاوااسکریپتش خاموش است، هر دو GET
 * می‌فرستند. پاسخ‌ندادن به آن یعنی کاربر گیر می‌کند بی‌آنکه بفهمد چرا.
 */
export async function GET(req: Request) {
  clearSession();
  return NextResponse.redirect(new URL('/login', req.url), 303);
}
