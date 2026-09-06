'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Notice } from '@/components/ui';
import { TelegramLink } from '@/components/TelegramLink';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalali } from '@/lib/format';

interface Customer {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  national_id: string | null;
  address: string | null;
  created_at: string;
}

interface Data {
  customer: Customer | null;
  account: { username: string; last_login_at: string | null } | null;
  stats: { servers: number; invoices: number; unpaid: number } | null;
}

export default function ProfilePage() {
  const { data, loading, error, reload } = useLoad<Data>('/api/portal/profile');

  const [form, setForm] = useState({
    name: '',
    company: '',
    email: '',
    national_id: '',
    address: '',
  });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // فرم از داده سرور پر می‌شود، یک بار وقتی رسید. بدون این، کاربر باید
  // مشخصاتش را از نو بنویسد تا یک فیلد را عوض کند.
  useEffect(() => {
    if (!data?.customer) return;
    setForm({
      name: data.customer.name ?? '',
      company: data.customer.company ?? '',
      email: data.customer.email ?? '',
      national_id: data.customer.national_id ?? '',
      address: data.customer.address ?? '',
    });
  }, [data]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await api.patch('/api/portal/profile', form);
      setMsg({ type: 'success', text: 'مشخصات ذخیره شد.' });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ذخیره ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);

    // تطبیق دو فیلد سمت مرورگر بررسی می‌شود: خطای تایپی نباید یک رفت و
    // برگشت به سرور بخواهد
    if (pw.new_password !== pw.confirm) {
      setPwMsg({ type: 'error', text: 'گذرواژه تازه و تکرارش یکی نیستند' });
      return;
    }

    setBusy(true);
    try {
      await api.post('/api/portal/profile', {
        current_password: pw.current_password,
        new_password: pw.new_password,
      });
      setPw({ current_password: '', new_password: '', confirm: '' });
      setPwMsg({ type: 'success', text: 'گذرواژه عوض شد.' });
    } catch (e) {
      setPwMsg({
        type: 'error',
        text: e instanceof ApiError ? e.message : 'تغییر گذرواژه ناموفق بود',
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading || error || !data || !data.customer) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">پروفایل</h1>
        <p className="text-xs text-muted mt-0.5">
          این مشخصات روی فاکتورهای شما چاپ می‌شود.
        </p>
      </div>

      {/* ── یک نگاه کلی ───────────────────────────────────── */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Link href="/portal" className="card p-4 hover:border-cyan/40 transition-colors">
          <div className="text-xs text-muted">سرورهای فعال</div>
          <div className="text-2xl font-bold mt-1">{faNum(data.stats?.servers ?? 0)}</div>
        </Link>
        <Link href="/portal/invoices" className="card p-4 hover:border-cyan/40 transition-colors">
          <div className="text-xs text-muted">فاکتور پرداخت‌شده</div>
          <div className="text-2xl font-bold mt-1 text-ok">{faNum(data.stats?.invoices ?? 0)}</div>
        </Link>
        <Link href="/portal/invoices" className="card p-4 hover:border-cyan/40 transition-colors">
          <div className="text-xs text-muted">در انتظار پرداخت</div>
          <div
            className={`text-2xl font-bold mt-1 ${
              (data.stats?.unpaid ?? 0) > 0 ? 'text-amber' : ''
            }`}
          >
            {faNum(data.stats?.unpaid ?? 0)}
          </div>
        </Link>
      </div>

      {/* ── مشخصات ───────────────────────────────────────── */}
      <form onSubmit={save} className="card p-5 space-y-4">
        <h2 className="text-sm font-bold">مشخصات</h2>

        {msg && <Notice type={msg.type}>{msg.text}</Notice>}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام و نام خانوادگی">
            <input className="input" value={form.name} onChange={set('name')} required />
          </Field>

          {/* شماره فقط نشان داده می‌شود: نام کاربری و مقصد پیامک همین
              است و عوض‌کردنش کار پشتیبانی است */}
          <Field label="شماره موبایل" hint="برای تغییر شماره، تیکت بزنید">
            <input className="input ltr" value={data.customer.phone ?? ''} disabled />
          </Field>

          <Field label="ایمیل" hint="فاکتور، پاسخ تیکت و مشخصات سرور به این نشانی می‌رود">
            <input className="input ltr" type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="نام شرکت">
            <input className="input" value={form.company} onChange={set('company')} />
          </Field>
          <Field label="شناسه ملی یا کد ملی">
            <input
              className="input ltr"
              value={form.national_id}
              onChange={set('national_id')}
            />
          </Field>
          <Field label="نشانی">
            <input className="input" value={form.address} onChange={set('address')} />
          </Field>
        </div>

        <button type="submit" className="btn-primary text-xs px-4 py-1.5" disabled={busy}>
          {busy ? 'در حال ذخیره…' : 'ذخیره مشخصات'}
        </button>
      </form>

      {/* ── تلگرام ───────────────────────────────────────── */}
      <TelegramLink />

      {/* ── گذرواژه ──────────────────────────────────────── */}
      <form onSubmit={changePassword} className="card p-5 space-y-4">
        <h2 className="text-sm font-bold">تغییر گذرواژه</h2>

        {pwMsg && <Notice type={pwMsg.type}>{pwMsg.text}</Notice>}

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="گذرواژه فعلی">
            <input
              className="input ltr"
              type="password"
              value={pw.current_password}
              onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="گذرواژه تازه" hint="دست‌کم ۸ کاراکتر">
            <input
              className="input ltr"
              type="password"
              value={pw.new_password}
              onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
          <Field label="تکرار گذرواژه تازه">
            <input
              className="input ltr"
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
        </div>

        <button type="submit" className="btn-ghost text-xs px-4 py-1.5" disabled={busy}>
          تغییر گذرواژه
        </button>
      </form>

      {/* ── حساب ─────────────────────────────────────────── */}
      <div className="card p-5 space-y-2">
        <h2 className="text-sm font-bold">حساب</h2>
        <div className="space-y-1 text-xs">
          <div className="flex gap-2">
            <span className="text-muted shrink-0 w-24">نام کاربری</span>
            <span className="ltr">{data.account?.username ?? '—'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted shrink-0 w-24">عضویت از</span>
            <span>{formatJalali(data.customer.created_at)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted shrink-0 w-24">آخرین ورود</span>
            <span>
              {data.account?.last_login_at ? formatJalali(data.account.last_login_at) : '—'}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-muted/70 leading-relaxed pt-2">
          اگر مشکلی در حسابتان هست یا می‌خواهید شماره موبایلتان عوض شود، از بخش{' '}
          <Link href="/portal/tickets" className="text-cyan hover:underline">
            پشتیبانی
          </Link>{' '}
          تیکت بزنید.
        </p>
      </div>
    </div>
  );
}
