'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { BarChart } from '@/components/Chart';
import { Mono, StatCard } from '@/components/ui';
import {
  formatBps,
  formatBytes,
  formatPercent,
  formatTB,
} from '@/lib/format';

interface PeriodRow {
  key: string;
  label: string;
  from: string;
  to: string;
  rx: number;
  tx: number;
  total: number;
  cpu_avg: number | null;
  cpu_max: number;
  ram_avg: number | null;
  rx_peak: number;
  tx_peak: number;
  uptime: number | null;
  servers: number;
}

interface ServerRow {
  id: number;
  name: string;
  main_ip: string;
  traffic_quota_gb: number;
  rx: number;
  tx: number;
  total: number;
  cpu_avg: number | null;
  ram_avg: number | null;
  disk_max: number;
  rx_peak: number;
  tx_peak: number;
  uptime: number | null;
  days: number;
}

interface ReportData {
  type: string;
  calendar: string;
  periods: PeriodRow[];
  byServer: ServerRow[];
  grand: { rx: number; tx: number; total: number };
}

const TYPES = [
  { key: 'daily', label: 'روزانه', count: 30 },
  { key: 'monthly', label: 'ماهانه', count: 12 },
  { key: 'yearly', label: 'سالانه', count: 3 },
];

export default function ReportsPage() {
  const [type, setType] = useState('daily');
  const [serverId, setServerId] = useState('all');
  const count = TYPES.find((t) => t.key === type)?.count ?? 30;

  const qs = new URLSearchParams({ type, count: String(count), server_id: serverId });
  const { data, loading, error, reload } = useLoad<ReportData>(`/api/reports?${qs}`);
  const servers = useLoad<{ servers: { id: number; name: string }[] }>('/api/servers');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">گزارش مصرف</h1>
          <p className="text-xs text-muted mt-0.5">
            حجم ترافیک، میانگین منابع و در دسترس بودن ·{' '}
            {data?.calendar === 'gregorian' ? 'تقویم میلادی' : 'تقویم شمسی'}
          </p>
        </div>
        <a href={`/api/reports?${qs}&format=csv`} className="btn-ghost text-xs" download>
          دریافت خروجی CSV
        </a>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                type === t.key ? 'bg-cyan/10 text-cyan border-cyan/30' : 'border-line text-muted hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select className="input max-w-[200px]" value={serverId} onChange={(e) => setServerId(e.target.value)}>
          <option value="all">همه سرورها</option>
          {(servers.data?.servers ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <LoadState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!!data && data.periods.every((p) => p.total === 0)}
        emptyText="هنوز داده‌ای برای گزارش جمع نشده است. تجمیع روزانه هر چند دقیقه به‌روز می‌شود."
      >
        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard title="مجموع ترافیک بازه" value={formatTB(data.grand.total)} tone="cyan" />
              <StatCard title="دریافتی" value={formatTB(data.grand.rx)} sub={formatBytes(data.grand.rx)} />
              <StatCard title="ارسالی" value={formatTB(data.grand.tx)} sub={formatBytes(data.grand.tx)} />
              <StatCard
                title="میانگین در دسترس بودن"
                value={
                  data.periods.some((p) => p.uptime !== null)
                    ? formatPercent(
                        avg(data.periods.map((p) => p.uptime).filter((x): x is number => x !== null)),
                        2,
                      )
                    : '—'
                }
                tone="ok"
              />
            </div>

            <section className="card p-4">
              <h2 className="text-sm font-bold mb-3">حجم ترافیک هر دوره</h2>
              <BarChart
                bars={data.periods.map((p) => ({ label: p.label, value: p.total }))}
                format={(v) => formatBytes(v, 1)}
              />
            </section>

            <section className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-line">
                <h2 className="text-sm font-bold">تفکیک دوره‌ای</h2>
              </div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>دوره</th>
                      <th>دریافت</th>
                      <th>ارسال</th>
                      <th>مجموع</th>
                      <th>اوج دریافت</th>
                      <th>اوج ارسال</th>
                      <th>میانگین پردازنده</th>
                      <th>در دسترس بودن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.periods].reverse().map((p) => (
                      <tr key={p.key}>
                        <td className="whitespace-nowrap">{p.label}</td>
                        <td className="text-xs">{formatBytes(p.rx, 1)}</td>
                        <td className="text-xs">{formatBytes(p.tx, 1)}</td>
                        <td className="text-xs font-medium">{formatBytes(p.total, 1)}</td>
                        <td className="text-xs text-muted">{formatBps(p.rx_peak, 0)}</td>
                        <td className="text-xs text-muted">{formatBps(p.tx_peak, 0)}</td>
                        <td className="text-xs">{p.cpu_avg === null ? '—' : formatPercent(p.cpu_avg, 0)}</td>
                        <td className="text-xs">
                          {p.uptime === null ? (
                            '—'
                          ) : (
                            <span className={p.uptime < 99 ? 'text-amber' : 'text-ok'}>{formatPercent(p.uptime, 2)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {serverId === 'all' && data.byServer.length > 0 && (
              <section className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-line">
                  <h2 className="text-sm font-bold">تفکیک سروری در کل بازه</h2>
                </div>
                <div className="table-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>سرور</th>
                        <th>دریافت</th>
                        <th>ارسال</th>
                        <th>مجموع</th>
                        <th>سهم</th>
                        <th>میانگین پردازنده</th>
                        <th>میانگین حافظه</th>
                        <th>بیشترین دیسک</th>
                        <th>در دسترس بودن</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byServer.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <span className="font-medium">{s.name}</span>
                            <br />
                            <Mono className="text-muted">{s.main_ip}</Mono>
                          </td>
                          <td className="text-xs">{formatBytes(s.rx, 1)}</td>
                          <td className="text-xs">{formatBytes(s.tx, 1)}</td>
                          <td className="text-xs font-medium">{formatBytes(s.total, 1)}</td>
                          <td className="text-xs text-muted">
                            {formatPercent(data.grand.total ? (s.total / data.grand.total) * 100 : 0, 0)}
                          </td>
                          <td className="text-xs">{s.cpu_avg === null ? '—' : formatPercent(s.cpu_avg, 0)}</td>
                          <td className="text-xs">{s.ram_avg === null ? '—' : formatPercent(s.ram_avg, 0)}</td>
                          <td className="text-xs">{s.disk_max ? formatPercent(s.disk_max, 0) : '—'}</td>
                          <td className="text-xs">
                            {s.uptime === null ? (
                              '—'
                            ) : (
                              <span className={s.uptime < 99 ? 'text-amber' : 'text-ok'}>{formatPercent(s.uptime, 2)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <p className="text-[11px] text-muted/70">
              واحدها: حجم بر مبنای ۱۰۲۴ (هر گیگابایت ۱۰۲۴ مگابایت) و سرعت بر مبنای ۱۰۰۰ (هر مگابیت یک میلیون بیت).
              گزارش‌ها از تجمیع روزانه خوانده می‌شوند که هر پنج دقیقه به‌روز می‌شود، پس مصرف امروز چند دقیقه تأخیر دارد.
            </p>
          </>
        )}
      </LoadState>
    </div>
  );
}

function avg(list: number[]): number {
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}
