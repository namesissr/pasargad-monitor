import { query } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { sendMail, type SmtpConfig, type SendResult } from '@/worker/smtp.mjs';

/**
 * ارسال ایمیل هشدار — نسخه اپ وب.
 *
 * منطق ارسال در worker/email.mjs هم هست تا ورکر به اپ وب وابسته نباشد،
 * مثل پیامک و تلگرام. ولی **خود پروتکل تکرار نشده**: هر دو طرف
 * worker/smtp.mjs را صدا می‌زنند. پروتکلی با این تعداد جزئیات اگر دو جا
 * نوشته شود، دیر یا زود دو رفتار متفاوت می‌دهد.
 */

/** تنظیمات SMTP از جدول settings — نه از .env، تا تغییرش بیلد نخواهد */
export async function smtpConfig(): Promise<SmtpConfig> {
  const s = await getSettings(true);
  return {
    host: s.smtp_host || '',
    port: s.smtp_port || '',
    security: s.smtp_security || 'starttls',
    user: s.smtp_user || '',
    pass: s.smtp_pass || '',
    from: s.smtp_from || '',
    fromName: s.smtp_from_name || 'پاسارگاد میزبان',
    insecure: String(s.smtp_insecure || 'false') === 'true',
  };
}

/** پیکربندی حداقلی کامل است؟ */
export function smtpConfigured(cfg: SmtpConfig): boolean {
  return Boolean(cfg.host && cfg.from);
}

/** نشانی گیرندگان: تنظیمات به‌علاوه ایمیل کاربران فعال پنل */
export async function recipients(): Promise<string[]> {
  const s = await getSettings();
  const fromSettings = String(s.email_recipients || '')
    .split(/[,،\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const rows = await query<{ email: string }>(
    `SELECT email FROM users WHERE is_active AND email IS NOT NULL AND email <> ''`,
  );

  return Array.from(
    new Set([...fromSettings, ...rows.map((r) => String(r.email).trim()).filter(Boolean)]),
  );
}

async function record(
  incidentId: number | null,
  to: string,
  subject: string,
  body: string,
  result: SendResult,
) {
  await query(
    `INSERT INTO notifications (incident_id, channel, recipient, body, ok, error)
     VALUES ($1, 'email', $2, $3, $4, $5)`,
    [incidentId, to, `${subject}\n\n${body}`, result.ok, result.error ?? null],
  ).catch((e) => console.error('[email] ثبت لاگ ناموفق:', e instanceof Error ? e.message : e));
}

/** ارسال به یک نشانی مشخص */
export async function sendEmailTo(
  to: string,
  subject: string,
  body: string,
  incidentId: number | null = null,
): Promise<SendResult> {
  const s = await getSettings();
  if (s.email_enabled !== 'true') return { ok: false, error: 'ارسال ایمیل غیرفعال است' };

  const cfg = await smtpConfig();
  if (!smtpConfigured(cfg)) return { ok: false, error: 'تنظیمات SMTP کامل نیست' };

  const r = await sendMail(cfg, { to, subject, text: body });
  await record(incidentId, to, subject, body, r);
  return r;
}

/**
 * ارسال به همه گیرندگان پنل.
 *
 * موضوع از خط اول پیام می‌آید. موضوع ثابت باعث می‌شود همه ایمیل‌ها در
 * صندوق یکسان دیده شوند و کسی بازشان نکند.
 */
export async function emailAll(
  message: string,
  incidentId?: number,
): Promise<{ sent: number; failed: number }> {
  const s = await getSettings();
  if (s.email_enabled !== 'true') return { sent: 0, failed: 0 };

  const cfg = await smtpConfig();
  if (!smtpConfigured(cfg)) {
    console.error('[email] تنظیمات SMTP کامل نیست؛ هشدار ارسال نشد:', message);
    return { sent: 0, failed: 0 };
  }

  const addresses = await recipients();
  if (!addresses.length) {
    console.error('[email] هیچ نشانی گیرنده‌ای تنظیم نشده است؛ هشدار ارسال نشد:', message);
    return { sent: 0, failed: 0 };
  }

  const subject = String(message).split('\n')[0].slice(0, 150);

  let sent = 0;
  let failed = 0;
  for (const to of addresses) {
    const r = await sendMail(cfg, { to, subject, text: message });
    if (r.ok) sent++;
    else {
      failed++;
      console.error('[email] ارسال ناموفق:', to, r.error);
    }
    await record(incidentId ?? null, to, subject, message, r);
  }
  return { sent, failed };
}
