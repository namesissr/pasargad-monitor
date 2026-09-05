'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalaliDay, formatToman, timeAgo } from '@/lib/format';

interface Order {
  id: number;
  number: string;
  status: 'pending' | 'paid' | 'provisioned' | 'canceled';
  product_name: string;
  price_toman: number;
  note: string | null;
  admin_note: string | null;
  paid_at: string | null;
  created_at: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_status: string | null;
  server_id: number | null;
  server_name: string | null;
}

interface Data {
  orders: Order[];
  totals: { awaiting: number; pending: number } | null;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'در انتظار پرداخت', cls: 'bg-line text-muted' },
  paid: { label: 'منتظر تحویل', cls: 'bg-amber/15 text-amber' },
  provisioned: { label: 'تحویل شد', cls: 'bg-ok/15 text-ok' },
  canceled: { label: 'لغو شده', cls: 'bg-line text-muted' },
};

const FILTERS = [
  ['', 'همه'],
  ['paid', 'منتظر تحویل'],
  ['pending', 'در انتظار پرداخت'],
  ['provisioned', 'تحویل‌شده'],
  ['canceled', 'لغو شده'],
] as const;

export default function OrdersPage() {
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useLoad<Data>(
    `/api/orders${status ? `?status=${status}` : ''}`,
    30_000,
  );
  const [provisioning, setProvisioning] = useState<Order | null>(null);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function cancel(o: Order) {
    if (!confirm(`سفارش ${o.number} لغو شود؟`)) return;
    setMsg(null);
    try {
      await api.patch('/api/orders', { id: o.id, action: 'cancel' });
      setMsg({ type: 'success', text: 'سفارش لغو شد.' });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'لغو ناموفق بود' });
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">سفارش‌ها</h1>
        <p className="text-xs text-muted mt-0.5">
          سرور اختصاصی خودکار ساخته نمی‌شود. سفارش پرداخت‌شده منتظر تحویل دستی شماست.
        </p>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {Number(data.totals?.awaiting) > 0 && (
        <Notice type="warn">
          {faNum(data.totals?.awaiting ?? 0)} سفارش پرداخت‌شده منتظر تحویل است.
        </Notice>
      )}

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

      {!data.orders.length ? (
        <Notice type="warn">سفارشی با این فیلتر نیست.</Notice>
      ) : (
        <div className="space-y-3">
          {data.orders.map((o) => {
            const st = STATUS[o.status] || STATUS.canceled;
            return (
              <div
                key={o.id}
                className={`card p-4 sm:p-5 ${o.status === 'paid' ? 'border-amber/40' : ''}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold">
                      {o.product_name}
                      <span className={`badge ms-2 ${st.cls}`}>{st.label}</span>
                    </h3>
                    <p className="text-[11px] text-muted mt-1">
                      <span className="ltr">{o.number}</span>
                      {' · '}
                      <Link href="/customers" className="hover:text-cyan">
                        {o.customer_name}
                      </Link>
                      {o.customer_phone && <span className="ltr"> · {o.customer_phone}</span>}
                    </p>
                    <p className="text-[11px] text-muted mt-0.5">
                      ثبت {formatJalaliDay(o.created_at)}
                      {o.paid_at && ` · پرداخت ${timeAgo(o.paid_at)}`}
                      {o.invoice_number && (
                        <>
                          {' · '}
                          <Link href="/invoices" className="hover:text-cyan ltr">
                            {o.invoice_number}
                          </Link>
                        </>
                      )}
                    </p>
                    {o.note && (
                      <p className="text-[11px] mt-2 p-2 rounded bg-panel2/60 leading-relaxed">
                        <span className="text-muted">یادداشت مشتری: </span>
                        {o.note}
                      </p>
                    )}
                    {o.admin_note && (
                      <p className="text-[11px] mt-1.5 text-muted leading-relaxed">
                        یادداشت داخلی: {o.admin_note}
                      </p>
                    )}
                    {o.server_name && (
                      <p className="text-[11px] mt-1.5 text-ok">
                        تحویل‌شده روی{' '}
                        <Link href={`/servers/${o.server_id}`} className="hover:underline">
                          {o.server_name}
                        </Link>
                      </p>
                    )}
                  </div>

                  <div className="text-end shrink-0">
                    <div className="text-sm font-bold">{formatToman(o.price_toman)}</div>
                    <div className="flex gap-2 mt-2 justify-end flex-wrap">
                      {o.status === 'paid' && (
                        <button
                          type="button"
                          className="btn-primary text-xs px-3 py-1.5"
                          onClick={() => setProvisioning(o)}
                        >
                          تحویل شد
                        </button>
                      )}
                      {(o.status === 'paid' || o.status === 'pending') && (
                        <button
                          type="button"
                          className="text-xs text-muted hover:text-danger px-2"
                          onClick={() => cancel(o)}
                        >
                          لغو
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {provisioning && (
        <ProvisionForm
          order={provisioning}
          onClose={() => setProvisioning(null)}
          onDone={(warning) => {
            setProvisioning(null);
            // هشدار یعنی ایمیل نرفته و رمزی که تایپ شده جایی نیست.
            // این باید مثل خطا دیده شود نه مثل موفقیت.
            setMsg(
              warning
                ? { type: 'error', text: warning }
                : { type: 'success', text: 'سفارش تحویل‌شده ثبت شد و مشخصات برای مشتری ایمیل شد.' },
            );
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * ثبت تحویل.
 *
 * وصل‌کردن سرور اختیاری است ولی توصیه می‌شود: بدون آن، بعدها معلوم
 * نیست کدام سرور بابت کدام سفارش تحویل شده.
 */
function ProvisionForm({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: (warning: string | null) => void;
}) {
  const servers = useLoad<{ servers: { id: number; name: string; customer_id: number | null }[] }>(
    '/api/servers',
  );
  const [serverId, setServerId] = useState('');
  const [adminNote, setAdminNote] = useState(order.admin_note ?? '');
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // فقط سرورهای همین مشتری، وگرنه سفارش به سرور کس دیگری وصل می‌شود
  const own = (servers.data?.servers ?? []).filter((s) => s.customer_id === order.customer_id);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (adminNote !== (order.admin_note ?? '')) {
        await api.patch('/api/orders', { id: order.id, action: 'note', admin_note: adminNote });
      }
      const res = await api.patch<{ emailSent: boolean; warning: string | null }>(
        '/api/orders',
        {
          id: order.id,
          action: 'provision',
          server_id: serverId ? Number(serverId) : null,
          username,
          password,
          delivery_note: deliveryNote,
        },
      );
      onDone(res.warning);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ثبت تحویل ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`تحویل سفارش ${order.number}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="card p-4 bg-panel2/40 text-xs space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-muted">محصول</span>
            <span>{order.product_name}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">مشتری</span>
            <span>{order.customer_name}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">مبلغ پرداخت‌شده</span>
            <span>{formatToman(order.price_toman)}</span>
          </div>
        </div>

        <Field
          label="سرور تحویل‌شده"
          hint={
            own.length
              ? 'فقط سرورهای همین مشتری. اول سرور را در بخش سرورها بسازید و به مشتری تخصیص دهید.'
              : 'این مشتری هنوز سروری ندارد. می‌توانید بعدا وصلش کنید.'
          }
        >
          <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">— بعدا وصل می‌کنم —</option>
            {own.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام کاربری" hint="در ایمیل تحویل می‌رود">
            <input
              className="input ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="گذرواژه" hint="در ایمیل می‌رود و هیچ‌جا ذخیره نمی‌شود">
            <input
              className="input ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="توضیح برای مشتری" hint="اختیاری؛ در همان ایمیل می‌رود">
          <textarea
            className="input"
            rows={2}
            value={deliveryNote}
            onChange={(e) => setDeliveryNote(e.target.value)}
            placeholder="پنل مدیریت روی پورت ۸۰۰۶ در دسترس است."
          />
        </Field>

        <Field label="یادداشت داخلی" hint="مشتری آن را نمی‌بیند">
          <textarea
            className="input"
            rows={2}
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
          />
        </Field>

        {password && (
          <Notice type="warn">
            گذرواژه <b>هیچ‌جا ذخیره نمی‌شود</b> و فقط در همین ایمیل می‌رود. اگر ایمیل نرسد،
            باید رمز را عوض کنید و دوباره بفرستید. پیامک عمدا رمز ندارد — پیامک رمزنگاری
            نمی‌شود و روی صفحه قفل گوشی هم پیش‌نمایش می‌شود.
          </Notice>
        )}

        {!serverId && (
          <Notice type="info">
            بدون انتخاب سرور، ایمیل فقط خبر تحویل می‌دهد و مشخصاتی ندارد. مشخصات — آی‌پی،
            سیستم عامل، پردازنده، حافظه و دیسک — از رکورد همان سرور خوانده می‌شود.
          </Notice>
        )}

        {!order.customer_email && (
          <Notice type="error">
            این مشتری ایمیل ندارد. مشخصات سرور جایی فرستاده نمی‌شود — اول ایمیلش را در بخش
            مشتریان ثبت کنید.
          </Notice>
        )}

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? 'در حال ثبت…' : 'ثبت تحویل'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
