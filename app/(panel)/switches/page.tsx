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
  protocol: 'nxapi' | 'snmp';
  url: string | null;
  username: string | null;
  insecure_tls: boolean;
  snmp_version: '2c' | '3' | null;
  snmp_host: string | null;
  snmp_port: number;
  snmp_user: string | null;
  snmp_auth_proto: string;
  snmp_priv_proto: string;
  snmp_write: boolean;
  vendor: string | null;
  config_transfer: 'none' | 'sftp' | 'tftp';
  has_community: boolean;
  has_write_community: boolean;
  has_auth_pass: boolean;
  has_priv_pass: boolean;
  can_write: boolean;
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
            Cisco Nexus از راه NX-API، یا هر برندی با SNMP v2c و v3: مصرف و وضعیت هر پورت، منابع و
            سخت‌افزار خود سوییچ، همسایه‌ها و MACها، پشتیبان پیکربندی، و خاموش و روشن کردن پورت. راهنما در
            docs/switches.md است.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/switches/report" className="btn-ghost">
            گزارش پورت‌ها
          </Link>
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            افزودن سوییچ
          </button>
        </div>
      </div>

      {error && <Notice type="warn">به‌روزرسانی انجام نشد: {error}</Notice>}

      {data.switches.length === 0 ? (
        <div className="card p-8 text-center space-y-2">
          <p className="text-sm">هنوز سوییچی تعریف نشده است.</p>
          <p className="text-xs text-muted">
            روی سوییچ NX-API (<Mono>feature nxapi</Mono>) یا SNMP را روشن کنید و سوییچ را با آدرس
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
            {[sw.model, versionLabel(sw), sw.datacenter_name].filter(Boolean).join(' · ') || 'هنوز خوانده نشده'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="badge border bg-line text-muted border-line" title={sw.can_write ? 'خاموش و روشن کردن پورت از پنل ممکن است' : 'فقط پایش'}>
            {protocolLabel(sw)}
            {!sw.can_write && ' · فقط خواندن'}
          </span>
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
          {sw.uptime_sec ? `روشن از ${formatDuration(sw.uptime_sec)} پیش` : <Mono>{addressOf(sw)}</Mono>}
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

function protocolLabel(sw: SwitchRow) {
  return sw.protocol === 'snmp' ? `SNMP v${sw.snmp_version}` : 'NX-API';
}

function versionLabel(sw: SwitchRow) {
  if (!sw.os_version) return null;
  return sw.protocol === 'nxapi' || sw.vendor === 'cisco' ? `NX-OS / IOS ${sw.os_version}` : sw.os_version;
}

function addressOf(sw: SwitchRow) {
  return sw.protocol === 'snmp' ? `${sw.snmp_host}:${sw.snmp_port}` : sw.url ?? '';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel2 rounded-lg py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="text-xs font-bold mt-0.5 ltr">{value}</p>
    </div>
  );
}

type Mode = 'nxapi' | 'snmp2c' | 'snmp3';

const AUTH_OPTIONS = [
  ['sha', 'SHA-1'],
  ['sha256', 'SHA-256'],
  ['sha384', 'SHA-384'],
  ['sha512', 'SHA-512'],
  ['sha224', 'SHA-224'],
  ['md5', 'MD5 (قدیمی)'],
  ['none', 'بدون احراز هویت (noAuthNoPriv)'],
];

const PRIV_OPTIONS = [
  ['aes', 'AES-128'],
  ['aes256b', 'AES-256 (سیسکو)'],
  ['aes256r', 'AES-256 (بقیه برندها)'],
  ['des', 'DES (قدیمی)'],
  ['none', 'بدون رمزنگاری (authNoPriv)'],
];

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
  const initialMode: Mode = !sw || sw.protocol === 'nxapi' ? 'nxapi' : sw.snmp_version === '3' ? 'snmp3' : 'snmp2c';
  const [form, setForm] = useState({
    name: sw?.name ?? '',
    mode: initialMode,
    url: sw?.url ?? 'https://',
    username: sw?.username ?? '',
    password: '',
    insecure_tls: sw?.insecure_tls ?? true,
    snmp_host: sw?.snmp_host ?? '',
    snmp_port: String(sw?.snmp_port ?? 161),
    snmp_community: '',
    snmp_write_community: '',
    clear_write_community: false,
    snmp_user: sw?.snmp_user ?? '',
    snmp_auth_proto: sw?.snmp_auth_proto ?? 'sha',
    snmp_auth_pass: '',
    snmp_priv_proto: sw?.snmp_priv_proto ?? 'aes',
    snmp_priv_pass: '',
    snmp_write: sw?.snmp_write ?? false,
    config_transfer: sw?.config_transfer ?? 'none',
    datacenter_id: sw?.datacenter_id ? String(sw.datacenter_id) : '',
    location: sw?.location ?? '',
    notes: sw?.notes ?? '',
    is_active: sw?.is_active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  type TextKey =
    | 'name' | 'url' | 'username' | 'password' | 'datacenter_id' | 'location' | 'notes'
    | 'snmp_host' | 'snmp_port' | 'snmp_community' | 'snmp_write_community' | 'snmp_user'
    | 'snmp_auth_proto' | 'snmp_auth_pass' | 'snmp_priv_proto' | 'snmp_priv_pass';
  const set = (k: TextKey) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // رازهای ذخیره‌شده فقط وقتی «خالی یعنی بدون تغییر» معنا دارند که همان نوع
  // اتصال باشد
  const sameMode = sw !== null && initialMode === form.mode;
  const keep = (has: boolean | undefined) => (sameMode && has ? '••••••••  (بدون تغییر)' : '');

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        protocol: form.mode === 'nxapi' ? 'nxapi' : 'snmp',
        url: form.url,
        username: form.username,
        password: form.password,
        insecure_tls: form.insecure_tls,
        snmp_version: form.mode === 'snmp3' ? '3' : '2c',
        snmp_host: form.snmp_host,
        snmp_port: form.snmp_port,
        snmp_community: form.snmp_community,
        snmp_write_community: form.snmp_write_community,
        clear_write_community: form.clear_write_community,
        snmp_user: form.snmp_user,
        snmp_auth_proto: form.snmp_auth_proto,
        snmp_auth_pass: form.snmp_auth_pass,
        snmp_priv_proto: form.snmp_auth_proto === 'none' ? 'none' : form.snmp_priv_proto,
        snmp_priv_pass: form.snmp_priv_pass,
        snmp_write: form.snmp_write,
        config_transfer: form.config_transfer,
        datacenter_id: form.datacenter_id || null,
        location: form.location,
        notes: form.notes,
        is_active: form.is_active,
      };
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

  const MODES: { key: Mode; label: string; hint: string }[] = [
    { key: 'nxapi', label: 'NX-API', hint: 'Cisco Nexus' },
    { key: 'snmp2c', label: 'SNMP v2c', hint: 'هر برند' },
    { key: 'snmp3', label: 'SNMP v3', hint: 'هر برند، امن' },
  ];

  return (
    <Modal open title={sw ? `ویرایش ${sw.name}` : 'افزودن سوییچ'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="نام">
          <input className="input" value={form.name} onChange={set('name')} placeholder="N9K-Core-1" />
        </Field>

        <div>
          <p className="label">روش اتصال</p>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setForm((f) => ({ ...f, mode: m.key }))}
                className={`rounded-lg border px-2 py-2 text-xs transition-colors ${
                  form.mode === m.key ? 'bg-cyan/10 text-cyan border-cyan/40' : 'border-line text-muted hover:text-white'
                }`}
              >
                <span className="block font-bold">{m.label}</span>
                <span className="block text-[10px] opacity-80 mt-0.5">{m.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {form.mode === 'nxapi' && (
          <>
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
              <Field label="گذرواژه" hint={sw ? 'خالی یعنی بدون تغییر. با تغییر آدرس یا نام کاربری باید دوباره وارد شود.' : undefined}>
                <input
                  className="input ltr"
                  type="password"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete="new-password"
                  placeholder={keep(sw?.has_password)}
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
          </>
        )}

        {form.mode !== 'nxapi' && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field label="آی‌پی سوییچ" hint="آی‌پی مدیریت یا هر آی‌پی‌ای که SNMP روی آن جواب می‌دهد">
                <input className="input ltr" value={form.snmp_host} onChange={set('snmp_host')} placeholder="10.0.0.5" />
              </Field>
            </div>
            <Field label="پورت UDP">
              <input className="input ltr" value={form.snmp_port} onChange={set('snmp_port')} />
            </Field>
          </div>
        )}

        {form.mode === 'snmp2c' && (
          <>
            <Field label="کامیونیتی خواندنی (read-only)" hint={sw ? 'خالی یعنی بدون تغییر' : undefined}>
              <input
                className="input ltr"
                type="password"
                value={form.snmp_community}
                onChange={set('snmp_community')}
                autoComplete="new-password"
                placeholder={keep(sw?.has_community)}
              />
            </Field>
            <Field
              label="کامیونیتی نوشتنی (اختیاری)"
              hint="فقط اگر می‌خواهید پورت را از پنل shut/no shut کنید. خالی = سوییچ فقط پایش می‌شود."
            >
              <input
                className="input ltr"
                type="password"
                value={form.snmp_write_community}
                onChange={set('snmp_write_community')}
                autoComplete="new-password"
                placeholder={keep(sw?.has_write_community)}
              />
            </Field>
            {sameMode && sw?.has_write_community && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.clear_write_community}
                  onChange={(e) => setForm((f) => ({ ...f, clear_write_community: e.target.checked }))}
                />
                حذف کامیونیتی نوشتنی — سوییچ فقط پایش شود
              </label>
            )}
            {(form.snmp_write_community || (sameMode && sw?.has_write_community && !form.clear_write_community)) && (
              <Notice type="warn">
                کامیونیتی v2c بی‌رمز در هر بسته می‌رود و هرکس آن را ببیند می‌تواند پورت خاموش کند. برای نوشتن،
                SNMPv3 با رمزنگاری امن‌تر است؛ دست‌کم دسترسی SNMP را با ACL فقط به آی‌پی سرور پنل محدود کنید.
              </Notice>
            )}
          </>
        )}

        {form.mode === 'snmp3' && (
          <>
            <Field label="نام کاربر SNMPv3">
              <input className="input ltr" value={form.snmp_user} onChange={set('snmp_user')} autoComplete="off" />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="احراز هویت">
                <select className="input" value={form.snmp_auth_proto} onChange={set('snmp_auth_proto')}>
                  {AUTH_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="گذرواژه احراز هویت" hint="دست‌کم ۸ نویسه">
                <input
                  className="input ltr"
                  type="password"
                  value={form.snmp_auth_pass}
                  onChange={set('snmp_auth_pass')}
                  autoComplete="new-password"
                  disabled={form.snmp_auth_proto === 'none'}
                  placeholder={keep(sw?.has_auth_pass)}
                />
              </Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="رمزنگاری">
                <select
                  className="input"
                  value={form.snmp_auth_proto === 'none' ? 'none' : form.snmp_priv_proto}
                  onChange={set('snmp_priv_proto')}
                  disabled={form.snmp_auth_proto === 'none'}
                >
                  {PRIV_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="گذرواژه رمزنگاری" hint="دست‌کم ۸ نویسه">
                <input
                  className="input ltr"
                  type="password"
                  value={form.snmp_priv_pass}
                  onChange={set('snmp_priv_pass')}
                  autoComplete="new-password"
                  disabled={form.snmp_auth_proto === 'none' || form.snmp_priv_proto === 'none'}
                  placeholder={keep(sw?.has_priv_pass)}
                />
              </Field>
            </div>
            {(form.snmp_auth_proto === 'none' || form.snmp_priv_proto === 'none') && (
              <Notice type="warn">
                بدون رمزنگاری، محتوای SNMP — از جمله فرمان خاموش کردن پورت — روی شبکه خوانا می‌رود.
              </Notice>
            )}
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.snmp_write}
                onChange={(e) => setForm((f) => ({ ...f, snmp_write: e.target.checked }))}
              />
              <span>
                اجازه نوشتن — shut/no shut، توضیح پورت، و با انتقال فایل، محدودیت سرعت و پشتیبان
                <span className="block text-muted mt-0.5">
                  کاربر روی سوییچ باید write-view داشته باشد. بدون این تیک سوییچ فقط پایش می‌شود.
                </span>
              </span>
            </label>
          </>
        )}

        {form.mode !== 'nxapi' && (
          <>
            <Field
              label="انتقال فایل پیکربندی (فقط سیسکو)"
              hint="برای محدودیت سرعت (نکسوس) و پشتیبان پیکربندی با SNMP: سوییچ فایل را از سرور پنل برمی‌دارد یا به آن می‌فرستد. نشانی سرور پنل و کاربر SFTP در تنظیمات ← پایش."
            >
              <select
                className="input"
                value={form.config_transfer}
                onChange={(e) => setForm((f) => ({ ...f, config_transfer: e.target.value as 'none' | 'sftp' | 'tftp' }))}
              >
                <option value="none">ندارد</option>
                <option value="sftp">SFTP — رمزنگاری‌شده (پیشنهادی)</option>
                <option value="tftp">TFTP — بی‌رمز</option>
              </select>
            </Field>
            {form.config_transfer === 'tftp' && (
              <Notice type="warn">
                با TFTP پیکربندی سوییچ — با هش گذرواژه‌ها و کامیونیتی‌ها — روی شبکه مدیریت بی‌رمز منتقل می‌شود. اگر
                سوییچ SFTP دارد، آن را انتخاب کنید.
              </Notice>
            )}
            {form.config_transfer !== 'none' && !(form.mode === 'snmp3' ? form.snmp_write : form.snmp_write_community || (sameMode && sw?.has_write_community && !form.clear_write_community)) && (
              <Notice type="info">انتقال فایل با SNMP SET راه می‌افتد و بدون اجازه نوشتن کار نمی‌کند.</Notice>
            )}
          </>
        )}

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
