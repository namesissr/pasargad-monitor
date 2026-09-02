import { query } from './db';
import { getSettings } from './settings';

/**
 * ارسال پیامک با کاوه‌نگار.
 *
 * نکته‌ای که یک بار وقت گرفت: کاوه‌نگار خطا را هم با کد ۲۰۰ برمی‌گرداند و
 * علت واقعی در فیلد return.status بدنه است. پس فقط res.ok را نگاه نکنید.
 *
 * این منطق در worker/sms.mjs هم تکرار شده. عمدی است: ورکر هشدار نباید به
 * بالا بودن اپ وب وابسته باشد، وگرنه وقتی سایت می‌خوابد هشداری هم نمی‌آید.
 * اگر اینجا را عوض کردید، آنجا را هم عوض کنید.
 */

export interface SmsResult {
  ok: boolean;
  error?: string;
}

const KAVENEGAR_STATUS: Record<number, string> = {
  400: 'پارامترها ناقص است',
  401: 'حساب غیرفعال است',
  402: 'عملیات ناموفق بود',
  403: 'کد شناسایی نامعتبر است',
  404: 'متد نامشخص است',
  405: 'متد GET یا POST اشتباه است',
  406: 'پارامتر اجباری خالی فرستاده شده',
  407: 'دسترسی به اطلاعات مورد نظر مجاز نیست',
  409: 'سرور قادر به پاسخ‌گویی نیست',
  411: 'دریافت‌کننده نامعتبر است',
  412: 'فرستنده نامعتبر است',
  413: 'پیام خالی است یا طولش از حد مجاز بیشتر است',
  414: 'حجم درخواست بیشتر از حد مجاز است',
  418: 'اعتبار شما کافی نیست',
  424: 'الگوی مورد نظر پیدا نشد',
  426: 'استفاده از این خط نیازمند سرویس ویژه است',
  428: 'ارسال کد از طریق تماس تلفنی امکان‌پذیر نیست',
};

/** ارسال یک پیامک به یک شماره */
export async function sendSms(receptor: string, message: string): Promise<SmsResult> {
  const apiKey = process.env.KAVENEGAR_API_KEY;
  const sender = process.env.KAVENEGAR_SENDER || '';

  if (!apiKey) return { ok: false, error: 'کلید کاوه‌نگار تنظیم نشده است' };

  const url = `https://api.kavenegar.com/v1/${apiKey}/sms/send.json`;
  const body = new URLSearchParams({ receptor, message });
  if (sender) body.set('sender', sender);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let parsed: { return?: { status?: number; message?: string } } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `پاسخ نامعتبر از کاوه‌نگار: ${text.slice(0, 120)}` };
    }

    const status = parsed.return?.status;
    if (status !== 200) {
      const reason = KAVENEGAR_STATUS[status ?? 0] || parsed.return?.message || 'علت نامشخص';
      return { ok: false, error: `کاوه‌نگار: ${reason} (کد ${status ?? '؟'})` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `ارتباط با کاوه‌نگار برقرار نشد: ${msg}` };
  }
}

/** فهرست شماره‌های گیرنده هشدار از تنظیمات و کاربران */
export async function alertRecipients(): Promise<string[]> {
  const s = await getSettings();
  const fromSettings = (s.sms_recipients || '')
    .split(/[,،\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const rows = await query<{ phone: string }>(
    `SELECT phone FROM users WHERE is_active AND phone IS NOT NULL AND phone <> ''`,
  );
  const fromUsers = rows.map((r) => r.phone.trim()).filter(Boolean);

  return Array.from(new Set([...fromSettings, ...fromUsers]));
}

/** ارسال به همه گیرنده‌ها و ثبت در لاگ */
export async function notifyAll(message: string, incidentId?: number): Promise<{ sent: number; failed: number }> {
  const s = await getSettings();
  if (s.sms_enabled !== 'true') return { sent: 0, failed: 0 };

  const numbers = await alertRecipients();
  let sent = 0;
  let failed = 0;

  for (const to of numbers) {
    const r = await sendSms(to, message);
    if (r.ok) sent++;
    else failed++;
    await query(
      `INSERT INTO notifications (incident_id, channel, recipient, body, ok, error)
       VALUES ($1, 'sms', $2, $3, $4, $5)`,
      [incidentId ?? null, to, message, r.ok, r.error ?? null],
    ).catch((e) => console.error('[sms] ثبت لاگ پیامک ناموفق:', e.message));
  }

  return { sent, failed };
}
