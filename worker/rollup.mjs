import { q, settingNum, log } from './db.mjs';

/**
 * تجمیع نمونه‌های خام به ساعتی و روزانه.
 *
 * چرا تجمیع لازم است: با ۵۰ سرور و نمونه هر ۱۰ ثانیه، روزی ۴۳۰ هزار ردیف خام
 * ساخته می‌شود. گزارش یک‌ساله روی جدول خام یعنی ۱۵۰ میلیون ردیف — عملاً
 * غیرممکن. جدول روزانه برای همان یک سال ۱۸ هزار ردیف دارد.
 *
 * هر اجرا چند ساعت و چند روز اخیر را دوباره حساب می‌کند نه فقط بازه بسته‌شده،
 * چون داده ممکن است با تأخیر برسد یا ورکر برای مدتی خوابیده باشد.
 */

/** تجمیع ساعتی از نمونه‌های خام */
export async function rollupHourly(hoursBack = 3) {
  await q(
    `INSERT INTO server_metrics_hourly (
       server_id, hour, cpu_avg, cpu_max, ram_pct_avg, ram_pct_max, disk_pct_max,
       load_avg, rx_bytes, tx_bytes, rx_bps_max, tx_bps_max, rx_bps_avg, tx_bps_avg, samples
     )
     SELECT server_id,
            date_trunc('hour', ts),
            AVG(cpu_percent)::real,
            MAX(cpu_percent)::real,
            AVG(CASE WHEN ram_total_bytes > 0
                     THEN ram_used_bytes::float8 / ram_total_bytes * 100 END)::real,
            MAX(CASE WHEN ram_total_bytes > 0
                     THEN ram_used_bytes::float8 / ram_total_bytes * 100 END)::real,
            MAX(CASE WHEN disk_total_bytes > 0
                     THEN disk_used_bytes::float8 / disk_total_bytes * 100 END)::real,
            AVG(load1)::real,
            COALESCE(SUM(rx_bytes), 0),
            COALESCE(SUM(tx_bytes), 0),
            COALESCE(MAX(rx_bps), 0),
            COALESCE(MAX(tx_bps), 0),
            COALESCE(AVG(rx_bps), 0)::bigint,
            COALESCE(AVG(tx_bps), 0)::bigint,
            COUNT(*)::int
       FROM server_metrics
      WHERE ts >= date_trunc('hour', now()) - ($1::text || ' hours')::interval
      GROUP BY 1, 2
     ON CONFLICT (server_id, hour) DO UPDATE SET
       cpu_avg      = EXCLUDED.cpu_avg,
       cpu_max      = EXCLUDED.cpu_max,
       ram_pct_avg  = EXCLUDED.ram_pct_avg,
       ram_pct_max  = EXCLUDED.ram_pct_max,
       disk_pct_max = EXCLUDED.disk_pct_max,
       load_avg     = EXCLUDED.load_avg,
       rx_bytes     = EXCLUDED.rx_bytes,
       tx_bytes     = EXCLUDED.tx_bytes,
       rx_bps_max   = EXCLUDED.rx_bps_max,
       tx_bps_max   = EXCLUDED.tx_bps_max,
       rx_bps_avg   = EXCLUDED.rx_bps_avg,
       tx_bps_avg   = EXCLUDED.tx_bps_avg,
       samples      = EXCLUDED.samples`,
    [String(hoursBack)],
  );
}

/**
 * تجمیع روزانه از تجمیع ساعتی — میانگین‌ها وزنی‌اند تا با تعداد نمونه بخوانند.
 *
 * شرط source = 'agent' در بند تعارض حیاتی است: این تابع هر پنج دقیقه سه روز
 * اخیر را دوباره می‌نویسد. بدون آن شرط، روزی که ادمین دستی از پنل دیتاسنتر
 * وارد کرده ظرف پنج دقیقه پاک می‌شد — بی‌صدا و بدون هیچ خطایی.
 */
export async function rollupDaily(daysBack = 3) {
  await q(
    `INSERT INTO server_metrics_daily (
       server_id, day, cpu_avg, cpu_max, ram_pct_avg, ram_pct_max, disk_pct_max,
       load_avg, rx_bytes, tx_bytes, rx_bps_max, tx_bps_max, samples
     )
     SELECT server_id,
            hour::date,
            (SUM(cpu_avg::float8 * samples)     / NULLIF(SUM(samples), 0))::real,
            MAX(cpu_max),
            (SUM(ram_pct_avg::float8 * samples) / NULLIF(SUM(samples), 0))::real,
            MAX(ram_pct_max),
            MAX(disk_pct_max),
            (SUM(load_avg::float8 * samples)    / NULLIF(SUM(samples), 0))::real,
            COALESCE(SUM(rx_bytes), 0),
            COALESCE(SUM(tx_bytes), 0),
            COALESCE(MAX(rx_bps_max), 0),
            COALESCE(MAX(tx_bps_max), 0),
            COALESCE(SUM(samples), 0)::int
       FROM server_metrics_hourly
      WHERE hour >= date_trunc('day', now()) - ($1::text || ' days')::interval
      GROUP BY 1, 2
     ON CONFLICT (server_id, day) DO UPDATE SET
       cpu_avg      = EXCLUDED.cpu_avg,
       cpu_max      = EXCLUDED.cpu_max,
       ram_pct_avg  = EXCLUDED.ram_pct_avg,
       ram_pct_max  = EXCLUDED.ram_pct_max,
       disk_pct_max = EXCLUDED.disk_pct_max,
       load_avg     = EXCLUDED.load_avg,
       rx_bytes     = EXCLUDED.rx_bytes,
       tx_bytes     = EXCLUDED.tx_bytes,
       rx_bps_max   = EXCLUDED.rx_bps_max,
       tx_bps_max   = EXCLUDED.tx_bps_max,
       samples      = EXCLUDED.samples
     WHERE server_metrics_daily.source = 'agent'`,
    [String(daysBack)],
  );

  // درصد در دسترس بودن از نتایج بررسی سلامت
  const interval = await settingNum('check_interval_sec', 30);
  await q(
    `UPDATE server_metrics_daily d
        SET uptime_ratio = c.ratio,
            down_seconds = c.down_cnt * $2
       FROM (
         SELECT server_id, ts::date AS day,
                (AVG(CASE WHEN ok THEN 1.0 ELSE 0.0 END) * 100)::real AS ratio,
                COUNT(*) FILTER (WHERE NOT ok)::int AS down_cnt
           FROM server_checks
          WHERE ts >= date_trunc('day', now()) - ($1::text || ' days')::interval
          GROUP BY 1, 2
       ) c
      WHERE d.server_id = c.server_id AND d.day = c.day`,
    [String(daysBack), interval],
  );
}

/**
 * پاک‌سازی داده قدیمی.
 * جدول روزانه هرگز پاک نمی‌شود — همان است که گزارش سالانه از آن می‌آید.
 */
export async function purgeOld() {
  const days = await settingNum('raw_retention_days', 7);

  const raw = await q(
    `WITH d AS (DELETE FROM server_metrics WHERE ts < now() - ($1::text || ' days')::interval RETURNING 1)
     SELECT COUNT(*)::int AS n FROM d`,
    [String(days)],
  );

  const checks = await q(
    `WITH d AS (DELETE FROM server_checks WHERE ts < now() - interval '90 days' RETURNING 1)
     SELECT COUNT(*)::int AS n FROM d`,
  );

  await q(`DELETE FROM server_metrics_hourly WHERE hour < now() - interval '400 days'`);
  await q(`DELETE FROM notifications WHERE created_at < now() - interval '180 days'`);
  await q(`DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < now() - interval '365 days'`);

  log(`پاک‌سازی: ${raw[0]?.n ?? 0} نمونه خام و ${checks[0]?.n ?? 0} نتیجه بررسی حذف شد`);
}
