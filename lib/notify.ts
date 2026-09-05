import { notifyAll as smsAll } from './sms';
import { telegramAll } from './telegram';
import { emailAll } from './email';

/**
 * ارسال هشدار به همه کانال‌های فعال.
 *
 * هر کانال جدا خاموش و روشن می‌شود. اگر هیچ‌کدام فعال نباشد چیزی
 * فرستاده نمی‌شود و این خطا نیست — کاربر عمداً خاموششان کرده.
 *
 * شکست یک کانال نباید جلوی دیگری را بگیرد: پیامک ممکن است اعتبارش تمام
 * شده باشد و تلگرام سالم باشد، یا برعکس.
 */
interface ChannelResult {
  sent: number;
  failed: number;
}

export async function notify(
  message: string,
  incidentId?: number,
): Promise<{ sms: ChannelResult; telegram: ChannelResult; email: ChannelResult }> {
  const [sms, telegram, email] = await Promise.all([
    smsAll(message, incidentId).catch((e) => {
      console.error('[notify] پیامک ناموفق:', e instanceof Error ? e.message : e);
      return { sent: 0, failed: 1 };
    }),
    telegramAll(message, incidentId).catch((e) => {
      console.error('[notify] تلگرام ناموفق:', e instanceof Error ? e.message : e);
      return { sent: 0, failed: 1 };
    }),
    emailAll(message, incidentId).catch((e) => {
      console.error('[notify] ایمیل ناموفق:', e instanceof Error ? e.message : e);
      return { sent: 0, failed: 1 };
    }),
  ]);
  return { sms, telegram, email };
}
