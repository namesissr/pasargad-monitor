'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBoundary } from './ui';

const NAV = [
  { group: 'مانیتورینگ', items: [
    { href: '/', label: 'داشبورد', icon: '▤' },
    { href: '/servers', label: 'سرورها', icon: '▦' },
    { href: '/incidents', label: 'رویدادها', icon: '⚠' },
  ]},
  { group: 'زیرساخت', items: [
    { href: '/datacenters', label: 'دیتاسنترها', icon: '⬡' },
    { href: '/ips', label: 'آی‌پی‌ها', icon: '◈' },
    { href: '/virtualizor', label: 'هایپروایزرها', icon: '⧉' },
  ]},
  { group: 'مشتریان', items: [
    { href: '/customers', label: 'مشتریان', icon: '☺' },
  ]},
  { group: 'گزارش', items: [
    { href: '/reports', label: 'گزارش مصرف', icon: '▨' },
    { href: '/traffic', label: 'لاگ ترافیک', icon: '⇅' },
    { href: '/invoices', label: 'فاکتورها', icon: '❑' },
    { href: '/billing', label: 'حسابداری', icon: '₮' },
    { href: '/topups', label: 'خرید ترافیک', icon: '⊕' },
  ]},
  { group: 'سامانه', items: [
    { href: '/settings', label: 'تنظیمات', icon: '⚙' },
  ]},
];

export function Shell({ username, children }: { username: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  async function logout() {
    try {
      await api.post('/api/auth/logout');
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* نوار کناری */}
      {/*
        روی موبایل کشویی است و روی دسکتاپ چسبان.
        ارتفاع با dvh گرفته می‌شود نه vh: مرورگر موبایل نوار آدرس را در
        vh حساب می‌کند، پس ردیف پایینی — نام کاربر و دکمه خروج — زیر لبه
        صفحه می‌افتاد و اصلا دیده نمی‌شد.
      */}
      <aside
        className={`fixed start-0 lg:start-auto lg:sticky top-0 h-[100dvh] lg:h-screen w-64 max-w-[85vw]
                    lg:w-60 shrink-0 bg-panel border-e border-line flex flex-col
                    z-40 transition-transform duration-200
                    ${open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
        aria-hidden={undefined}
      >
        <div className="h-14 shrink-0 flex items-center gap-2.5 px-5 border-b border-line">
          <span className="w-7 h-7 rounded-md bg-cyan/15 border border-cyan/30 grid place-items-center text-cyan text-sm">
            ⬢
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold">پاسارگاد میزبان</p>
            <p className="text-[10px] text-muted">پنل مانیتورینگ</p>
          </div>
        </div>

        <nav className="p-3 overflow-y-auto flex-1 min-h-0">
          {NAV.map((g) => (
            <div key={g.group} className="mb-4">
              <p className="text-[10px] text-muted/60 px-2 mb-1.5">{g.group}</p>
              {g.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm mb-0.5 transition-colors
                    ${isActive(item.href)
                      ? 'bg-cyan/10 text-cyan border border-cyan/25'
                      : 'text-muted hover:text-white hover:bg-panel2 border border-transparent'}`}
                >
                  <span className="text-xs opacity-70">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="h-14 shrink-0 border-t border-line px-4 flex items-center justify-between">
          <span className="text-xs text-muted truncate">{username}</span>
          <button type="button" onClick={logout} className="text-xs text-muted hover:text-danger">
            خروج
          </button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex-1 min-w-0">
        <header className="h-14 border-b border-line flex items-center gap-3 px-4 lg:px-6 sticky top-0 bg-rack/90 backdrop-blur z-20">
          {/* هدف لمسی باید دست‌کم ۴۴ پیکسل باشد؛ آیکون تنها روی موبایل
              به‌سختی زده می‌شود */}
          <button
            type="button"
            className="lg:hidden -ms-2 w-11 h-11 grid place-items-center text-muted hover:text-white text-xl"
            onClick={() => setOpen((v) => !v)}
            aria-label="منو"
            aria-expanded={open}
          >
            ☰
          </button>
          <span className="text-xs text-muted truncate">
            {NAV.flatMap((g) => g.items).find((i) => isActive(i.href))?.label ?? ''}
          </span>
          <span className="ms-auto text-[11px] text-muted lg:hidden truncate max-w-[40%]">
            {username}
          </span>
        </header>

        <main className="p-3 sm:p-4 lg:p-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
