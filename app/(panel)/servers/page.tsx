'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Mono, StatusBadge, Notice } from '@/components/ui';
import { InstallInstructions } from '@/components/InstallInstructions';
import { UsageBar } from '@/components/Chart';
import { api, ApiError } from '@/lib/api';
import {
  faNum,
  formatBytes,
  formatDuration,
  formatMbps,
  formatPercent,
  formatTB,
  timeAgo,
} from '@/lib/format';

interface ServerRow {
  id: number;
  name: string;
  hostname: string | null;
  main_ip: string;
  provider: string | null;
  location: string | null;
  datacenter_id: number | null;
  datacenter_name: string | null;
  os: string | null;
  cpu_cores: number | null;
  ram_total_bytes: number | null;
  disk_total_bytes: number | null;
  port_mbps: number | null;
  traffic_quota_gb: number | null;
  customer: string | null;
  status: string;
  last_seen_at: string | null;
  cpu_percent: number | null;
  ram_used_bytes: number | null;
  disk_used_bytes: number | null;
  rx_bps: number | null;
  tx_bps: number | null;
  uptime_sec: number | null;
  period_rx: number;
  period_tx: number;
  ip_count: number;
  open_incidents: number;
}

interface Datacenter {
  id: number;
  name: string;
}

interface ListData {
  servers: ServerRow[];
  period: { label: string; from: string; to: string };
}

const pct = (used: number | null, total: number | null) =>
  used && total && total > 0 ? (used / total) * 100 : 0;

export default function ServersPage() {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [datacenterId, setDatacenterId] = useState('all');

  // اگر از صفحه دیتاسنترها آمده‌ایم، فیلتر از آدرس خوانده می‌شود
  useEffect(() => {
    const dc = new URLSearchParams(window.location.search).get('datacenter_id');
    if (dc) setDatacenterId(dc);
  }, []);

  const url = `/api/servers?${new URLSearchParams({
    q,
    datacenter_id: datacenterId,
    ...(showAll ? { all: '1' } : {}),
  })}`;
  const { data, loading, error, reload } = useLoad<ListData>(url, 10_000);
  const dcs = useLoad<{ datacenters: Datacenter[] }>('/api/datacenters');

  // سرورها بر اساس دیتاسنتر گروه می‌شوند. ترتیب از خود کوئری می‌آید.
  const groups: { id: number | null; name: string; servers: ServerRow[] }[] = [];
  for (const srv of data?.servers ?? []) {
    const key = srv.datacenter_id ?? null;
    const last = groups[groups.length - 1];
    if (last && last.id === key) last.servers.push(srv);
    else groups.push({ id: key, name: srv.datacenter_name ?? 'بدون دیتاسنتر', servers: [srv] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">سرورها</h1>
          <p className="text-xs text-muted mt-0.5">مصرف ترافیک دوره {data?.period.label ?? ''}</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          + افزودن سرور
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          className="input max-w-xs"
          placeholder="جستجو: نام، آی‌پی، مشتری، دیتاسنتر"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input max-w-[200px]" value={datacenterId} onChange={(e) => setDatacenterId(e.target.value)}>
          <option value="all">همه دیتاسنترها</option>
          <option value="none">بدون دیتاسنتر</option>
          {(dcs.data?.datacenters ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          نمایش سرورهای بایگانی‌شده
        </label>
      </div>

      <LoadState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!!data && data.servers.length === 0}
        emptyText={q ? 'سروری با این جستجو پیدا نشد' : 'هنوز سروری اضافه نکرده‌اید. با دکمه بالا شروع کنید.'}
      >
        <div className="card table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>سرور</th>
                <th>وضعیت</th>
                <th>پردازنده</th>
                <th>حافظه</th>
                <th>دیسک</th>
                <th>ترافیک لحظه‌ای</th>
                <th>مصرف دوره</th>
                <th>آپ‌تایم</th>
                <th>آی‌پی</th>
              </tr>
            </thead>
            {groups.map((group) => (
            <tbody key={String(group.id ?? 'none')}>
              <tr className="bg-panel2/70">
                <td colSpan={9} className="!py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-xs flex items-center gap-2">
                      <span className="text-cyan">⬡</span>
                      {group.id ? (
                        <Link href="/datacenters" className="hover:text-cyan">{group.name}</Link>
                      ) : (
                        <span className="text-amber">{group.name}</span>
                      )}
                      <span className="text-muted font-normal">({faNum(group.servers.length)} سرور)</span>
                    </span>
                    <span className="text-[11px] text-muted">
                      مصرف دوره:{' '}
                      {formatTB(
                        group.servers.reduce((a, x) => a + Number(x.period_rx ?? 0) + Number(x.period_tx ?? 0), 0),
                      )}
                      {group.servers.some((x) => x.status === 'down') && (
                        <span className="text-danger">
                          {' '}· {faNum(group.servers.filter((x) => x.status === 'down').length)} قطع
                        </span>
                      )}
                    </span>
                  </div>
                </td>
              </tr>
              {group.servers.map((s) => {
                const ramPct = pct(s.ram_used_bytes, s.ram_total_bytes);
                const diskPct = pct(s.disk_used_bytes, s.disk_total_bytes);
                const used = Number(s.period_rx ?? 0) + Number(s.period_tx ?? 0);
                const quota = Number(s.traffic_quota_gb ?? 0) * Math.pow(1024, 3);

                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/servers/${s.id}`} className="hover:text-cyan">
                        <span className="font-medium">{s.name}</span>
                        <br />
                        <Mono className="text-muted">{s.main_ip}</Mono>
                        {s.location && <span className="text-[11px] text-muted"> · {s.location}</span>}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                      {s.open_incidents > 0 && (
                        <span className="badge bg-danger/15 text-danger ms-1">{faNum(s.open_incidents)}</span>
                      )}
                    </td>
                    <td className="w-28">
                      {s.status === 'up' ? (
                        <UsageBar percent={Number(s.cpu_percent ?? 0)} right={formatPercent(Number(s.cpu_percent ?? 0), 0)} label=" " />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="w-28">
                      {s.status === 'up' ? (
                        <>
                          <UsageBar percent={ramPct} right={formatPercent(ramPct, 0)} label=" " />
                          <span className="text-[10px] text-muted">{formatBytes(s.ram_total_bytes, 0)}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="w-28">
                      {s.status === 'up' ? (
                        <>
                          <UsageBar percent={diskPct} right={formatPercent(diskPct, 0)} label=" " />
                          <span className="text-[10px] text-muted">{formatBytes(s.disk_total_bytes, 0)}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      <span className="text-cyan">↓</span> {formatMbps(s.rx_bps)}
                      <br />
                      <span className="text-amber">↑</span> {formatMbps(s.tx_bps)}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {formatTB(used)}
                      {quota > 0 && (
                        <>
                          <br />
                          <span className={`text-[10px] ${used / quota > 0.9 ? 'text-danger' : 'text-muted'}`}>
                            از {formatTB(quota, 1)} · {formatPercent((used / quota) * 100, 0)}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {s.status === 'up' ? formatDuration(s.uptime_sec) : timeAgo(s.last_seen_at)}
                    </td>
                    <td className="text-xs">{faNum(s.ip_count)}</td>
                  </tr>
                );
              })}
            </tbody>
            ))}
          </table>
        </div>
      </LoadState>

      <AddServerModal
        open={adding}
        onClose={() => setAdding(false)}
        onDone={reload}
        datacenters={dcs.data?.datacenters ?? []}
      />
    </div>
  );
}

/** فرم افزودن سرور — پس از ثبت، دستور نصب ایجنت نشان داده می‌شود */
function AddServerModal({
  open,
  onClose,
  onDone,
  datacenters,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  datacenters: Datacenter[];
}) {
  const [form, setForm] = useState({
    name: '',
    main_ip: '',
    hostname: '',
    datacenter_id: '',
    location: '',
    customer: '',
    ssh_port: '22',
    port_mbps: '1000',
    traffic_quota_gb: '0',
    monthly_cost: '0',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: number; token: string } | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await api.post<{ id: number; agent_token: string }>('/api/servers', {
        ...form,
        datacenter_id: form.datacenter_id ? Number(form.datacenter_id) : null,
        ssh_port: Number(form.ssh_port) || 22,
        port_mbps: Number(form.port_mbps) || 1000,
        traffic_quota_gb: Number(form.traffic_quota_gb) || 0,
        monthly_cost: Number(form.monthly_cost) || 0,
      });
      setCreated({ id: res.id, token: res.agent_token });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'ثبت سرور انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setCreated(null);
    setForm({ ...form, name: '', main_ip: '', hostname: '', customer: '' });
    onClose();
  }

  return (
    <Modal open={open} title={created ? 'سرور ثبت شد — حالا ایجنت را نصب کنید' : 'افزودن سرور اختصاصی'} onClose={close} wide>
      {created ? (
        <InstallInstructions token={created.token} serverId={created.id} onClose={close} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="نام سرور *">
              <input className="input" value={form.name} onChange={set('name')} placeholder="مثلا: DE-Hetzner-01" />
            </Field>
            <Field label="آی‌پی اصلی *" hint="این آی‌پی خودکار در فهرست آی‌پی‌ها ثبت می‌شود">
              <input className="input ltr" value={form.main_ip} onChange={set('main_ip')} placeholder="185.1.2.3" />
            </Field>
            <Field label="نام میزبان">
              <input className="input ltr" value={form.hostname} onChange={set('hostname')} placeholder="srv01.example.com" />
            </Field>
            <Field label="پورت SSH" hint="برای بررسی سلامت وقتی ایجنت خبر نمی‌دهد">
              <input className="input ltr" value={form.ssh_port} onChange={set('ssh_port')} />
            </Field>
            <Field
              label="دیتاسنتر *"
              hint={
                datacenters.length
                  ? 'قیمت ترافیک و آی‌پی از همین دیتاسنتر ارث می‌رسد'
                  : 'هنوز دیتاسنتری نساخته‌اید — بدون آن هزینه محاسبه نمی‌شود'
              }
            >
              <select className="input" value={form.datacenter_id} onChange={set('datacenter_id')}>
                <option value="">انتخاب نشده</option>
                {datacenters.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="موقعیت">
              <input className="input" value={form.location} onChange={set('location')} placeholder="فالکنشتاین آلمان" />
            </Field>
            <Field label="مشتری">
              <input className="input" value={form.customer} onChange={set('customer')} />
            </Field>
            <Field label="ظرفیت پورت (مگابیت)">
              <input className="input ltr" value={form.port_mbps} onChange={set('port_mbps')} />
            </Field>
            <Field label="سهمیه ترافیک ماهانه (گیگابایت)" hint="صفر یعنی نامحدود">
              <input className="input ltr" value={form.traffic_quota_gb} onChange={set('traffic_quota_gb')} />
            </Field>
            <Field label="هزینه ماهانه (تومان)">
              <input className="input ltr" value={form.monthly_cost} onChange={set('monthly_cost')} />
            </Field>
          </div>

          <Field label="یادداشت">
            <textarea className="input h-20 resize-none" value={form.notes} onChange={set('notes')} />
          </Field>

          {err && <Notice type="error">{err}</Notice>}

          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={close}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !form.name || !form.main_ip}>
              {busy ? 'در حال ثبت…' : 'ثبت سرور'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
