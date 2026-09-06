import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ارسال همگانی ایمیل و پیامک.
 *
 * ── چرا صف، و نه ارسال در همین درخواست ─────────────────────
 *
 * ارسال به چند صد مشتری در یک درخواست HTTP قطعا تایم‌اوت می‌شود، و آن
 * وقت معلوم نیست چند نفر پیام گرفته‌اند و چند نفر نه. بدترین حالت این
 * است که ادمین دوباره بفرستد و نصف مشتری‌ها دو بار پیام بگیرند.
 *
 * پس اینجا فقط ردیف گیرنده‌ها ساخته می‌شود و ورکر می‌فرستد.
 *
 * ── ایمیل و پیامک عمدا جدا هستند ───────────────────────────
 *
 * متنشان فرق دارد (پیامک کوتاه و بی‌عنوان)، گیرنده‌هایشان فرق دارد
 * (بعضی مشتری‌ها ایمیل ندارند)، و هزینه‌شان فرق دارد. یکی‌کردنشان یعنی
 * ادمین بدون اینکه بخواهد پیامک هم بفرستد.
 *
 * ── گیرنده‌ها همین حالا قطعی می‌شوند ───────────────────────
 *
 * فهرست در لحظه ساخت صف ثبت می‌شود، نه هنگام ارسال. مشتری‌ای که وسط
 * کار اضافه شود پیام نمی‌گیرد — و همین درست است: ادمین تعداد را دیده و
 * تأیید کرده.
 */

const SMS_MAX = 480;
const EMAIL_MAX = 5000;

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const id = idParam(url, 'id');

    // یک ارسال مشخص: گیرنده‌ها با وضعیتشان
    if (id !== null) {
      const broadcast = await queryOne(
        `SELECT b.id, b.channel, b.subject, b.body, b.target, b.status,
                b.total, b.sent, b.failed, b.created_at, b.started_at, b.finished_at,
                u.username AS created_by_name
           FROM broadcasts b
           LEFT JOIN users u ON u.id = b.created_by
          WHERE b.id = $1`,
        [id],
      );
      if (!broadcast) return fail('ارسال پیدا نشد', 404);

      const recipients = await query(
        `SELECT r.id, r.address, r.status, r.error, r.sent_at, c.name AS customer_name
           FROM broadcast_recipients r
           JOIN customers c ON c.id = r.customer_id
          WHERE r.broadcast_id = $1
          ORDER BY
            -- ناموفق‌ها اول: همان‌هایی که کار دارند
            CASE r.status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
            c.name
          LIMIT 500`,
        [id],
      );

      return ok({ broadcast, recipients });
    }

    const broadcasts = await query(
      `SELECT b.id, b.channel, b.subject, b.body, b.target, b.status,
              b.total, b.sent, b.failed, b.created_at, b.finished_at,
              u.username AS created_by_name
         FROM broadcasts b
         LEFT JOIN users u ON u.id = b.created_by
        ORDER BY b.created_at DESC
        LIMIT 50`,
    );

    // مشتری‌ها برای فرم انتخاب، با اینکه هرکدام چه راهی دارند
    const customers = await query(
      `SELECT id, name, phone, email FROM customers
        WHERE is_active ORDER BY name LIMIT 1000`,
    );

    return ok({ broadcasts, customers });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const channel = String(body.channel ?? '');
    if (channel !== 'email' && channel !== 'sms') return fail('کانال نامعتبر است', 400);

    const text = String(body.body ?? '').trim();
    if (!text) return fail('متن پیام را بنویسید', 400);

    const max = channel === 'sms' ? SMS_MAX : EMAIL_MAX;
    if (text.length > max) {
      return fail(`متن بیش از حد بلند است (حداکثر ${max} کاراکتر)`, 400);
    }

    const subject = channel === 'email' ? String(body.subject ?? '').trim().slice(0, 200) : '';
    if (channel === 'email' && !subject) return fail('موضوع ایمیل را بنویسید', 400);

    const target = String(body.target ?? 'all') === 'selected' ? 'selected' : 'all';

    // شناسه‌های انتخاب‌شده فقط عدد؛ هرچه غیرعدد باشد کنار گذاشته می‌شود
    const ids = Array.isArray(body.customer_ids)
      ? body.customer_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];

    if (target === 'selected' && !ids.length) {
      return fail('دست‌کم یک مشتری انتخاب کنید', 400);
    }

    // ── گیرنده‌ها ─────────────────────────────────────────
    //
    // فقط مشتری‌هایی که آن کانال را دارند. مشتری بدون ایمیل در ارسال
    // ایمیلی اصلا ردیف نمی‌گیرد — وگرنه فهرست پر از «ناموفق»هایی
    // می‌شود که هیچ‌وقت قرار نبوده موفق شوند.
    const column = channel === 'email' ? 'email' : 'phone';
    const params: unknown[] = [];
    let where = `is_active AND ${column} IS NOT NULL AND ${column} <> ''`;
    if (target === 'selected') {
      params.push(ids);
      where += ` AND id = ANY($${params.length}::int[])`;
    }

    const recipients = await query<{ id: number; address: string }>(
      `SELECT id, ${column} AS address FROM customers WHERE ${where} ORDER BY id`,
      params,
    );

    if (!recipients.length) {
      return fail(
        channel === 'email'
          ? 'هیچ‌کدام از مشتری‌های انتخاب‌شده ایمیل ثبت‌شده ندارند'
          : 'هیچ‌کدام از مشتری‌های انتخاب‌شده شماره ثبت‌شده ندارند',
        400,
      );
    }

    const row = await queryOne<{ id: number }>(
      `INSERT INTO broadcasts (channel, subject, body, target, total, created_by)
       VALUES ($1, NULLIF($2,''), $3, $4, $5, $6)
       RETURNING id`,
      [channel, subject, text, target, recipients.length, session.uid],
    );
    const broadcastId = Number(row?.id);

    // نشانی در لحظه کپی می‌شود: اگر مشتری بعدا ایمیلش را عوض کند،
    // سابقه باید بگوید به کجا فرستاده شد
    for (const r of recipients) {
      await query(
        `INSERT INTO broadcast_recipients (broadcast_id, customer_id, address)
         VALUES ($1, $2, $3)
         ON CONFLICT (broadcast_id, customer_id) DO NOTHING`,
        [broadcastId, r.id, r.address],
      );
    }

    return ok({ id: broadcastId, total: recipients.length }, { status: 201 });
  });
}

/** لغو ارسالی که هنوز تمام نشده */
export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<{ id?: unknown; action?: unknown }>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه ارسال نامعتبر است', 400);

    /**
     * تلاش دوباره فقط برای گیرنده‌های ناموفق.
     *
     * ردیف‌های ناموفق به pending برمی‌گردند و شمارنده ناموفق به همان
     * اندازه کم می‌شود، وگرنه بعد از تلاش دوباره جمع sent و failed از
     * total بیشتر می‌شود و عددها بی‌معنی.
     *
     * ردیف‌های موفق دست نمی‌خورند — تلاش دوباره نباید به کسی که پیام
     * گرفته دوباره پیام بفرستد.
     */
    if (String(body.action) === 'retry_failed') {
      const rows = await query<{ n: number }>(
        `WITH reset AS (
           UPDATE broadcast_recipients
              SET status = 'pending', error = NULL, sent_at = NULL
            WHERE broadcast_id = $1 AND status = 'failed'
            RETURNING 1
         )
         SELECT COUNT(*)::int AS n FROM reset`,
        [id],
      );
      const n = Number(rows[0]?.n) || 0;
      if (!n) return fail('گیرنده ناموفقی برای تلاش دوباره نیست', 400);

      await query(
        `UPDATE broadcasts
            SET failed = GREATEST(failed - $2, 0),
                status = 'queued',
                finished_at = NULL
          WHERE id = $1`,
        [id, n],
      );

      return ok({ retried: n });
    }

    if (String(body.action) !== 'cancel') return fail('عملیات نامعتبر است', 400);

    // پیام‌هایی که رفته‌اند برنمی‌گردند؛ لغو فقط جلوی بقیه را می‌گیرد.
    // این را رابط هم صریح می‌گوید تا کسی انتظار برگشت نداشته باشد.
    const rows = await query<{ id: number }>(
      `UPDATE broadcasts SET status = 'canceled', finished_at = now()
        WHERE id = $1 AND status IN ('queued', 'sending')
        RETURNING id`,
      [id],
    );
    if (!rows.length) return fail('این ارسال قابل لغو نیست', 400);

    return ok({ ok: true });
  });
}
