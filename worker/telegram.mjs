import { q, settings, logErr } from './db.mjs';

/**
 * ارسال پیام تلگرام از ورکر.
 *
 * نسخه دوقلوی lib/telegram.ts است. تکرار عمدی است: ورکر هشدار نباید به
 * بالا بودن اپ وب وابسته باشد، وگرنه وقتی سایت می‌خوابد هشداری هم نمی‌آید.
 * اگر یکی را عوض کردید، دیگری را هم عوض کنید.
 *
 * دو نکته: تلگرام خطا را در بدنه با «ok: false» می‌گوید، و
 * api.telegram.org از ایران در دسترس نیست — با TELEGRAM_API_BASE از
 * واسط عبور دهید.
 */

export async function sendTelegram(chatId, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: 'توکن ربات تلگرام تنظیم نشده است' };

  const apiBase = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');

  try {
    const res = await fetch(`${apiBase}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `پاسخ نامعتبر از تلگرام: ${text.slice(0, 120)}` };
    }

    if (parsed.ok !== true) {
      return {
        ok: false,
        error: `تلگرام: ${parsed.description || 'علت نامشخص'} (کد ${parsed.error_code ?? res.status})`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `ارتباط با تلگرام برقرار نشد: ${err.message}` };
  }
}

/** ارسال به همه گفتگوهای تنظیم‌شده */
export async function telegramAll(message, incidentId = null) {
  const s = await settings();
  if (s.telegram_enabled !== 'true') return { sent: 0, failed: 0 };

  const chats = Array.from(
    new Set(
      String(s.telegram_chat_ids || '')
        .split(/[,،\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  );

  if (!chats.length) {
    logErr('تلگرام فعال است ولی هیچ شناسه گفتگویی تنظیم نشده. هشدار ارسال نشد:', message);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const to of chats) {
    const r = await sendTelegram(to, message);
    if (r.ok) sent++;
    else {
      failed++;
      logErr('ارسال تلگرام ناموفق:', to, r.error);
    }
    await q(
      `INSERT INTO notifications (incident_id, channel, recipient, body, ok, error)
       VALUES ($1, 'telegram', $2, $3, $4, $5)`,
      [incidentId, to, message, r.ok, r.error ?? null],
    ).catch((e) => logErr('ثبت لاگ تلگرام ناموفق:', e.message));
  }

  return { sent, failed };
}
