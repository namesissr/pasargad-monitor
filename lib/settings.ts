import { query } from './db';

/**
 * تنظیمات زمان اجرا از جدول settings.
 * تغییرشان نیاز به بیلد دوباره ندارد. مقادیر .env اینجا نمی‌آیند.
 */

export type SettingsMap = Record<string, string>;

let cache: { at: number; data: SettingsMap } | null = null;
const TTL_MS = 15_000;

/** همه تنظیمات با کش کوتاه */
export async function getSettings(force = false): Promise<SettingsMap> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const rows = await query<{ key: string; value: string | null }>('SELECT key, value FROM settings');
  const data: SettingsMap = {};
  for (const r of rows) data[r.key] = r.value ?? '';
  cache = { at: Date.now(), data };
  return data;
}

/** یک تنظیم با مقدار پیش‌فرض */
export async function getSetting(key: string, fallback = ''): Promise<string> {
  const s = await getSettings();
  return s[key] ?? fallback;
}

/** یک تنظیم عددی */
export async function getSettingNum(key: string, fallback: number): Promise<number> {
  const v = Number(await getSetting(key, ''));
  return Number.isFinite(v) ? v : fallback;
}

/** ذخیره چند تنظیم و باطل‌کردن کش */
export async function saveSettings(patch: SettingsMap): Promise<void> {
  const entries = Object.entries(patch);
  if (!entries.length) return;
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
    );
  }
  cache = null;
}
