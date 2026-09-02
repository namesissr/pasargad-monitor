'use client';

import Link from 'next/link';
import { useLoad, LoadState } from '@/components/useLoad';
import { StatCard, StatusBadge, Mono } from '@/components/ui';
import { UsageBar } from '@/components/Chart';
import {
  faNum,
  formatBps,
  formatDuration,
  formatMbps,
  formatPercent,
  formatTB,
  formatToman,
  timeAgo,
  INCIDENT_KIND_LABEL,
  IP_STATUS_LABEL,
} from '@/lib/format';

interface LiveServer {
  id: number;
  name: string;
  main_ip: string;
  status: string;
  location: string | null;
  provider: string | null;
  datacenter_id: number | null;
  datacenter_name: string | null;
  last_seen_at: string | null;
  ram_total_bytes: number | null;
  disk_total_bytes: number | null;
  port_mbps: number | null;
  traffic_quota_gb: number | null;
  metric_ts: string | null;
  cpu_percent: number | null;
  ram_used_bytes: number | null;
  disk_used_bytes: number | null;
  load1: number | null;
  rx_bps: number | null;
  tx_bps: number | null;
  uptime_sec: number | null;
  period_rx: number;
  period_tx: number;
}

interface LiveData {
  servers: LiveServer[];
  ipStats: { status: string; cnt: number }[];
  incidents: {
    id: number;
    server_id: number | null;
    server_name: string | null;
    kind: string;
    severity: string;
    message: string;
    started_at: string;
    ack_at: string | null;
  }[];
  monthlyCost: number;
  cost: { rent: number; traffic: number; ip: number; total: number };
  period: { label: string; from: string; to: string };
  now: string;
}

const pct = (used: number | null, total: number | null) =>
  used && total && total > 0 ? (used / total) * 100 : 0;

export default function DashboardPage() {
  const { data, loading, error, reload, updatedAt } = useLoad<LiveData>('/api/live', 5000);

  // قاعده مهم: پیش از JSX بازگشت زودهنگام. هرگز data!.x داخل JSX ننویسید.
  // فقط وقتی کل صفحه جای خطا را می‌گیرد که هیچ داده‌ای نداشته باشیم.
  // خطای یک بارگذاری دوره‌ای نباید داشبورد زنده را خالی کند.
  if (!data) {
    return (
      <LoadState loading={loading} error={error} onRetry={reload}>
        {null}
      </LoadState>
    );
  }

  const servers = data.servers;
  const up = servers.filter((s) => s.status === 'up').length;
  const down = servers.filter((s) => s.status === 'down').length;
  const rxNow = servers.reduce((a, s) => a + Number(s.rx_bps ?? 0), 0);
  const txNow = servers.reduce((a, s) => a + Number(s.tx_bps ?? 0), 0);
  const periodBytes = servers.reduce((a, s) => a + Number(s.period_rx ?? 0) + Number(s.period_tx ?? 0), 0);
  const ipTotal = data.ipStats.reduce((a, s) => a + s.cnt, 0);
  const openIncidents = data.incidents.length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold">داشبورد</h1>
          <p className="text-xs text-muted mt-0.5">
            دوره جاری: {data.period.label} · به‌روزرسانی {timeAgo(updatedAt)}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-danger' : 'bg-ok animate-pulse'}`} />
          {error ? 'به‌روزرسانی متوقف شد' : 'زنده — هر ۵ ثانیه'}
        </span>
      </div>

      {/* داده قبلی سر جایش می‌ماند و خطا به‌جای خالی‌کردن صفحه اینجا دیده می‌شود */}
      {error && (
        <div className="border border-danger/30 bg-danger/10 text-danger rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-3">
          <span>آخرین به‌روزرسانی ناموفق بود: {error}</span>
          <button type="button" onClick={reload} className="underline shrink-0">تلاش دوباره</button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard
          title="سرورها"
          value={faNum(servers.length)}
          sub={`${faNum(up)} در دسترس · ${faNum(down)} قطع`}
          tone={down > 0 ? 'danger' : 'ok'}
        />
        <StatCard title="ترافیک دریافتی لحظه‌ای" value={formatBps(rxNow)} sub="مجموع همه سرورها" tone="cyan" />
        <StatCard title="ترافیک ارسالی لحظه‌ای" value={formatBps(txNow)} sub="مجموع همه سرورها" tone="cyan" />
        <StatCard title={`مصرف ${data.period.label}`} value={formatTB(periodBytes)} sub="دریافت + ارسال" />
        <StatCard
          title="رویدادهای باز"
          value={faNum(openIncidents)}
          sub={openIncidents ? 'نیاز به رسیدگی' : 'همه چیز عادی است'}
          tone={openIncidents ? 'danger' : 'ok'}
        />
        <StatCard
          title={`هزینه ${data.period.label}`}
          value={formatToman(data.cost?.total ?? data.monthlyCost)}
          sub={
            data.cost
              ? `اجاره ${formatToman(data.cost.rent)} · ترافیک ${formatToman(data.cost.traffic)} · آی‌پی ${formatToman(data.cost.ip)}`
              : `${faNum(ipTotal)} آی‌پی ثبت‌شده`
          }
        />
      </div>

      {/* رویدادهای باز */}
      {data.incidents.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-bold text-danger">رویدادهای باز</h2>
            <Link href="/incidents" className="text-xs text-muted hover:text-cyan">
              همه رویدادها ←
            </Link>
          </div>
          <ul className="divide-y divide-line/60">
            {data.incidents.slice(0, 6).map((inc) => (
              <li key={inc.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${inc.severity === 'critical' ? 'bg-danger' : 'bg-amber'}`} />
                <span className="text-muted text-xs shrink-0 w-28 truncate">
                  {INCIDENT_KIND_LABEL[inc.kind] ?? inc.kind}
                </span>
                <span className="flex-1 truncate">{inc.message}</span>
                {inc.ack_at && <span className="badge bg-line text-muted shrink-0">دیده شد</span>}
                <span className="text-[11px] text-muted shrink-0">{timeAgo(inc.started_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* وضعیت آی‌پی‌ها */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold">وضعیت آی‌پی‌ها</h2>
          <Link href="/ips" className="text-xs text-muted hover:text-cyan">
            مدیریت آی‌پی ←
          </Link>
        </div>
        {ipTotal === 0 ? (
          <p className="text-xs text-muted py-2">هنوز آی‌پی‌ای ثبت نشده است.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {['assigned', 'free', 'reserved', 'blocked', 'abuse'].map((st) => {
              const cnt = data.ipStats.find((s) => s.status === st)?.cnt ?? 0;
              return (
                <div key={st} className="bg-panel2 rounded-lg px-3 py-2.5">
                  <p className="text-[11px] text-muted mb-1">{IP_STATUS_LABEL[st]}</p>
                  <p className="text-lg font-bold">{faNum(cnt)}</p>
                  <p className="text-[10px] text-muted/70">{formatPercent(ipTotal ? (cnt / ipTotal) * 100 : 0, 0)}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* شبکه سرورها */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold">سرورها</h2>
          <Link href="/servers" className="text-xs text-muted hover:text-cyan">
            فهرست کامل ←
          </Link>
        </div>

        {servers.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-sm text-muted mb-3">هنوز سروری اضافه نشده است.</p>
            <Link href="/servers" className="btn-primary inline-flex">
              افزودن اولین سرور
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {servers.map((s) => {
              const cpu = Number(s.cpu_percent ?? 0);
              const ramPct = pct(s.ram_used_bytes, s.ram_total_bytes);
              const diskPct = pct(s.disk_used_bytes, s.disk_total_bytes);
              const quotaBytes = Number(s.traffic_quota_gb ?? 0) * Math.pow(1024, 3);
              const usedBytes = Number(s.period_rx ?? 0) + Number(s.period_tx ?? 0);
              const quotaPct = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;
              const stale = s.status !== 'up';

              return (
                <Link
                  key={s.id}
                  href={`/servers/${s.id}`}
                  className={`card p-4 block hover:border-cyan/40 transition-colors ${stale ? 'opacity-90' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{s.name}</p>
                      <Mono className="text-muted">{s.main_ip}</Mono>
                      {s.datacenter_name && (
                        <span className="text-[10px] text-muted block mt-0.5">⬡ {s.datacenter_name}</span>
                      )}
                    </div>
                    <StatusBadge status={s.status} />
                  </div>

                  {s.status === 'down' ? (
                    <p className="text-xs text-danger py-3">
                      آخرین ارتباط: {timeAgo(s.last_seen_at)}
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      <UsageBar percent={cpu} label="پردازنده" right={formatPercent(cpu, 0)} />
                      <UsageBar percent={ramPct} label="حافظه" right={formatPercent(ramPct, 0)} />
                      <UsageBar percent={diskPct} label="دیسک" right={formatPercent(diskPct, 0)} />
                      {quotaBytes > 0 && (
                        <UsageBar
                          percent={quotaPct}
                          label={`سهمیه ${data.period.label}`}
                          right={`${formatPercent(quotaPct, 0)}`}
                        />
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-line/60 text-[11px] text-muted">
                    <span className="flex items-center gap-1">
                      <span className="text-cyan">↓</span> {formatMbps(s.rx_bps)}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-amber">↑</span> {formatMbps(s.tx_bps)}
                    </span>
                    <span>{s.status === 'up' ? formatDuration(s.uptime_sec) : timeAgo(s.last_seen_at)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
