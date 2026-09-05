import { q, q1, settings, log, logErr } from './db.mjs';
import { sendSms } from './sms.mjs';
import { sendEmailTo } from './email.mjs';
import { notify } from './notify.mjs';

/**
 * صدور خودکار فاکتور تمدید.
 *
 * چند روز پیش از موعد تمدید هر سرور، یک فاکتور ساخته می‌شود و به مشتری
 * خبر می‌رود. تا حالا فقط پیامک «موعد تمدید رسید» می‌رفت و مشتری جایی
 * نداشت که مبلغ را ببیند یا پرداخت کند.
 *
 * ── چرا فاکتور تکراری ساخته نمی‌شود ────────────────────────
 *
 * ایندکس یکتای (server_id, period_from) روی فاکتورهای تمدید. این چرخه
 * هر چند ساعت اجرا می‌شود؛ بدون آن ایندکس، هر اجرا یک فاکتور تازه
 * می‌ساخت و مشتری ده‌ها ردیف تکراری می‌دید.
 *
 * ON CONFLICT DO NOTHING یعنی اجرای دوم بی‌سروصدا رد می‌شود — و چون
 * RETURNING خالی برمی‌گردد، پیامک هم دوباره نمی‌رود.
 *
 * ── سروری که قیمت ندارد فاکتور نمی‌گیرد ────────────────────
 *
 * renewal_price_toman صفر یعنی «هنوز قیمت‌گذاری نشده». ساختن فاکتور صفر
 * تومانی هیچ معنایی ندارد و فقط مشتری را گیج می‌کند.
 */

/** شماره فاکتور خوانا؛ همان دنباله‌ای که سمت وب استفاده می‌شود */
async function nextNumber() {
  const row = await q1(`SELECT nextval('invoice_number_seq')::text AS n`);
  return `${new Date().getFullYear()}-${String(row?.n ?? '1').padStart(5, '0')}`;
}

export async function issueRenewalInvoices() {
  const s = await settings();
  if (s.invoices_enabled === 'false') return;

  const daysBefore = Math.max(0, Number(s.invoice_days_before) || 7);
  const panelUrl = String(s.panel_url || '').replace(/\/+$/, '');

  const servers = await q(
    `SELECT s.id, s.name, s.renews_at, s.renewal_price_toman::float8 AS price,
            COALESCE(s.renewal_months, 1) AS months,
            c.id AS customer_id, c.name AS customer_name,
            c.phone AS customer_phone, c.email AS customer_email
       FROM servers s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.is_active AND c.is_active
        AND s.renews_at IS NOT NULL
        AND s.renewal_price_toman > 0
        AND s.renews_at <= CURRENT_DATE + ($1 || ' days')::interval`,
    [String(daysBefore)],
  );

  for (const srv of servers) {
    try {
      // دوره تازه از همان موعد تمدید شروع می‌شود. period_from کلید
      // یکتایی است، پس تا موعد جلو نرود فاکتور دوم ساخته نمی‌شود.
      const number = await nextNumber();
      const title = `تمدید سرور «${srv.name}»`;

      const rows = await q(
        `INSERT INTO invoices
           (number, customer_id, server_id, kind, title, amount_toman,
            period_from, period_to, due_at)
         VALUES ($1, $2, $3, 'renewal', $4, $5,
                 $6::date,
                 ($6::date + ($7 || ' months')::interval)::date,
                 $6::date)
         ON CONFLICT (server_id, period_from) WHERE kind = 'renewal' AND status <> 'canceled'
         DO NOTHING
         RETURNING id, number`,
        [number, srv.customer_id, srv.id, title, Math.round(srv.price), srv.renews_at, String(srv.months)],
      );

      // فاکتور از قبل بود؛ نه خبری، نه لاگی
      if (!rows.length) continue;

      const amount = Math.round(srv.price).toLocaleString('fa-IR');
      const link = panelUrl ? `\n\n${panelUrl}/portal/invoices` : '';

      const message =
        `پاسارگاد میزبان: فاکتور تمدید سرور «${srv.name}» صادر شد.\n\n` +
        `شماره فاکتور: ${rows[0].number}\n` +
        `مبلغ: ${amount} تومان\n` +
        `مهلت: ${srv.renews_at}\n\n` +
        `برای پرداخت وارد پرتال شوید.${link}`;

      if (srv.customer_phone) {
        const r = await sendSms(
          srv.customer_phone,
          `پاسارگاد میزبان: فاکتور تمدید «${srv.name}» به مبلغ ${amount} تومان صادر شد. ` +
            'برای پرداخت وارد پرتال شوید.',
        );
        if (!r.ok) logErr('پیامک فاکتور ارسال نشد:', srv.customer_phone, r.error);
      }

      if (srv.customer_email) {
        await sendEmailTo(
          srv.customer_email,
          `فاکتور ${rows[0].number} — تمدید سرور «${srv.name}»`,
          message,
          'warn',
        );
      }

      await notify(
        `پاسارگاد میزبان — فاکتور تمدید صادر شد.\n` +
          `${rows[0].number} · ${title}\n` +
          `مشتری: ${srv.customer_name}\n` +
          `مبلغ: ${amount} تومان`,
      ).catch((e) => logErr('خبر فاکتور به ادمین نرسید:', e.message));

      log(`فاکتور تمدید صادر شد: ${rows[0].number} — ${srv.name} (${srv.customer_name})`);
    } catch (err) {
      logErr(`صدور فاکتور سرور ${srv.name} خطا داد:`, err.message);
    }
  }
}
