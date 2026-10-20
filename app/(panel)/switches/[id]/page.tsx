'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Chart, UsageBar } from '@/components/Chart';
import { Field, Modal, Mono, Notice, StatCard, StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  faNum,
  formatBps,
  formatBytes,
  formatDuration,
  formatJalaliDay,
  formatJalaliTime,
  formatPercent,
  timeAgo,
  INCIDENT_KIND_LABEL,
} from '@/lib/format';

interface Transceiver {
  type: string | null;
  vendor: string | null;
  part: string | null;
  serial: string | null;
  temp_c: number | null;
  tx_dbm: number | null;
  rx_dbm: number | null;
  rx_warn_lo: number | null;
  rx_low: boolean;
}

interface Port {
  id: number;
  name: string;
  kind: string;
  description: string | null;
  admin_up: boolean | null;
  oper_up: boolean | null;
  oper_reason: string | null;
  speed_mbps: number | null;
  mtu: number | null;
  mode: string | null;
  vlan: string | null;
  mac: string | null;
  member_of: string | null;
  hw_type: string | null;
  xcvr_type: string | null;
  last_flap: string | null;
  in_bps: number;
  out_bps: number;
  in_errors: number | null;
  out_errors: number | null;
  crc_errors: number | null;
  in_discards: number | null;
  out_discards: number | null;
  transceiver: Transceiver | null;
  server_id: number | null;
  server_name: string | null;
  server_ip: string | null;
  customer_name: string | null;
  count_traffic: boolean;
  count_since: string | null;
  is_protected: boolean;
  alert_down: boolean;
  note: string | null;
  is_present: boolean;
  last_change_at: string | null;
  counters_at: string | null;
  today_in: number;
  today_out: number;
  month_in: number;
  month_out: number;
  month_errors: number;
  has_incident: boolean;
  pending_action: string | null;
}

interface EnvItem {
  name: string;
  status?: string | null;
  ok: boolean;
  absent?: boolean;
  current?: number | null;
  major?: number | null;
  model?: string | null;
  direction?: string | null;
  output_w?: number | null;
  capacity_w?: number | null;
}

interface SwitchInfo {
  id: number;
  name: string;
  protocol: 'nxapi' | 'snmp';
  url: string | null;
  snmp_version: string | null;
  snmp_host: string | null;
  snmp_port: number;
  vendor: string | null;
  can_write: boolean;
  can_save: boolean;
  datacenter_name: string | null;
  location: string | null;
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
  cpu_percent: number | null;
  mem_used_bytes: number | null;
  mem_total_bytes: number | null;
  load1: number | null;
  max_temp_c: number | null;
  env: { temps: EnvItem[]; fans: EnvItem[]; psus: EnvItem[]; problems: string[] } | null;
  env_ok: boolean | null;
  env_checked_at: string | null;
}

interface ActionRow {
  id: number;
  port_id: number | null;
  port_name: string;
  action: string;
  save_config: boolean;
  reason: string | null;
  status: string;
  requested_by_name: string | null;
  requested_at: string;
  finished_at: string | null;
  result: string | null;
}

interface IncidentRow {
  id: number;
  kind: string;
  severity: string;
  message: string;
  started_at: string;
  switch_port_id: number | null;
}

interface Detail {
  switch: SwitchInfo;
  ports: Port[];
  actions: ActionRow[];
  incidents: IncidentRow[];
  period: { label: string; from: string; to: string };
}

const RANGES = [
  { key: '1h', label: '۱ ساعت' },
  { key: '6h', label: '۶ ساعت' },
  { key: '24h', label: '۲۴ ساعت' },
  { key: '7d', label: '۷ روز' },
  { key: '30d', label: '۳۰ روز' },
  { key: '90d', label: '۳ ماه' },
];

const IN_COLOR = '#3ED6C5';
const OUT_COLOR = '#F2B44C';

const ACTION_LABEL: Record<string, string> = { shutdown: 'خاموش (shutdown)', no_shutdown: 'روشن (no shutdown)' };
const ACTION_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'در صف', cls: 'bg-line text-muted border-line' },
  running: { label: 'در حال اجرا', cls: 'bg-cyan/10 text-cyan border-cyan/30' },
  done: { label: 'انجام شد', cls: 'bg-ok/10 text-ok border-ok/30' },
  failed: { label: 'ناموفق', cls: 'bg-danger/10 text-danger border-danger/30' },
};

// رشته زمان از سرور در منطقه زمانی گزارش آمده؛ از Date عبور نمی‌کند
const timeLabel = (t: string) => {
  if (!t) return '';
  if (t.length <= 10) return formatJalaliDay(t);
  return faNum(t.slice(11, 16));
};

const speedLabel = (mbps: number | null) => {
  if (!mbps) return '—';
  return mbps >= 1000 ? `${faNum(+(mbps / 1000).toFixed(1))}G` : `${faNum(mbps)}M`;
};

type PortFilter = 'all' | 'up' | 'down' | 'shut' | 'linked';

/** وضعیت خوانای پورت */
function portState(p: Port): { label: string; cls: string } {
  if (!p.is_present) return { label: 'حذف‌شده', cls: 'bg-line text-muted border-line' };
  if (p.admin_up === false) return { label: 'خاموش (shut)', cls: 'bg-amber/15 text-amber border-amber/30' };
  if (p.oper_up) return { label: 'وصل', cls: 'bg-ok/15 text-ok border-ok/30' };
  if (p.oper_reason && /err/i.test(p.oper_reason)) {
    return { label: 'err-disabled', cls: 'bg-danger/20 text-danger border-danger/40' };
  }
  if (p.oper_up === false) return { label: 'قطع', cls: 'bg-danger/10 text-danger border-danger/30' };
  return { label: 'نامشخص', cls: 'bg-line text-muted border-line' };
}

export default function SwitchDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [range, setRange] = useState('6h');
  const [filter, setFilter] = useState<PortFilter>('all');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [openPortId, setOpenPortId] = useState<number | null>(null);

  const detail = useLoad<Detail>(id ? `/api/switches/${id}` : null, 10_000);
  const metrics = useLoad<{ points: Record<string, unknown>[] }>(
    id ? `/api/switches/${id}/metrics?range=${range}` : null,
    30_000,
  );

  const ports = detail.data?.ports;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (ports ?? []).filter((p) => {
      // پیش‌فرض فقط پورت‌های فیزیکی و پورت‌چنل؛ ویلن و لوپ‌بک شلوغ می‌کنند
      if (!showAll && !['ethernet', 'port-channel'].includes(p.kind)) return false;
      if (!showAll && !p.is_present) return false;
      if (filter === 'up' && !p.oper_up) return false;
      if (filter === 'down' && !(p.oper_up === false && p.admin_up !== false)) return false;
      if (filter === 'shut' && p.admin_up !== false) return false;
      if (filter === 'linked' && !p.server_id) return false;
      if (!q) return true;
      return [p.name, p.description, p.server_name, p.customer_name, p.vlan, p.note]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [ports, filter, search, showAll]);

  if (!detail.data) {
    return (
      <LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {null}
      </LoadState>
    );
  }

  const d = detail.data;
  const sw = d.switch;
  const physical = d.ports.filter((p) => p.kind === 'ethernet' && p.is_present);
  const upCount = physical.filter((p) => p.oper_up).length;
  const totalIn = physical.reduce((s, p) => s + (Number(p.in_bps) || 0), 0);
  const totalOut = physical.reduce((s, p) => s + (Number(p.out_bps) || 0), 0);
  const memPct = sw.mem_total_bytes && sw.mem_used_bytes !== null ? (sw.mem_used_bytes / sw.mem_total_bytes) * 100 : null;
  const openPort = openPortId !== null ? d.ports.find((p) => p.id === openPortId) ?? null : null;
  const points = metrics.data?.points ?? [];

  return (
    <div className="space-y-5">
      {/* سرتیتر */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/switches" className="text-muted hover:text-cyan text-sm">
              سوییچ‌ها
            </Link>
            <span className="text-muted">/</span>
            <h1 className="text-lg font-bold">{sw.name}</h1>
            {sw.is_active ? <StatusBadge status={sw.status} /> : <span className="badge bg-line text-muted">غیرفعال</span>}
          </div>
          <p className="text-xs text-muted mt-1.5">
            {[sw.vendor, sw.model, sw.os_version, sw.serial && `سریال ${sw.serial}`, sw.hostname]
              .filter(Boolean)
              .join(' · ') || 'هنوز خوانده نشده'}
          </p>
          <p className="text-[11px] text-muted mt-1">
            {sw.protocol === 'snmp' ? `SNMP v${sw.snmp_version}` : 'NX-API'}
            {!sw.can_write && ' (فقط پایش)'} ·{' '}
            <Mono>{sw.protocol === 'snmp' ? `${sw.snmp_host}:${sw.snmp_port}` : sw.url}</Mono>
            {sw.datacenter_name && ` · ${sw.datacenter_name}`}
            {sw.location && ` · ${sw.location}`}
          </p>
        </div>
        <div className="text-[11px] text-muted text-end">
          <p>آخرین خواندن: {sw.last_poll_at ? timeAgo(sw.last_poll_at) : '—'}</p>
          {sw.last_poll_ms !== null && <p>مدت خواندن: {faNum((sw.last_poll_ms / 1000).toFixed(1))} ثانیه</p>}
        </div>
      </div>

      {detail.error && <Notice type="warn">به‌روزرسانی انجام نشد: {detail.error}</Notice>}
      {sw.last_error && (
        <Notice type={sw.status === 'down' ? 'error' : 'warn'}>
          {sw.status === 'down' ? 'پنل به سوییچ دسترسی ندارد: ' : 'بخشی از اطلاعات خوانده نشد: '}
          {sw.last_error}
        </Notice>
      )}

      {/* شاخص‌ها */}
      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3">
        <StatCard
          title="پردازنده"
          value={formatPercent(sw.cpu_percent)}
          tone={(sw.cpu_percent ?? 0) >= 90 ? 'danger' : (sw.cpu_percent ?? 0) >= 75 ? 'warn' : 'default'}
          sub={sw.load1 !== null ? `بار ${faNum(Number(sw.load1).toFixed(2))}` : undefined}
        />
        <StatCard
          title="حافظه"
          value={formatPercent(memPct)}
          sub={sw.mem_total_bytes ? `${formatBytes(sw.mem_used_bytes)} از ${formatBytes(sw.mem_total_bytes)}` : undefined}
        />
        <StatCard
          title="بیشترین دما"
          value={sw.max_temp_c !== null ? `${faNum(Math.round(sw.max_temp_c))}°C` : '—'}
          tone={sw.env_ok === false ? 'danger' : 'default'}
          sub={sw.env_ok === false ? 'مشکل سخت‌افزار' : sw.env_ok ? 'فن و تغذیه سالم' : undefined}
        />
        <StatCard title="روشن از" value={sw.uptime_sec ? formatDuration(sw.uptime_sec) : '—'} />
        <StatCard
          title="پورت‌های وصل"
          value={`${faNum(upCount)} از ${faNum(physical.length)}`}
          tone="cyan"
        />
        <StatCard
          title="ترافیک لحظه‌ای پورت‌ها"
          value={formatBps(totalIn + totalOut)}
          sub={`ورودی ${formatBps(totalIn)} · خروجی ${formatBps(totalOut)}`}
        />
      </div>

      {/* رویدادهای باز */}
      {d.incidents.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-bold mb-2">رویدادهای باز</h2>
          <ul className="space-y-1.5 text-xs">
            {d.incidents.map((i) => (
              <li key={i.id} className="flex items-start gap-2">
                <span
                  className={`badge border shrink-0 ${
                    i.severity === 'critical' ? 'bg-danger/15 text-danger border-danger/30' : 'bg-amber/15 text-amber border-amber/30'
                  }`}
                >
                  {INCIDENT_KIND_LABEL[i.kind] ?? i.kind}
                </span>
                <span className="flex-1">{i.message}</span>
                <span className="text-muted shrink-0">{timeAgo(i.started_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* نمودار منابع */}
      <section className="space-y-3">
        <RangeButtons range={range} setRange={setRange} loading={metrics.loading} error={metrics.error} />
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-sm font-bold mb-2">پردازنده و حافظه</h3>
            <Chart
              points={points}
              height={190}
              series={[
                { key: 'cpu', label: 'پردازنده', color: IN_COLOR, percent: true },
                { key: 'mem_pct', label: 'حافظه', color: OUT_COLOR, percent: true },
              ]}
              format={(v) => `${faNum(v.toFixed(0))}٪`}
              formatTime={timeLabel}
            />
          </div>
          <div className="card p-4">
            <h3 className="text-sm font-bold mb-2">دما</h3>
            <Chart
              points={points}
              height={190}
              fill={false}
              series={[{ key: 'temp', label: 'بیشترین دما', color: '#F2555A' }]}
              format={(v) => `${faNum(v.toFixed(0))}°`}
              formatTime={timeLabel}
            />
          </div>
        </div>
      </section>

      {/* پورت‌ها */}
      <section className="card">
        <div className="p-4 flex items-center gap-2 flex-wrap border-b border-line">
          <h2 className="text-sm font-bold me-2">پورت‌ها</h2>
          <input
            className="input max-w-[220px]"
            placeholder="جست‌وجو: پورت، توضیح، سرور، ویلن"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input max-w-[170px]" value={filter} onChange={(e) => setFilter(e.target.value as PortFilter)}>
            <option value="all">همه</option>
            <option value="up">وصل</option>
            <option value="down">قطع</option>
            <option value="shut">خاموش (shut)</option>
            <option value="linked">وصل به سرور</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            ویلن، مدیریت و حذف‌شده‌ها هم
          </label>
          <span className="ms-auto text-[11px] text-muted">
            مصرف ماه: {d.period.label} · in یعنی ورودی به سوییچ
          </span>
        </div>

        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>پورت</th>
                <th>وضعیت</th>
                <th className="col-sm">لینک</th>
                <th>ورودی / خروجی لحظه‌ای</th>
                <th className="col-md">امروز</th>
                <th className="col-sm">این ماه</th>
                <th className="col-md">خطا (ماه)</th>
                <th className="col-sm">سرور</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const st = portState(p);
                const cap = p.speed_mbps ? p.speed_mbps * 1e6 : 0;
                const util = cap ? (Math.max(Number(p.in_bps), Number(p.out_bps)) / cap) * 100 : 0;
                return (
                  <tr key={p.id} className={p.is_present ? '' : 'opacity-50'}>
                    <td>
                      <button type="button" className="text-start hover:text-cyan" onClick={() => setOpenPortId(p.id)}>
                        <Mono>{p.name}</Mono>
                        {p.is_protected && <span className="ms-1 text-[10px] text-amber" title="محافظت‌شده">⛨</span>}
                        {p.description && <span className="block text-[11px] text-muted truncate max-w-[180px]">{p.description}</span>}
                      </button>
                    </td>
                    <td>
                      <span className={`badge border ${st.cls}`}>{st.label}</span>
                      {p.pending_action && <span className="block text-[10px] text-cyan mt-1">فرمان در جریان…</span>}
                      {p.has_incident && <span className="block text-[10px] text-danger mt-1">رویداد باز</span>}
                    </td>
                    <td className="col-sm text-xs">
                      <span className="ltr">{speedLabel(p.speed_mbps)}</span>
                      <span className="block text-[10px] text-muted">
                        {[p.mode, p.vlan && p.vlan !== p.mode ? `vlan ${p.vlan}` : null, p.member_of].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td className="text-xs min-w-[130px]">
                      <InOut a={formatBps(p.in_bps)} b={formatBps(p.out_bps)} />
                      {cap > 0 && p.oper_up && (
                        <div className="mt-1">
                          <UsageBar percent={util} />
                        </div>
                      )}
                    </td>
                    <td className="col-md text-xs">
                      <InOut a={formatBytes(p.today_in)} b={formatBytes(p.today_out)} />
                    </td>
                    <td className="col-sm text-xs">
                      <InOut a={formatBytes(p.month_in)} b={formatBytes(p.month_out)} />
                    </td>
                    <td className={`col-md text-xs ${p.month_errors > 0 ? 'text-amber' : 'text-muted'}`}>
                      {faNum(p.month_errors)}
                    </td>
                    <td className="col-sm text-xs">
                      {p.server_id ? (
                        <Link href={`/servers/${p.server_id}`} className="hover:text-cyan">
                          {p.server_name}
                          {p.count_traffic && <span className="block text-[10px] text-cyan">مبنای ترافیک</span>}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn-ghost text-xs" onClick={() => setOpenPortId(p.id)}>
                        جزئیات
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-muted text-xs py-8">
                    {d.ports.length === 0 ? 'هنوز پورتی خوانده نشده است' : 'پورتی با این فیلتر نیست'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* سخت‌افزار */}
      <EnvironmentCard sw={sw} />

      {/* تاریخچه فرمان‌ها */}
      <section className="card">
        <div className="p-4 border-b border-line">
          <h2 className="text-sm font-bold">تاریخچه خاموش و روشن کردن پورت‌ها</h2>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>زمان</th>
                <th>پورت</th>
                <th>فرمان</th>
                <th className="col-sm">درخواست‌دهنده</th>
                <th>وضعیت</th>
                <th className="col-md">نتیجه</th>
              </tr>
            </thead>
            <tbody>
              {d.actions.map((a) => (
                <tr key={a.id}>
                  <td className="text-xs whitespace-nowrap" title={formatJalaliTime(a.requested_at)}>
                    {timeAgo(a.requested_at)}
                  </td>
                  <td>
                    <Mono>{a.port_name}</Mono>
                  </td>
                  <td className="text-xs">
                    {ACTION_LABEL[a.action] ?? a.action}
                    {a.reason && <span className="block text-[10px] text-muted">{a.reason}</span>}
                  </td>
                  <td className="col-sm text-xs">{a.requested_by_name ?? '—'}</td>
                  <td>
                    <span className={`badge border ${ACTION_STATUS[a.status]?.cls ?? ''}`}>
                      {ACTION_STATUS[a.status]?.label ?? a.status}
                    </span>
                  </td>
                  <td className="col-md text-xs max-w-[360px]">{a.result ?? '—'}</td>
                </tr>
              ))}
              {d.actions.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted text-xs py-6">
                    هنوز فرمانی از پنل اجرا نشده است
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {openPort && (
        <PortModal
          switchId={sw.id}
          switchName={sw.name}
          canWrite={sw.can_write}
          canSave={sw.can_save}
          port={openPort}
          onClose={() => setOpenPortId(null)}
          onChanged={detail.reload}
        />
      )}
    </div>
  );
}

function RangeButtons({
  range,
  setRange,
  loading,
  error,
}: {
  range: string;
  setRange: (r: string) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => setRange(r.key)}
          className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
            range === r.key ? 'bg-cyan/10 text-cyan border-cyan/30' : 'border-line text-muted hover:text-white'
          }`}
        >
          {r.label}
        </button>
      ))}
      {loading && <span className="text-[11px] text-muted">در حال بارگذاری…</span>}
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}

function EnvironmentCard({ sw }: { sw: SwitchInfo }) {
  const env = sw.env;
  if (!env) {
    return (
      <section className="card p-4 text-xs text-muted">
        وضعیت دما، فن و منبع تغذیه هنوز خوانده نشده (هر پنج دقیقه یک بار).
      </section>
    );
  }
  const okBadge = (item: EnvItem) =>
    item.absent ? (
      <span className="badge border bg-line text-muted border-line">خالی</span>
    ) : item.ok ? (
      <span className="badge border bg-ok/10 text-ok border-ok/30">{item.status || 'سالم'}</span>
    ) : (
      <span className="badge border bg-danger/15 text-danger border-danger/30">{item.status || 'مشکل'}</span>
    );

  return (
    <section className="card p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold">سخت‌افزار</h2>
        <span className="text-[11px] text-muted">
          {sw.env_checked_at ? `بررسی ${timeAgo(sw.env_checked_at)}` : ''}
        </span>
      </div>
      {env.problems.length > 0 && <Notice type="error">{env.problems.join('، ')}</Notice>}

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted mb-2">منبع تغذیه</p>
          <ul className="space-y-1.5 text-xs">
            {env.psus.map((p) => (
              <li key={p.name} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block" dir="ltr">{p.name}</span>
                  {p.output_w !== null && p.output_w !== undefined && (
                    <span className="block text-muted text-[10px]">
                      مصرف {faNum(Math.round(p.output_w))} وات{p.capacity_w ? ` از ${faNum(Math.round(p.capacity_w))}` : ''}
                    </span>
                  )}
                  {p.model && <span className="block text-muted text-[10px] font-mono" dir="ltr">{p.model}</span>}
                </span>
                {okBadge(p)}
              </li>
            ))}
            {env.psus.length === 0 && <li className="text-muted">خوانده نشد</li>}
          </ul>
        </div>
        <div>
          <p className="text-xs text-muted mb-2">فن‌ها</p>
          <ul className="space-y-1.5 text-xs">
            {env.fans.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate" dir="ltr">{f.name}</span>
                  {f.direction && <span className="block text-muted text-[10px]" dir="ltr">{f.direction}</span>}
                </span>
                {okBadge(f)}
              </li>
            ))}
            {env.fans.length === 0 && <li className="text-muted">خوانده نشد</li>}
          </ul>
        </div>
        <div>
          <p className="text-xs text-muted mb-2">دما</p>
          <ul className="space-y-1.5 text-xs">
            {env.temps.map((t, i) => (
              <li key={`${t.name}-${i}`} className="flex items-center justify-between gap-2">
                <span className="truncate">{t.name}</span>
                <span className={t.ok ? '' : 'text-danger font-bold'}>
                  {t.current !== null && t.current !== undefined ? `${faNum(t.current)}°C` : '—'}
                  {t.major ? <span className="text-muted text-[10px] ms-1">(حد {faNum(t.major)})</span> : null}
                </span>
              </li>
            ))}
            {env.temps.length === 0 && <li className="text-muted">خوانده نشد</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}

interface ServerOption {
  id: number;
  name: string;
  main_ip: string;
}

function PortModal({
  switchId,
  switchName,
  canWrite,
  canSave,
  port,
  onClose,
  onChanged,
}: {
  switchId: number;
  switchName: string;
  canWrite: boolean;
  canSave: boolean;
  port: Port;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [range, setRange] = useState('24h');
  const [confirming, setConfirming] = useState<'shutdown' | 'no_shutdown' | null>(null);
  const series = useLoad<{ points: Record<string, unknown>[] }>(
    `/api/switches/${switchId}/metrics?port_id=${port.id}&range=${range}`,
    30_000,
  );
  const daily = useLoad<{ days: Record<string, number | string>[] }>(
    `/api/switches/${switchId}/metrics?port_id=${port.id}&view=daily&days=31`,
  );
  const st = portState(port);
  const points = series.data?.points ?? [];
  const peak = points.reduce((m, pt) => Math.max(m, Number(pt.in_bps) || 0, Number(pt.out_bps) || 0), 0);
  const x = port.transceiver;
  const canAct = port.is_present && ['ethernet', 'port-channel'].includes(port.kind);
  const actionHint = canWrite
    ? 'فرمان روی سوییچ اجرا و سپس وضعیت واقعی پورت دوباره خوانده می‌شود. فقط حساب مدیر.'
    : 'این سوییچ فقط پایش می‌شود. برای خاموش و روشن کردن، در ویرایش سوییچ کامیونیتی نوشتنی (v2c) یا «اجازه نوشتن» (v3) بدهید.';

  return (
    <Modal open wide title={`${switchName} / ${port.name}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge border ${st.cls}`}>{st.label}</span>
          {port.description && <span className="text-sm">{port.description}</span>}
          {port.is_protected && <span className="badge border bg-amber/10 text-amber border-amber/30">محافظت‌شده</span>}
        </div>

        {/* مشخصات */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Info label="سرعت لینک" value={speedLabel(port.speed_mbps)} />
          <Info label="حالت / ویلن" value={[port.mode, port.vlan].filter(Boolean).join(' / ') || '—'} />
          <Info label="MTU" value={port.mtu ? faNum(port.mtu) : '—'} />
          <Info label="MAC" value={port.mac ?? '—'} mono />
          <Info label="عضو" value={port.member_of ?? '—'} mono />
          <Info label="آخرین تغییر لینک" value={port.last_flap ?? (port.last_change_at ? timeAgo(port.last_change_at) : '—')} />
          <Info label="علت قطعی" value={port.oper_up ? '—' : port.oper_reason ?? '—'} />
          <Info label="ماژول" value={port.xcvr_type ?? x?.type ?? '—'} />
          <Info
            label="خطای ورودی / خروجی / CRC"
            value={`${faNum(port.in_errors ?? 0)} / ${faNum(port.out_errors ?? 0)} / ${faNum(port.crc_errors ?? 0)}`}
          />
          <Info label="دور ریخته (discard)" value={`${faNum(port.in_discards ?? 0)} / ${faNum(port.out_discards ?? 0)}`} />
          {x && (
            <>
              <Info
                label="توان نوری Rx / Tx (dBm)"
                value={`${x.rx_dbm !== null ? x.rx_dbm.toFixed(2) : '—'} / ${x.tx_dbm !== null ? x.tx_dbm.toFixed(2) : '—'}`}
                warn={x.rx_low}
                mono
              />
              <Info label="دمای ماژول" value={x.temp_c !== null ? `${faNum(x.temp_c.toFixed(1))}°C` : '—'} />
            </>
          )}
        </div>
        {x?.rx_low && (
          <Notice type="warn">
            توان دریافتی نوری کمتر از آستانه هشدار ماژول است — فیبر، کانکتور یا ماژول طرف مقابل را بررسی کنید.
          </Notice>
        )}

        {/* نمودار */}
        <div className="space-y-2">
          <RangeButtons range={range} setRange={setRange} loading={series.loading} error={series.error} />
          <Chart
            points={points}
            height={200}
            series={[
              { key: 'in_bps', label: 'ورودی به سوییچ', color: IN_COLOR },
              { key: 'out_bps', label: 'خروجی از سوییچ', color: OUT_COLOR },
            ]}
            maxValue={peak > 0 ? peak * 1.15 : undefined}
            format={(v) => formatBps(v, 0)}
            formatTime={timeLabel}
          />
        </div>

        {/* مصرف روزانه */}
        <div>
          <p className="text-xs text-muted mb-2">مصرف روزانه (۳۱ روز اخیر)</p>
          <div className="table-wrap max-h-[260px] overflow-y-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>روز</th>
                  <th>ورودی</th>
                  <th>خروجی</th>
                  <th className="col-sm">اوج</th>
                  <th className="col-sm">خطا</th>
                </tr>
              </thead>
              <tbody>
                {(daily.data?.days ?? []).map((r) => (
                  <tr key={String(r.day)}>
                    <td className="text-xs">{formatJalaliDay(String(r.day))}</td>
                    <td className="text-xs ltr">{formatBytes(Number(r.in_bytes))}</td>
                    <td className="text-xs ltr">{formatBytes(Number(r.out_bytes))}</td>
                    <td className="col-sm text-xs ltr">{formatBps(Math.max(Number(r.in_peak), Number(r.out_peak)))}</td>
                    <td className="col-sm text-xs">{faNum(Number(r.errors))}</td>
                  </tr>
                ))}
                {!daily.loading && (daily.data?.days ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-muted text-xs py-4">
                      {daily.error ?? 'هنوز مصرف روزانه‌ای ثبت نشده (تجمیع هر پنج دقیقه)'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* shut / no shut */}
        {canAct && (
          <div className="border-t border-line pt-4 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted me-auto">{actionHint}</span>
            {!canWrite ? null : port.admin_up === false ? (
              <button type="button" className="btn-primary" onClick={() => setConfirming('no_shutdown')}>
                روشن کردن (no shutdown)
              </button>
            ) : (
              <button
                type="button"
                className="btn-danger"
                onClick={() => setConfirming('shutdown')}
                disabled={port.is_protected}
                title={port.is_protected ? 'پورت محافظت‌شده است' : undefined}
              >
                خاموش کردن (shutdown)
              </button>
            )}
          </div>
        )}

        <PortSettings port={port} onSaved={onChanged} />
      </div>

      {confirming && (
        <ActionConfirm
          port={port}
          switchName={switchName}
          canSave={canSave}
          action={confirming}
          onClose={() => setConfirming(null)}
          onDone={() => {
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

/** دو مقدار ورودی و خروجی، هرکدام در خط خودش؛ کنار هم در متن راست‌به‌چپ جابه‌جا می‌شدند */
function InOut({ a, b }: { a: string; b: string }) {
  return (
    <span className="block leading-5">
      <span className="block whitespace-nowrap">
        <span className="text-cyan text-[10px] me-1">ورودی</span>
        {a}
      </span>
      <span className="block whitespace-nowrap">
        <span className="text-amber text-[10px] me-1">خروجی</span>
        {b}
      </span>
    </span>
  );
}

function Info({ label, value, mono, warn }: { label: string; value: string; mono?: boolean; warn?: boolean }) {
  return (
    <div className="bg-panel2 rounded-lg px-3 py-2 min-w-0">
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`mt-0.5 truncate ${mono ? 'ltr font-mono' : ''} ${warn ? 'text-amber' : ''}`} title={value}>
        {value}
      </p>
    </div>
  );
}

function PortSettings({ port, onSaved }: { port: Port; onSaved: () => void }) {
  const servers = useLoad<{ servers: ServerOption[] }>('/api/servers');
  const [form, setForm] = useState({
    server_id: port.server_id ? String(port.server_id) : '',
    count_traffic: port.count_traffic,
    alert_down: port.alert_down,
    is_protected: port.is_protected,
    note: port.note ?? '',
  });
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const countable = ['ethernet', 'port-channel'].includes(port.kind);

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      await api.patch('/api/switch-ports', {
        id: port.id,
        server_id: form.server_id || null,
        count_traffic: form.server_id ? form.count_traffic : false,
        alert_down: form.alert_down,
        is_protected: form.is_protected,
        note: form.note,
      });
      setMsg({ type: 'success', text: 'ذخیره شد' });
      onSaved();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ذخیره انجام نشد' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line pt-4 space-y-3">
      <h3 className="text-sm font-bold">تنظیمات پورت در پنل</h3>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="سرور متصل" hint="مصرف این پورت در صفحه همان سرور هم دیده می‌شود">
          <select
            className="input"
            value={form.server_id}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                server_id: e.target.value,
                // پورتی که تازه به سرور وصل می‌شود پیش‌فرض هشدار قطعی می‌گیرد
                alert_down: e.target.value && !f.server_id ? true : f.alert_down,
              }))
            }
          >
            <option value="">— هیچ‌کدام</option>
            {(servers.data?.servers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.main_ip})
              </option>
            ))}
          </select>
        </Field>
        <Field label="یادداشت">
          <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>

      <div className="space-y-2 text-xs">
        {countable && (
          <label className={`flex items-start gap-2 ${form.server_id ? 'cursor-pointer' : 'opacity-50'}`}>
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={!form.server_id}
              checked={form.count_traffic && Boolean(form.server_id)}
              onChange={(e) => setForm((f) => ({ ...f, count_traffic: e.target.checked }))}
            />
            <span>
              مصرف این پورت مبنای ترافیک سرور باشد
              <span className="block text-muted mt-0.5">
                به‌جای عدد ایجنت، در سهمیه، حسابداری، گزارش و پرتال مشتری. خروجی سوییچ دانلود سرور است و
                ورودی سوییچ آپلودش. از همین لحظه اعمال می‌شود؛ روزهای گذشته دست نمی‌خورند.
              </span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.alert_down}
            onChange={(e) => setForm((f) => ({ ...f, alert_down: e.target.checked }))}
          />
          <span>
            هشدار قطعی لینک
            <span className="block text-muted mt-0.5">
              اگر لینک بیش از یک دقیقه قطع بماند پیامک و رویداد می‌سازد. خاموش کردن عمدی از پنل هشدار ندارد.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.is_protected}
            onChange={(e) => setForm((f) => ({ ...f, is_protected: e.target.checked }))}
          />
          <span>
            محافظت‌شده
            <span className="block text-muted mt-0.5">آپلینک، پورت‌چنل هسته، یا هر پورتی که نباید از پنل خاموش شود.</span>
          </span>
        </label>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'در حال ذخیره…' : 'ذخیره تنظیمات پورت'}
        </button>
      </div>
    </div>
  );
}

function ActionConfirm({
  port,
  switchName,
  canSave,
  action,
  onClose,
  onDone,
}: {
  port: Port;
  switchName: string;
  canSave: boolean;
  action: 'shutdown' | 'no_shutdown';
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [save, setSave] = useState(false);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<'form' | 'running' | 'done'>('form');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const isShut = action === 'shutdown';
  // برای خاموش کردن پورتی که به سرور وصل است، نام پورت باید تایپ شود؛
  // یک کلیک اشتباه نباید سرویس مشتری را قطع کند
  const needTyping = isShut && Boolean(port.server_id);
  const ready = !needTyping || typed.trim().toLowerCase() === port.name.toLowerCase();

  async function run() {
    setPhase('running');
    setResult(null);
    try {
      const res = await api.post<{ id: number }>('/api/switch-actions', {
        port_id: port.id,
        action,
        reason,
        save_config: save && canSave,
      });
      // ورکر هر سه ثانیه صف را نگاه می‌کند؛ تا یک دقیقه منتظر می‌مانیم
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await api.get<{ action: ActionRow }>(`/api/switch-actions?id=${res.id}`);
        if (r.action.status === 'done' || r.action.status === 'failed') {
          setResult({ ok: r.action.status === 'done', text: r.action.result ?? '' });
          setPhase('done');
          onDone();
          return;
        }
      }
      setResult({ ok: false, text: 'نتیجه تا یک دقیقه نیامد. ورکر در حال اجراست؟ وضعیت در تاریخچه پایین صفحه دیده می‌شود.' });
      setPhase('done');
      onDone();
    } catch (e) {
      setResult({ ok: false, text: e instanceof ApiError ? e.message : 'ثبت درخواست ناموفق بود' });
      setPhase('done');
    }
  }

  return (
    <Modal open title={isShut ? `خاموش کردن ${port.name}` : `روشن کردن ${port.name}`} onClose={phase === 'running' ? () => {} : onClose}>
      <div className="space-y-4">
        {phase === 'form' && (
          <>
            <p className="text-sm">
              روی سوییچ <b>{switchName}</b>، پورت <Mono>{port.name}</Mono>
              {port.description ? ` (${port.description})` : ''} {isShut ? 'خاموش (shutdown)' : 'روشن (no shutdown)'} شود؟
            </p>
            {isShut && port.server_id && (
              <Notice type="error">
                این پورت به سرور <b>{port.server_name}</b>
                {port.customer_name ? ` مشتری ${port.customer_name}` : ''} وصل است و سرور قطع می‌شود. هشدار قطعی برای
                این سرور تا روشن شدن دوباره پورت ساکت می‌ماند.
              </Notice>
            )}
            {isShut && port.member_of && (
              <Notice type="warn">این پورت عضو {port.member_of} است؛ پورت‌چنل با یک عضو کمتر کار می‌کند.</Notice>
            )}
            <Field label="دلیل" hint="در تاریخچه می‌ماند">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلا: عدم پرداخت فاکتور" />
            </Field>
            {needTyping && (
              <Field label={`برای تأیید، نام پورت را بنویسید: ${port.name}`}>
                <input className="input ltr" value={typed} onChange={(e) => setTyped(e.target.value)} />
              </Field>
            )}
            <label className={`flex items-start gap-2 text-xs ${canSave ? 'cursor-pointer' : 'opacity-60'}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={save && canSave}
                disabled={!canSave}
                onChange={(e) => setSave(e.target.checked)}
              />
              <span>
                ماندگار پس از ریبوت (copy running-config startup-config)
                <span className="block text-muted mt-0.5">
                  {canSave
                    ? 'بدون این، تغییر با ریبوت سوییچ برمی‌گردد. توجه: هر تغییر ذخیره‌نشده دیگری روی سوییچ هم با آن ذخیره می‌شود.'
                    : 'ذخیره پیکربندی از پنل فقط برای NX-API و سیسکو با SNMP ممکن است. روی این سوییچ، ذخیره را خودتان انجام دهید وگرنه با ریبوت برمی‌گردد.'}
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                انصراف
              </button>
              <button type="button" className={isShut ? 'btn-danger' : 'btn-primary'} onClick={run} disabled={!ready}>
                {isShut ? 'خاموش شود' : 'روشن شود'}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <div className="flex items-center gap-3 py-6 justify-center text-sm text-muted">
            <span className="w-4 h-4 border-2 border-cyan/30 border-t-cyan rounded-full animate-spin" />
            در حال اجرا روی سوییچ…
          </div>
        )}

        {phase === 'done' && result && (
          <>
            <Notice type={result.ok ? 'success' : 'error'}>{result.text}</Notice>
            <div className="flex justify-end">
              <button type="button" className="btn-ghost" onClick={onClose}>
                بستن
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
