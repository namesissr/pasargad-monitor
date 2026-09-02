'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Notice } from '@/components/ui';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/auth/login', { username, password });
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.href = next && next.startsWith('/') ? next : '/';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ورود انجام نشد');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="inline-grid place-items-center w-12 h-12 rounded-xl bg-cyan/15 border border-cyan/30 text-cyan text-xl mb-3">
            ⬢
          </span>
          <h1 className="text-lg font-bold">پاسارگاد میزبان</h1>
          <p className="text-xs text-muted mt-1">پنل مانیتورینگ سرورهای اختصاصی</p>
        </div>

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

        <p className="text-center text-[11px] text-muted/60 mt-6">
          دسترسی فقط برای مدیران. تلاش‌های ورود ثبت می‌شود.
        </p>
      </div>
    </div>
  );
}
