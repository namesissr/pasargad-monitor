import {
  JALALI_MONTHS,
  dateToJalali,
  isJalaliLeap,
  jalaliMonthRange,
  jalaliYearRange,
  toGregorian,
} from './jalali';
import { faNum } from './format';

/**
 * بازه‌های زمانی گزارش.
 *
 * تجمیع روزانه با تاریخ میلادی ذخیره می‌شود (ستون day)، ولی گزارش ماهانه و
 * سالانه بر مبنای تقویم شمسی گروه می‌شود. اینجا هر دوره شمسی به یک بازه
 * میلادی ترجمه می‌شود تا کوئری ساده بماند: WHERE day BETWEEN from AND to
 */

export type Calendar = 'jalali' | 'gregorian';

export interface Period {
  key: string;   // شناسه یکتا، مثلا 1404-07
  label: string; // برچسب فارسی، مثلا مهر ۱۴۰۴
  from: string;  // YYYY-MM-DD میلادی
  to: string;    // YYYY-MM-DD میلادی
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const GREGORIAN_MONTHS = [
  'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
  'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر',
];

/** N روز اخیر، از قدیم به جدید */
export function lastDays(count: number, endDate = new Date()): Period[] {
  const out: Period[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    const s = iso(d);
    const j = dateToJalali(d);
    out.push({
      key: s,
      label: `${faNum(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`,
      from: s,
      to: s,
    });
  }
  return out;
}

/** N ماه اخیر، از قدیم به جدید */
export function lastMonths(count: number, calendar: Calendar = 'jalali', now = new Date()): Period[] {
  const out: Period[] = [];

  if (calendar === 'jalali') {
    const j = dateToJalali(now);
    let jy = j.jy;
    let jm = j.jm;
    const stack: Period[] = [];
    for (let i = 0; i < count; i++) {
      const r = jalaliMonthRange(jy, jm);
      stack.push({
        key: `${jy}-${pad(jm)}`,
        label: `${JALALI_MONTHS[jm - 1]} ${faNum(jy)}`,
        from: r.from,
        to: r.to,
      });
      jm -= 1;
      if (jm === 0) {
        jm = 12;
        jy -= 1;
      }
    }
    out.push(...stack.reverse());
    return out;
  }

  let gy = now.getFullYear();
  let gm = now.getMonth() + 1;
  const stack: Period[] = [];
  for (let i = 0; i < count; i++) {
    const last = new Date(gy, gm, 0).getDate();
    stack.push({
      key: `${gy}-${pad(gm)}`,
      label: `${GREGORIAN_MONTHS[gm - 1]} ${faNum(gy)}`,
      from: `${gy}-${pad(gm)}-01`,
      to: `${gy}-${pad(gm)}-${pad(last)}`,
    });
    gm -= 1;
    if (gm === 0) {
      gm = 12;
      gy -= 1;
    }
  }
  out.push(...stack.reverse());
  return out;
}

/** N سال اخیر، از قدیم به جدید */
export function lastYears(count: number, calendar: Calendar = 'jalali', now = new Date()): Period[] {
  const out: Period[] = [];
  if (calendar === 'jalali') {
    const base = dateToJalali(now).jy;
    for (let i = count - 1; i >= 0; i--) {
      const jy = base - i;
      const r = jalaliYearRange(jy);
      out.push({ key: String(jy), label: `سال ${faNum(jy)}`, from: r.from, to: r.to });
    }
    return out;
  }
  const base = now.getFullYear();
  for (let i = count - 1; i >= 0; i--) {
    const gy = base - i;
    out.push({ key: String(gy), label: `سال ${faNum(gy)}`, from: `${gy}-01-01`, to: `${gy}-12-31` });
  }
  return out;
}

/** دوره جاری — برای محاسبه مصرف ماه جاری و سهمیه */
export function currentMonth(calendar: Calendar = 'jalali', now = new Date()): Period {
  return lastMonths(1, calendar, now)[0];
}

/** ماه شمسی مشخص به بازه میلادی */
export function jalaliMonthPeriod(jy: number, jm: number): Period {
  const r = jalaliMonthRange(jy, jm);
  return { key: `${jy}-${pad(jm)}`, label: `${JALALI_MONTHS[jm - 1]} ${faNum(jy)}`, ...r };
}

/** تعداد روزهای سپری‌شده و باقی‌مانده از دوره جاری */
export function periodProgress(p: Period, now = new Date()): { elapsed: number; total: number; remaining: number } {
  const from = new Date(`${p.from}T00:00:00`);
  const to = new Date(`${p.to}T23:59:59`);
  const total = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const elapsed = Math.min(total, Math.max(1, Math.ceil((now.getTime() - from.getTime()) / 86_400_000)));
  return { elapsed, total, remaining: Math.max(0, total - elapsed) };
}

/** بازه دلخواه از تعداد روز اخیر */
export function rangeOfLastDays(days: number, now = new Date()): { from: string; to: string } {
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
}

export { toGregorian, isJalaliLeap };
