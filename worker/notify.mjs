import { notifyAll } from './sms.mjs';
import { telegramAll } from './telegram.mjs';
import { emailAll } from './email.mjs';
import { logErr } from './db.mjs';

/**
 * ارسال هشدار به همه کانال‌های فعال.
 *
 * شکست یک کانال نباید جلوی دیگری را بگیرد: ممکن است اعتبار پیامک تمام
 * شده باشد و تلگرام سالم باشد، یا برعکس.
 */
export async function notify(message, incidentId = null) {
  const [sms, telegram, email] = await Promise.all([
    notifyAll(message, incidentId).catch((e) => {
      logErr('پیامک ناموفق:', e.message);
      return { sent: 0, failed: 1 };
    }),
    telegramAll(message, incidentId).catch((e) => {
      logErr('تلگرام ناموفق:', e.message);
      return { sent: 0, failed: 1 };
    }),
    emailAll(message, incidentId).catch((e) => {
      logErr('ایمیل ناموفق:', e.message);
      return { sent: 0, failed: 1 };
    }),
  ]);
  return {
    sent: sms.sent + telegram.sent + email.sent,
    failed: sms.failed + telegram.failed + email.failed,
  };
}
