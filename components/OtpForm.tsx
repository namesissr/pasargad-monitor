'use client';

import { useEffect, useRef, useState } from 'react';
import { Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum } from '@/lib/format';

/**
 * فرم ورود با کد پیامکی.
 *
 * ── چرا کامپوننت مشترک ─────────────────────────────────────
 *
 * دو جا لازم است: صفحه ورود، و مرحله حسابِ فروشگاه عمومی. اگر دو نسخه
 * می‌بود، شمارش معکوس یا مدیریت خطا در یکی‌شان عقب می‌ماند.
 *
 * ── پس از تأیید، نشست باز است ──────────────────────────────
 *
 * مسیر تأیید خودش کوکی را می‌گذارد. پس onDone فقط خبر می‌دهد؛ صفحه
 * ورود کاربر را می‌فرستد به پرتال، و فروشگاه سفارش را با
 * mode=session ادامه می‌دهد.
 */
export function OtpForm({
  onDone,
  initialPhone = '',
}: {
  onDone: (username: string) => void;
  initialPhone?: string;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'info' | 'success'; text: string } | null>(null);
  const [left, setLeft] = useState(0);

  const codeRef = useRef<HTMLInputElement>(null);

  // شمارش معکوس ارسال دوباره. بدون آن، کاربر دکمه را پشت‌سرهم می‌زند و
  // هر بار همان خطای «کد قبلی هنوز معتبر است» را می‌گیرد.
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  async function request(e?: React.FormEvent) {
    e?.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.post<{ resendAfter: number; devCode?: string }>(
        '/api/auth/otp/request',
        { phone },
      );
      setSent(true);
      setLeft(res.resendAfter ?? 90);
      setMsg({
        type: res.devCode ? 'info' : 'success',
        // حالت توسعه کد را برمی‌گرداند تا آزمودن بدون پیامک ممکن باشد.
        // روی محیط واقعی این هرگز پر نیست.
        text: res.devCode
          ? `حالت توسعه — کد: ${res.devCode}`
          : 'اگر با این شماره حساب دارید، کد تا لحظاتی دیگر می‌رسد.',
      });
      // تمرکز روی فیلد کد، تا کاربر لازم نباشد دنبالش بگردد
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      // «کد قبلی هنوز معتبر است» خطای واقعی نیست: یعنی کد در راه است
      const retry = err instanceof ApiError ? (err.data as { retryAfter?: number })?.retryAfter : 0;
      if (retry) {
        setSent(true);
        setLeft(retry);
        setMsg({ type: 'info', text: 'کد قبلی هنوز معتبر است. همان را وارد کنید.' });
      } else {
        setMsg({ type: 'error', text: err instanceof ApiError ? err.message : 'ارسال کد ناموفق بود' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.post<{ username: string }>('/api/auth/otp/verify', { phone, code });
      onDone(res.username);
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof ApiError ? err.message : 'تأیید کد ناموفق بود' });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={sent ? verify : request} className="space-y-4">
      <Field label="شماره موبایل">
        <input
          className="input ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="09121234567"
          autoComplete="tel"
          inputMode="tel"
          disabled={sent}
          required
        />
      </Field>

      {sent && (
        <Field label="کد پیامک‌شده" hint="کد شش‌رقمی">
          <input
            ref={codeRef}
            className="input ltr text-center tracking-[0.4em] text-lg"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
        </Field>
      )}

      {msg && <Notice type={msg.type === 'info' ? 'info' : msg.type}>{msg.text}</Notice>}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          className="btn-primary text-xs px-5 py-2"
          disabled={busy || !phone || (sent && code.length !== 6)}
        >
          {busy ? 'لطفا صبر کنید…' : sent ? 'ورود' : 'ارسال کد'}
        </button>

        {sent && (
          <>
            <button
              type="button"
              className="text-xs text-muted hover:text-white disabled:opacity-50"
              onClick={() => request()}
              disabled={busy || left > 0}
            >
              {left > 0 ? `ارسال دوباره تا ${faNum(left)} ثانیه` : 'ارسال دوباره کد'}
            </button>

            <button
              type="button"
              className="text-xs text-muted hover:text-white ms-auto"
              onClick={() => {
                setSent(false);
                setCode('');
                setMsg(null);
                setLeft(0);
              }}
            >
              تغییر شماره
            </button>
          </>
        )}
      </div>
    </form>
  );
}
