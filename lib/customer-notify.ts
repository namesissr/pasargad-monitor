import { query, queryOne } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { sendEmailTo } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { sendTelegram } from '@/lib/telegram';

/**
 * اطلاع‌رسانی به مشتری، از هر راهی که دارد.
 *
 * ── چرا یک تابع ────────────────────────────────────────────
 *
 * تا حالا هر جا که به مشتری خبر می‌داد، خودش پیامک و ایمیل را جدا صدا
 * می‌زد. یعنی افزودن یک کانال تازه — مثل تلگرام — باید در هر کدام
 * تکرار می‌شد، و آن یکی که فراموش می‌شد هیچ خطایی نمی‌داد؛ فقط مشتری
 * خبردار نمی‌شد.
 *
 * ── هیچ کانالی جلوی دیگری را نمی‌گیرد ──────────────────────
 *
 * اعتبار پیامک تمام می‌شود، ایمیل به اسپم می‌رود، مشتری ربات را بلاک
 * می‌کند. هر سه با هم و مستقل فرستاده می‌شوند، و شکست هرکدام فقط لاگ
 * می‌شود.
 *
 * ── پیامک کوتاه‌تر است، عمدا ────────────────────────────────
 *
 * پیامک هزینه دارد و طولش محدود است. متن کوتاه اختیاری است؛ اگر داده
 * نشود پیامکی فرستاده نمی‌شود — که برای خبرهای کم‌اهمیت دقیقا همان
 * چیزی است که می‌خواهیم.
 */

export interface CustomerNotifyResult {
  sms: boolean;
  email: boolean;
  telegram: boolean;
}

type MailKind = 'info' | 'ok' | 'warn' | 'danger';

// type است نه interface: کوئری pg محدودیت T extends QueryResultRow
// دارد و تایپ‌اسکریپت فقط به type alias امضای ایندکس ضمنی می‌دهد.
type CustomerRow = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  telegram_chat_id: string | null;
};

export async function notifyCustomer(
  customerId: number,
  opts: {
    subject: string;
    /** متن کامل، برای ایمیل و تلگرام */
    message: string;
    /** متن کوتاه برای پیامک؛ ندادنش یعنی پیامک نفرست */
    sms?: string;
    kind?: MailKind;
  },
): Promise<CustomerNotifyResult> {
  const result: CustomerNotifyResult = { sms: false, email: false, telegram: false };

  const c = await queryOne<CustomerRow>(
    `SELECT id, name, phone, email, telegram_chat_id FROM customers WHERE id = $1`,
    [customerId],
  );
  if (!c) {
    console.error('[customer-notify] مشتری پیدا نشد:', customerId);
    return result;
  }

  const s = await getSettings();

  // ── پیامک ───────────────────────────────────────────────
  if (opts.sms && c.phone) {
    const r = await sendSms(c.phone, opts.sms).catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }));
    result.sms = r.ok;
    if (!r.ok) console.error('[customer-notify] پیامک نرفت:', c.phone, r.error);
  }

  // ── ایمیل ───────────────────────────────────────────────
  if (c.email) {
    const r = await sendEmailTo(c.email, opts.subject, opts.message, opts.kind ?? 'info').catch(
      (e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    result.email = r.ok;
    if (!r.ok) console.error('[customer-notify] ایمیل نرفت:', c.email, r.error);
  }

  // ── تلگرام ──────────────────────────────────────────────
  //
  // کلید عمومی تلگرام (telegram_enabled) کانال ادمین را کنترل می‌کند و
  // اینجا عمدا بررسی نمی‌شود: ممکن است ادمین هشدار تلگرامی خودش را
  // نخواهد ولی مشتری‌ها ربات را وصل کرده باشند.
  if (c.telegram_chat_id && s.telegram_customer_enabled !== 'false') {
    const r = await sendTelegram(c.telegram_chat_id, `${opts.subject}\n\n${opts.message}`).catch(
      (e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    result.telegram = r.ok;

    if (!r.ok) {
      console.error('[customer-notify] تلگرام نرفت:', c.telegram_chat_id, r.error);

      // مشتری ربات را بلاک کرده یا گفتگو را پاک کرده. نگه‌داشتن شناسه
      // یعنی هر بار دوباره تلاش و هر بار همان خطا — و مشتری در پرتال
      // «متصل» می‌بیند در حالی که هیچ پیامی نمی‌گیرد.
      const dead = String(r.error || '').match(/blocked|chat not found|deactivated|kicked/i);
      if (dead) {
        await query(
          `UPDATE customers SET telegram_chat_id = NULL, telegram_linked_at = NULL WHERE id = $1`,
          [customerId],
        ).catch((e) =>
          console.error('[customer-notify] پاک‌کردن اتصال تلگرام ناموفق:', e),
        );
        console.error('[customer-notify] اتصال تلگرام قطع شد؛ مشتری باید دوباره وصل کند:', c.name);
      }
    }
  }

  return result;
}
