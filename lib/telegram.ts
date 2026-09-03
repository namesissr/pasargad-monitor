import { query } from './db';
import { getSettings } from './settings';

/**
 * ارسال پیام تلگرام با ربات.
 *
 * دو نکته که مثل کاوه‌نگار وقت می‌گیرند اگر رعایت نشوند:
 *
 * ۱. تلگرام خطا را در بدنه با «ok: false» و «description» برمی‌گرداند.
 *    فقط res.ok را نگاه نکنید — مخصوصاً چون بعضی خطاها کد ۲۰۰ می‌گیرند.
 *
 * ۲. api.telegram.org از ایران در دسترس نیست. اگر سرور پنل داخل ایران
 *    است، TELEGRAM_API_BASE را روی یک واسط یا پروکسی بگذارید — همان
 *    الگویی که برای TMDb استفاده می‌شود.
 *
 * این منطق در worker/telegram.mjs هم تکرار شده. عمدی است: ورکر هشدار
 * نباید به بالا بودن اپ وب وابسته باشد. اگر اینجا را عوض کردید، آنجا را
 * هم عوض کنید.
 */

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

/** ارسال یک پیام به یک شناسه گفتگو */
export async function sendTelegram(chatId: string, message: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: 'توکن ربات تلگرام تنظیم نشده است' };

  const apiBase = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
  const url = `${apiBase}/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        // بدون پارس مارک‌داون: نام مشتری یا یادداشت ممکن است کاراکتر
        // خاص داشته باشد و کل پیام را با خطای پارس بیندازد
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let parsed: { ok?: boolean; description?: string; error_code?: number } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `پاسخ نامعتبر از تلگرام: ${text.slice(0, 120)}` };
    }

    if (parsed.ok !== true) {
      const reason = parsed.description || 'علت نامشخص';
      return { ok: false, error: `تلگرام: ${reason} (کد ${parsed.error_code ?? res.status})` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `ارتباط با تلگرام برقرار نشد: ${msg}` };
  }
}

/** شناسه‌های گفتگو از تنظیمات */
export async function telegramRecipients(): Promise<string[]> {
  const s = await getSettings();
  return Array.from(
    new Set(
      (s.telegram_chat_ids || '')
        .split(/[,،\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  );
}

/** ارسال به همه گفتگوها و ثبت در لاگ */
export async function telegramAll(
  message: string,
  incidentId?: number,
): Promise<{ sent: number; failed: number }> {
  const s = await getSettings();
  if (s.telegram_enabled !== 'true') return { sent: 0, failed: 0 };

  const chats = await telegramRecipients();
  let sent = 0;
  let failed = 0;

  for (const to of chats) {
    const r = await sendTelegram(to, message);
    if (r.ok) sent++;
    else failed++;
    await query(
      `INSERT INTO notifications (incident_id, channel, recipient, body, ok, error)
       VALUES ($1, 'telegram', $2, $3, $4, $5)`,
      [incidentId ?? null, to, message, r.ok, r.error ?? null],
    ).catch((e) => console.error('[telegram] ثبت لاگ ناموفق:', e.message));
  }

  return { sent, failed };
}
