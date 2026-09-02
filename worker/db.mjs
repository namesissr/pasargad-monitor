import pg from 'pg';

const { Pool } = pg;

/**
 * اتصال دیتابیس ورکر — جدا از اپ وب.
 *
 * ورکر عمداً هیچ وابستگی‌ای به اپ وب ندارد. اگر وب بخوابد، پایش و پیامک
 * هشدار باید همچنان کار کند؛ وگرنه دقیقاً وقتی که بیشترین نیاز به هشدار
 * هست، هشداری نمی‌آید.
 */

let pool = null;

export function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error('[ورکر] متغیر DATABASE_URL تنظیم نشده است');
      process.exit(1);
    }
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX || 6),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      // باید دقیقاً همان منطقه زمانی lib/db.ts باشد، وگرنه مرز روز در
      // تجمیع با مرز روز در گزارش نمی‌خواند
      options: `-c timezone=${process.env.REPORT_TZ || 'Asia/Tehran'}`,
    });
    pool.on('error', (err) => console.error('[ورکر] خطای استخر اتصال:', err.message));
  }
  return pool;
}

export async function q(text, params = []) {
  const res = await db().query(text, params);
  return res.rows;
}

export async function q1(text, params = []) {
  const rows = await q(text, params);
  return rows[0] ?? null;
}

/** تنظیمات با کش کوتاه */
let cache = null;
export async function settings(force = false) {
  if (!force && cache && Date.now() - cache.at < 15_000) return cache.data;
  const rows = await q('SELECT key, value FROM settings');
  const data = {};
  for (const r of rows) data[r.key] = r.value ?? '';
  cache = { at: Date.now(), data };
  return data;
}

export async function settingNum(key, fallback) {
  const s = await settings();
  const v = Number(s[key]);
  return Number.isFinite(v) ? v : fallback;
}

export const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
export const logErr = (...args) => console.error(`[${new Date().toISOString()}]`, ...args);
