'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Mono, Notice, StatusBadge } from '@/components/ui';
import { UsageBar } from '@/components/Chart';
import { api, ApiError } from '@/lib/api';
import { faNum, formatBps, formatDuration, timeAgo } from '@/lib/format';

interface SwitchRow {
  id: number;
  name: string;
  url: string;
  username: string;
  insecure_tls: boolean;
  datacenter_id: number | null;
  datacenter_name: string | null;
  location: string | null;
  notes: string | null;
  is_active: boolean;
  hostname: string | null;
  model: string | null;
  serial: string | null;
  os_version: string | null;
  uptime_sec: number | null;
  status: string;
  last_seen_at: string | null;
  last_poll_at: string | null;
  last_poll_ms: number | null;
  last_error: string | null;
  fail_streak: number;
  cpu_percent: number | null;
  mem_used_bytes: number | null;
  mem_total_bytes: number | null;
  load1: number | null;
  max_temp_c: number | null;
  env_ok: boolean | null;
  has_password: boolean;
  ports_total: number;
  ports_up: number;
  ports_down: number;
  ports_shut: number;
  ports_linked: number;
  in_bps: number;
  out_bps: number;
  open_incidents: number;
}

interface ListData {
  switches: SwitchRow[];
  datacenters: { id: number; name: string }[];
}

export default function SwitchesPage() {
  const { data, loading, error, reload } = useLoad<ListData>('/api/switches', 15_000);
  const [editing, setEditing] = useState<SwitchRow | 'new' | null>(null);

  // داده قبلی در خطای بارگذاری دوره‌ای می‌ماند؛ فقط بار اول کل صفحه
  // جایش را به حالت بارگذاری می‌دهد
  if (!data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">سوییچ‌ها</h1>
          <p className="text-xs text-muted mt-1">
            Cisco Nexus از راه NX-API: مصرف و وضعیت هر پورت، منابع و سخت‌افزار خود سوییچ، و
            خاموش و روشن کردن پورت. راهنمای آماده‌سازی سوییچ در docs/switches.md است.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          افزودن سوییچ
        </button>
      </div>

      {error && <Notice type="warn">به‌روزرسانی انجام نشد: {error}</Notice>}

      {data.switches.length === 0 ? (
        <div className="card p-8 text-center space-y-2">
          <p className="text-sm">هنوز سوییچی تعریف نشده است.</p>
          <p className="text-xs text-muted">
            روی سوییچ <Mono>feature nxapi</Mono> را روشن کنید، یک کاربر بسازید، و سوییچ را با آدرس
            مدیریتش اینجا اضافه کنید. ظرف نیم دقیقه پورت‌ها ظاهر می‌شوند — یا پیام خطا می‌گوید چه
            چیزی کم است.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.switches.map((sw) => (
            <SwitchCard key={sw.id} sw={sw} onEdit={() => setEditing(sw)} />
          ))}
        </div>
      )}

      {editing && (
        <SwitchForm
          sw={editing === 'new' ? null : editing}
          datacenters={data.datacenters}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function SwitchCard({ sw, onEdit }: { sw: SwitchRow; onEdit: () => void }) {
  const memPct =
    sw.mem_total_bytes && sw.mem_used_bytes !== null ? (sw.mem_used_bytes / sw.mem_total_bytes) * 100 : null;
  const never = !sw.last_poll_at;

  return (
    <div className={`card p-4 space-y-3 ${sw.is_active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/switches/${sw.id}`} className="font-bold hover:text-cyan truncate block">
            {sw.name}
          </Link>
          <p className="text-[11px] text-muted truncate mt-0.5">
            {[sw.model, sw.os_version && `NX-OS ${sw.os_version}`, sw.datacenter_name].filter(Boolean).join(' · ') ||
              'هنوز خوانده نشده'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!sw.is_active ? (
            <span className="badge border bg-line text-muted border-line">غیرفعال</span>
          ) : (
            <StatusBadge status={sw.status} />
          )}
        </div>
      </div>

      {sw.last_error && (
        <Notice type={sw.status === 'down' ? 'error' : 'warn'}>
          {sw.status === 'down' ? 'دسترسی نیست: ' : ''}
          {sw.last_error}
        </Notice>
      )}
      {never && sw.is_active && !sw.last_error && (
        <Notice type="info">در انتظار اولین خواندن — حداکثر نیم دقیقه.</Notice>
      )}

      {!never && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <UsageBar percent={sw.cpu_percent ?? 0} label="پردازنده" />
            <UsageBar percent={memPct ?? 0} label="حافظه" />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="پورت فعال" value={`${faNum(sw.ports_up)}/${faNum(sw.ports_total)}`} />
            <Stat label="ورودی" value={formatBps(sw.in_bps)} />
            <Stat label="خروجی" value={formatBps(sw.out_bps)} />
          </div>

          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {sw.ports_down > 0 && (
              <span className="badge border bg-danger/10 text-danger border-danger/30">
                {faNum(sw.ports_down)} پورت قطع
              </span>
            )}
            {sw.ports_shut > 0 && (
              <span className="badge border bg-amber/10 text-amber border-amber/30">
                {faNum(sw.ports_shut)} خاموش (shut)
              </span>
            )}
            {sw.ports_linked > 0 && (
              <span className="badge border bg-cyan/10 text-cyan border-cyan/30">
                {faNum(sw.ports_linked)} وصل به سرور
              </span>
            )}
            {sw.env_ok === false && (
              <span className="badge border bg-danger/15 text-danger border-danger/30">مشکل سخت‌افزار</span>
            )}
            {sw.max_temp_c !== null && (
              <span className="badge border bg-line text-muted border-line">دما {faNum(Math.round(sw.max_temp_c))}°C</span>
            )}
            {sw.open_incidents > 0 && (
              <span className="badge border bg-danger/15 text-danger border-danger/30">
                {faNum(sw.open_incidents)} رویداد باز
              </span>
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-between text-[11px] text-muted pt-1 border-t border-line">
        <span>
          {sw.uptime_sec ? `روشن از ${formatDuration(sw.uptime_sec)} پیش` : <Mono>{sw.url}</Mono>}
        </span>
        <span className="flex items-center gap-3">
          <span title={sw.last_poll_at ?? ''}>{sw.last_poll_at ? timeAgo(sw.last_poll_at) : '—'}</span>
          <button type="button" className="hover:text-white" onClick={onEdit}>
            ویرایش
          </button>
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel2 rounded-lg py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="text-xs font-bold mt-0.5 ltr">{value}</p>
    </div>
  );
}

function SwitchForm({
  sw,
  datacenters,
  onClose,
  onSaved,
}: {
  sw: SwitchRow | null;
  datacenters: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: sw?.name ?? '',
    url: sw?.url ?? 'https://',
    username: sw?.username ?? '',
    password: '',
    insecure_tls: sw?.insecure_tls ?? true,
    datacenter_id: sw?.datacenter_id ? String(sw.datacenter_id) : '',
    location: sw?.location ?? '',
    notes: sw?.notes ?? '',
    is_active: sw?.is_active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: 'name' | 'url' | 'username' | 'password' | 'datacenter_id' | 'location' | 'notes') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const body = { ...form, datacenter_id: form.datacenter_id || null };
      if (sw) await api.patch('/api/switches', { id: sw.id, ...body });
      else await api.post('/api/switches', body);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!sw) return;
    if (
      !confirm(
        `سوییچ «${sw.name}» و همه تاریخچه پورت‌هایش حذف شود؟\n` +
          'سرورهایی که ترافیکشان از این سوییچ شمرده می‌شد به عدد ایجنت برمی‌گردند. ' +
          'اگر فقط موقتا نمی‌خواهید خوانده شود، «غیرفعال» کنید.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.del(`/api/switches?id=${sw.id}`);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'حذف انجام نشد');
      setBusy(false);
    }
  }

  return (
    <Modal open title={sw ? `ویرایش ${sw.name}` : 'افزودن سوییچ'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="نام">
          <input className="input" value={form.name} onChange={set('name')} placeholder="N9K-Core-1" />
        </Field>
        <Field
          label="آدرس NX-API"
          hint="آی‌پی مدیریت (mgmt0) سوییچ. اگر پورت NX-API را عوض کرده‌اید، پورت را هم بنویسید."
        >
          <input className="input ltr" value={form.url} onChange={set('url')} placeholder="https://10.0.0.5" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام کاربری سوییچ">
            <input className="input ltr" value={form.username} onChange={set('username')} autoComplete="off" />
          </Field>
          <Field
            label="گذرواژه"
            hint={sw ? 'خالی یعنی بدون تغییر. با تغییر آدرس یا نام کاربری باید دوباره وارد شود.' : undefined}
          >
            <input
              className="input ltr"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              placeholder={sw?.has_password ? '••••••••' : ''}
            />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.insecure_tls}
            onChange={(e) => setForm((f) => ({ ...f, insecure_tls: e.target.checked }))}
          />
          <span>
            پذیرش گواهی خودامضا
            <span className="block text-muted mt-0.5">
              گواهی پیش‌فرض NX-API خودامضاست. اگر گواهی معتبر روی سوییچ نصب کرده‌اید خاموشش کنید.
            </span>
          </span>
        </label>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="دیتاسنتر">
            <select className="input" value={form.datacenter_id} onChange={set('datacenter_id')}>
              <option value="">—</option>
              {datacenters.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="محل (رک، ردیف)">
            <input className="input" value={form.location} onChange={set('location')} />
          </Field>
        </div>
        <Field label="یادداشت">
          <textarea className="input min-h-[60px]" value={form.notes} onChange={set('notes')} />
        </Field>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          />
          فعال — خوانده شود و هشدار بدهد
        </label>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {sw ? (
            <button type="button" className="btn-danger" onClick={remove} disabled={busy}>
              حذف
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              انصراف
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>
              {busy ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
