import { query, queryOne } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { sendEmailTo } from '@/lib/email';
import { notify } from '@/lib/notify';

/**
 * تیکت پشتیبانی.
 *
 * ── وضعیت از دید ما نوشته می‌شود، نه از دید مشتری ───────────
 *
 *   open      نوبت پاسخ ماست
 *   answered  پاسخ داده‌ایم، منتظر مشتری
 *   closed    بسته شده
 *
 * با این تعریف، فهرست «open» دقیقا همان چیزی است که کار دارد. اگر از
 * دید مشتری نوشته می‌شد، پشتیبان باید هر بار فکر می‌کرد کدام‌ها نوبت
 * اوست.
 *
 * ── اطلاع‌رسانی ────────────────────────────────────────────
 *
 * پیام مشتری → ایمیل و هشدار به ادمین
 * پاسخ ما    → ایمیل به مشتری
 *
 * شکست ارسال هرگز جلوی ثبت پیام را نمی‌گیرد: پیام ثبت شده و همان
 * واقعیت است. خبرندادن بد است، ولی گم‌شدن پیام بدتر.
 */

/** شماره تیکت خوانا */
export async function nextTicketNumber(): Promise<string> {
  const row = await queryOne<{ n: string }>(`SELECT nextval('ticket_number_seq')::text AS n`);
  return `T${new Date().getFullYear()}-${String(row?.n ?? '1').padStart(5, '0')}`;
}

/** بریدن متن برای پیش‌نمایش در ایمیل و پیامک */
function preview(body: string, max = 400): string {
  const text = String(body ?? '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type TicketInfo = {
  id: number;
  number: string;
  subject: string;
  customer_name: string;
  customer_email: string | null;
  server_name: string | null;
};

async function ticketInfo(ticketId: number): Promise<TicketInfo | null> {
  return queryOne<TicketInfo>(
    `SELECT t.id, t.number, t.subject,
            c.name AS customer_name, c.email AS customer_email,
            s.name AS server_name
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
       LEFT JOIN servers s ON s.id = t.server_id
      WHERE t.id = $1`,
    [ticketId],
  );
}

/** لینک تیکت در پرتال یا پنل؛ خالی اگر آدرس پنل تنظیم نشده باشد */
async function links(ticketId: number) {
  const s = await getSettings();
  const base = String(s.panel_url || '').replace(/\/+$/, '');
  return {
    portal: base ? `${base}/portal/tickets/${ticketId}` : '',
    panel: base ? `${base}/tickets/${ticketId}` : '',
  };
}

/**
 * خبر پیام تازه مشتری، به ادمین.
 *
 * هم ایمیل و هم کانال‌های هشدار — چون تیکت باز، کاری است که منتظر
 * ماست و نباید لای بقیه ایمیل‌ها گم شود.
 */
export async function announceCustomerMessage(ticketId: number, body: string, isNew: boolean) {
  const t = await ticketInfo(ticketId);
  if (!t) return;

  const url = (await links(ticketId)).panel;
  const head = isNew ? 'تیکت تازه' : 'پاسخ تازه مشتری';

  const message =
    `پاسارگاد میزبان — ${head}\n\n` +
    `${t.number} · ${t.subject}\n` +
    `مشتری: ${t.customer_name}` +
    (t.server_name ? ` · سرور: ${t.server_name}` : '') +
    `\n\n${preview(body)}` +
    (url ? `\n\n${url}` : '');

  await notify(message).catch((e) =>
    console.error('[ticket] خبر به ادمین نرسید:', e instanceof Error ? e.message : e),
  );
}

/** خبر پاسخ ما، به مشتری */
export async function announceAdminReply(ticketId: number, body: string) {
  const t = await ticketInfo(ticketId);
  if (!t) return;

  if (!t.customer_email) {
    console.error('[ticket] مشتری ایمیل ندارد؛ پاسخ تیکت خبر داده نشد:', t.number);
    return;
  }

  const url = (await links(ticketId)).portal;

  const message =
    `سلام ${t.customer_name} عزیز،\n\n` +
    `به تیکت شما پاسخ داده شد.\n\n` +
    `${t.number} · ${t.subject}\n\n` +
    `${preview(body, 1500)}` +
    (url ? `\n\nبرای دیدن گفتگو و پاسخ‌دادن وارد پرتال شوید:\n${url}` : '');

  // sendEmailTo خطا پرتاب نمی‌کند؛ شکست را در نتیجه برمی‌گرداند. اگر
  // فقط catch بگذاریم، ایمیل نرفته و هیچ ردی هم نمی‌ماند.
  const res = await sendEmailTo(
    t.customer_email,
    `پاسخ تیکت ${t.number} — ${t.subject}`,
    message,
    'info',
  ).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));

  if (!res.ok) {
    console.error(`[ticket] ایمیل پاسخ ${t.number} ارسال نشد:`, res.error);
  }
}

/**
 * ثبت پیام و به‌روزرسانی وضعیت تیکت.
 *
 * وضعیت با نویسنده پیام عوض می‌شود: پیام مشتری تیکت را باز می‌کند
 * (حتی اگر بسته بوده)، پاسخ ما آن را به answered می‌برد.
 *
 * بازشدن تیکت بسته عمدی است: مشتری‌ای که پیگیری می‌کند نباید مجبور شود
 * تیکت تازه بسازد و سابقه را از هم بپاشد.
 */
export async function addMessage(
  ticketId: number,
  author: 'customer' | 'admin',
  body: string,
  authorUserId: number | null = null,
) {
  await query(
    `INSERT INTO ticket_messages (ticket_id, author, author_user_id, body)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, author, authorUserId, body],
  );

  await query(
    `UPDATE tickets
        SET status = $2, last_reply_at = now(), last_reply_by = $3, updated_at = now()
      WHERE id = $1`,
    [ticketId, author === 'customer' ? 'open' : 'answered', author],
  );
}
