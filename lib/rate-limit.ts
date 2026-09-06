/**
 * محدودکننده نرخ، در حافظه همین پروسه.
 *
 * ── چرا لازم است ───────────────────────────────────────────
 *
 * مسیرهای عمومی فروشگاه از اینترنت باز در دسترس‌اند و یکی‌شان **حساب
 * می‌سازد**. بدون سقف، یک اسکریپت در چند دقیقه هزاران مشتری و سفارش
 * می‌سازد؛ جدول‌ها پر می‌شوند، ایمیل‌ها می‌روند، و پیداکردن سفارش‌های
 * واقعی لای آن‌ها کار یک روز می‌شود.
 *
 * ── چرا در حافظه، نه در ردیس یا دیتابیس ────────────────────
 *
 * پنل یک نمونه دارد. محدودکننده در حافظه برای همین کافی است و هیچ
 * وابستگی تازه‌ای اضافه نمی‌کند.
 *
 * **اگر روزی چند نمونه شد، این سقف به‌ازای هر نمونه می‌شود.** یعنی
 * سست‌تر، نه بی‌اثر. جایگزینی‌اش با ردیس همان‌جا لازم می‌شود.
 *
 * ری‌استارت سرویس شمارنده‌ها را صفر می‌کند. این هم پذیرفته است: سقف
 * برای جلوگیری از سیل است، نه برای حسابداری دقیق.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// سقف تعداد کلیدهای نگه‌داشته‌شده. بدون آن، هر آی‌پی تازه یک ردیف
// دائمی می‌سازد و حافظه پروسه بی‌صدا بالا می‌رود — همان نشتی که فقط
// بعد از چند هفته و با ری‌استارت خودبه‌خودی معلوم می‌شود.
const MAX_KEYS = 10_000;

/**
 * آیا این کلید هنوز اجازه دارد؟
 *
 * برمی‌گرداند { ok، مانده، ثانیه تا آزادشدن }. خودِ تابع چیزی را رد
 * نمی‌کند؛ تصمیم با مسیر است تا پیام خطا فارسی و مربوط باشد.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const windowMs = windowSec * 1000;

  // پاک‌سازی تنبل: فقط وقتی نقشه بزرگ شد، و فقط کلیدهای مرده
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) {
      if (!b.hits.length || now - b.hits[b.hits.length - 1] > windowMs) buckets.delete(k);
    }
    // اگر باز هم بزرگ بود، از قدیمی‌ترین‌ها حذف می‌شود. سقف حافظه
    // مهم‌تر از دقت شمارش است.
    if (buckets.size > MAX_KEYS) {
      for (const k of Array.from(buckets.keys()).slice(0, buckets.size - MAX_KEYS)) {
        buckets.delete(k);
      }
    }
  }

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfter: 0 };
}

/**
 * آی‌پی درخواست‌کننده.
 *
 * پشت انجین‌ایکس، آی‌پی واقعی در X-Forwarded-For است. اولین مقدار
 * زنجیره را می‌گیریم — همان آی‌پی کلاینت.
 *
 * **این هدر جعل‌شدنی است** اگر کسی مستقیم به اپ برسد. اپ فقط از پشت
 * انجین‌ایکس در دسترس است و انجین‌ایکس این هدر را خودش بازنویسی
 * می‌کند، پس اینجا قابل اتکاست. اگر روزی اپ مستقیم منتشر شد، این
 * فرض هم می‌شکند.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || 'unknown';
}
