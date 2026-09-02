import { q, settings, logErr, log } from './db.mjs';

/**
 * ارسال پیامک با کاوه‌نگار — نسخه ورکر.
 *
 * این منطق در lib/sms.ts هم هست. تکرارش عمدی است تا ورکر هیچ وابستگی‌ای به
 * اپ وب نداشته باشد. اگر یکی را عوض کردید، آن یکی را هم عوض کنید.
 *
 * نکته: کاوه‌نگار خطا را با کد ۲۰۰ برمی‌گرداند و علت در return.status بدنه است.
 */

const STATUS_FA = {
  400: 'پارامترها ناقص است',
  401: 'حساب غیرفعال است',
  402: 'عملیات ناموفق بود',
  403: 'کد شناسایی نامعتبر است',
  406: 'پارامتر اجباری خالی فرستاده شده',
  411: 'دریافت‌کننده نامعتبر است',
  412: 'فرستنده نامعتبر است',
  413: 'پیام خالی است یا طولش از حد مجاز بیشتر است',
  418: 'اعتبار شما کافی نیست',
  426: 'استفاده از این خط نیازمند سرویس ویژه است',
};

export async function sendSms(receptor, message) {
  const apiKey = process.env.KAVENEGAR_API_KEY;
  const sender = process.env.KAVENEGAR_SENDER || '';

  if (!apiKey) return { ok: false, error: 'کلید کاوه‌نگار تنظیم نشده است' };

  const body = new URLSearchParams({ receptor, message });
  if (sender) body.set('sender', sender);

  try {
    const res = await fetch(`https://api.kavenegar.com/v1/${apiKey}/sms/send.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `پاسخ نامعتبر از کاوه‌نگار: ${text.slice(0, 120)}` };
    }

    const status = parsed?.return?.status;
    if (status !== 200) {
      const reason = STATUS_FA[status] || parsed?.return?.message || 'علت نامشخص';
      return { ok: false, error: `کاوه‌نگار: ${reason} (کد ${status ?? '؟'})` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `ارتباط با کاوه‌نگار برقرار نشد: ${err.message}` };
  }
}

/** شماره‌های گیرنده از تنظیمات و کاربران فعال */
export async function recipients() {
  const s = await settings();
  const fromSettings = String(s.sms_recipients || '')
    .split(/[,،\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const rows = await q(
    `SELECT phone FROM users WHERE is_active AND phone IS NOT NULL AND phone <> ''`,
  );
  return Array.from(new Set([...fromSettings, ...rows.map((r) => String(r.phone).trim()).filter(Boolean)]));
}

/** ارسال به همه گیرنده‌ها و ثبت در لاگ */
export async function notifyAll(message, incidentId = null) {
  const s = await settings();
  if (s.sms_enabled !== 'true') {
    log('پیامک غیرفعال است؛ ارسال نشد:', message);
    return { sent: 0, failed: 0 };
  }

  const numbers = await recipients();
  if (!numbers.length) {
    logErr('هیچ شماره گیرنده‌ای تنظیم نشده است. هشدار ارسال نشد:', message);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const to of numbers) {
    const r = await sendSms(to, message);
    if (r.ok) sent++;
    else {
      failed++;
      logErr('ارسال پیامک ناموفق:', to, r.error);
    }
    await q(
      `INSERT INTO notifications (incident_id, channel, recipient, body, ok, error)
       VALUES ($1, 'sms', $2, $3, $4, $5)`,
      [incidentId, to, message, r.ok, r.error ?? null],
    ).catch((e) => logErr('ثبت لاگ پیامک ناموفق:', e.message));
  }

  return { sent, failed };
}
