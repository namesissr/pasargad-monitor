import { q, q1, settingNum, log, logErr } from './db.mjs';
import { checkServers, checkIps, checkProbes } from './checks.mjs';
import { dispatchNotifications } from './incidents.mjs';
import { evaluateThresholds } from './alerts.mjs';
import { rollupHourly, rollupDaily, purgeOld } from './rollup.mjs';
import { hashPassword } from './hash.mjs';

/**
 * ورکر پایش و هشدار.
 *
 * چهار چرخه مستقل با فاصله‌های متفاوت. هر چرخه با setTimeout بازگشتی زمان‌بندی
 * می‌شود نه setInterval، چون اگر یک اجرا طول بکشد، setInterval اجراهای بعدی را
 * روی هم می‌ریزد و در بدترین حالت ده‌ها بررسی همزمان می‌سازد.
 *
 * هیچ خطایی نباید پروسه را بکشد: یک سرور خراب نباید پایش بقیه را متوقف کند.
 */

const CYCLE = {
  check: 30_000,      // از تنظیمات خوانده می‌شود
  threshold: 60_000,
  rollup: 300_000,    // هر پنج دقیقه — گزارش‌ها حداکثر پنج دقیقه عقب می‌مانند
  purge: 6 * 3600_000,
};

let stopping = false;

/** انتظار تا بالا آمدن دیتابیس — کانتینر پستگرس ممکن است دیرتر آماده شود */
async function waitForDb() {
  for (let i = 1; i <= 60; i++) {
    try {
      await q1('SELECT 1');
      log('اتصال به دیتابیس برقرار شد');
      return;
    } catch (err) {
      log(`دیتابیس هنوز آماده نیست (تلاش ${i}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  logErr('دیتابیس بعد از سه دقیقه بالا نیامد. ورکر خارج می‌شود.');
  process.exit(1);
}

/** ساخت کاربر مدیر اگر هیچ کاربری وجود نداشته باشد */
async function ensureAdmin() {
  const row = await q1('SELECT COUNT(*)::int AS n FROM users');
  if ((row?.n ?? 0) > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  const phone = process.env.ADMIN_PHONE || null;

  if (!password) {
    logErr(
      'هیچ کاربری در دیتابیس نیست و ADMIN_PASSWORD هم تنظیم نشده. ' +
        'یا آن را در .env بگذارید یا با «node worker/create-user.mjs» کاربر بسازید.',
    );
    return;
  }

  await q(
    `INSERT INTO users (username, password_hash, full_name, phone, role)
     VALUES ($1, $2, $3, $4, 'admin') ON CONFLICT (username) DO NOTHING`,
    [username, await hashPassword(password), process.env.ADMIN_NAME || 'مدیر', phone],
  );
  log(`کاربر مدیر «${username}» ساخته شد`);
}

/** یک چرخه امن — خطا لاگ می‌شود ولی پروسه زنده می‌ماند */
async function safe(name, fn) {
  try {
    await fn();
  } catch (err) {
    logErr(`چرخه ${name} خطا داد:`, err.message);
  }
}

/** زمان‌بندی بازگشتی؛ اجرای بعدی فقط بعد از پایان اجرای فعلی */
function schedule(name, fn, intervalFn) {
  const tick = async () => {
    if (stopping) return;
    await safe(name, fn);
    if (stopping) return;
    const ms = await intervalFn();
    setTimeout(tick, ms).unref?.();
  };
  void tick();
}

async function main() {
  log('ورکر پایش پاسارگاد میزبان شروع شد');
  await waitForDb();
  await ensureAdmin();

  schedule(
    'بررسی سلامت',
    async () => {
      await checkServers();
      await checkIps();
      await checkProbes();
      await dispatchNotifications();
    },
    async () => Math.max(10, await settingNum('check_interval_sec', 30)) * 1000,
  );

  schedule('ارزیابی آستانه‌ها', evaluateThresholds, async () => CYCLE.threshold);

  schedule(
    'تجمیع',
    async () => {
      await rollupHourly(3);
      await rollupDaily(3);
    },
    async () => CYCLE.rollup,
  );

  schedule('پاک‌سازی', purgeOld, async () => CYCLE.purge);
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`سیگنال ${sig} دریافت شد؛ ورکر خاموش می‌شود`);
    stopping = true;
    setTimeout(() => process.exit(0), 1500);
  });
}

process.on('unhandledRejection', (err) => {
  logErr('پرامیس مدیریت‌نشده:', err instanceof Error ? err.message : err);
});

main().catch((err) => {
  logErr('ورکر بالا نیامد:', err);
  process.exit(1);
});
