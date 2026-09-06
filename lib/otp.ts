import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { query, queryOne } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { sendSms } from '@/lib/sms';
import { isValidPhone, normalizePhone } from '@/lib/register';

/**
 * ورود با کد یکبارمصرف.
 *
 * ── چه چیزی این را امن می‌کند ──────────────────────────────
 *
 * کد شش‌رقمی است، یعنی یک میلیون حالت. تنها چیزی که حدس‌زدنش را
 * غیرممکن می‌کند، **محدودکردن تعداد تلاش** است — نه طول کد. سه لایه
 * روی هم:
 *
 *   ۱. سقف تلاش روی خود ردیف (۵ بار) — حمله آهسته از چند آی‌پی را
 *      هم می‌گیرد، چون شمارنده روی کد است نه روی درخواست‌کننده.
 *   ۲. سقف درخواست کد برای هر شماره (۵ در ساعت) و فاصله بین دو
 *      درخواست (۹۰ ثانیه).
 *   ۳. سقف نرخ آی‌پی، در خود مسیر ای‌پی‌آی.
 *
 * ── کد در دیتابیس ذخیره نمی‌شود ────────────────────────────
 *
 * HMAC آن با SESSION_SECRET ذخیره می‌شود. دامپ دیتابیس بدون آن کلید
 * هیچ کد زنده‌ای را برنمی‌گرداند.
 *
 * ── چرا randomInt و نه Math.random ─────────────────────────
 *
 * Math.random قابل پیش‌بینی است. کسی که چند خروجی‌اش را ببیند، بعدی را
 * حساب می‌کند — و اینجا «بعدی» کد ورود یک نفر دیگر است.
 */

/** اعتبار کد. کوتاه است چون کد زنده، یک کلید زنده است. */
const TTL_SEC = 180;

/** بیشترین تلاش برای یک کد */
const MAX_ATTEMPTS = 5;

/** کمترین فاصله بین دو درخواست کد برای یک شماره */
const RESEND_COOLDOWN_SEC = 90;

/** بیشترین درخواست کد برای یک شماره در یک ساعت */
const MAX_PER_HOUR = 5;

export const OTP_TTL_SEC = TTL_SEC;
export const OTP_RESEND_SEC = RESEND_COOLDOWN_SEC;

/**
 * اثر کد.
 *
 * شماره داخل ورودی HMAC می‌آید تا کد یک شماره روی شماره دیگری کار
 * نکند، حتی اگر اتفاقی دو کد یکسان تولید شده باشند.
 */
function fingerprint(phone: string, code: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('متغیر SESSION_SECRET تنظیم نشده یا کوتاه‌تر از ۱۶ کاراکتر است');
  }
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
}

/** مقایسه بدون نشت زمانی */
function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** کد شش‌رقمی؛ صفرِ ابتدایی هم مجاز است */
function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface OtpRequestResult {
  ok: boolean;
  error?: string;
  status?: number;
  /** ثانیه تا امکان درخواست دوباره */
  retryAfter?: number;
  /** فقط در حالت توسعه پر می‌شود */
  devCode?: string;
}

/**
 * ساخت و ارسال کد.
 *
 * ── درباره پاسخ خنثی ───────────────────────────────────────
 *
 * اگر شماره حسابی نداشته باشد، **باز هم پاسخ موفق برمی‌گردد** و کدی
 * فرستاده نمی‌شود. وگرنه این مسیر تبدیل می‌شود به ابزاری برای فهمیدن
 * اینکه کدام شماره‌ها مشتری ما هستند.
 *
 * هزینه‌اش این است که کسی که شماره را اشتباه زده منتظر کدی می‌ماند که
 * نمی‌آید؛ پیام رابط همین را می‌گوید.
 */
export async function requestOtp(rawPhone: unknown, ip: string): Promise<OtpRequestResult> {
  const s = await getSettings();
  if (s.otp_login_enabled === 'false') {
    return { ok: false, error: 'ورود با کد پیامکی فعال نیست', status: 503 };
  }

  const phone = normalizePhone(rawPhone);
  if (!isValidPhone(phone)) {
    return { ok: false, error: 'شماره موبایل معتبر نیست — مثل ۰۹۱۲۱۲۳۴۵۶۷', status: 400 };
  }

  // فاصله بین دو درخواست، و سقف ساعتی. هر دو روی شماره‌اند نه آی‌پی:
  // آی‌پی عوض می‌شود، شماره نه.
  const recent = await queryOne<{ last_at: string | null; count_hour: number }>(
    `SELECT MAX(created_at) AS last_at,
            COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS count_hour
       FROM otp_codes WHERE phone = $1`,
    [phone],
  );

  if (recent?.last_at) {
    const elapsed = (Date.now() - new Date(recent.last_at).getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SEC) {
      return {
        ok: false,
        error: 'کد قبلی هنوز معتبر است',
        status: 429,
        retryAfter: Math.ceil(RESEND_COOLDOWN_SEC - elapsed),
      };
    }
  }

  if ((recent?.count_hour ?? 0) >= MAX_PER_HOUR) {
    return {
      ok: false,
      error: 'درخواست کد برای این شماره بیش از حد بوده. یک ساعت دیگر امتحان کنید.',
      status: 429,
    };
  }

  // حساب باید وجود داشته باشد، ولی نبودنش به بیرون گفته نمی‌شود
  const user = await queryOne<{ id: number }>(
    `SELECT u.id
       FROM users u
      WHERE lower(u.username) = lower($1)
        AND u.role = 'customer'
        AND u.is_active
        AND u.customer_id IS NOT NULL`,
    [phone],
  );

  if (!user) {
    // هیچ ردیفی هم ثبت نمی‌شود: وگرنه جدول با شماره‌های تصادفی پر
    // می‌شود و سقف ساعتیِ شماره‌های واقعی هم بی‌معنی می‌ماند.
    console.error('[otp] درخواست کد برای شماره بدون حساب:', phone);
    return { ok: true };
  }

  const code = newCode();

  // کدهای قبلی همین شماره باطل می‌شوند: دو کد زنده یعنی دو کلید زنده
  await query(
    `UPDATE otp_codes SET consumed_at = now()
      WHERE phone = $1 AND consumed_at IS NULL`,
    [phone],
  );

  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, request_ip)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval, NULLIF($4,''))`,
    [phone, fingerprint(phone, code), String(TTL_SEC), ip],
  );

  // حالت توسعه: کد در لاگ می‌نشیند به‌جای اینکه پیامک شود. برای آزمودن
  // بدون سوزاندن اعتبار پیامک.
  if (s.sms_dev_mode === 'true') {
    console.error(`[otp] حالت توسعه — کد ورود ${phone}: ${code}`);
    return { ok: true, devCode: code };
  }

  const brand = s.invoice_seller_name || s.panel_title || 'پاسارگاد میزبان';
  const sms = await sendSms(
    phone,
    `${brand}\nکد ورود شما: ${code}\nتا ${Math.round(TTL_SEC / 60)} دقیقه معتبر است.\nاین کد را به کسی ندهید.`,
  );

  if (!sms.ok) {
    // شکست ارسال به کاربر گفته می‌شود، برخلاف «حساب وجود ندارد».
    // اینجا چیزی لو نمی‌رود و ندانستنش یعنی انتظار بی‌پایان.
    console.error('[otp] ارسال پیامک ناموفق:', sms.error);
    return { ok: false, error: 'ارسال پیامک ناموفق بود. کمی بعد دوباره امتحان کنید.', status: 502 };
  }

  return { ok: true };
}

export interface OtpVerifyResult {
  ok: boolean;
  error?: string;
  status?: number;
  user?: { id: number; username: string; role: string; customer_id: number | null };
}

/**
 * بررسی کد و برگرداندن حساب.
 *
 * نشست را خودش باز نمی‌کند؛ آن کار مسیر ای‌پی‌آی است با startSession.
 * جداکردنشان یعنی این تابع بدون وابستگی به کوکی قابل آزمودن است.
 */
export async function verifyOtp(rawPhone: unknown, rawCode: unknown): Promise<OtpVerifyResult> {
  const s = await getSettings();
  if (s.otp_login_enabled === 'false') {
    return { ok: false, error: 'ورود با کد پیامکی فعال نیست', status: 503 };
  }

  const phone = normalizePhone(rawPhone);
  const code = String(rawCode ?? '').trim().replace(/\D/g, '');

  if (!isValidPhone(phone) || code.length !== 6) {
    return { ok: false, error: 'شماره یا کد معتبر نیست', status: 400 };
  }

  const row = await queryOne<{
    id: number;
    code_hash: string;
    attempts: number;
    expired: boolean;
    consumed: boolean;
  }>(
    `SELECT id, code_hash, attempts,
            (expires_at <= now()) AS expired,
            (consumed_at IS NOT NULL) AS consumed
       FROM otp_codes
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone],
  );

  // پیام یکسان برای «کدی درخواست نشده» و «کد اشتباه»: تفاوتشان فقط
  // به حمله‌کننده می‌گوید کدام شماره‌ها کد گرفته‌اند.
  if (!row) return { ok: false, error: 'کد وارد‌شده درست نیست', status: 401 };

  if (row.consumed) {
    return { ok: false, error: 'این کد قبلا استفاده شده. کد تازه بگیرید.', status: 401 };
  }
  if (row.expired) {
    return { ok: false, error: 'کد منقضی شده. کد تازه بگیرید.', status: 401 };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'تعداد تلاش بیش از حد. کد تازه بگیرید.', status: 429 };
  }

  // شمارنده **پیش از** مقایسه بالا می‌رود. اگر بعدش بالا می‌رفت،
  // درخواست‌های موازی همگی شمارنده صفر می‌دیدند و سقف تلاش دور زده
  // می‌شد.
  await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);

  if (!sameHash(row.code_hash, fingerprint(phone, code))) {
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    return {
      ok: false,
      error:
        left > 0
          ? `کد وارد‌شده درست نیست. ${left} تلاش دیگر باقی است.`
          : 'کد وارد‌شده درست نیست. تلاش‌ها تمام شد؛ کد تازه بگیرید.',
      status: 401,
    };
  }

  const user = await queryOne<{
    id: number;
    username: string;
    role: string;
    customer_id: number | null;
  }>(
    `SELECT id, username, role, customer_id
       FROM users
      WHERE lower(username) = lower($1) AND role = 'customer' AND is_active`,
    [phone],
  );

  // حساب بین درخواست کد و تأیید غیرفعال شده. کد را می‌سوزانیم تا
  // دوباره امتحان‌کردنش هم فایده‌ای نداشته باشد.
  if (!user || !user.customer_id) {
    await query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [row.id]);
    return { ok: false, error: 'این حساب فعال نیست', status: 403 };
  }

  // یکبارمصرف: همین‌جا مصرف می‌شود، پیش از بازشدن نشست
  await query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [row.id]);

  return { ok: true, user };
}
