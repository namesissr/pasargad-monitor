'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Chart, UsageBar } from '@/components/Chart';
import { Mono, Notice, StatCard, StatusBadge } from '@/components/ui';
import {
  faNum,
  formatBps,
  formatBytes,
  formatDuration,
  formatJalaliTime,
  formatPercent,
  timeAgo,
  INCIDENT_KIND_LABEL,
} from '@/lib/format';
import {
  ACTION_STATUS,
  IN_COLOR,
  InOut,
  OUT_COLOR,
  RangeButtons,
  Tabs,
  actionLabel,
  neighborLabel,
  portState,
  speedLabel,
  timeLabel,
  type ActionRow,
  type EnvItem,
  type Port,
  type SwitchInfo,
} from './shared';
import { PortModal, SuggestionBox } from './port-modal';
import { ConfigTab } from './configs';

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

type PortFilter = 'all' | 'up' | 'down' | 'shut' | 'linked' | 'unlinked' | 'suggested' | 'issues' | 'limited';
type MainTab = 'ports' | 'neighbors' | 'resources' | 'configs' | 'history';

export default function SwitchDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [tab, setTab] = useState<MainTab>('ports');
  const [openPortId, setOpenPortId] = useState<number | null>(null);

  const detail = useLoad<Detail>(id ? `/api/switches/${id}` : null, 10_000);

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
  const suggestions = d.ports.filter((p) => !p.server_id && p.suggested_server_id && p.is_present);
  const withNeighbors = d.ports.filter((p) => (p.neighbors ?? []).length > 0).length;
  const pendingActions = d.actions.filter((a) => a.status === 'pending' || a.status === 'running').length;

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
        <div className="text-[11px] text-muted text-end space-y-0.5">
          <p>آخرین خواندن: {sw.last_poll_at ? timeAgo(sw.last_poll_at) : '—'}</p>
          {sw.last_poll_ms !== null && <p>مدت خواندن: {faNum((sw.last_poll_ms / 1000).toFixed(1))} ثانیه</p>}
          <p>
            <Link href={`/switches/report?switch_id=${sw.id}`} className="hover:text-cyan">
              گزارش پورت‌ها و صدک ۹۵ ←
            </Link>
          </p>
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
                {i.switch_port_id ? (
                  <button type="button" className="flex-1 text-start hover:text-cyan" onClick={() => setOpenPortId(i.switch_port_id)}>
                    {i.message}
                  </button>
                ) : (
                  <span className="flex-1">{i.message}</span>
                )}
                <span className="text-muted shrink-0">{timeAgo(i.started_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'ports', label: 'پورت‌ها', count: suggestions.length, tone: 'warn' },
          { key: 'neighbors', label: 'همسایه‌ها و MAC', count: withNeighbors },
          { key: 'resources', label: 'منابع و سخت‌افزار', count: sw.env_ok === false ? 1 : 0, tone: 'danger' },
          { key: 'configs', label: 'پشتیبان پیکربندی', count: sw.config_count },
          { key: 'history', label: 'تاریخچه فرمان‌ها', count: pendingActions },
        ]}
      />

      {tab === 'ports' && (
        <PortsTab d={d} suggestions={suggestions} onOpen={setOpenPortId} onChanged={detail.reload} />
      )}
      {tab === 'neighbors' && <NeighborsTab d={d} onOpen={setOpenPortId} />}
      {tab === 'resources' && <ResourcesTab sw={sw} />}
      {tab === 'configs' && (
        <section className="card p-4">
          <ConfigTab sw={sw} onChanged={detail.reload} />
        </section>
      )}
      {tab === 'history' && <HistoryTab actions={d.actions} />}

      {openPort && (
        <PortModal sw={sw} port={openPort} onClose={() => setOpenPortId(null)} onChanged={detail.reload} />
      )}
    </div>
  );
}

function PortsTab({
  d,
  suggestions,
  onOpen,
  onChanged,
}: {
  d: Detail;
  suggestions: Port[];
  onOpen: (id: number) => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<PortFilter>('all');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qMac = q.replace(/[^0-9a-f]/g, '');
    return d.ports.filter((p) => {
      // پیش‌فرض فقط پورت‌های فیزیکی و پورت‌چنل؛ ویلن و لوپ‌بک شلوغ می‌کنند
      if (!showAll && !['ethernet', 'port-channel'].includes(p.kind)) return false;
      if (!showAll && !p.is_present) return false;
      if (filter === 'up' && !p.oper_up) return false;
      if (filter === 'down' && !(p.oper_up === false && p.admin_up !== false)) return false;
      if (filter === 'shut' && p.admin_up !== false) return false;
      if (filter === 'linked' && !p.server_id) return false;
      if (filter === 'unlinked' && (p.server_id || p.is_protected || p.oper_up !== true)) return false;
      if (filter === 'suggested' && !(p.suggested_server_id && !p.server_id)) return false;
      if (filter === 'issues' && !p.has_incident) return false;
      if (filter === 'limited' && !p.rate_limit_mbps) return false;
      if (!q) return true;
      const text = [p.name, p.description, p.server_name, p.customer_name, p.vlan, p.note, p.suggested_server_name]
        .concat((p.neighbors ?? []).map((n) => n.sys_name))
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
      // جست‌وجوی MAC با هر قالبی: aabb.ccdd یا aa:bb:cc
      const mac = qMac.length >= 4 && (p.macs ?? []).some((m) => m.mac.replace(/:/g, '').includes(qMac));
      return text || mac;
    });
  }, [d.ports, filter, search, showAll]);

  return (
    <div className="space-y-3">
      {suggestions.length > 0 && filter !== 'suggested' && (
        <div className="border border-amber/30 bg-amber/5 rounded-lg px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
          <span className="me-auto">
            پنل برای {faNum(suggestions.length)} پورت از روی LLDP، جدول MAC/ARP یا توضیح پورت حدس زده به کدام سرور وصل
            است. تا تأیید نکنید چیزی عوض نمی‌شود.
          </span>
          <button type="button" className="btn-ghost text-xs" onClick={() => setFilter('suggested')}>
            بررسی پیشنهادها
          </button>
        </div>
      )}
      {filter === 'suggested' && suggestions.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {suggestions.map((p) => (
            <div key={p.id} className="card p-3 space-y-2">
              <button type="button" className="text-sm hover:text-cyan" onClick={() => onOpen(p.id)}>
                <Mono>{p.name}</Mono>
                {p.description && <span className="text-muted text-xs ms-2">{p.description}</span>}
              </button>
              <SuggestionBox port={p} onChanged={onChanged} />
            </div>
          ))}
        </div>
      )}

      <section className="card">
        <div className="p-4 flex items-center gap-2 flex-wrap border-b border-line">
          <input
            className="input max-w-[240px]"
            placeholder="جست‌وجو: پورت، توضیح، سرور، همسایه، MAC"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input max-w-[190px]" value={filter} onChange={(e) => setFilter(e.target.value as PortFilter)}>
            <option value="all">همه</option>
            <option value="up">وصل</option>
            <option value="down">قطع</option>
            <option value="shut">خاموش (shut)</option>
            <option value="linked">وصل به سرور</option>
            <option value="unlinked">وصل ولی بدون سرور</option>
            <option value="suggested">پیشنهاد اتصال</option>
            <option value="issues">با رویداد باز</option>
            <option value="limited">محدودیت سرعت</option>
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
                const nb = (p.neighbors ?? [])[0];
                return (
                  <tr key={p.id} className={p.is_present ? '' : 'opacity-50'}>
                    <td>
                      <button type="button" className="text-start hover:text-cyan" onClick={() => onOpen(p.id)}>
                        <Mono>{p.name}</Mono>
                        {p.is_protected && <span className="ms-1 text-[10px] text-amber" title="محافظت‌شده">⛨</span>}
                        {p.description && <span className="block text-[11px] text-muted truncate max-w-[180px]">{p.description}</span>}
                        {nb && (
                          <span className="block text-[10px] text-muted/80 truncate max-w-[180px] ltr" title={`${nb.proto.toUpperCase()}: ${neighborLabel(nb)}`}>
                            ↔ {neighborLabel(nb)}
                          </span>
                        )}
                      </button>
                    </td>
                    <td>
                      <span className={`badge border ${st.cls}`}>{st.label}</span>
                      {p.pending_action && <span className="block text-[10px] text-cyan mt-1">فرمان در جریان…</span>}
                      {p.has_incident && <span className="block text-[10px] text-danger mt-1">رویداد باز</span>}
                    </td>
                    <td className="col-sm text-xs">
                      <span className="ltr">{speedLabel(p.speed_mbps)}</span>
                      {p.rate_limit_mbps ? (
                        <span className="block text-[10px] text-cyan">سقف {speedLabel(p.rate_limit_mbps)}</span>
                      ) : null}
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
                      ) : p.suggested_server_id ? (
                        <button type="button" className="text-amber hover:text-cyan text-start" onClick={() => onOpen(p.id)}>
                          پیشنهاد: {p.suggested_server_name}
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn-ghost text-xs" onClick={() => onOpen(p.id)}>
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
    </div>
  );
}

interface LocateRow {
  switch_id: number;
  switch_name: string;
  port_id: number;
  port: string;
  description: string | null;
  mac_count: number | null;
  is_protected: boolean;
  mac: string;
  vlan: string | null;
  ip: string | null;
  server_id: number | null;
  server_name: string | null;
}

function NeighborsTab({ d, onOpen }: { d: Detail; onOpen: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const found = useLoad<{ rows: LocateRow[]; arpOnly: { ip: string; mac: string; interface: string | null; switch_name: string }[] | null }>(
    submitted ? `/api/switches/locate?q=${encodeURIComponent(submitted)}` : null,
  );
  const ports = d.ports.filter((p) => p.is_present && ((p.neighbors ?? []).length > 0 || (p.mac_count ?? 0) > 0));
  const discoveredAt = d.ports.map((p) => p.discovered_at).filter(Boolean).sort().pop() ?? null;

  return (
    <div className="space-y-4">
      <section className="card p-4 space-y-3">
        <h2 className="text-sm font-bold">این آی‌پی یا MAC کجاست؟</h2>
        <form
          className="flex gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
        >
          <input
            className="input ltr max-w-[280px]"
            placeholder="10.0.0.5 یا aa:bb:cc:dd:ee:ff"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={!q.trim()}>
            جست‌وجو در همه سوییچ‌ها
          </button>
        </form>
        {submitted && (
          found.loading ? (
            <p className="text-xs text-muted">در حال جست‌وجو…</p>
          ) : found.error ? (
            <Notice type="error">{found.error}</Notice>
          ) : (found.data?.rows ?? []).length === 0 ? (
            <p className="text-xs text-muted">
              روی هیچ پورتی دیده نشد.
              {(found.data?.arpOnly ?? []).length > 0 &&
                ` در جدول ARP سوییچ ${found.data?.arpOnly?.[0].switch_name} با MAC ${found.data?.arpOnly?.[0].mac} هست، ولی آن MAC روی پورتی از سوییچ‌های پنل دیده نشده.`}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>سوییچ / پورت</th>
                    <th>MAC</th>
                    <th className="col-sm">ویلن</th>
                    <th>آی‌پی</th>
                    <th className="col-sm">سرور</th>
                  </tr>
                </thead>
                <tbody>
                  {(found.data?.rows ?? []).map((r, i) => (
                    <tr key={`${r.port_id}-${r.mac}-${i}`}>
                      <td className="text-xs">
                        {r.switch_id === d.switch.id ? (
                          <button type="button" className="hover:text-cyan" onClick={() => onOpen(r.port_id)}>
                            <Mono>{r.port}</Mono>
                          </button>
                        ) : (
                          <Link href={`/switches/${r.switch_id}`} className="hover:text-cyan">
                            {r.switch_name} / <Mono>{r.port}</Mono>
                          </Link>
                        )}
                        {i === 0 && (r.mac_count ?? 0) <= 8 && !r.is_protected && (
                          <span className="badge bg-ok/10 text-ok border border-ok/30 ms-2">پورت لبه</span>
                        )}
                        {(r.mac_count ?? 0) > 8 && <span className="block text-[10px] text-muted">{faNum(r.mac_count ?? 0)} MAC — آپلینک</span>}
                        {r.description && <span className="block text-[10px] text-muted">{r.description}</span>}
                      </td>
                      <td className="text-xs ltr font-mono">{r.mac}</td>
                      <td className="col-sm text-xs">{r.vlan ?? '—'}</td>
                      <td className="text-xs ltr">{r.ip ?? '—'}</td>
                      <td className="col-sm text-xs">
                        {r.server_id ? (
                          <Link href={`/servers/${r.server_id}`} className="hover:text-cyan">
                            {r.server_name}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>

      <section className="card">
        <div className="p-4 border-b border-line flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-bold me-auto">همسایه‌ها و دستگاه‌های پشت هر پورت</h2>
          <span className="text-[11px] text-muted">
            LLDP، CDP و جدول MAC هر پنج دقیقه{discoveredAt ? ` — آخرین بار ${timeAgo(discoveredAt)}` : ''}
          </span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>پورت</th>
                <th>همسایه</th>
                <th className="col-sm">تعداد MAC</th>
                <th>سرور</th>
              </tr>
            </thead>
            <tbody>
              {ports.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button type="button" className="text-start hover:text-cyan" onClick={() => onOpen(p.id)}>
                      <Mono>{p.name}</Mono>
                      {p.description && <span className="block text-[11px] text-muted truncate max-w-[200px]">{p.description}</span>}
                    </button>
                  </td>
                  <td className="text-xs ltr">
                    {(p.neighbors ?? []).length === 0
                      ? '—'
                      : (p.neighbors ?? []).map((n, i) => (
                          <span key={i} className="block">
                            <span className="text-muted text-[10px] uppercase me-1">{n.proto}</span>
                            {neighborLabel(n)}
                            {n.mgmt_ip && <span className="text-muted"> · {n.mgmt_ip}</span>}
                          </span>
                        ))}
                  </td>
                  <td className="col-sm text-xs">{p.mac_count ? faNum(p.mac_count) : '—'}</td>
                  <td className="text-xs">
                    {p.server_id ? (
                      <Link href={`/servers/${p.server_id}`} className="hover:text-cyan">
                        {p.server_name}
                      </Link>
                    ) : p.suggested_server_id ? (
                      <button type="button" className="text-amber hover:text-cyan" onClick={() => onOpen(p.id)}>
                        پیشنهاد: {p.suggested_server_name}
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {ports.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted text-xs py-8">
                    هنوز همسایه یا MACی خوانده نشده (هر پنج دقیقه).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ResourcesTab({ sw }: { sw: SwitchInfo }) {
  const [range, setRange] = useState('6h');
  const metrics = useLoad<{ points: Record<string, unknown>[] }>(`/api/switches/${sw.id}/metrics?range=${range}`, 30_000);
  const points = metrics.data?.points ?? [];
  return (
    <div className="space-y-4">
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
      <EnvironmentCard sw={sw} />
    </div>
  );
}

function HistoryTab({ actions }: { actions: ActionRow[] }) {
  return (
    <section className="card">
      <div className="p-4 border-b border-line">
        <h2 className="text-sm font-bold">فرمان‌های اجراشده از پنل</h2>
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
            {actions.map((a) => (
              <tr key={a.id}>
                <td className="text-xs whitespace-nowrap" title={formatJalaliTime(a.requested_at)}>
                  {timeAgo(a.requested_at)}
                </td>
                <td>{a.port_name ? <Mono>{a.port_name}</Mono> : <span className="text-muted text-xs">کل سوییچ</span>}</td>
                <td className="text-xs">
                  {actionLabel(a)}
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
            {actions.length === 0 && (
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

