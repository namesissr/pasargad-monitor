import { q, settings, log, logErr } from './db.mjs';
import { sendSms } from './sms.mjs';
import { notify } from './notify.mjs';
import { sendEmailTo } from './email.mjs';

/**
 * هشدارهای مشتری: سهمیه ترافیک و موعد تمدید.
 *
 * سه هشدار، با دو مخاطب متفاوت:
 *
 *   ۹۰٪ سهمیه   → فقط مشتری. هنوز مشکلی نیست، فقط باید بداند.
 *   اتمام سهمیه → مشتری و ادمین. از اینجا هزینه اضافه شروع می‌شود.
 *   موعد تمدید  → مشتری و ادمین. هر دو باید بدانند.
 *
 * دو قاعده که این بخش را قابل اعتماد نگه می‌دارند:
 *
 * **هر هشدار یک بار.** جدول customer_notices با کلید یکتای
 * (سرور، نوع، دوره) جلوی تکرار را می‌گیرد. بدون آن، این چرخه هر نیم
 * ساعت همان پیامک را می‌فرستاد و مشتری یاد می‌گرفت نادیده‌اش بگیرد.
 *
 * **ثبت پیش از ارسال.** ردیف اول درج می‌شود، بعد پیامک می‌رود. اگر
 * برعکس بود، هر خطای گذرا در ارسال یعنی تلاش دوباره در دور بعد و
 * احتمال پیامک تکراری. از دست دادن یک هشدار بهتر از فرستادن ده‌تاست.
 */

/**
 * ثبت هشدار، اگر قبلا ثبت نشده باشد.
 * برمی‌گرداند: آیا این بار تازه است؟
 */
async function claim(serverId, kind, periodKey, detail) {
  const rows = await q(
    `INSERT INTO customer_notices (server_id, kind, period_key, detail)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (server_id, kind, period_key) DO NOTHING
     RETURNING id`,
    [serverId, kind, periodKey, detail],
  );
  return rows.length > 0;
}

/**
 * ارسال به مشتری از هر راهی که دارد، و در صورت لزوم به ادمین.
 *
 * پیامک و ایمیل هر دو می‌روند و شکست یکی جلوی دیگری را نمی‌گیرد: ممکن
 * است اعتبار پیامک تمام شده باشد یا شماره عوض شده باشد. مشتری‌ای که
 * خبردار نشود، همان مشتری‌ای است که بعداً شاکی می‌شود.
 */
async function dispatch(srv, subject, message, alsoAdmin, kind = 'warn') {
  if (srv.customer_phone) {
    const r = await sendSms(srv.customer_phone, message);
    if (!r.ok) logErr('پیامک مشتری ارسال نشد:', srv.customer_phone, r.error);
  }
  if (srv.customer_email) {
    const r = await sendEmailTo(srv.customer_email, subject, message, kind);
    if (!r.ok) logErr('ایمیل مشتری ارسال نشد:', srv.customer_email, r.error);
  }
  if (alsoAdmin) {
    await notify(message).catch((e) => logErr('هشدار ادمین ارسال نشد:', e.message));
  }
}

export async function checkCustomerAlerts() {
  const s = await settings();
  if (s.customer_alerts_enabled === 'false') return;

  // فقط سرورهایی که مشتری دارند. سرور بی‌مشتری کسی را ندارد که خبرش کنیم.
  const servers = await q(
    `SELECT s.id, s.name,
            -- ترافیک پیش‌خرید: سرور اختصاصی سهمیه ماهانه ندارد. مشترک
            -- ترافیک می‌خرد و هر وقت تمام شد دوباره می‌خرد.
            to_char(s.traffic_counted_from, 'YYYY-MM-DD') AS counted_from,
            tp.purchased::float8 AS purchased_gb,
            (tp.used_bytes / 1073741824 + s.traffic_used_before_gb)::float8 AS used_gb,
            s.renews_at, s.renew_notice_days,
            c.id AS customer_id, c.name AS customer_name,
            c.phone AS customer_phone, c.email AS customer_email
       FROM servers s
       JOIN customers c ON c.id = s.customer_id
       LEFT JOIN LATERAL (
         SELECT COALESCE((SELECT SUM(gb) FROM traffic_topups tt WHERE tt.server_id = s.id), 0)::float8
                  AS purchased,
                COALESCE((SELECT SUM(d.rx_bytes) FROM server_metrics_daily d
                           WHERE d.server_id = s.id
                             AND s.traffic_counted_from IS NOT NULL
                             AND d.day >= s.traffic_counted_from), 0)::float8
                  AS used_bytes
       ) tp ON TRUE
      WHERE s.is_active AND c.is_active`,
  );

  for (const srv of servers) {
    try {
      // ── ترافیک پیش‌خرید ─────────────────────────────────────
      //
      // کلید یکتایی همان تاریخ شروع شمارش سرور است، نه ماه صورتحساب:
      // ترافیک انقضا ندارد، پس هشدار هم با آمدن ماه تازه از نو نمی‌آید.
      // مسلح‌شدن دوباره فقط با خرید تازه است، و آن را خود اندپوینت خرید
      // با پاک‌کردن این ردیف‌ها انجام می‌دهد.
      if (srv.purchased_gb > 0) {
        const used = Number(srv.used_gb) || 0;
        const purchased = Number(srv.purchased_gb);
        const remaining = purchased - used;
        const pct = (used / purchased) * 100;
        const detail = `${used.toFixed(1)} از ${purchased.toFixed(0)} گیگ`;

        if (pct >= 100) {
          if (await claim(srv.id, 'quota_100', srv.counted_from, detail)) {
            await dispatch(
              srv,
              `ترافیک سرور «${srv.name}» تمام شد`,
              `پاسارگاد میزبان: ترافیک سرور «${srv.name}» تمام شد ` +
                `(${detail}). برای خرید ترافیک با پشتیبانی تماس بگیرید.`,
              false,
              'danger',
            );
            await notify(
              `پاسارگاد میزبان — ترافیک سرور «${srv.name}» تمام شد. ` +
                `مشتری: ${srv.customer_name}. مصرف: ${detail}`,
            ).catch((e) => logErr('هشدار ادمین ارسال نشد:', e.message));
            log(`هشدار اتمام ترافیک: ${srv.name} (${srv.customer_name})`);
          }
        } else if (pct >= 90) {
          // ۹۰٪ فقط به مشتری می‌رود. هنوز مشکلی نیست و ادمین را بی‌دلیل
          // درگیر نمی‌کند.
          if (await claim(srv.id, 'quota_90', srv.counted_from, detail)) {
            await dispatch(
              srv,
              `ترافیک سرور «${srv.name}» رو به اتمام است`,
              `پاسارگاد میزبان: ترافیک سرور «${srv.name}» رو به اتمام است ` +
                `(${detail} مصرف، ${remaining.toFixed(0)} گیگ باقی‌مانده).`,
              false,
            );
            log(`هشدار ۹۰٪ ترافیک: ${srv.name} (${srv.customer_name})`);
          }
        }
      }

      // ── موعد تمدید ──────────────────────────────────────────
      if (srv.renews_at) {
        const due = new Date(srv.renews_at);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);

        const daysLeft = Math.round((due - today) / 86400000);
        const notice = Number(srv.renew_notice_days) || 0;

        // از «notice» روز مانده تا خود روز موعد. بعد از موعد دیگر
        // فرستاده نمی‌شود؛ تمدیدنشدن دیگر خبر نیست، وضعیت است.
        if (daysLeft <= notice && daysLeft >= 0) {
          const key = due.toISOString().slice(0, 10);
          const when = daysLeft === 0 ? 'امروز است' : `${daysLeft} روز دیگر است`;
          if (await claim(srv.id, 'renewal', key, `${daysLeft} روز مانده`)) {
            await dispatch(
              srv,
              `موعد تمدید سرور «${srv.name}» ${when}`,
              `پاسارگاد میزبان: موعد تمدید سرور «${srv.name}» ${when}. ` +
                'برای تمدید با پشتیبانی تماس بگیرید.',
              false,
            );
            await notify(
              `پاسارگاد میزبان — موعد تمدید سرور «${srv.name}» ${when}. ` +
                `مشتری: ${srv.customer_name}` +
                (srv.customer_phone ? ` (${srv.customer_phone})` : ''),
            ).catch((e) => logErr('هشدار ادمین ارسال نشد:', e.message));
            log(`هشدار تمدید: ${srv.name} (${srv.customer_name}) — ${daysLeft} روز`);
          }
        }
      }
    } catch (err) {
      // خطای یک سرور نباید بقیه را متوقف کند
      logErr(`هشدار مشتری برای سرور ${srv.name} خطا داد:`, err.message);
    }
  }
}
