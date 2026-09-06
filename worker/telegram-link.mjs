import { q, settings, log, logErr } from './db.mjs';
import { sendTelegram } from './telegram.mjs';

/**
 * اتصال تلگرام مشتری.
 *
 * ── چرا خواندن، نه وب‌هوک ──────────────────────────────────
 *
 * وب‌هوک یک مسیر عمومی تازه می‌خواهد و یک قدم راه‌اندازی (setWebhook) که
 * فراموش‌شدنش هیچ خطایی نمی‌سازد: اتصال‌ها فقط بی‌صدا کار نمی‌کنند —
 * بدترین شکل خرابی.
 *
 * ورکر از قبل همیشه در حال اجراست و برای فرستادن پیام هم به تلگرام وصل
 * می‌شود. getUpdates هیچ راه‌اندازی تازه‌ای نمی‌خواهد.
 *
 * ── شناسه گفتگو از تلگرام می‌آید، نه از مرورگر ─────────────
 *
 * این کل نکته امنیتی این بخش است. اگر مشتری شناسه را در فرم می‌نوشت،
 * هر کسی می‌توانست شناسه یک نفر دیگر را بنویسد و هشدارهای او را
 * بگیرد. اینجا شناسه از خود پیامی که به ربات رسیده برداشته می‌شود.
 *
 * ── offset چرا ذخیره می‌شود ────────────────────────────────
 *
 * getUpdates هر به‌روزرسانی را تا وقتی تأیید نشده دوباره می‌دهد. بدون
 * نگه‌داشتن offset بین ری‌استارت‌ها، ورکر پس از هر ری‌استارت همان
 * /start قدیمی را دوباره پردازش می‌کند.
 */

const API_BASE = () =>
  (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');

/** فراخوان ساده ای‌پی‌آی تلگرام */
async function call(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: 'توکن ربات تلگرام تنظیم نشده است' };

  try {
    const res = await fetch(`${API_BASE()}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      // getUpdates با long polling تا ۳۰ ثانیه منتظر می‌ماند؛ مهلت
      // باید از آن بیشتر باشد وگرنه هر بار قطع می‌شود
      signal: AbortSignal.timeout(45_000),
    });

    const text = await res.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `پاسخ نامعتبر از تلگرام: ${text.slice(0, 120)}` };
    }

    if (parsed.ok !== true) {
      return {
        ok: false,
        error: `تلگرام: ${parsed.description || 'علت نامشخص'} (کد ${parsed.error_code ?? res.status})`,
      };
    }
    return { ok: true, result: parsed.result };
  } catch (err) {
    return { ok: false, error: `ارتباط با تلگرام برقرار نشد: ${err.message}` };
  }
}

/** نام کاربری ربات، برای ساختن لینک t.me */
async function ensureBotUsername() {
  const s = await settings();
  if (s.telegram_bot_username) return s.telegram_bot_username;

  const me = await call('getMe');
  if (!me.ok || !me.result?.username) {
    logErr('نام کاربری ربات تلگرام گرفته نشد:', me.error || 'پاسخ بدون username');
    return '';
  }

  await q(
    `INSERT INTO settings (key, value) VALUES ('telegram_bot_username', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [me.result.username],
  );
  log('نام کاربری ربات تلگرام ثبت شد:', me.result.username);
  return me.result.username;
}

/** پاسخ کوتاه به همان گفتگو */
async function reply(chatId, text) {
  const r = await sendTelegram(chatId, text);
  if (!r.ok) logErr('پاسخ تلگرام ارسال نشد:', chatId, r.error);
}

/**
 * پردازش یک پیام.
 *
 * فقط سه فرمان: /start با کد، /start بدون کد، و /stop.
 * هرچیز دیگر یک راهنمای کوتاه می‌گیرد — سکوت، کاربر را سردرگم می‌کند.
 */
async function handleMessage(msg) {
  const chatId = String(msg?.chat?.id ?? '');
  const text = String(msg?.text ?? '').trim();
  if (!chatId || !text) return;

  // ── قطع اتصال ─────────────────────────────────────────
  if (text === '/stop' || text === '/disconnect') {
    const rows = await q(
      `UPDATE customers SET telegram_chat_id = NULL, telegram_linked_at = NULL
        WHERE telegram_chat_id = $1
        RETURNING id, name`,
      [chatId],
    );
    await reply(
      chatId,
      rows.length
        ? 'اتصال قطع شد. دیگر پیامی از پاسارگاد میزبان دریافت نمی‌کنید.\n\nبرای وصل‌کردن دوباره، از بخش پروفایل در پنل کاربری اقدام کنید.'
        : 'این گفتگو به هیچ حسابی وصل نیست.',
    );
    if (rows.length) log('اتصال تلگرام قطع شد:', rows[0].name);
    return;
  }

  // ── اتصال با کد ───────────────────────────────────────
  const start = text.match(/^\/start(?:\s+(\S+))?$/);
  if (!start) {
    await reply(
      chatId,
      'برای اتصال حساب، از بخش پروفایل در پنل کاربری پاسارگاد میزبان دکمه «اتصال تلگرام» را بزنید.',
    );
    return;
  }

  const code = (start[1] || '').trim();
  if (!code) {
    await reply(
      chatId,
      'سلام!\n\nبرای دریافت هشدارهای سرورتان، از بخش پروفایل در پنل کاربری پاسارگاد میزبان دکمه «اتصال تلگرام» را بزنید و روی لینکی که می‌دهد کلیک کنید.',
    );
    return;
  }

  // کد باید موجود، منقضی‌نشده و مصرف‌نشده باشد. همه شرط‌ها در همان
  // به‌روزرسانی‌اند تا دو پیام همزمان نتوانند یک کد را دو بار مصرف کنند.
  const claimed = await q(
    `UPDATE telegram_link_tokens
        SET consumed_at = now()
      WHERE code = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING customer_id`,
    [code],
  );

  if (!claimed.length) {
    await reply(
      chatId,
      'این کد معتبر نیست یا منقضی شده.\n\nاز پروفایل پنل کاربری کد تازه بگیرید.',
    );
    return;
  }

  const customerId = claimed[0].customer_id;

  // یک گفتگو به دو حساب وصل نمی‌شود. اتصال قبلی همین گفتگو پاک می‌شود،
  // وگرنه ایندکس یکتا این به‌روزرسانی را رد می‌کند و کاربر فقط یک خطای
  // نامفهوم می‌گیرد.
  await q(
    `UPDATE customers SET telegram_chat_id = NULL, telegram_linked_at = NULL
      WHERE telegram_chat_id = $1 AND id <> $2`,
    [chatId, customerId],
  );

  const rows = await q(
    `UPDATE customers
        SET telegram_chat_id = $2, telegram_linked_at = now()
      WHERE id = $1
      RETURNING name`,
    [customerId, chatId],
  );

  if (!rows.length) {
    await reply(chatId, 'حساب مربوط به این کد پیدا نشد.');
    return;
  }

  await reply(
    chatId,
    `سلام ${rows[0].name} عزیز،\n\nحساب شما با موفقیت وصل شد. از این پس هشدارهای سرور، فاکتورها و پاسخ تیکت‌ها را اینجا هم دریافت می‌کنید.\n\nبرای قطع اتصال، /stop بفرستید.`,
  );
  log('اتصال تلگرام برقرار شد:', rows[0].name);
}

/**
 * یک دور خواندن به‌روزرسانی‌ها.
 *
 * برمی‌گرداند تعداد پیام‌های پردازش‌شده. صفر یعنی چیزی نبود، نه خطا.
 */
export async function pollTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return 0;

  const s = await settings();
  if (s.telegram_customer_enabled === 'false') return 0;

  await ensureBotUsername();

  const offset = Number(s.telegram_updates_offset || 0) || 0;

  // timeout=0 یعنی بدون long polling: چرخه ورکر خودش زمان‌بندی دارد و
  // نگه‌داشتن اتصال باز، فقط یک اتصال دیگر است که می‌تواند گیر کند.
  const res = await call('getUpdates', {
    offset,
    timeout: 0,
    limit: 50,
    allowed_updates: ['message'],
  });

  if (!res.ok) {
    // «Conflict» یعنی وب‌هوک تنظیم شده و getUpdates کار نمی‌کند. این را
    // باید صریح گفت، وگرنه اتصال‌ها بی‌صدا کار نمی‌کنند.
    if (String(res.error).includes('Conflict')) {
      logErr(
        'تلگرام: وب‌هوک تنظیم شده و خواندن پیام‌ها ممکن نیست. ' +
          'برای اتصال مشتری، وب‌هوک را با deleteWebhook بردارید.',
      );
    } else {
      logErr('خواندن به‌روزرسانی‌های تلگرام ناموفق:', res.error);
    }
    return 0;
  }

  const updates = Array.isArray(res.result) ? res.result : [];
  if (!updates.length) return 0;

  let handled = 0;
  let maxId = offset - 1;

  for (const u of updates) {
    maxId = Math.max(maxId, Number(u.update_id) || 0);
    if (!u.message) continue;
    try {
      await handleMessage(u.message);
      handled++;
    } catch (e) {
      // یک پیام خراب نباید جلوی بقیه را بگیرد، و مهم‌تر: نباید offset
      // را عقب نگه دارد وگرنه همان پیام تا ابد دوباره پردازش می‌شود.
      logErr('پردازش پیام تلگرام ناموفق:', e.message);
    }
  }

  // offset همیشه جلو می‌رود، حتی اگر پردازش پیامی شکست خورده باشد
  await q(
    `INSERT INTO settings (key, value) VALUES ('telegram_updates_offset', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(maxId + 1)],
  );

  return handled;
}

/** پاک‌سازی کدهای منقضی */
export async function pruneLinkTokens() {
  await q(`DELETE FROM telegram_link_tokens WHERE created_at < now() - interval '1 day'`);
}
