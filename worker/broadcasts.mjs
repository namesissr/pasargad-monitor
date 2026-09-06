import { q, q1, log, logErr } from './db.mjs';
import { sendSms } from './sms.mjs';
import { sendEmailTo } from './email.mjs';

/**
 * ارسال همگانی، از صف.
 *
 * ── چرا ورکر می‌فرستد و نه مسیر ای‌پی‌آی ────────────────────
 *
 * ارسال به چند صد مشتری در یک درخواست HTTP تایم‌اوت می‌شود و معلوم
 * نمی‌ماند چند نفر پیام گرفته‌اند. اینجا هر گیرنده ردیف خودش را دارد،
 * پس ارسال نیمه‌تمام از همان‌جا ادامه پیدا می‌کند.
 *
 * ── هر دور، یک دسته کوچک ───────────────────────────────────
 *
 * نه همه گیرنده‌ها یکجا. سه دلیل:
 *
 *   ۱. سرویس پیامک و SMTP هر دو سقف نرخ دارند و ارسال انبوه پشت‌سرهم
 *      باعث می‌شود کل ارسال بلاک شود.
 *   ۲. لغو باید اثر داشته باشد؛ با یک حلقه طولانی، تا آخر کار ادامه
 *      پیدا می‌کرد.
 *   ۳. یک ارسال بزرگ نباید بقیه چرخه‌های ورکر را عقب بیندازد.
 *
 * ── وضعیت روی خود گیرنده نوشته می‌شود ──────────────────────
 *
 * پیش از هر چیز دیگر. اگر پروسه وسط کار بمیرد، بدترین حالت این است که
 * یک پیام رفته و «pending» مانده و دوباره می‌رود — نه اینکه صد پیام
 * دوباره برود.
 */

/** چند گیرنده در هر دور */
const BATCH = 20;

/** فاصله بین دو ارسال، به میلی‌ثانیه */
const GAP_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * یک دسته از یک ارسال.
 * برمی‌گرداند تعداد پیام‌های فرستاده‌شده در این دور.
 */
async function runBatch(b) {
  const rows = await q(
    `SELECT id, customer_id, address FROM broadcast_recipients
      WHERE broadcast_id = $1 AND status = 'pending'
      ORDER BY id
      LIMIT $2`,
    [b.id, BATCH],
  );

  if (!rows.length) {
    await q(
      `UPDATE broadcasts SET status = 'done', finished_at = now() WHERE id = $1`,
      [b.id],
    );
    log(`ارسال همگانی ${b.id} تمام شد: ${b.sent} موفق، ${b.failed} ناموفق`);
    return 0;
  }

  for (const r of rows) {
    // لغو وسط کار باید فورا اثر کند، نه در دور بعد
    const still = await q1(`SELECT status FROM broadcasts WHERE id = $1`, [b.id]);
    if (!still || still.status === 'canceled') {
      log(`ارسال همگانی ${b.id} لغو شد`);
      return 0;
    }

    const res =
      b.channel === 'sms'
        ? await sendSms(r.address, b.body)
        : await sendEmailTo(r.address, b.subject || 'پاسارگاد میزبان', b.body, 'info');

    await q(
      `UPDATE broadcast_recipients
          SET status = $2, error = $3, sent_at = now()
        WHERE id = $1`,
      [r.id, res.ok ? 'sent' : 'failed', res.ok ? null : String(res.error || '').slice(0, 300)],
    );

    await q(
      res.ok
        ? `UPDATE broadcasts SET sent = sent + 1 WHERE id = $1`
        : `UPDATE broadcasts SET failed = failed + 1 WHERE id = $1`,
      [b.id],
    );

    if (!res.ok) logErr(`ارسال همگانی ${b.id} به ${r.address} ناموفق:`, res.error);

    await sleep(GAP_MS);
  }

  return rows.length;
}

/**
 * یک دور از صف ارسال همگانی.
 *
 * فقط **یک** ارسال در هر دور پیش می‌رود. دو ارسال همزمان یعنی دو برابر
 * فشار روی سرویس پیامک، و آن‌ها سقف نرخ دارند.
 */
export async function drainBroadcasts() {
  const b = await q1(
    `SELECT id, channel, subject, body, sent, failed
       FROM broadcasts
      WHERE status IN ('queued', 'sending')
      ORDER BY created_at
      LIMIT 1`,
  );
  if (!b) return 0;

  await q(
    `UPDATE broadcasts
        SET status = 'sending', started_at = COALESCE(started_at, now())
      WHERE id = $1 AND status = 'queued'`,
    [b.id],
  );

  try {
    return await runBatch(b);
  } catch (e) {
    // یک ارسال خراب نباید صف را قفل کند. ردیف‌های pending سر جایشان
    // می‌مانند و دور بعد دوباره تلاش می‌شود.
    logErr(`ارسال همگانی ${b.id} خطا داد:`, e.message);
    return 0;
  }
}
