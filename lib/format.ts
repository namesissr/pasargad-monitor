import { dateToJalali, JALALI_MONTHS, isoToJalali } from './jalali';

/**
 * قالب‌بندی اعداد و تاریخ برای نمایش فارسی.
 *
 * قاعده واحدها — عمدی و ثابت در کل پنل:
 *  • حجم (رم، دیسک، ترافیک) دودویی است: هر گیگابایت ۱۰۲۴ مگابایت.
 *  • سرعت (مگابیت بر ثانیه) اعشاری است: هر مگابیت ۱٬۰۰۰٬۰۰۰ بیت.
 * این همان قراردادی است که vnstat و ابزارهای شبکه دارند. قاطی‌کردنشان
 * باعث می‌شود عدد پنل با صورتحساب دیتاسنتر نخواند.
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** تبدیل ارقام انگلیسی به فارسی */
export function faNum(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** عدد با جداکننده هزارگان و ارقام فارسی */
export function faInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return faNum(Math.round(n).toLocaleString('en-US'));
}

/** عدد اعشاری با تعداد رقم مشخص */
export function faFloat(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return faNum(n.toFixed(digits));
}

const BYTE_UNITS = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت', 'پتابایت'];

/** حجم به مناسب‌ترین واحد — مبنای ۱۰۲۴ */
export function formatBytes(bytes: number | string | null | undefined, digits = 2): string {
  const b = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (b === null || b === undefined || !Number.isFinite(b)) return '—';
  if (b === 0) return '۰ بایت';
  const i = Math.min(Math.floor(Math.log(Math.abs(b)) / Math.log(1024)), BYTE_UNITS.length - 1);
  const v = b / Math.pow(1024, i);
  return `${faNum(v.toFixed(i === 0 ? 0 : digits))} ${BYTE_UNITS[i]}`;
}

/** حجم همیشه به ترابایت — برای گزارش ترافیک */
export function formatTB(bytes: number | string | null | undefined, digits = 3): string {
  const b = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (b === null || b === undefined || !Number.isFinite(b)) return '—';
  return `${faNum((b / Math.pow(1024, 4)).toFixed(digits))} ترابایت`;
}

/** حجم همیشه به گیگابایت */
export function formatGB(bytes: number | string | null | undefined, digits = 2): string {
  const b = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (b === null || b === undefined || !Number.isFinite(b)) return '—';
  return `${faNum((b / Math.pow(1024, 3)).toFixed(digits))} گیگابایت`;
}

/** بایت به عدد ترابایت بدون واحد — برای محاسبه */
export function toTB(bytes: number | string | null | undefined): number {
  const b = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!Number.isFinite(b as number)) return 0;
  return (b as number) / Math.pow(1024, 4);
}

const BIT_UNITS = ['بیت/ث', 'کیلوبیت/ث', 'مگابیت/ث', 'گیگابیت/ث'];

/** سرعت لحظه‌ای — ورودی بیت بر ثانیه، مبنای ۱۰۰۰ */
export function formatBps(bps: number | string | null | undefined, digits = 1): string {
  const v = typeof bps === 'string' ? Number(bps) : bps;
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '۰ مگابیت/ث';
  const i = Math.min(Math.floor(Math.log10(Math.abs(v)) / 3), BIT_UNITS.length - 1);
  return `${faNum((v / Math.pow(1000, i)).toFixed(i === 0 ? 0 : digits))} ${BIT_UNITS[i]}`;
}

/** سرعت همیشه به مگابیت بر ثانیه */
export function formatMbps(bps: number | string | null | undefined, digits = 1): string {
  const v = typeof bps === 'string' ? Number(bps) : bps;
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${faNum((v / 1e6).toFixed(digits))} مگابیت/ث`;
}

/** بیت بر ثانیه به عدد مگابیت بدون واحد */
export function toMbps(bps: number | string | null | undefined): number {
  const v = typeof bps === 'string' ? Number(bps) : bps;
  if (!Number.isFinite(v as number)) return 0;
  return (v as number) / 1e6;
}

/** درصد */
export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${faNum(v.toFixed(digits))}٪`;
}

/** مبلغ به تومان */
export function formatToman(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : v;
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${faNum(Math.round(n).toLocaleString('en-US'))} تومان`;
}

/** مدت زمان به شکل خوانا — «۳ روز و ۴ ساعت» */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${faNum(d)} روز`);
  if (h) parts.push(`${faNum(h)} ساعت`);
  if (!d && m) parts.push(`${faNum(m)} دقیقه`);
  if (!parts.length) parts.push(`${faNum(s)} ثانیه`);
  return parts.slice(0, 2).join(' و ');
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** تاریخ شمسی — «۱۲ مهر ۱۴۰۴» */
export function formatJalali(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  const j = dateToJalali(d);
  return `${faNum(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${faNum(j.jy)}`;
}

/** تاریخ شمسی از رشته YYYY-MM-DD بدون در نظر گرفتن منطقه زمانی */
export function formatJalaliDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const j = isoToJalali(iso);
  return `${faNum(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${faNum(j.jy)}`;
}

/** تاریخ و ساعت شمسی — «۱۲ مهر ۱۴۰۴ ساعت ۱۴:۳۲» */
export function formatJalaliTime(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  const j = dateToJalali(d);
  const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${faNum(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${faNum(j.jy)} ساعت ${faNum(t)}`;
}

/** فقط ساعت */
export function formatClock(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return faNum(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
}

/** زمان نسبی — «۲ دقیقه پیش» */
export function timeAgo(input: string | Date | null | undefined): string {
  if (!input) return 'هرگز';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 0) return 'همین حالا';
  if (diff < 10) return 'همین حالا';
  if (diff < 60) return `${faNum(diff)} ثانیه پیش`;
  if (diff < 3600) return `${faNum(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86400) return `${faNum(Math.floor(diff / 3600))} ساعت پیش`;
  if (diff < 2592000) return `${faNum(Math.floor(diff / 86400))} روز پیش`;
  return formatJalali(d);
}

/** برچسب فارسی وضعیت سرور */
export const SERVER_STATUS_LABEL: Record<string, string> = {
  up: 'در دسترس',
  down: 'قطع',
  unknown: 'نامشخص',
  maintenance: 'تعمیرات',
};

/** برچسب فارسی وضعیت آی‌پی */
export const IP_STATUS_LABEL: Record<string, string> = {
  free: 'آزاد',
  assigned: 'تخصیص‌یافته',
  reserved: 'رزرو',
  blocked: 'مسدود',
  abuse: 'گزارش تخلف',
};

/** برچسب فارسی نوع رویداد */
export const INCIDENT_KIND_LABEL: Record<string, string> = {
  down: 'قطعی سرور',
  agent_lost: 'قطع ارتباط ایجنت',
  cpu: 'پردازنده بالا',
  ram: 'حافظه بالا',
  disk: 'دیسک پر',
  traffic: 'عبور از سهمیه ترافیک',
  load: 'بار سیستم بالا',
  ip_down: 'قطعی آی‌پی',
};
