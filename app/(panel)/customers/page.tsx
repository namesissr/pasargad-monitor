'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, timeAgo } from '@/lib/format';

interface CustomerRow {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  national_id: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  user_id: number | null;
  username: string | null;
  user_active: boolean | null;
  last_login_at: string | null;
  server_count: number;
}

export default function CustomersPage() {
  const { data, loading, error, reload } = useLoad<{ customers: CustomerRow[] }>('/api/customers');
  const [editing, setEditing] = useState<CustomerRow | 'new' | null>(null);
  const [account, setAccount] = useState<CustomerRow | null>(null);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function remove(c: CustomerRow) {
    if (!confirm(`مشتری «${c.name}» حذف شود؟ حساب ورودش هم می‌رود. سرورهایش می‌مانند و فقط تخصیصشان پاک می‌شود.`)) {
      return;
    }
    try {
      await api.del(`/api/customers?id=${c.id}`);
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'حذف مشتری ناموفق بود' });
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">مشتریان</h1>
          <p className="text-xs text-muted mt-0.5">
            سرور را به مشتری تخصیص دهید و برایش حساب ورود بسازید تا مصرف خودش را ببیند.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          + افزودن مشتری
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {!data.customers.length ? (
        <Notice type="warn">هنوز مشتری‌ای ثبت نشده.</Notice>
      ) : (
        <div className="card table-wrap">
          <table className="tbl sm:min-w-[820px]">
            <thead>
              <tr>
                <th>نام</th>
                <th className="col-md">شرکت</th>
                <th>تماس</th>
                <th className="col-sm">سرور</th>
                <th>حساب ورود</th>
                <th className="col-md">آخرین ورود</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((c) => (
                <tr key={c.id} className={c.is_active ? '' : 'opacity-60'}>
                  <td className="text-xs font-bold">
                    {c.name}
                    {!c.is_active && <span className="badge bg-line text-muted ms-2">غیرفعال</span>}
                  </td>
                  <td className="col-md text-xs">{c.company || '—'}</td>
                  <td className="text-xs">
                    {c.phone && <span className="ltr block">{c.phone}</span>}
                    {c.email && <span className="ltr block text-muted">{c.email}</span>}
                    {!c.phone && !c.email && '—'}
                  </td>
                  <td className="col-sm text-xs">{faNum(c.server_count)}</td>
                  <td className="text-xs">
                    {c.username ? (
                      <>
                        <span className="ltr">{c.username}</span>
                        {c.user_active === false && (
                          <span className="badge bg-line text-muted ms-1">غیرفعال</span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">ندارد</span>
                    )}
                  </td>
                  <td className="col-md text-xs text-muted">
                    {c.last_login_at ? timeAgo(c.last_login_at) : '—'}
                  </td>
                  <td className="text-end sm:whitespace-nowrap">
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-cyan"
                      onClick={() => setAccount(c)}
                    >
                      {c.username ? 'حساب' : 'ساخت حساب'}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-cyan ms-3"
                      onClick={() => setEditing(c)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-danger ms-3"
                      onClick={() => remove(c)}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CustomerForm
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {account && (
        <AccountForm
          customer={account}
          onClose={() => setAccount(null)}
          onDone={() => {
            setAccount(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CustomerForm({
  customer,
  onClose,
  onDone,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    first_name: customer?.first_name ?? '',
    last_name: customer?.last_name ?? '',
    name: customer?.name ?? '',
    company: customer?.company ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    national_id: customer?.national_id ?? '',
    address: customer?.address ?? '',
    notes: customer?.notes ?? '',
    is_active: customer?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (customer) await api.patch('/api/customers', { id: customer.id, ...form });
      else await api.post('/api/customers', form);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره مشتری ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={customer ? `ویرایش ${customer.name}` : 'مشتری تازه'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام"><input className="input" value={form.first_name} onChange={set('first_name')} /></Field>
          <Field label="نام خانوادگی"><input className="input" value={form.last_name} onChange={set('last_name')} /></Field>
          <Field label="شرکت" hint="برای مشتری حقوقی؛ اختیاری">
            <input className="input" value={form.company} onChange={set('company')} />
          </Field>
          <Field label="تلفن" hint="پیامک هشدار سهمیه و تمدید به همین شماره می‌رود">
            <input className="input ltr" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="ایمیل"><input className="input ltr" value={form.email} onChange={set('email')} /></Field>
          <Field label="کد ملی" hint="ده رقم">
            <input className="input ltr" value={form.national_id} onChange={set('national_id')} />
          </Field>
          <Field label="وضعیت" hint="غیرفعال‌کردن، حساب ورودش را هم غیرفعال می‌کند">
            <select
              className="input"
              value={form.is_active ? 'true' : 'false'}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'true' }))}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
        </div>

        <Field label="نشانی"><textarea className="input" rows={2} value={form.address} onChange={set('address')} /></Field>
        <Field label="یادداشت" hint="فقط برای شما؛ مشتری آن را نمی‌بیند">
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * حساب ورود مشتری.
 *
 * گذرواژه هرگز خوانده نمی‌شود، فقط نوشته. برای حساب موجود، خالی‌گذاشتنش
 * یعنی «عوض نکن» — وگرنه هر ذخیره‌ای گذرواژه را پاک می‌کرد.
 */
function AccountForm({
  customer,
  onClose,
  onDone,
}: {
  customer: CustomerRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const exists = Boolean(customer.username);
  const [form, setForm] = useState({
    username: customer.username ?? '',
    password: '',
    is_active: customer.user_active !== false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.put('/api/customers', {
        id: customer.id,
        username: form.username,
        password: form.password,
        is_active: form.is_active,
      });
      setDone(true);
      setTimeout(onDone, 900);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره حساب ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`حساب ورود ${customer.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field
          label="نام کاربری"
          hint={exists ? 'نام کاربری پس از ساخت عوض نمی‌شود' : 'مشتری با این نام وارد می‌شود'}
        >
          <input
            className="input ltr"
            value={form.username}
            disabled={exists}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            autoComplete="off"
          />
        </Field>

        <Field
          label="گذرواژه"
          hint={exists ? 'خالی یعنی همان گذرواژه قبلی بماند' : 'حداقل ۸ کاراکتر'}
        >
          <input
            className="input ltr"
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            autoComplete="new-password"
          />
        </Field>

        {exists && (
          <Field label="وضعیت حساب">
            <select
              className="input"
              value={form.is_active ? 'true' : 'false'}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'true' }))}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
        )}

        <Notice type="warn">
          مشتری فقط سرورهایی را می‌بیند که به او تخصیص داده‌اید، و فقط مصرف و سلامتشان را —
          نه قیمت تمام‌شده، نه دیتاسنتر، نه یادداشت‌های داخلی.
        </Notice>

        {err && <Notice type="error">{err}</Notice>}
        {done && <Notice type="success">حساب ذخیره شد.</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button type="button" className="btn" onClick={save} disabled={busy || done}>
            {busy ? 'در حال ذخیره…' : exists ? 'ذخیره' : 'ساخت حساب'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
