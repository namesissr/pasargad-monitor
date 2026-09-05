'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalaliDay, formatToman, timeAgo } from '@/lib/format';

interface Invoice {
  id: number;
  number: string;
  title: string;
  kind: string;
  status: 'unpaid' | 'paid' | 'canceled';
  amount_toman: number;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  payment_ref: string | null;
  card_number: string | null;
  gateway: string | null;
  customer_id: number;
  customer_name: string;
  server_id: number | null;
  server_name: string | null;
}

interface Data {
  invoices: Invoice[];
  totals: { unpaid: number; paid_month: number; unpaid_count: number } | null;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  unpaid: { label: 'در انتظار', cls: 'bg-amber/15 text-amber' },
  paid: { label: 'پرداخت‌شده', cls: 'bg-ok/15 text-ok' },
  canceled: { label: 'لغو شده', cls: 'bg-line text-muted' },
};

const KIND: Record<string, string> = {
  renewal: 'تمدید',
  traffic: 'ترافیک',
  manual: 'دستی',
};

const FILTERS = [
  ['', 'همه'],
  ['unpaid', 'در انتظار'],
  ['paid', 'پرداخت‌شده'],
  ['canceled', 'لغو شده'],
] as const;

export default function InvoicesPage() {
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useLoad<Data>(
    `/api/invoices${status ? `?status=${status}` : ''}`,
  );
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function act(inv: Invoice, action: 'cancel' | 'mark_paid') {
    const question =
      action === 'cancel'
        ? `فاکتور ${inv.number} لغو شود؟`
        : `فاکتور ${inv.number} به مبلغ ${formatToman(inv.amount_toman)} پرداخت‌شده ثبت شود؟\n\n` +
          'سرور تمدید می‌شود و به مشتری پیامک و ایمیل می‌رود.';
    if (!confirm(question)) return;

    setMsg(null);
    try {
      await api.patch('/api/invoices', { id: inv.id, action });
      setMsg({
        type: 'success',
        text: action === 'cancel' ? 'فاکتور لغو شد.' : 'پرداخت ثبت شد و سرویس تمدید شد.',
      });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'عملیات ناموفق بود' });
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">فاکتورها</h1>
          <p className="text-xs text-muted mt-0.5">
            فاکتور تمدید خودکار صادر می‌شود. قیمت هر سرور در صفحه خودش تنظیم می‌شود.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          + فاکتور دستی
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-xs text-muted">در انتظار پرداخت</div>
          <div className="text-2xl font-bold mt-1 text-amber">
            {formatToman(data.totals?.unpaid ?? 0)}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            {faNum(data.totals?.unpaid_count ?? 0)} فاکتور
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">پرداخت‌شده این ماه</div>
          <div className="text-2xl font-bold mt-1 text-ok">
            {formatToman(data.totals?.paid_month ?? 0)}
          </div>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        {FILTERS.map(([key, label]) => (
          <button
            key={key || 'all'}
            type="button"
            onClick={() => setStatus(key)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              status === key
                ? 'bg-cyan/10 text-cyan border-cyan/30'
                : 'border-line text-muted hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!data.invoices.length ? (
        <Notice type="warn">فاکتوری با این فیلتر نیست.</Notice>
      ) : (
        <div className="card table-wrap">
          <table className="tbl sm:min-w-[880px]">
            <thead>
              <tr>
                <th>شماره</th>
                <th>مشتری</th>
                <th>بابت</th>
                <th>مبلغ</th>
                <th>وضعیت</th>
                <th className="col-sm">مهلت</th>
                <th className="col-md">پیگیری</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => {
                const st = STATUS[inv.status] || STATUS.canceled;
                return (
                  <tr key={inv.id}>
                    <td className="text-xs ltr sm:whitespace-nowrap">
                      {inv.number}
                      <span className="badge bg-line text-muted ms-1">
                        {KIND[inv.kind] ?? inv.kind}
                      </span>
                    </td>
                    <td className="text-xs">
                      <Link href="/customers" className="hover:text-cyan">
                        {inv.customer_name}
                      </Link>
                    </td>
                    <td className="text-xs">
                      {inv.title}
                      {inv.server_name && (
                        <Link
                          href={`/servers/${inv.server_id}`}
                          className="text-muted block text-[11px] hover:text-cyan"
                        >
                          {inv.server_name}
                        </Link>
                      )}
                    </td>
                    <td className="text-xs font-medium sm:whitespace-nowrap">
                      {formatToman(inv.amount_toman)}
                    </td>
                    <td className="text-xs">
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                      {inv.paid_at && (
                        <span className="text-muted block text-[11px]">{timeAgo(inv.paid_at)}</span>
                      )}
                    </td>
                    <td className="text-xs text-muted col-sm sm:whitespace-nowrap">
                      {inv.due_at ? formatJalaliDay(inv.due_at) : '—'}
                    </td>
                    <td className="text-xs text-muted col-md">
                      {inv.payment_ref ? (
                        <span className="ltr break-anywhere">{inv.payment_ref}</span>
                      ) : (
                        '—'
                      )}
                      {inv.card_number && (
                        <span className="block text-[11px] ltr">{inv.card_number}</span>
                      )}
                    </td>
                    <td className="text-end whitespace-nowrap">
                      {inv.status === 'unpaid' && (
                        <>
                          <button
                            type="button"
                            className="text-xs text-muted hover:text-ok"
                            onClick={() => act(inv, 'mark_paid')}
                          >
                            ثبت پرداخت
                          </button>
                          <button
                            type="button"
                            className="text-xs text-muted hover:text-danger ms-3"
                            onClick={() => act(inv, 'cancel')}
                          >
                            لغو
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <ManualInvoiceForm
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * فاکتور دستی.
 *
 * سرور اختیاری است: فاکتوری که سرور دارد و نوعش تمدید نیست، سرویس را
 * تمدید نمی‌کند — فقط به آن سرور نسبت داده می‌شود تا در گزارش معلوم
 * باشد بابت چه بوده.
 */
function ManualInvoiceForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const customers = useLoad<{ customers: { id: number; name: string }[] }>('/api/customers');
  const servers = useLoad<{ servers: { id: number; name: string; customer_id: number | null }[] }>(
    '/api/servers',
  );

  const [form, setForm] = useState({
    customer_id: '',
    server_id: '',
    title: '',
    amount_toman: '',
    due_at: '',
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // فقط سرورهای همان مشتری، وگرنه فاکتور به سرور کس دیگری وصل می‌شود
  const ownServers = (servers.data?.servers ?? []).filter(
    (s) => String(s.customer_id ?? '') === form.customer_id,
  );

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.post('/api/invoices', {
        customer_id: Number(form.customer_id),
        server_id: form.server_id ? Number(form.server_id) : null,
        title: form.title,
        amount_toman: Number(form.amount_toman),
        due_at: form.due_at,
        note: form.note,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ساخت فاکتور ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="فاکتور دستی" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="مشتری">
            <select
              className="input"
              value={form.customer_id}
              onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value, server_id: '' }))}
            >
              <option value="">— انتخاب کنید —</option>
              {(customers.data?.customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="سرور" hint="اختیاری؛ فقط سرورهای همین مشتری">
            <select
              className="input"
              value={form.server_id}
              onChange={(e) => setForm((f) => ({ ...f, server_id: e.target.value }))}
              disabled={!form.customer_id}
            >
              <option value="">— بدون سرور —</option>
              {ownServers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="عنوان" hint="در فاکتور مشتری همین دیده می‌شود">
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="خرید ترافیک اضافه"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="مبلغ (تومان)">
            <input
              className="input ltr"
              value={form.amount_toman}
              onChange={(e) => setForm((f) => ({ ...f, amount_toman: e.target.value }))}
            />
          </Field>
          <Field label="مهلت پرداخت" hint="میلادی، مثل ۲۰۲۶-۰۹-۲۰. اختیاری.">
            <input
              className="input ltr"
              value={form.due_at}
              onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))}
              placeholder="2026-09-20"
            />
          </Field>
        </div>

        <Field label="یادداشت" hint="فقط برای شما؛ مشتری آن را نمی‌بیند">
          <input
            className="input"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </Field>

        <Notice type="warn">
          فاکتور دستی سرویس را تمدید نمی‌کند. تمدید فقط با فاکتور نوع «تمدید» انجام می‌شود که
          خودکار صادر می‌شود.
        </Notice>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button
            type="button"
            className="btn"
            onClick={save}
            disabled={busy || !form.customer_id || !form.title || !Number(form.amount_toman)}
          >
            {busy ? 'در حال ساخت…' : 'ساخت فاکتور'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
