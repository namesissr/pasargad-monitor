import { getPool, query, queryOne } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { sendEmailTo } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { notify } from '@/lib/notify';
import { verifyPayment, type PayPingConfig } from '@/worker/payping.mjs';

/**
 * فاکتور و پرداخت.
 *
 * سه قاعده اینجا هست که هیچ‌کدام قابل مذاکره نیستند. هر سه از تجربه
 * درگاه‌های ایرانی می‌آیند و شکستن هرکدام یعنی از دست دادن پول:
 *
 * ۱. **مبلغ تأیید از دیتابیس می‌آید، نه از آدرس بازگشت.** اگر از
 *    پارامتر خوانده شود، کاربر فاکتور ده‌میلیونی را با تأیید هزار
 *    تومان پرداخت‌شده می‌کند. رایج‌ترین حفره در این درگاه‌هاست.
 *
 * ۲. **تأیید اید‌مپوتنت است.** ردیف فاکتور با FOR UPDATE قفل می‌شود و
 *    اگر از قبل paid باشد نتیجه قبلی برمی‌گردد. رفرش صفحه بازگشت نباید
 *    دو بار سرویس بدهد یا دو بار پیامک بفرستد.
 *
 * ۳. **تمدید به انتهای دوره اضافه می‌شود، نه به امروز.** با
 *    now() + interval، مشتری‌ای که زودتر پرداخت می‌کند روزهای
 *    باقی‌مانده‌اش را می‌سوزاند.
 */

export interface PaidResult {
  ok: boolean;
  alreadyPaid: boolean;
  invoice: { id: number; number: string; amount_toman: number; title: string };
  error?: string;
}

export async function paypingConfig(): Promise<PayPingConfig & { enabled: boolean }> {
  const s = await getSettings(true);
  return {
    enabled: s.payping_enabled === 'true' && Boolean(s.payping_token),
    token: s.payping_token || '',
    version: s.payping_version || 'v2',
    unit: s.payping_unit || 'toman',
  };
}

/** شماره فاکتور خوانا: سال چهاررقمی و شماره پیوسته */
export async function nextInvoiceNumber(): Promise<string> {
  const row = await queryOne<{ n: string }>(`SELECT nextval('invoice_number_seq')::text AS n`);
  const year = new Date().getFullYear();
  return `${year}-${String(row?.n ?? '1').padStart(5, '0')}`;
}

/**
 * ثبت پرداخت موفق یک فاکتور.
 *
 * این تابع همه‌جای مسیر بازگشت از درگاه استفاده می‌شود و خودش قفل و
 * بررسی تکرار را انجام می‌دهد. صدا زدنش چند بار بی‌خطر است.
 */
export async function settleInvoice(
  invoiceId: number,
  opts: { refId: string | null; paymentCode: string | null; cardNumber: string | null },
): Promise<PaidResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // قفل ردیف: دو بازگشت همزمان از درگاه نباید هر دو تمدید کنند
    const { rows } = await client.query(
      `SELECT i.id, i.number, i.status, i.amount_toman::float8 AS amount_toman, i.title,
              i.kind, i.server_id, i.customer_id, i.period_to,
              i.traffic_gb::float8 AS traffic_gb, i.order_id,
              c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
              s.name AS server_name, s.renewal_months
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         LEFT JOIN servers s ON s.id = i.server_id
        WHERE i.id = $1
        FOR UPDATE OF i`,
      [invoiceId],
    );

    const inv = rows[0];
    if (!inv) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        alreadyPaid: false,
        invoice: { id: invoiceId, number: '', amount_toman: 0, title: '' },
        error: 'فاکتور پیدا نشد',
      };
    }

    const summary = {
      id: inv.id,
      number: inv.number,
      amount_toman: Number(inv.amount_toman),
      title: inv.title,
    };

    // از قبل پرداخت شده: نتیجه قبلی برمی‌گردد، هیچ کاری تکرار نمی‌شود
    if (inv.status === 'paid') {
      await client.query('ROLLBACK');
      return { ok: true, alreadyPaid: true, invoice: summary };
    }

    if (inv.status === 'canceled') {
      await client.query('ROLLBACK');
      return { ok: false, alreadyPaid: false, invoice: summary, error: 'این فاکتور لغو شده است' };
    }

    await client.query(
      `UPDATE invoices
          SET status = 'paid', paid_at = now(), updated_at = now(),
              payment_ref = COALESCE($2, payment_ref),
              payment_code = COALESCE($3, payment_code),
              card_number = COALESCE($4, card_number)
        WHERE id = $1`,
      [invoiceId, opts.refId, opts.paymentCode, opts.cardNumber],
    );

    // تمدید سرور: به انتهای دوره اضافه می‌شود نه به امروز.
    //
    // GREATEST با امروز لازم است برای فاکتوری که خیلی دیر پرداخت شده —
    // وگرنه تمدید در گذشته می‌نشیند و سرور همان لحظه دوباره سررسید
    // می‌شود.
    if (inv.kind === 'renewal' && inv.server_id) {
      await client.query(
        `UPDATE servers
            SET renews_at = GREATEST(COALESCE(renews_at, CURRENT_DATE), CURRENT_DATE)
                            + (COALESCE(renewal_months, 1) || ' months')::interval
          WHERE id = $1`,
        [inv.server_id],
      );

      // هشدار تمدید این موعد پاک می‌شود تا برای موعد بعدی از نو بیاید
      await client.query(`DELETE FROM customer_notices WHERE server_id = $1 AND kind = 'renewal'`, [
        inv.server_id,
      ]);
    }

    // ── بسته ترافیک ──────────────────────────────────────────
    //
    // مقدار گیگ از خود فاکتور می‌آید نه از بسته: اگر ادمین بسته را
    // ویرایش کند، فاکتوری که مشتری دیده و پرداخت کرده نباید عوض شود.
    //
    // این داخل همان تراکنش قفل‌شده است، پس دقیقا یک بار اجرا می‌شود.
    // رفرش صفحه بازگشت دو بار ترافیک نمی‌دهد.
    if (inv.kind === 'traffic' && inv.server_id && Number(inv.traffic_gb) > 0) {
      await client.query(
        `INSERT INTO traffic_topups (server_id, gb, price_toman, note)
         VALUES ($1, $2, $3, $4)`,
        [
          inv.server_id,
          Number(inv.traffic_gb),
          Math.round(Number(inv.amount_toman)),
          `خرید آنلاین — فاکتور ${inv.number}`,
        ],
      );

      // شروع شمارش مصرف، اگر اولین خرید این سرور است
      await client.query(
        `UPDATE servers SET traffic_counted_from = CURRENT_DATE
          WHERE id = $1 AND traffic_counted_from IS NULL`,
        [inv.server_id],
      );

      // هشدارهای اتمام ترافیک پاک می‌شوند تا از نو مسلح شوند. بدون
      // این، مشتری‌ای که بسته خریده و باز تمام کرده هیچ خبری نمی‌گیرد.
      await client.query(
        `DELETE FROM customer_notices
          WHERE server_id = $1 AND kind IN ('quota_90', 'quota_100')`,
        [inv.server_id],
      );
    }

    // ── سفارش محصول ─────────────────────────────────────────
    //
    // تحویل دستی است: سرور اختصاصی خودکار ساخته نمی‌شود. سفارش به
    // حالت paid می‌رود و در صف تحویل ادمین می‌نشیند.
    if (inv.kind === 'order' && inv.order_id) {
      await client.query(
        `UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [inv.order_id],
      );

      // موجودی هنگام پرداخت کم می‌شود، نه هنگام صدور فاکتور: فاکتور
      // رهاشده نباید موجودی را تا ابد قفل کند.
      //
      // GREATEST با صفر لازم است چون دو نفر می‌توانند همزمان فاکتور یک
      // محصول تک‌موجودی را ساخته باشند. موجودی منفی بی‌معنی است؛ آن
      // حالت با هشدار به ادمین مدیریت می‌شود نه با رد کردن پولی که
      // گرفته شده.
      await client.query(
        `UPDATE products p
            SET stock = GREATEST(p.stock - 1, 0), updated_at = now()
           FROM orders o
          WHERE o.id = $1 AND p.id = o.product_id AND p.stock IS NOT NULL`,
        [inv.order_id],
      );
    }

    await client.query('COMMIT');

    // اطلاع‌رسانی بیرون از تراکنش: پیامک کند است و نباید قفل را نگه دارد
    await announcePaid(inv).catch((e) =>
      console.error('[invoice] اطلاع‌رسانی پرداخت ناموفق:', e instanceof Error ? e.message : e),
    );

    return { ok: true, alreadyPaid: false, invoice: summary };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      // تراکنش از قبل بسته شده؛ چیزی برای برگرداندن نمانده
    });
    throw err;
  } finally {
    client.release();
  }
}

/** خبر پرداخت، به مشتری و به ادمین */
async function announcePaid(inv: Record<string, unknown>) {
  const amount = Number(inv.amount_toman).toLocaleString('fa-IR');
  const title = String(inv.title);
  const number = String(inv.number);

  const forCustomer =
    `پاسارگاد میزبان: پرداخت شما با موفقیت ثبت شد.\n\n` +
    `فاکتور ${number} — ${title}\n` +
    `مبلغ: ${amount} تومان\n\n` +
    `از همراهی شما سپاسگزاریم.`;

  if (inv.customer_phone) {
    const r = await sendSms(
      String(inv.customer_phone),
      `پاسارگاد میزبان: پرداخت فاکتور ${number} به مبلغ ${amount} تومان ثبت شد. با تشکر.`,
    );
    if (!r.ok) console.error('[invoice] پیامک مشتری ارسال نشد:', r.error);
  }

  if (inv.customer_email) {
    await sendEmailTo(String(inv.customer_email), `پرداخت فاکتور ${number} ثبت شد`, forCustomer, 'ok');
  }

  // سفارش محصول کار دارد و باید از بقیه پرداخت‌ها جدا دیده شود
  const needsAction = inv.kind === 'order' ? '\n\n⚠ این سفارش منتظر تحویل است.' : '';

  await notify(
    `پاسارگاد میزبان — پرداخت تازه.\n` +
      `فاکتور ${number} · ${title}\n` +
      `مشتری: ${inv.customer_name}\n` +
      `مبلغ: ${amount} تومان${needsAction}`,
  );
}

/**
 * تأیید پرداخت با درگاه و ثبت آن.
 *
 * مبلغ از همان ردیفی می‌آید که قفل می‌شود، نه از ورودی.
 */
export async function verifyAndSettle(
  invoiceId: number,
  callback: { refId: string | null; paymentCode: string | null; cardNumber: string | null },
): Promise<PaidResult> {
  const inv = await queryOne<{
    id: number;
    number: string;
    title: string;
    status: string;
    amount_toman: number;
    payment_code: string | null;
  }>(
    `SELECT id, number, title, status, amount_toman::float8 AS amount_toman, payment_code
       FROM invoices WHERE id = $1`,
    [invoiceId],
  );

  if (!inv) {
    return {
      ok: false,
      alreadyPaid: false,
      invoice: { id: invoiceId, number: '', amount_toman: 0, title: '' },
      error: 'فاکتور پیدا نشد',
    };
  }

  const summary = {
    id: inv.id,
    number: inv.number,
    amount_toman: Number(inv.amount_toman),
    title: inv.title,
  };

  // اگر از قبل پرداخت شده، اصلا به درگاه دست نمی‌زنیم. تأیید دوباره
  // همان ارجاع، از سمت درگاه خطا می‌دهد و کاربر پیام ترسناک می‌بیند
  // برای پرداختی که کاملا موفق بوده.
  if (inv.status === 'paid') return { ok: true, alreadyPaid: true, invoice: summary };

  const cfg = await paypingConfig();
  const result = await verifyPayment(cfg, {
    // از دیتابیس، نه از آدرس بازگشت
    amountToman: Number(inv.amount_toman),
    refId: callback.refId,
    paymentCode: callback.paymentCode || inv.payment_code,
  });

  return settleInvoice(invoiceId, {
    refId: callback.refId,
    paymentCode: callback.paymentCode || inv.payment_code,
    cardNumber: callback.cardNumber || result.cardNumber,
  });
}

/** فاکتورهای یک مشتری */
export async function customerInvoices(customerId: number) {
  return query(
    `SELECT i.id, i.number, i.title, i.kind, i.status,
            i.amount_toman::float8 AS amount_toman,
            i.period_from, i.period_to, i.due_at, i.paid_at, i.created_at,
            i.payment_ref, i.card_number, i.payment_error,
            s.id AS server_id, s.name AS server_name
       FROM invoices i
       LEFT JOIN servers s ON s.id = i.server_id
      WHERE i.customer_id = $1
      ORDER BY i.created_at DESC
      LIMIT 200`,
    [customerId],
  );
}
