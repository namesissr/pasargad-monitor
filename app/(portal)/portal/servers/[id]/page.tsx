'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Chart } from '@/components/Chart';
import { Notice } from '@/components/ui';
import {
  faNum,
  formatBytes,
  formatBps,
  formatFromGb,
  formatJalaliDay,
  formatJalaliTime,
  formatPercent,
  timeAgo,
  INCIDENT_KIND_LABEL,
} from '@/lib/format';

interface Detail {
  server: {
    id: number;
    name: string;
    hostname: string | null;
    main_ip: string | null;
    status: string;
    os: string | null;
    cpu_model: string | null;
    cpu_cores: number | null;
    location: string | null;
    port_mbps: number | null;
    ram_total_bytes: number | null;
    disk_total_bytes: number | null;
    last_seen_at: string | null;
    renews_at: string | null;
    created_at: string;
    traffic_counted_from: string | null;
    traffic_purchased_gb: number;
    traffic_used_gb: number;
    traffic_balance_gb: number;
    metric_ts: string | null;
    cpu_percent: number | null;
    ram_used_bytes: number | null;
    disk_used_bytes: number | null;
    load1: number | null;
    rx_bps: number | null;
    tx_bps: number | null;
    uptime_sec: number | null;
  };
  range: string;
  points: Record<string, number | string>[];
  daily: { day: string; rx: number; tx: number; uptime_ratio: number | null }[];
  monthly: { label: string; rx: number; tx: number; days: number }[];
  topups: { id: number; gb: number; note: string | null; created_at: string }[];
  ips: { ip: string; ptr: string | null; is_primary: boolean }[];
  incidents: {
    id: number;
    kind: string;
    severity: string;
    message: string;
    started_at: string;
    resolved_at: string | null;
    duration_sec: number | null;
  }[];
  period: { label: string; from: string; to: string; rx: number; tx: number };
}

const STATUS: Record<string, { label: string; cls: string }> = {
  up: { label: 'در دسترس', cls: 'bg-ok/15 text-ok' },
  down: { label: 'قطع', cls: 'bg-danger/15 text-danger' },
  maintenance: { label: 'تعمیرات', cls: 'bg-amber/15 text-amber' },
  unknown: { label: 'نامشخص', cls: 'bg-line text-muted' },
};

const RANGES = [
  ['24h', '۲۴ ساعت'],
  ['7d', '۷ روز'],
  ['30d', '۳۰ روز'],
  ['90d', '۹۰ روز'],
] as const;

/**
 * برچسب محور زمان.
 *
 * نقطه‌های بازه کوتاه «YYYY-MM-DD HH:MM» اند و بازه بلند «YYYY-MM-DD».
 * طول رشته تفکیکشان می‌کند: ساعت برای بازه کوتاه، تاریخ برای بلند.
 */
function chartTime(t: string) {
  if (!t) return '';
  return t.length <= 10 ? formatJalaliDay(t) : faNum(t.slice(11, 16));
}

/** مدت روشن بودن، به شکل خوانا */
function uptime(sec: number | null) {
  if (!sec || sec < 60) return '—';
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  if (days) return `${faNum(days)} روز و ${faNum(hours)} ساعت`;
  return `${faNum(hours)} ساعت`;
}

export default function PortalServerPage() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState('24h');
  const { data, loading, error, reload } = useLoad<Detail>(
    id ? `/api/portal/servers/${id}?range=${range}` : null,
    30_000,
  );

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const s = data.server;
  const st = STATUS[s.status] || STATUS.unknown;
  const ramPct =
    s.ram_used_bytes && s.ram_total_bytes ? (s.ram_used_bytes / s.ram_total_bytes) * 100 : null;
  const diskPct =
    s.disk_used_bytes && s.disk_total_bytes ? (s.disk_used_bytes / s.disk_total_bytes) * 100 : null;

  const purchased = Number(s.traffic_purchased_gb) || 0;
  const trafficPct = purchased > 0 ? Math.min(100, (s.traffic_used_gb / purchased) * 100) : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/portal" className="text-xs text-muted hover:text-cyan">
            → بازگشت به فهرست سرورها
          </Link>
          <h1 className="text-lg font-bold mt-1">
            {s.name}
            <span className={`badge ms-2 ${st.cls}`}>{st.label}</span>
          </h1>
          <p className="text-xs text-muted mt-0.5 ltr break-anywhere">
            {s.main_ip}
            {s.hostname && ` · ${s.hostname}`}
          </p>
        </div>
        <div className="text-xs text-muted text-end">
          {s.status === 'up' ? (
            <>روشن از {uptime(s.uptime_sec)}</>
          ) : (
            s.last_seen_at && <>آخرین ارتباط {timeAgo(s.last_seen_at)}</>
          )}
          {s.renews_at && <div className="mt-0.5">تمدید: {formatJalaliDay(s.renews_at)}</div>}
        </div>
      </div>

      {/* ── ترافیک: مهم‌ترین عدد، پس اول ────────────────────── */}
      <section className="card p-4 sm:p-5">
        <h2 className="text-sm font-bold mb-3">ترافیک</h2>

        {purchased > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Stat label="خریداری‌شده" value={formatFromGb(purchased)} />
              <Stat label="مصرف‌شده" value={formatFromGb(s.traffic_used_gb)} />
              <Stat
                label="باقی‌مانده"
                value={formatFromGb(Math.max(0, s.traffic_balance_gb))}
                tone={s.traffic_balance_gb <= 0 ? 'danger' : 'ok'}
              />
            </div>

            {trafficPct !== null && (
              <>
                <div className="h-2 rounded-full bg-line overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      trafficPct >= 90 ? 'bg-danger' : trafficPct >= 75 ? 'bg-amber' : 'bg-cyan'
                    }`}
                    style={{ width: `${trafficPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted mt-2 leading-relaxed">
                  {formatPercent(trafficPct)} مصرف شده. محاسبه بر اساس ترافیک دانلود است و
                  ترافیک خریداری‌شده انقضا ندارد.
                  {s.traffic_counted_from && (
                    <> شمارش از {formatJalaliDay(s.traffic_counted_from)}.</>
                  )}
                </p>
              </>
            )}
          </>
        ) : (
          <Notice type="warn">
            برای این سرور ترافیکی ثبت نشده. اگر فکر می‌کنید اشتباهی رخ داده، با پشتیبانی تماس
            بگیرید.
          </Notice>
        )}
      </section>

      {/* ── وضعیت لحظه‌ای ──────────────────────────────────── */}
      <section className="card p-4 sm:p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-bold">وضعیت لحظه‌ای</h2>
          {s.metric_ts && (
            <span className="text-[11px] text-muted">آخرین گزارش {timeAgo(s.metric_ts)}</span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label="پردازنده"
            value={s.cpu_percent === null ? '—' : formatPercent(s.cpu_percent)}
          />
          <Stat label="حافظه" value={ramPct === null ? '—' : formatPercent(ramPct)} />
          <Stat label="دیسک" value={diskPct === null ? '—' : formatPercent(diskPct)} />
          <Stat label="بار سیستم" value={s.load1 === null ? '—' : faNum(s.load1.toFixed(2))} />
          <Stat label="دانلود لحظه‌ای" value={formatBps(s.rx_bps ?? 0)} />
          <Stat label="آپلود لحظه‌ای" value={formatBps(s.tx_bps ?? 0)} />
          <Stat label={`دانلود ${data.period.label}`} value={formatBytes(data.period.rx)} />
          <Stat label={`آپلود ${data.period.label}`} value={formatBytes(data.period.tx)} />
        </div>
      </section>

      {/* ── نمودار ─────────────────────────────────────────── */}
      <section className="card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="text-sm font-bold">نمودار</h2>
          <div className="flex gap-1">
            {RANGES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
                  range === key
                    ? 'bg-cyan/10 text-cyan border-cyan/30'
                    : 'border-line text-muted hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!data.points.length ? (
          <p className="text-xs text-muted text-center py-8">برای این بازه داده‌ای ثبت نشده.</p>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-[11px] text-muted mb-2">ترافیک</p>
              <Chart
                series={[
                  { key: 'rx_bps', label: 'دانلود', color: '#3ed6c5' },
                  { key: 'tx_bps', label: 'آپلود', color: '#f2b44c' },
                ]}
                points={data.points}
                format={(v) => formatBps(v)}
                formatTime={chartTime}
              />
            </div>
            <div>
              <p className="text-[11px] text-muted mb-2">پردازنده و حافظه</p>
              <Chart
                series={[
                  { key: 'cpu', label: 'پردازنده', color: '#3ed6c5' },
                  { key: 'ram_pct', label: 'حافظه', color: '#7c8aa0' },
                ]}
                points={data.points}
                format={(v) => formatPercent(v, 0)}
                formatTime={chartTime}
                maxValue={100}
              />
            </div>
          </div>
        )}
      </section>

      {/* ── مصرف روزانه ────────────────────────────────────── */}
      <section className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">مصرف روزانه</h2>
          <p className="text-[11px] text-muted mt-0.5">سی روز اخیر</p>
        </div>
        {!data.daily.length ? (
          <p className="p-6 text-center text-xs text-muted">داده‌ای ثبت نشده.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl sm:min-w-[520px]">
              <thead>
                <tr>
                  <th>روز</th>
                  <th>دانلود</th>
                  <th>آپلود</th>
                  <th className="col-sm">مجموع</th>
                  <th className="col-md">در دسترس</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr key={d.day}>
                    <td className="text-xs sm:whitespace-nowrap">{formatJalaliDay(d.day)}</td>
                    <td className="text-xs text-cyan">{formatBytes(d.rx, 2)}</td>
                    <td className="text-xs text-amber">{formatBytes(d.tx, 2)}</td>
                    <td className="text-xs col-sm">{formatBytes(Number(d.rx) + Number(d.tx), 2)}</td>
                    <td className="text-xs text-muted col-md">
                      {d.uptime_ratio === null ? '—' : formatPercent(d.uptime_ratio * 100, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── گزارش ماهانه ───────────────────────────────────── */}
      <section className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">گزارش ماهانه</h2>
        </div>
        <div className="table-wrap">
          <table className="tbl sm:min-w-[480px]">
            <thead>
              <tr>
                <th>ماه</th>
                <th>دانلود</th>
                <th>آپلود</th>
                <th className="col-sm">مجموع</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m) => (
                <tr key={m.label}>
                  <td className="text-xs sm:whitespace-nowrap">{m.label}</td>
                  <td className="text-xs text-cyan">{formatBytes(m.rx, 2)}</td>
                  <td className="text-xs text-amber">{formatBytes(m.tx, 2)}</td>
                  <td className="text-xs col-sm">{formatBytes(Number(m.rx) + Number(m.tx), 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ── خریدهای ترافیک ───────────────────────────────── */}
        <section className="card overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-line">
            <h2 className="text-sm font-bold">خرید ترافیک این سرور</h2>
          </div>
          {!data.topups.length ? (
            <p className="p-6 text-center text-xs text-muted">خریدی ثبت نشده.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {data.topups.map((t) => (
                <li key={t.id} className="px-4 sm:px-5 py-2.5 flex items-center gap-3 text-xs">
                  <span className={t.gb < 0 ? 'text-danger' : 'text-ok'}>
                    {t.gb > 0 ? '+' : ''}
                    {formatFromGb(t.gb)}
                  </span>
                  <span className="text-muted truncate flex-1">{t.note || ''}</span>
                  <span className="text-muted shrink-0">{formatJalaliDay(t.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── آی‌پی‌ها ──────────────────────────────────────── */}
        <section className="card overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-line">
            <h2 className="text-sm font-bold">آی‌پی‌ها ({faNum(data.ips.length)})</h2>
          </div>
          {!data.ips.length ? (
            <p className="p-6 text-center text-xs text-muted">آی‌پی‌ای ثبت نشده.</p>
          ) : (
            <ul className="divide-y divide-line/60 max-h-64 overflow-y-auto">
              {data.ips.map((ip) => (
                <li key={ip.ip} className="px-4 sm:px-5 py-2 flex items-center gap-2 text-xs">
                  <span className="ltr font-mono">{ip.ip}</span>
                  {ip.is_primary && <span className="badge bg-cyan/15 text-cyan">اصلی</span>}
                  {ip.ptr && <span className="text-muted truncate ltr">{ip.ptr}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── رویدادها ───────────────────────────────────────── */}
      <section className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">رویدادهای اخیر</h2>
          <p className="text-[11px] text-muted mt-0.5">قطعی‌ها و هشدارهای این سرور</p>
        </div>
        {!data.incidents.length ? (
          <p className="p-6 text-center text-xs text-muted">
            رویدادی ثبت نشده — سرور بدون مشکل کار کرده.
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {data.incidents.map((inc) => (
              <li key={inc.id} className="px-4 sm:px-5 py-3 text-xs">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <span
                    className={`badge border ${
                      inc.resolved_at
                        ? 'bg-ok/15 text-ok border-ok/30'
                        : 'bg-danger/15 text-danger border-danger/30'
                    }`}
                  >
                    {INCIDENT_KIND_LABEL[inc.kind] ?? inc.kind}
                    {inc.resolved_at ? ' — برطرف شد' : ' — باز'}
                  </span>
                  <span className="text-muted" title={formatJalaliTime(inc.started_at)}>
                    {timeAgo(inc.started_at)}
                  </span>
                </div>
                <p className="mt-1.5 text-muted leading-relaxed">{inc.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── مشخصات ─────────────────────────────────────────── */}
      <section className="card p-4 sm:p-5">
        <h2 className="text-sm font-bold mb-3">مشخصات</h2>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
          {[
            ['سیستم عامل', s.os || '—'],
            ['پردازنده', s.cpu_model || '—'],
            ['تعداد هسته', s.cpu_cores ? faNum(s.cpu_cores) : '—'],
            ['حافظه', s.ram_total_bytes ? formatBytes(s.ram_total_bytes, 0) : '—'],
            ['دیسک', s.disk_total_bytes ? formatBytes(s.disk_total_bytes, 0) : '—'],
            ['ظرفیت پورت', s.port_mbps ? `${faNum(s.port_mbps)} مگابیت` : '—'],
            ['موقعیت', s.location || '—'],
            ['تاریخ تحویل', formatJalaliDay(s.created_at)],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between gap-3 border-b border-line/40 pb-1.5">
              <dt className="text-muted shrink-0">{k}</dt>
              <dd className="text-end truncate">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'danger';
}) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={`mt-0.5 text-sm font-medium ${
          tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}
