'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Chart } from '@/components/Chart';
import { JalaliDatePicker } from '@/components/JalaliDatePicker';
import { BackfillModal } from '@/components/BackfillModal';
import { Mono, Notice, StatCard } from '@/components/ui';
import {
  faFloat,
  faNum,
  formatBps,
  formatBytes,
  formatJalaliDay,
  formatTB,
} from '@/lib/format';

interface Point {
  t: string;
  rx: number;
  tx: number;
  rx_peak: number;
  tx_peak: number;
  source?: string;
}

interface TrafficData {
  server: { id: number; name: string; main_ip: string };
  from: string;
  to: string;
  granularity: 'hour' | 'day';
  spanDays: number;
  expected: number;
  points: Point[];
  totals: { rx: number; tx: number; rx_peak: number; tx_peak: number };
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoOf(d);
};

export default function TrafficLogPage() {
  const [serverId, setServerId] = useState('');
  const [from, setFrom] = useState(isoOf(new Date()));
  const [to, setTo] = useState(isoOf(new Date()));
  const [backfilling, setBackfilling] = useState(false);

  const servers = useLoad<{ servers: { id: number; name: string; main_ip: string }[] }>('/api/servers');

  // سرور از آدرس، وگرنه اولین سرور فهرست
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('server_id');
    if (fromUrl) setServerId(fromUrl);
  }, []);

  useEffect(() => {
    if (serverId) return;
    const first = servers.data?.servers?.[0];
    if (first) setServerId(String(first.id));
  }, [servers.data, serverId]);

  const qs = new URLSearchParams({ server_id: serverId, from, to });
  const { data, loading, error, reload } = useLoad<TrafficData>(
    serverId ? `/api/traffic?${qs}` : null,
  );

  const preset = (fromIso: string, toIso: string) => {
    setFrom(fromIso);
    setTo(toIso);
  };

  const today = isoOf(new Date());
  const isActive = (f: string, t: string) => from === f && to === t;

  const PRESETS: [string, string, string][] = [
    ['امروز', today, today],
    ['دیروز', daysAgo(1), daysAgo(1)],
    ['۷ روز اخیر', daysAgo(6), today],
    ['۳۰ روز اخیر', daysAgo(29), today],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">لاگ ترافیک</h1>
          <p className="text-xs text-muted mt-0.5">
            مصرف دقیق هر سرور در هر بازه‌ای، به تفکیک دانلود و آپلود
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setBackfilling(true)}
          disabled={!serverId}
        >
          وارد کردن مصرف گذشته
        </button>
      </div>

      {/* انتخابگرها */}
      <div className="card p-4 space-y-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">سرور</label>
            <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
              {(servers.data?.servers ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <JalaliDatePicker label="از تاریخ" value={from} onChange={setFrom} max={to} />
          <JalaliDatePicker label="تا تاریخ" value={to} onChange={setTo} min={from} max={today} />

          <div className="flex items-end">
            <a
              href={`/api/traffic?${qs}&format=csv`}
              className="btn-ghost w-full justify-center"
              download
            >
              خروجی CSV
            </a>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-line/60">
          <span className="text-[11px] text-muted ms-1">میان‌بر:</span>
          {PRESETS.map(([label, f, t]) => (
            <button
              key={label}
              type="button"
              onClick={() => preset(f, t)}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                isActive(f, t)
                  ? 'bg-cyan/10 text-cyan border-cyan/30'
                  : 'border-line text-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <LoadState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!!data && data.points.length === 0}
        emptyText="برای این بازه داده‌ای ثبت نشده است. اگر تاریخ گذشته را انتخاب کرده‌اید، شاید ایجنت آن موقع نصب نبوده."
      >
        {data && data.points.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                title="دانلود"
                value={formatTB(data.totals.rx, 3)}
                sub={`${formatBytes(data.totals.rx)} · اوج ${formatBps(data.totals.rx_peak, 0)}`}
                tone="cyan"
              />
              <StatCard
                title="آپلود"
                value={formatTB(data.totals.tx, 3)}
                sub={`${formatBytes(data.totals.tx)} · اوج ${formatBps(data.totals.tx_peak, 0)}`}
                tone="warn"
              />
              <StatCard
                title="مجموع"
                value={formatTB(data.totals.rx + data.totals.tx, 3)}
                sub={formatBytes(data.totals.rx + data.totals.tx)}
              />
              <StatCard
                title="بازه"
                value={
                  data.from === data.to
                    ? formatJalaliDay(data.from)
                    : `${faNum(data.spanDays)} روز`
                }
                sub={
                  data.from === data.to
                    ? 'شکست ساعتی'
                    : `${formatJalaliDay(data.from)} تا ${formatJalaliDay(data.to)}`
                }
              />
            </div>

            {data.points.length < data.expected && (
              <Notice type="info">
                از {faNum(data.expected)} بازه مورد انتظار، {faNum(data.points.length)} بازه داده دارد.
                فاصله‌ها یعنی ایجنت آن مدت گزارش نداده — نه اینکه ترافیک صفر بوده.
              </Notice>
            )}

            <TrafficCharts data={data} />
            <TrafficTable data={data} />
          </>
        )}
      </LoadState>

      <BackfillModal
        open={backfilling}
        serverId={serverId}
        serverName={data?.server.name ?? ''}
        onClose={() => setBackfilling(false)}
        onDone={reload}
      />

      {data && (
        <p className="text-[11px] text-muted/70">
          سرور: {data.server.name} · <Mono>{data.server.main_ip}</Mono> ·{' '}
          <Link href={`/servers/${data.server.id}`} className="hover:text-cyan underline">
            صفحه سرور
          </Link>
          {' · '}
          داده {data.granularity === 'hour' ? 'ساعتی' : 'روزانه'} از جدول تجمیع؛ بازه یک‌روزه ساعتی
          و بیشتر از دو روز روزانه می‌شود.
        </p>
      )}
    </div>
  );
}

/** دو نمودار حجم با مقیاس مشترک، تا نسبت دانلود به آپلود درست دیده شود */
function TrafficCharts({ data }: { data: TrafficData }) {
  const hourly = data.granularity === 'hour';
  const peak = Math.max(
    ...data.points.map((p) => Math.max(Number(p.rx) || 0, Number(p.tx) || 0)),
    1,
  );
  const scale = peak * 1.15;

  const label = (t: string) =>
    hourly ? faNum(t.slice(11, 16)) : formatJalaliDay(t);

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-bold">حجم ترافیک {hourly ? 'ساعت به ساعت' : 'روز به روز'}</h2>
        <span className="text-[11px] text-muted">هر دو نمودار روی یک مقیاس</span>
      </div>

      <div>
        <p className="text-[11px] text-muted mb-1">دانلود</p>
        <Chart
          points={data.points as unknown as Record<string, unknown>[]}
          height={150}
          maxValue={scale}
          series={[{ key: 'rx', label: 'دانلود', color: '#3ED6C5' }]}
          format={(v) => formatBytes(v, 1)}
          formatTime={label}
        />
      </div>

      <div>
        <p className="text-[11px] text-muted mb-1">آپلود</p>
        <Chart
          points={data.points as unknown as Record<string, unknown>[]}
          height={150}
          maxValue={scale}
          series={[{ key: 'tx', label: 'آپلود', color: '#F2B44C' }]}
          format={(v) => formatBytes(v, 1)}
          formatTime={label}
        />
      </div>
    </section>
  );
}

function TrafficTable({ data }: { data: TrafficData }) {
  const hourly = data.granularity === 'hour';
  const rows = [...data.points].reverse();

  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <h2 className="text-sm font-bold">جدول {hourly ? 'ساعتی' : 'روزانه'}</h2>
      </div>
      <div className="table-wrap">
        <table className="tbl min-w-[620px]">
          <thead>
            <tr>
              <th>{hourly ? 'ساعت' : 'روز'}</th>
              <th>دانلود</th>
              <th>آپلود</th>
              <th>مجموع</th>
              <th>اوج دانلود</th>
              <th>اوج آپلود</th>
              {!hourly && <th>منشأ</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.t}>
                <td className="whitespace-nowrap">
                  {hourly ? (
                    <>
                      <Mono>{p.t.slice(11, 16)}</Mono>
                      <span className="text-[10px] text-muted ms-2">{formatJalaliDay(p.t.slice(0, 10))}</span>
                    </>
                  ) : (
                    formatJalaliDay(p.t)
                  )}
                </td>
                <td className="text-xs text-cyan">{formatBytes(p.rx, 2)}</td>
                <td className="text-xs text-amber">{formatBytes(p.tx, 2)}</td>
                <td className="text-xs font-medium">{formatBytes(Number(p.rx) + Number(p.tx), 2)}</td>
                <td className="text-xs text-muted">{formatBps(p.rx_peak, 0)}</td>
                <td className="text-xs text-muted">{formatBps(p.tx_peak, 0)}</td>
                {!hourly && (
                  <td className="text-xs">
                    {p.source && p.source !== 'agent' ? (
                      <span className="badge bg-amber/15 text-amber">
                        {p.source === 'vnstat' ? 'vnstat' : 'دستی'}
                      </span>
                    ) : (
                      <span className="text-muted">ایجنت</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-panel2">
              <td className="text-xs font-bold">جمع</td>
              <td className="text-xs font-bold text-cyan">{formatBytes(data.totals.rx, 2)}</td>
              <td className="text-xs font-bold text-amber">{formatBytes(data.totals.tx, 2)}</td>
              <td className="text-xs font-bold">{formatBytes(data.totals.rx + data.totals.tx, 2)}</td>
              <td className="text-xs font-bold text-muted">{formatBps(data.totals.rx_peak, 0)}</td>
              <td className="text-xs font-bold text-muted">{formatBps(data.totals.tx_peak, 0)}</td>
              {!hourly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-4 py-2.5 text-[11px] text-muted/70 border-t border-line/60">
        مجموع بازه: {faFloat(data.totals.rx / Math.pow(1024, 4), 3)} ترابایت دانلود و{' '}
        {faFloat(data.totals.tx / Math.pow(1024, 4), 3)} ترابایت آپلود.
      </p>
    </section>
  );
}
