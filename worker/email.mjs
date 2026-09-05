import { q, settings, log, logErr } from './db.mjs';
import { sendMail } from './smtp.mjs';

/**
 * ارسال ایمیل هشدار — نسخه ورکر.
 *
 * برخلاف پیامک و تلگرام که کلیدشان در .env است، تنظیمات SMTP در جدول
 * settings می‌نشیند تا از پنل قابل تغییر باشد و عوض‌کردنش بیلد نخواهد.
 *
 * منطق ارسال در lib/email.ts هم هست تا ورکر به اپ وب وابسته نباشد؛ ولی
 * خود پروتکل در worker/smtp.mjs یکی است و هر دو همان را صدا می‌زنند.
 */

/** تنظیمات SMTP از جدول settings */
export async function smtpConfig(force = false) {
  const s = await settings(force);
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

/** پیکربندی کامل است؟ بدون این سه، هیچ ایمیلی نمی‌رود */
export function smtpConfigured(cfg) {
  return Boolean(cfg.host && cfg.from);
}

/**
 * نشانی گیرندگان از تنظیمات و کاربران فعال.
 *
 * مثل شماره‌های پیامک: هرکس در پنل حساب دارد و ایمیلش را نوشته، خودکار
 * اضافه می‌شود.
 */
export async function recipients() {
  const s = await settings();
  const fromSettings = String(s.email_recipients || '')
    .split(/[,،\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const rows = await q(
    `SELECT email FROM users WHERE is_active AND email IS NOT NULL AND email <> ''`,
  );

  return Array.from(
    new Set([...fromSettings, ...rows.map((r) => String(r.email).trim()).filter(Boolean)]),
  );
}

/** ثبت در همان لاگ اعلان‌ها که پیامک و تلگرام دارند */
async function record(incidentId, to, subject, body, result) {
  await q(
    `INSERT INTO notifications (incident_id, channel, recipient, body, ok, error)
     VALUES ($1, 'email', $2, $3, $4, $5)`,
    [incidentId, to, `${subject}\n\n${body}`, result.ok, result.error ?? null],
  ).catch((e) => logErr('ثبت لاگ ایمیل ناموفق:', e.message));
}

/** ارسال به یک نشانی مشخص — برای هشدار مشتری */
export async function sendEmailTo(to, subject, body, incidentId = null) {
  const s = await settings();
  if (s.email_enabled !== 'true') return { ok: false, error: 'ارسال ایمیل غیرفعال است' };

  const cfg = await smtpConfig();
  if (!smtpConfigured(cfg)) return { ok: false, error: 'تنظیمات SMTP کامل نیست' };

  const r = await sendMail(cfg, { to, subject, text: body });
  await record(incidentId, to, subject, body, r);
  if (!r.ok) logErr('ارسال ایمیل ناموفق:', to, r.error);
  return r;
}

/**
 * ارسال به همه گیرندگان پنل.
 *
 * موضوع از خط اول پیام ساخته می‌شود. پیام‌های هشدار این پروژه یک جمله‌اند
 * و همان جمله بهترین موضوع است — موضوع ثابتِ «هشدار» باعث می‌شود همه
 * ایمیل‌ها در صندوق یکسان دیده شوند و کسی بازشان نکند.
 */
export async function emailAll(message, incidentId = null) {
  const s = await settings();
  if (s.email_enabled !== 'true') {
    log('ایمیل غیرفعال است؛ ارسال نشد:', message);
    return { sent: 0, failed: 0 };
  }

  const cfg = await smtpConfig();
  if (!smtpConfigured(cfg)) {
    logErr('تنظیمات SMTP کامل نیست. هشدار ایمیلی ارسال نشد:', message);
    return { sent: 0, failed: 0 };
  }

  const addresses = await recipients();
  if (!addresses.length) {
    logErr('هیچ نشانی ایمیلی تنظیم نشده است. هشدار ارسال نشد:', message);
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
      logErr('ارسال ایمیل ناموفق:', to, r.error);
    }
    await record(incidentId, to, subject, message, r);
  }
  return { sent, failed };
}
