'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

/**
 * منوی پرتال مشتری.
 *
 * پرتال جای مرور است نه مدیریت؛ هرچه بیشتر شود، پیداکردن
 * همان یک عددی که مشتری دنبالش آمده سخت‌تر می‌شود.
 *
 * کلاینت است چون مسیر فعال را از usePathname می‌گیرد. خروج هم fetch
 * دارد و هم فرم: با جاوااسکریپت، fetch و بعد تغییر آدرس؛ بدون آن،
 * پیمایش ساده فرم و ریدایرکت سرور.
 */

const NAV = [
  { href: '/portal', label: 'سرورها' },
  { href: '/portal/shop', label: 'فروشگاه' },
  { href: '/portal/usage', label: 'گزارش مصرف' },
  { href: '/portal/invoices', label: 'فاکتورها' },
  { href: '/portal/topups', label: 'خرید ترافیک' },
  { href: '/portal/tickets', label: 'پشتیبانی' },
  { href: '/portal/profile', label: 'پروفایل' },
];

export function PortalNav() {
  const pathname = usePathname();

  /**
   * خروج.
   *
   * پیمایش پیش‌فرض فرم متوقف می‌شود و به‌جایش fetch می‌رود، چون مقصدِ
   * بعدش را خود مرورگر با location تعیین می‌کند نه سرآیند Location
   * سرور. یک متغیر کمتر برای اشتباه‌شدن.
   *
   * finally عمدی است: اگر درخواست هم شکست بخورد، کاربر باید به صفحه
   * ورود برود. ماندن در پرتالی که نشستش نامعلوم است بدتر از یک خروج
   * ناقص است.
   */
  async function logout(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/api/auth/logout');
    } finally {
      window.location.href = '/login';
    }
  }

  // مسیر سرورها روی صفحه جزئیات هم فعال بماند، ولی روی بقیه نه
  const isActive = (href: string) =>
    href === '/portal'
      ? pathname === '/portal' || pathname.startsWith('/portal/servers')
      : pathname.startsWith(href);

  return (
    <header className="no-print border-b border-line bg-panel/60 sticky top-0 z-20 backdrop-blur">
      <div className="max-w-6xl mx-auto px-3 sm:px-4">
        <div className="h-14 flex items-center justify-between gap-3">
          <Link href="/portal" className="flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-md bg-cyan/15 border border-cyan/30 grid place-items-center text-cyan text-sm">
              ⬢
            </span>
            <span className="font-bold text-sm">پاسارگاد میزبان</span>
          </Link>

          {/*
            خروج با fetch انجام می‌شود و بعد خود صفحه عوض می‌شود — همان
            کاری که پنل مدیریت می‌کند و کار می‌کند.

            action و method روی فرم می‌مانند تا اگر جاوااسکریپت خاموش
            بود، پیمایش ساده مرورگر همان مسیر را بزند و سرور خودش
            ریدایرکت کند. دو راه، یک مقصد.
          */}
          <form action="/api/auth/logout" method="post" onSubmit={logout}>
            <button type="submit" className="text-xs text-muted hover:text-white px-2 py-1">
              خروج
            </button>
          </form>
        </div>

        {/* منو زیر سرصفحه است نه کنارش: روی موبایل کنار هم جا نمی‌شوند */}
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-2.5 text-xs whitespace-nowrap border-b-2 transition-colors ${
                isActive(item.href)
                  ? 'border-cyan text-cyan'
                  : 'border-transparent text-muted hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
