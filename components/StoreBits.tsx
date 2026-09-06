'use client';

/**
 * تکه‌های مشترک فروشگاه، بین صفحه فهرست و صفحه محصول.
 *
 * در فایل جدا هستند نه داخل page.tsx: نکست از فایل صفحه فقط چند خروجی
 * مشخص انتظار دارد و هر خروجی اضافه، دیر یا زود جای اشتباهی گیر می‌کند.
 */

export interface StoreProduct {
  id: number;
  name: string;
  kind: string;
  summary: string | null;
  spec_cpu: string | null;
  spec_ram: string | null;
  spec_disk: string | null;
  spec_bandwidth: string | null;
  spec_location: string | null;
  price_toman: number;
  setup_toman: number;
  billing_months: number;
  extra_ip_price_toman: number;
  max_extra_ips: number;
  in_stock: boolean;
}

export interface TrafficPackage {
  id: number;
  name: string;
  gb: number;
  price_toman: number;
  description: string | null;
}

/** دوره صورتحساب به فارسی خوانا */
export function billingLabel(months: number): string {
  if (months === 1) return 'ماهانه';
  if (months === 3) return 'سه‌ماهه';
  if (months === 6) return 'شش‌ماهه';
  if (months === 12) return 'سالانه';
  return `هر ${months} ماه`;
}

/** یک ردیف مشخصات که اگر مقدار نداشته باشد اصلا چاپ نمی‌شود */
export function Spec({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted shrink-0 w-20">{label}</span>
      <span className="break-anywhere">{value}</span>
    </div>
  );
}
