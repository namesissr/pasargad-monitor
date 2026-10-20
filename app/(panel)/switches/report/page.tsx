'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { JalaliDatePicker } from '@/components/JalaliDatePicker';
import { Mono, StatCard } from '@/components/ui';
import { faNum, formatBps, formatBytes, formatJalaliDay, formatPercent } from '@/lib/format';

interface Row {
  port_id: number;
  switch_id: number;
  switch_name: string;
  port: string;
  kind: string;
  description: string | null;
  speed_mbps: number | null;
  server_id: number | null;
  server_name: string | null;
  customer_name: string | null;
  in_bytes: number;
  out_bytes: number;
  in_peak: number;
  out_peak: number;
  errors: number;
  discards: number;
  p95_in: number | null;
  p95_out: number | null;
  p95: number | null;
  samples: number;
  flaps: number;
  avg_util: number | null;
}

type SortKey = 'port' | 'total' | 'p95' | 'peak' | 'util' | 'errors' | 'flaps';

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoOf(d);
};

/**
 * گزارش پورت‌های سوییچ: حجم، اوج، صدک ۹۵، بهره‌وری، خطا و قطع و وصل در
 * یک بازه. صدک ۹۵ همان عددی است که دیتاسنتر با آن پهنای باند را فاکتور
 * می‌کند؛ اینجا برای مقایسه با فاکتور و پیدا کردن پورت‌های پرمصرف.
 */
export default function SwitchReportPage() {
  const [period, setPeriod] = useState<'current' | 'previous' | 'custom'>('current');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoOf(new Date()));
  const [switchId, setSwitchId] = useState('');
  const [hideIdle, setHideIdle] = useState(true);
  const [sort, setSort] = useState<SortKey>('p95');

  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get('switch_id');
    if (sid) setSwitchId(sid);
  }, []);

  const switches = useLoad<{ switches: { id: number; name: string }[] }>('/api/switches');
  const qs = new URLSearchParams();
  if (period === 'custom') {
    qs.set('from', from);
    qs.set('to', to);
  } else {
    qs.set('period', period);
  }
  if (switchId) qs.set('switch_id', switchId);
  const report = useLoad<{ from: string; to: string; label: string; rows: Row[] }>(`/api/switches/report?${qs}`);

  const rows = useMemo(() => {
    const list = (report.data?.rows ?? []).filter((r) => !hideIdle || r.in_bytes + r.out_bytes > 0);
    const val = (r: Row): number => {
      switch (sort) {
        case 'total':
          return r.in_bytes + r.out_bytes;
        case 'p95':
          return r.p95 ?? -1;
        case 'peak':
          return Math.max(r.in_peak, r.out_peak);
        case 'util':
          return r.avg_util ?? -1;
        case 'errors':
          return r.errors;
        case 'flaps':
          return r.flaps;
        default:
          return 0;
      }
    };
    return sort === 'port' ? list : [...list].sort((a, b) => val(b) - val(a));
  }, [report.data, hideIdle, sort]);

  const totalIn = rows.reduce((s, r) => s + r.in_bytes, 0);
  const totalOut = rows.reduce((s, r) => s + r.out_bytes, 0);
  const totalErrors = rows.reduce((s, r) => s + r.errors, 0);
  // پورتی که ترافیک دارد ولی نمونه پنج‌دقیقه‌ای نه: بازه از نگهداری قدیمی‌تر است
  const partial = rows.some((r) => r.samples === 0 && r.in_bytes + r.out_bytes > 0);

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className={`hover:text-cyan ${sort === key ? 'text-cyan' : ''}`}
      title="مرتب‌سازی"
    >
      {label}
      {sort === key && key !== 'port' ? ' ↓' : ''}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/switches" className="text-muted hover:text-cyan text-sm">
              سوییچ‌ها
            </Link>
            <span className="text-muted">/</span>
            <h1 className="text-lg font-bold">گزارش پورت‌ها</h1>
          </div>
          <p className="text-xs text-muted mt-1">
            حجم، اوج، صدک ۹۵ و بهره‌وری هر پورت. صدک ۹۵ از نمونه‌های پنج‌دقیقه‌ای و روی بزرگ‌ترِ ورودی و خروجی
            حساب می‌شود — همان روش فاکتور پهنای باند دیتاسنترها.
          </p>
        </div>
        <a href={`/api/switches/report?${qs}&format=csv`} className="btn-ghost" download>
          خروجی CSV
        </a>
      </div>

      <div className="card p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div>
          <label className="label">بازه</label>
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="current">ماه جاری</option>
            <option value="previous">ماه قبل</option>
            <option value="custom">بازه دلخواه</option>
          </select>
        </div>
        {period === 'custom' && (
          <>
            <JalaliDatePicker label="از تاریخ" value={from} onChange={setFrom} max={to} />
            <JalaliDatePicker label="تا تاریخ" value={to} onChange={setTo} min={from} max={isoOf(new Date())} />
          </>
        )}
        <div>
          <label className="label">سوییچ</label>
          <select className="input" value={switchId} onChange={(e) => setSwitchId(e.target.value)}>
            <option value="">همه سوییچ‌ها</option>
            {(switches.data?.switches ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer pb-2">
          <input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} />
          پورت‌های بی‌ترافیک پنهان
        </label>
      </div>

      {!report.data ? (
        <LoadState loading={report.loading} error={report.error} onRetry={report.reload}>
          {null}
        </LoadState>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              title="بازه"
              value={report.data.label || `${formatJalaliDay(report.data.from)} تا ${formatJalaliDay(report.data.to)}`}
              sub={report.data.label ? `${formatJalaliDay(report.data.from)} تا ${formatJalaliDay(report.data.to)}` : undefined}
            />
            <StatCard title="مجموع ورودی" value={formatBytes(totalIn)} tone="cyan" sub="از سرورها به سوییچ" />
            <StatCard title="مجموع خروجی" value={formatBytes(totalOut)} tone="cyan" sub="از سوییچ به سرورها" />
            <StatCard title="خطای پورت‌ها" value={faNum(totalErrors)} tone={totalErrors > 0 ? 'warn' : 'default'} />
          </div>
          {report.error && <p className="text-xs text-danger">{report.error}</p>}

          <section className="card">
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{sortBtn('port', 'پورت')}</th>
                    <th className="col-sm">سرور</th>
                    <th>{sortBtn('total', 'حجم')}</th>
                    <th>{sortBtn('p95', 'صدک ۹۵')}</th>
                    <th className="col-md">{sortBtn('peak', 'اوج')}</th>
                    <th className="col-md">{sortBtn('util', 'میانگین بهره‌وری')}</th>
                    <th className="col-sm">{sortBtn('errors', 'خطا')}</th>
                    <th className="col-sm">{sortBtn('flaps', 'قطع')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.port_id}>
                      <td>
                        <Link href={`/switches/${r.switch_id}`} className="hover:text-cyan">
                          {!switchId && <span className="text-[11px] text-muted me-1">{r.switch_name} /</span>}
                          <Mono>{r.port}</Mono>
                        </Link>
                        <span className="block text-[10px] text-muted">
                          {[r.speed_mbps ? `${faNum(r.speed_mbps >= 1000 ? r.speed_mbps / 1000 : r.speed_mbps)}${r.speed_mbps >= 1000 ? 'G' : 'M'}` : null, r.description]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </td>
                      <td className="col-sm text-xs">
                        {r.server_id ? (
                          <Link href={`/servers/${r.server_id}`} className="hover:text-cyan">
                            {r.server_name}
                            {r.customer_name && <span className="block text-[10px] text-muted">{r.customer_name}</span>}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        <span className="block">
                          <span className="text-cyan text-[10px] me-1">ورودی</span>
                          {formatBytes(r.in_bytes)}
                        </span>
                        <span className="block">
                          <span className="text-amber text-[10px] me-1">خروجی</span>
                          {formatBytes(r.out_bytes)}
                        </span>
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        {r.p95 === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <>
                            <span className="block font-bold">{formatBps(r.p95)}</span>
                            <span className="block text-[10px] text-muted">
                              ورودی {formatBps(r.p95_in, 0)} · خروجی {formatBps(r.p95_out, 0)}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="col-md text-xs whitespace-nowrap">{formatBps(Math.max(r.in_peak, r.out_peak))}</td>
                      <td className="col-md text-xs">
                        {r.avg_util === null ? '—' : formatPercent(r.avg_util, r.avg_util < 1 ? 2 : 1)}
                      </td>
                      <td className={`col-sm text-xs ${r.errors > 0 ? 'text-amber' : 'text-muted'}`}>{faNum(r.errors)}</td>
                      <td className={`col-sm text-xs ${r.flaps > 0 ? 'text-amber' : 'text-muted'}`}>{faNum(r.flaps)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-muted text-xs py-8">
                        در این بازه پورتی با ترافیک نیست.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {partial && (
            <p className="text-[11px] text-muted">
              صدک ۹۵ فقط از روزهایی است که تجمیع پنج‌دقیقه‌ای دارند (نگهداری در تنظیمات پایش). داده پیش از نصب این نسخه
              صدک ندارد.
            </p>
          )}
        </>
      )}
    </div>
  );
}
