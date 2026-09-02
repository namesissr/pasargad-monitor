/**
 * محاسبه هزینه‌ای که هر سرور اختصاصی به دیتاسنتر تحمیل می‌کند.
 *
 * سه جزء دارد و هر سه به تومان‌اند:
 *   ۱. اجاره ثابت ماهانه سرور
 *   ۲. هزینه ترافیک مازاد بر سهمیه رایگان
 *   ۳. هزینه آی‌پی‌های مازاد بر آی‌پی‌های رایگان
 *
 * دو نکته که اگر رعایت نشوند عدد پنل با فاکتور دیتاسنتر نمی‌خواند:
 *
 *  • «کدام ترافیک» — بعضی دیتاسنترها مجموع رفت‌وبرگشت را حساب می‌کنند،
 *    بعضی فقط ارسالی، بعضی هرکدام بیشتر بود. اختلافشان تا دو برابر است.
 *
 *  • «مبنای ترابایت» — بیشتر دیتاسنترها ترابایت را ۱۰۰۰ به توان چهار
 *    می‌گیرند نه ۱۰۲۴. اختلافش حدود ده درصد است.
 *
 * هر دو برای هر دیتاسنتر جدا تنظیم می‌شوند.
 *
 * توجه: بقیه پنل حجم را با مبنای ۱۰۲۴ نشان می‌دهد (قرارداد ابزارهای
 * سیستمی). فقط این فایل از مبنای صورتحساب دیتاسنتر استفاده می‌کند. برای
 * همین در صفحه حسابداری مبنا کنار عدد نوشته می‌شود.
 */

export type BillingDirection = 'total' | 'out' | 'in' | 'max';

export const DIRECTION_LABEL: Record<BillingDirection, string> = {
  total: 'مجموع دریافت و ارسال',
  out: 'فقط ارسالی',
  in: 'فقط دریافتی',
  max: 'هرکدام بیشتر باشد',
};

/** مقادیر قیمت‌گذاری که از دیتاسنتر می‌آیند */
export interface DatacenterRates {
  price_per_tb: number;
  price_per_ip: number;
  included_tb: number;
  included_ips: number;
  billing_direction: BillingDirection;
  tb_base: number;
}

/** بازنویسی اختیاری روی یک سرور — خالی یعنی از دیتاسنتر ارث ببر */
export interface ServerOverrides {
  price_per_tb?: number | null;
  price_per_ip?: number | null;
  included_tb?: number | null;
  included_ips?: number | null;
}

export interface Rates extends DatacenterRates {
  /** کدام فیلدها روی خود سرور بازنویسی شده‌اند — برای نمایش در پنل */
  overridden: string[];
}

const DEFAULTS: DatacenterRates = {
  price_per_tb: 0,
  price_per_ip: 0,
  included_tb: 0,
  included_ips: 1,
  billing_direction: 'total',
  tb_base: 1000,
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** نرخ مؤثر یک سرور: بازنویسی سرور بر مقدار دیتاسنتر می‌چربد */
export function effectiveRates(
  server: ServerOverrides | null,
  dc: Partial<DatacenterRates> | null,
): Rates {
  const base: DatacenterRates = {
    price_per_tb: num(dc?.price_per_tb) ?? DEFAULTS.price_per_tb,
    price_per_ip: num(dc?.price_per_ip) ?? DEFAULTS.price_per_ip,
    included_tb: num(dc?.included_tb) ?? DEFAULTS.included_tb,
    included_ips: num(dc?.included_ips) ?? DEFAULTS.included_ips,
    billing_direction: (dc?.billing_direction as BillingDirection) || DEFAULTS.billing_direction,
    tb_base: num(dc?.tb_base) === 1024 ? 1024 : 1000,
  };

  const overridden: string[] = [];
  const pick = <K extends keyof DatacenterRates>(key: K, label: string): number => {
    const own = num(server?.[key as keyof ServerOverrides]);
    if (own !== null) {
      overridden.push(label);
      return own;
    }
    return base[key] as number;
  };

  return {
    price_per_tb: pick('price_per_tb', 'قیمت ترابایت'),
    price_per_ip: pick('price_per_ip', 'قیمت آی‌پی'),
    included_tb: pick('included_tb', 'ترافیک رایگان'),
    included_ips: pick('included_ips', 'آی‌پی رایگان'),
    billing_direction: base.billing_direction,
    tb_base: base.tb_base,
    overridden,
  };
}

/** بایت‌هایی که مبنای صورتحساب‌اند، بر اساس قرارداد دیتاسنتر */
export function billableBytes(rx: number, tx: number, direction: BillingDirection): number {
  const r = Number(rx) || 0;
  const t = Number(tx) || 0;
  if (direction === 'out') return t;
  if (direction === 'in') return r;
  if (direction === 'max') return Math.max(r, t);
  return r + t;
}

/** بایت به ترابایت با مبنای صورتحساب دیتاسنتر */
export function bytesToTb(bytes: number, base: number): number {
  return (Number(bytes) || 0) / Math.pow(base, 4);
}

export interface MonthCost {
  /** بایت خامی که مبنای صورتحساب است */
  billable_bytes: number;
  used_tb: number;
  included_tb: number;
  /** ترابایت مازاد بر سهمیه — همان چیزی که پول می‌گیرند */
  billable_tb: number;
  traffic_cost: number;

  ip_count: number;
  included_ips: number;
  billable_ips: number;
  ip_cost: number;

  rent: number;
  total: number;

  /** درصد سهمیه مصرف‌شده — برای نوار پیشرفت */
  quota_percent: number | null;
}

/** هزینه یک سرور در یک دوره کامل ماهانه */
export function computeMonthCost(params: {
  rx: number;
  tx: number;
  ipCount: number;
  rent: number;
  rates: Rates;
}): MonthCost {
  const { rx, tx, ipCount, rent, rates } = params;

  const billable_bytes = billableBytes(rx, tx, rates.billing_direction);
  const used_tb = bytesToTb(billable_bytes, rates.tb_base);
  const billable_tb = Math.max(0, used_tb - rates.included_tb);
  const traffic_cost = billable_tb * rates.price_per_tb;

  const billable_ips = Math.max(0, (Number(ipCount) || 0) - rates.included_ips);
  const ip_cost = billable_ips * rates.price_per_ip;

  const rentValue = Number(rent) || 0;

  return {
    billable_bytes,
    used_tb,
    included_tb: rates.included_tb,
    billable_tb,
    traffic_cost,
    ip_count: Number(ipCount) || 0,
    included_ips: rates.included_ips,
    billable_ips,
    ip_cost,
    rent: rentValue,
    total: rentValue + traffic_cost + ip_cost,
    quota_percent: rates.included_tb > 0 ? (used_tb / rates.included_tb) * 100 : null,
  };
}

export interface DayCost {
  day: string;
  rx: number;
  tx: number;
  billable_bytes: number;
  used_tb: number;
  /** ترابایتی که همین روز از سهمیه عبور کرده و پول دارد */
  billable_tb: number;
  traffic_cost: number;
  ip_cost: number;
  rent: number;
  total: number;
}

/**
 * شکست روزانه هزینه در یک ماه.
 *
 * سهمیه ترافیک ماهانه است نه روزانه، پس نمی‌شود هر روز را جدا حساب کرد.
 * روش درست، مصرف تجمعی است: تا وقتی جمع ماه زیر سهمیه است هزینه ترافیک
 * صفر می‌ماند، و از روزی که سهمیه تمام می‌شود فقط مازاد همان روز حساب
 * می‌شود. همان کاری که خود دیتاسنتر می‌کند.
 *
 * اجاره سرور و هزینه آی‌پی ماهانه‌اند و به‌طور مساوی بین روزهای ماه پخش
 * می‌شوند — یعنی «هزینه امروز» شامل سهم امروز از اجاره هم هست.
 */
export function computeDailyCosts(params: {
  days: { day: string; rx: number; tx: number }[];
  ipCount: number;
  rent: number;
  rates: Rates;
  /** تعداد کل روزهای ماه، برای پخش هزینه‌های ثابت */
  daysInMonth: number;
}): DayCost[] {
  const { days, ipCount, rent, rates, daysInMonth } = params;

  const includedBytes = rates.included_tb * Math.pow(rates.tb_base, 4);
  const billable_ips = Math.max(0, (Number(ipCount) || 0) - rates.included_ips);
  const dailyIpCost = (billable_ips * rates.price_per_ip) / Math.max(1, daysInMonth);
  const dailyRent = (Number(rent) || 0) / Math.max(1, daysInMonth);

  let cumulative = 0;
  const out: DayCost[] = [];

  for (const d of days) {
    const rx = Number(d.rx) || 0;
    const tx = Number(d.tx) || 0;
    const dayBytes = billableBytes(rx, tx, rates.billing_direction);

    const before = cumulative;
    const after = before + dayBytes;
    cumulative = after;

    // فقط آن بخشی از مصرف امروز که از سهمیه عبور کرده
    let overBytes = 0;
    if (after > includedBytes) {
      overBytes = before >= includedBytes ? dayBytes : after - includedBytes;
    }

    const billable_tb = bytesToTb(overBytes, rates.tb_base);
    const traffic_cost = billable_tb * rates.price_per_tb;

    out.push({
      day: d.day,
      rx,
      tx,
      billable_bytes: dayBytes,
      used_tb: bytesToTb(dayBytes, rates.tb_base),
      billable_tb,
      traffic_cost,
      ip_cost: dailyIpCost,
      rent: dailyRent,
      total: traffic_cost + dailyIpCost + dailyRent,
    });
  }

  return out;
}
