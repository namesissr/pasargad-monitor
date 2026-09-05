import { NextResponse } from 'next/server';
import { ForbiddenError, UnauthorizedError } from './auth';

/** پاسخ موفق */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

/** پاسخ خطا با پیام فارسی */
export function fail(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

/**
 * پوشش هر مسیر API. خطای مدیریت‌نشده را به پیام فارسی تبدیل می‌کند
 * تا کلاینت هیچ‌وقت «خطا در ارتباط با سرور» بی‌جزئیات نبیند.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnauthorizedError) return fail(err.message, 401);
    // ۴۰۳ از ۴۰۱ جداست: کاربر وارد شده ولی این بخش مال او نیست. با ۴۰۱،
    // رابط او را به صفحه ورود می‌فرستاد و حلقه بی‌پایان می‌ساخت.
    if (err instanceof ForbiddenError) return fail(err.message, 403);
    const message = err instanceof Error ? err.message : 'خطای ناشناخته';
    console.error('[api]', message, err);
    return fail(message.startsWith('خطا') ? message : `خطای سرور: ${message}`, 500);
  }
}

/** خواندن بدنه JSON با خطای فارسی در صورت خرابی */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('بدنه درخواست جیسون معتبر نیست');
  }
}

/** خواندن پارامتر عددی از کوئری */
export function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * شناسه عددی از کوئری، یا null اگر نبود یا نامعتبر بود.
 *
 * چرا لازم است: `Number(null)` در جاوااسکریپت **صفر** است نه NaN، و
 * `Number.isInteger(0)` هم درست است. پس این الگوی رایج
 *
 *     const id = Number(url.searchParams.get('server_id'));
 *     if (Number.isInteger(id)) where = 'WHERE server_id = $1';
 *
 * وقتی پارامتر اصلا فرستاده نشده باشد، روی «سرور شماره صفر» فیلتر
 * می‌کند — یعنی فهرست خالی و جمع صفر، بدون هیچ خطایی. این دقیقا یک بار
 * در صفحه خرید ترافیک رخ داد و تشخیصش سخت بود چون همه‌چیز سالم به‌نظر
 * می‌رسید.
 *
 * نبودِ پارامتر از مقدار نامعتبر جدا نمی‌شود، چون هر دو یک معنی دارند:
 * شناسه‌ای در کار نیست. شناسه‌ها در این پروژه SERIAL اند، پس صفر و منفی
 * هم نامعتبرند.
 */
export function idParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
