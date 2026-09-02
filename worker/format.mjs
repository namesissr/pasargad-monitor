/** قالب‌بندی فارسی برای متن پیامک — نسخه کوچک lib/format.ts */

const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export const faNum = (v) => String(v).replace(/\d/g, (d) => FA[Number(d)]);

const BYTES = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'];

export function formatBytes(b, digits = 2) {
  const n = Number(b);
  if (!Number.isFinite(n) || n === 0) return '۰ بایت';
  const i = Math.min(Math.floor(Math.log(Math.abs(n)) / Math.log(1024)), BYTES.length - 1);
  return `${faNum((n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : digits))} ${BYTES[i]}`;
}

export function formatPercent(v, digits = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${faNum(n.toFixed(digits))}٪`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${faNum(d)} روز`);
  if (h) parts.push(`${faNum(h)} ساعت`);
  if (!d && m) parts.push(`${faNum(m)} دقیقه`);
  if (!parts.length) parts.push(`${faNum(s)} ثانیه`);
  return parts.slice(0, 2).join(' و ');
}

/** ساعت محلی به شکل ۱۴:۳۲ */
export function clock(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return faNum(`${p(date.getHours())}:${p(date.getMinutes())}`);
}
