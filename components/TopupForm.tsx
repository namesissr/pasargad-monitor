'use client';

import { useState } from 'react';
import { useLoad } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/**
 * فرم خرید ترافیک.
 *
 * دوره پرسیده نمی‌شود چون ترافیک انقضا ندارد. تاریخ خرید همان زمان ثبت
 * است و در تاریخچه می‌ماند.
 */
export function TopupForm({
  serverId,
  onClose,
  onDone,
}: {
  serverId?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const servers = useLoad<{ servers: { id: number; name: string }[] }>('/api/servers');
  const [form, setForm] = useState({
    server_id: serverId ? String(serverId) : '',
    gb: '',
    unit: 'TB',
    price_toman: '',
    note: '',
  });

  const amountGb = Number(form.gb) * (form.unit === 'TB' ? 1024 : 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.post('/api/topups', {
        server_id: Number(form.server_id),
        gb: amountGb,
        price_toman: form.price_toman,
        note: form.note,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ثبت خرید ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="خرید ترافیک" onClose={onClose}>
      <div className="space-y-4">
        {!serverId && (
          <Field label="سرور">
            <select
              className="input"
              value={form.server_id}
              onChange={(e) => setForm((f) => ({ ...f, server_id: e.target.value }))}
            >
              <option value="">— انتخاب کنید —</option>
              {(servers.data?.servers ?? []).map((sv) => (
                <option key={sv.id} value={sv.id}>{sv.name}</option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="مقدار"
            hint={
              form.gb && form.unit === 'TB'
                ? `${amountGb.toLocaleString('fa-IR')} گیگابایت`
                : 'برای اصلاح اشتباه، عدد منفی بزنید'
            }
          >
            <div className="flex gap-2">
              <input
                className="input ltr flex-1"
                value={form.gb}
                onChange={(e) => setForm((f) => ({ ...f, gb: e.target.value }))}
                placeholder="100"
              />
              <select
                className="input w-24"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              >
                <option value="TB">ترابایت</option>
                <option value="GB">گیگابایت</option>
              </select>
            </div>
          </Field>
          <Field label="مبلغ (تومان)" hint="اختیاری">
            <input
              className="input ltr"
              value={form.price_toman}
              onChange={(e) => setForm((f) => ({ ...f, price_toman: e.target.value }))}
            />
          </Field>
        </div>

        <Field label="توضیح" hint="مثلاً شماره فاکتور">
          <input
            className="input"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </Field>

        <Notice type="warn">
          این ترافیک انقضا ندارد و تا مصرف کامل باقی می‌ماند. با اولین خرید هر سرور، شمارش
          مصرف از همان روز شروع می‌شود. هشدار اتمام هم از نو مسلح می‌شود، پس اگر باز تمام شد
          دوباره خبر می‌رود.
        </Notice>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button
            type="button"
            className="btn"
            onClick={save}
            disabled={busy || !form.server_id || !Number(form.gb)}
          >
            {busy ? 'در حال ثبت…' : 'ثبت خرید'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
