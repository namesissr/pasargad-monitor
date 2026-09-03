import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSettings, saveSettings } from '@/lib/settings';
import { sendSms } from '@/lib/sms';
import { sendTelegram } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** کلیدهایی که از پنل قابل تغییرند — بقیه دست‌نخورده می‌مانند */
const ALLOWED = [
  'sms_enabled',
  'sms_recipients',
  'telegram_enabled',
  'telegram_chat_ids',
  'vz_discover_hours',
  'alert_repeat_min',
  'down_after_sec',
  'raw_retention_days',
  'check_interval_sec',
  'traffic_calendar',
  'panel_title',
];

export async function GET() {
  return handle(async () => {
    await requireUser();
    const settings = await getSettings(true);
    const users = await query(
      `SELECT id, username, full_name, phone, role, is_active, last_login_at FROM users ORDER BY id`,
    );
    const smsConfigured = Boolean(process.env.KAVENEGAR_API_KEY);
    const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    const recent = await query(
      `SELECT id, recipient, body, ok, error, created_at FROM notifications ORDER BY created_at DESC LIMIT 20`,
    );
    return ok({ settings, users, smsConfigured, telegramConfigured, recentSms: recent });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const patch: Record<string, string> = {};
    for (const key of ALLOWED) {
      if (key in body) patch[key] = String(body[key] ?? '');
    }

    if ('traffic_calendar' in patch && !['jalali', 'gregorian'].includes(patch.traffic_calendar)) {
      return fail('تقویم باید jalali یا gregorian باشد', 400);
    }

    if (!Object.keys(patch).length) return fail('هیچ تنظیمی برای ذخیره فرستاده نشده است', 400);

    await saveSettings(patch);
    return ok({ ok: true });
  });
}

/** ارسال پیام آزمایشی — پیامک یا تلگرام */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const { phone, chatId } = await readJson<{ phone?: string; chatId?: string }>(req);

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
