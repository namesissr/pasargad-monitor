'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Notice } from '@/components/ui';
import { OtpForm } from '@/components/OtpForm';
import { SiteFooter } from '@/components/SiteFooter';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // پیش‌فرض گذرواژه است نه کد پیامکی: کارکنان از همین صفحه وارد
  // می‌شوند و حساب کارکنان اصلا کد پیامکی نمی‌گیرد.
  const [tab, setTab] = useState<'password' | 'otp'>('password');

  /**
   * مقصد پس از ورود.
   *
   * نقش را فقط سرور می‌داند، پس مقصد از پاسخ او می‌آید. «next» فقط
   * وقتی رعایت می‌شود که با نقش بخواند — وگرنه مشتری به صفحه‌ای
   * می‌رفت که ای‌پی‌آی‌اش ۴۰۳ می‌دهد و صفحه خالی می‌ماند.
   */
  function goHome(redirect?: string) {
    const next = new URLSearchParams(window.location.search).get('next');
    const home = redirect === '/portal' ? '/portal' : '/';
    const useNext = next && next.startsWith('/') && (home === '/' || next.startsWith('/portal'));
    window.location.href = useNext ? next : home;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ redirect?: string }>('/api/auth/login', { username, password });
      goHome(res?.redirect);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ورود انجام نشد');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 grid place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="inline-grid place-items-center w-12 h-12 rounded-xl bg-cyan/15 border border-cyan/30 text-cyan text-xl mb-3">
            ⬢
          </span>
          <h1 className="text-lg font-bold">پاسارگاد میزبان</h1>
          <p className="text-xs text-muted mt-1">پنل مانیتورینگ سرورهای اختصاصی</p>
        </div>

        <div className="flex gap-1 mb-3">
          {(
            [
              ['password', 'گذرواژه'],
              ['otp', 'کد پیامکی'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setError(null);
              }}
              className={`flex-1 px-3 py-2 rounded-lg text-xs border transition-colors ${
                tab === key
                  ? 'bg-cyan/10 text-cyan border-cyan/30'
                  : 'border-line text-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'otp' ? (
          <div className="card p-6">
            <OtpForm onDone={() => goHome('/portal')} />
            <p className="text-[11px] text-muted/70 mt-4 leading-relaxed">
              ورود با کد پیامکی فقط برای حساب مشتری است. کارکنان با گذرواژه وارد می‌شوند.
            </p>
          </div>
        ) : (
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="label" htmlFor="username">نام کاربری</label>
            <input
              id="username"
              className="input ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div>
            <label className="label" htmlFor="password">گذرواژه</label>
            <input
              id="password"
              type="password"
              className="input ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && <Notice type="error">{error}</Notice>}

          <button type="submit" className="btn-primary w-full" disabled={busy || !username || !password}>
            {busy ? 'در حال ورود…' : 'ورود'}
          </button>
        </form>
        )}

        <p className="text-center text-xs text-muted mt-6">
          حساب ندارید؟{' '}
          <Link href="/store" className="text-cyan hover:underline">
            از فروشگاه سفارش بدهید
          </Link>{' '}
          — ثبت‌نام حین سفارش انجام می‌شود.
        </p>

        <p className="text-center text-[11px] text-muted/60 mt-2">
          تلاش‌های ورود ثبت می‌شود.
        </p>
      </div>
      </div>

      <SiteFooter compact />
    </div>
  );
}
