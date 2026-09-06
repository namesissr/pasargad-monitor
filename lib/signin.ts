import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/session';

/**
 * باز کردن نشست برای یک حساب.
 *
 * ── چرا یک تابع مشترک ──────────────────────────────────────
 *
 * دو جا نشست باز می‌کنند: صفحه ورود، و پرداخت فروشگاه عمومی که مشتری
 * حین سفارش وارد می‌شود یا ثبت‌نام می‌کند.
 *
 * اگر هرکدام کوکی خودش را بسازد، دیر یا زود یکی‌شان httpOnly یا
 * sameSite را جا می‌اندازد — و آن یکی همان است که کسی متوجهش نمی‌شود
 * تا وقتی که دیر شده.
 *
 * ── cid عمدا شرطی است ──────────────────────────────────────
 *
 * شناسه مشتری فقط برای نقش customer داخل توکن می‌رود. اگر همیشه
 * گذاشته شود، حساب کارکنان هم یک cid می‌گیرد و نگهبان‌های پرتال آن را
 * مشتری حساب می‌کنند.
 *
 * این یک بار جا افتاد و نتیجه‌اش «به این بخش دسترسی ندارید» برای
 * مشتری‌ای بود که همه‌چیزش درست بود.
 */
export interface SignInUser {
  id: number;
  username: string;
  role: string;
  customer_id: number | null;
}

export async function startSession(user: SignInUser): Promise<void> {
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
}
