import { randomBytes } from 'node:crypto';
import { query, queryOne } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/http';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * اتصال تلگرام مشتری.
 *
 * ── شناسه گفتگو از اینجا نمی‌آید ───────────────────────────
 *
 * این مسیر فقط یک **کد یکبارمصرف** می‌سازد. شناسه گفتگوی تلگرام را ورکر
 * از خود پیامی که به ربات می‌رسد برمی‌دارد.
 *
 * اگر شناسه از اینجا پذیرفته می‌شد، هر مشتری می‌توانست شناسه یک نفر
 * دیگر را بفرستد و هشدارهای او را بگیرد. به همین سادگی.
 *
 * ── کد کوتاه است، عمدا ─────────────────────────────────────
 *
 * در آدرس t.me می‌رود و گاهی دستی تایپ می‌شود. امنیتش از کوتاهی‌اش
 * نمی‌آید بلکه از سه چیز می‌آید: پنج دقیقه اعتبار، یکبارمصرف بودن، و
 * اینکه حدس‌زدنش هیچ سودی ندارد جز وصل‌کردن تلگرام خودت به حساب
 * قربانی — که خودش هشدارها را از دست می‌دهد و متوجه می‌شود.
 */

const TTL_MIN = 5;

/** وضعیت فعلی اتصال */
export async function GET() {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const c = await queryOne<{ telegram_chat_id: string | null; telegram_linked_at: string | null }>(
      `SELECT telegram_chat_id, telegram_linked_at FROM customers WHERE id = $1`,
      [customerId],
    );

    const s = await getSettings();

    return ok({
      linked: Boolean(c?.telegram_chat_id),
      linkedAt: c?.telegram_linked_at ?? null,
      enabled: s.telegram_customer_enabled !== 'false',
      // خالی یعنی ورکر هنوز به تلگرام وصل نشده. رابط باید بتواند این را
      // بگوید، وگرنه دکمه‌ای می‌سازد که به لینک خراب می‌رود.
      botUsername: s.telegram_bot_username || '',
    });
  });
}

/** ساخت کد اتصال تازه */
export async function POST() {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const s = await getSettings();
    if (s.telegram_customer_enabled === 'false') {
      return fail('اطلاع‌رسانی تلگرام فعال نیست', 503);
    }
    if (!s.telegram_bot_username) {
      return fail(
        'ربات تلگرام هنوز آماده نیست. کمی بعد دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.',
        503,
      );
    }

    // کدهای قبلی همین مشتری باطل می‌شوند: چند کد زنده یعنی چند راه باز
    await query(
      `UPDATE telegram_link_tokens SET consumed_at = now()
        WHERE customer_id = $1 AND consumed_at IS NULL`,
      [customerId],
    );

    // base64url بدون کاراکتر مشکل‌ساز در آدرس
    const code = randomBytes(12).toString('base64url');

    await query(
      `INSERT INTO telegram_link_tokens (code, customer_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [code, customerId, String(TTL_MIN)],
    );

    return ok({
      code,
      url: `https://t.me/${s.telegram_bot_username}?start=${code}`,
      botUsername: s.telegram_bot_username,
      expiresInMin: TTL_MIN,
    });
  });
}

/** قطع اتصال */
export async function DELETE() {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    await query(
      `UPDATE customers SET telegram_chat_id = NULL, telegram_linked_at = NULL WHERE id = $1`,
      [customerId],
    );
    await query(
      `UPDATE telegram_link_tokens SET consumed_at = now()
        WHERE customer_id = $1 AND consumed_at IS NULL`,
      [customerId],
    );

    return ok({ ok: true });
  });
}
