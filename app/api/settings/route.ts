import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSettings, saveSettings } from '@/lib/settings';
import { sendSms } from '@/lib/sms';
import { sendTelegram } from '@/lib/telegram';
import { smtpConfig, smtpConfigured } from '@/lib/email';
import { sendMail } from '@/worker/smtp.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** کلیدهایی که از پنل قابل تغییرند — بقیه دست‌نخورده می‌مانند */
const ALLOWED = [
  'sms_enabled',
  'sms_recipients',
  'telegram_enabled',
  'telegram_chat_ids',
  'vz_discover_hours',
  'vz_auto_apply',
  'alert_repeat_min',
  'down_after_sec',
  'raw_retention_days',
  'check_interval_sec',
  'traffic_calendar',
  'panel_title',
  'email_enabled',
  'email_recipients',
  'smtp_host',
  'smtp_port',
  'smtp_security',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'smtp_from_name',
  'smtp_insecure',
];

/**
 * کلیدهایی که هرگز به پنل برنمی‌گردند.
 *
 * رمز سرور ایمیل در جدول settings است تا تغییرش بیلد نخواهد، ولی
 * برگرداندنش در پاسخ ای‌پی‌آی یعنی هر بار که کسی صفحه تنظیمات را باز
 * می‌کند، رمز از شبکه رد می‌شود و در تاریخچه مرورگر و لاگ‌ها می‌نشیند.
 * پنل فقط می‌داند تنظیم شده یا نه.
 */
const SECRET = ['smtp_pass'];

export async function GET() {
  return handle(async () => {
    await requireUser();
    const raw = await getSettings(true);
    const settings: Record<string, string> = { ...raw };
    for (const key of SECRET) delete settings[key];
    const users = await query(
      `SELECT id, username, full_name, phone, email, role, is_active, last_login_at
         FROM users ORDER BY id`,
    );
    const smsConfigured = Boolean(process.env.KAVENEGAR_API_KEY);
    const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    const emailConfigured = Boolean(raw.smtp_host && raw.smtp_from);
    const smtpPassSet = Boolean(raw.smtp_pass);
    const recent = await query(
      `SELECT id, recipient, body, ok, error, created_at FROM notifications ORDER BY created_at DESC LIMIT 20`,
    );
    return ok({
      settings,
      users,
      smsConfigured,
      telegramConfigured,
      emailConfigured,
      smtpPassSet,
      recentSms: recent,
    });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const patch: Record<string, string> = {};
    for (const key of ALLOWED) {
      if (!(key in body)) continue;
      const value = String(body[key] ?? '');
      // رمز خالی یعنی «عوض نکن»، نه «پاک کن». چون پنل رمز فعلی را
      // نمی‌گیرد، فرمِ ذخیره‌شده با فیلد خالی وگرنه رمز را می‌سوزاند —
      // و بعدش هیچ ایمیلی نمی‌رود بی آنکه کسی بفهمد چرا.
      if (SECRET.includes(key) && value === '') continue;
      patch[key] = value;
    }

    if ('traffic_calendar' in patch && !['jalali', 'gregorian'].includes(patch.traffic_calendar)) {
      return fail('تقویم باید jalali یا gregorian باشد', 400);
    }

    if ('smtp_security' in patch && !['none', 'starttls', 'tls'].includes(patch.smtp_security)) {
      return fail('روش امنیتی باید none یا starttls یا tls باشد', 400);
    }

    if ('smtp_port' in patch && patch.smtp_port !== '') {
      const port = Number(patch.smtp_port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return fail('پورت SMTP نامعتبر است', 400);
      }
    }

    if (!Object.keys(patch).length) return fail('هیچ تنظیمی برای ذخیره فرستاده نشده است', 400);

    await saveSettings(patch);
    return ok({ ok: true });
  });
}

/**
 * ویرایش نشانی ایمیل یک کاربر پنل.
 *
 * ساخت کاربر با اسکریپت روی سرور انجام می‌شود، ولی ایمیل باید از پنل
 * قابل تغییر باشد: بدون آن، «ایمیل کاربران خودکار اضافه می‌شود» حرفی
 * است که راهی برای عملی‌کردنش نیست.
 */
export async function PUT(req: Request) {
  return handle(async () => {
    await requireUser();
    const { userId, email } = await readJson<{ userId?: number; email?: string }>(req);

    const id = Number(userId);
    if (!Number.isInteger(id)) return fail('شناسه کاربر نامعتبر است', 400);

    const value = String(email ?? '').trim();
    if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return fail('نشانی ایمیل معتبر نیست', 400);
    }

    const rows = await query<{ id: number }>(
      `UPDATE users SET email = NULLIF($2, '') WHERE id = $1 RETURNING id`,
      [id, value],
    );
    if (!rows.length) return fail('کاربر پیدا نشد', 404);
    return ok({ ok: true });
  });
}

/** ارسال پیام آزمایشی — پیامک، تلگرام یا ایمیل */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const { phone, chatId, email } = await readJson<{
      phone?: string;
      chatId?: string;
      email?: string;
    }>(req);

    const mailTo = String(email ?? '').trim();
    if (mailTo) {
      const cfg = await smtpConfig();
      if (!smtpConfigured(cfg)) {
        return fail('اول آدرس سرور SMTP و نشانی فرستنده را ذخیره کنید', 400);
      }
      const subject = 'آزمایش ارسال ایمیل — پاسارگاد میزبان';
      const text =
        'این یک ایمیل آزمایشی از پنل مانیتورینگ پاسارگاد میزبان است.\n\n' +
        'اگر این پیام را می‌بینید، تنظیمات سرور ایمیل درست است.';
      // ارسال آزمایشی عمداً به تنظیم email_enabled نگاه نمی‌کند: باید
      // بشود پیش از روشن‌کردن، اتصال را سنجید.
      const r = await sendMail(cfg, { to: mailTo, subject, text });
      await query(
        `INSERT INTO notifications (channel, recipient, body, ok, error)
         VALUES ('email', $1, $2, $3, $4)`,
        [mailTo, `${subject}\n\n${text}`, r.ok, r.error ?? null],
      );
      if (!r.ok) return fail(r.error || 'ارسال ایمیل ناموفق بود', 502);
      return ok({ ok: true });
    }

    const chat = String(chatId ?? '').trim();
    if (chat) {
      const body = 'پاسارگاد میزبان: این یک پیام آزمایشی از پنل مانیتورینگ است.';
      const r = await sendTelegram(chat, body);
      await query(
        `INSERT INTO notifications (channel, recipient, body, ok, error)
         VALUES ('telegram', $1, $2, $3, $4)`,
        [chat, body, r.ok, r.error ?? null],
      );
      if (!r.ok) return fail(r.error || 'ارسال تلگرام ناموفق بود', 502);
      return ok({ ok: true });
    }

    const to = String(phone ?? '').trim();
    if (!to) return fail('شماره گیرنده یا شناسه گفتگو را وارد کنید', 400);

    const body = 'پاسارگاد میزبان: این یک پیامک آزمایشی از پنل مانیتورینگ است.';
    const r = await sendSms(to, body);

    await query(
      `INSERT INTO notifications (channel, recipient, body, ok, error) VALUES ('sms', $1, $2, $3, $4)`,
      [to, body, r.ok, r.error ?? null],
    );

    if (!r.ok) return fail(r.error || 'ارسال پیامک ناموفق بود', 502);
    return ok({ ok: true });
  });
}
