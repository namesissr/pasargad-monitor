'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Chart, UsageBar } from '@/components/Chart';
import { Field, IpBadge, Modal, Mono, Notice, StatCard, StatusBadge } from '@/components/ui';
import { InstallInstructions } from '@/components/InstallInstructions';
import { DIRECTION_LABEL, type BillingDirection } from '@/lib/billing';
import { api, ApiError } from '@/lib/api';
import {
  faFloat,
  faNum,
  formatBps,
  formatBytes,
  formatJalaliDay,
  formatDuration,
  formatJalaliTime,
  formatMbps,
  formatPercent,
  formatTB,
  formatToman,
  timeAgo,
  INCIDENT_KIND_LABEL,
} from '@/lib/format';

interface Detail {
  server: {
    id: number;
    name: string;
    hostname: string | null;
    main_ip: string;
    ssh_port: number;
    provider: string | null;
    location: string | null;
    os: string | null;
    cpu_model: string | null;
    cpu_cores: number | null;
    ram_total_bytes: number | null;
    disk_total_bytes: number | null;
    port_mbps: number | null;
    traffic_quota_gb: number | null;
    monthly_cost: number | null;
    customer: string | null;
    agent_token: string;
    agent_version: string | null;
    net_iface: string | null;
    datacenter_id: number | null;
    datacenter_name: string | null;
    price_per_tb: number | null;
    price_per_ip: number | null;
    included_tb: number | null;
    included_ips: number | null;
    status: string;
    last_seen_at: string | null;
    is_active: boolean;
    notes: string | null;
    cpu_percent: number | null;
    ram_used_bytes: number | null;
    disk_used_bytes: number | null;
    swap_used_bytes: number | null;
    swap_total_bytes: number | null;
    load1: number | null;
    load5: number | null;
    load15: number | null;
    rx_bps: number | null;
    tx_bps: number | null;
    uptime_sec: number | null;
    process_count: number | null;
    tcp_conn_count: number | null;
    metric_ts: string | null;
  };
  billing: {
    rates: {
      price_per_tb: number;
      price_per_ip: number;
      included_tb: number;
      included_ips: number;
      billing_direction: BillingDirection;
      tb_base: number;
      overridden: string[];
    };
    cost: {
      used_tb: number;
      included_tb: number;
      billable_tb: number;
      traffic_cost: number;
      ip_count: number;
      billable_ips: number;
      ip_cost: number;
      rent: number;
      total: number;
      quota_percent: number | null;
    };
  } | null;
  traffic: {
    today: { rx: number; tx: number };
    month: { rx: number; tx: number; label: string };
    year: { rx: number; tx: number; label: string };
  };
  uptime30: number | null;
  uptimeDays: number;
  ips: {
    id: number;
    ip: string;
    version: number;
    status: string;
    ptr: string | null;
    customer: string | null;
    is_monitored: boolean;
    ping_ok: boolean | null;
    ping_ms: number | null;
    last_ping_at: string | null;
  }[];
  incidents: {
    id: number;
    kind: string;
    severity: string;
    message: string;
    started_at: string;
    resolved_at: string | null;
    ack_at: string | null;
  }[];
}

interface Points {
  points: Record<string, unknown>[];
  source: string;
}

const RANGES = [
  { key: '1h', label: '۱ ساعت' },
  { key: '6h', label: '۶ ساعت' },
  { key: '24h', label: '۲۴ ساعت' },
  { key: '7d', label: '۷ روز' },
  { key: '30d', label: '۳۰ روز' },
  { key: '90d', label: '۳ ماه' },
  { key: '1y', label: '۱ سال' },
];

export default function ServerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [range, setRange] = useState('6h');
  const [editing, setEditing] = useState(false);
  const [showAgent, setShowAgent] = useState(false);

  const detail = useLoad<Detail>(id ? `/api/servers/${id}` : null, 10_000);
  const metrics = useLoad<Points>(id ? `/api/servers/${id}/metrics?range=${range}` : null, 30_000);
  const dcs = useLoad<{ datacenters: { id: number; name: string }[] }>('/api/datacenters');

  // خطای بارگذاری دوره‌ای نباید صفحه سرور را خالی کند
  if (!detail.data) {
    return (
      <LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {null}
      </LoadState>
    );
  }

  const d = detail.data;
  const s = d.server;
  const ramPct = s.ram_used_bytes && s.ram_total_bytes ? (s.ram_used_bytes / s.ram_total_bytes) * 100 : 0;
  const diskPct = s.disk_used_bytes && s.disk_total_bytes ? (s.disk_used_bytes / s.disk_total_bytes) * 100 : 0;
  const quotaBytes = Number(s.traffic_quota_gb ?? 0) * Math.pow(1024, 3);
  const points = metrics.data?.points ?? [];
  const isLongRange = ['7d', '30d', '90d', '1y'].includes(range);

  // اوج هر جهت در بازه نمایش‌داده‌شده، و مقیاس مشترک دو نمودار
  const peakOf = (key: string) =>
    points.reduce((m, pt) => Math.max(m, Number(pt[key]) || 0), 0);
  const peakRx = peakOf('rx_bps');
  const peakTx = peakOf('tx_bps');
  const speedScale = Math.max(peakRx, peakTx) * 1.15 || 1;
  const volumeScale = Math.max(peakOf('rx_bytes'), peakOf('tx_bytes')) * 1.15 || 1;

  // کدام جهت پول دارد، طبق قرارداد دیتاسنتر
  const dir = d.billing?.rates.billing_direction;
  const monthRx = Number(d.traffic.month.rx);
  const monthTx = Number(d.traffic.month.tx);
  const rxBilled = dir === 'in' || dir === 'total' || (dir === 'max' && monthRx >= monthTx);
  const txBilled = dir === 'out' || dir === 'total' || (dir === 'max' && monthTx > monthRx);

  /**
   * حجمی که واقعاً پول دارد، طبق قرارداد دیتاسنتر.
   * بدون دیتاسنتر به مجموع دو جهت برمی‌گردد — همان رفتار قبلی.
   */
  const billableOf = (rx: number | string, tx: number | string) => {
    const r = Number(rx) || 0;
    const t = Number(tx) || 0;
    if (dir === 'in') return r;
    if (dir === 'out') return t;
    if (dir === 'max') return Math.max(r, t);
    return r + t;
  };

  // نوار سهمیه هم همان جهتی را می‌شمارد که دیتاسنتر حساب می‌کند
  const monthBytes = billableOf(d.traffic.month.rx, d.traffic.month.tx);

  // رشته زمان از سرور در منطقه زمانی گزارش آمده و از Date عبور نمی‌کند،
  // پس منطقه زمانی مرورگر بازدیدکننده روی برچسب اثر ندارد
  const timeLabel = (t: string) => {
    if (!t) return '';
    if (t.length <= 10) return formatJalaliDay(t);  // YYYY-MM-DD
    return faNum(t.slice(11, 16));                  // HH:MM
  };

  return (
    <div className="space-y-5">
      {/* سرتیتر */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/servers" className="text-muted hover:text-cyan text-sm">
              سرورها
            </Link>
            <span className="text-muted">/</span>
            <h1 className="text-lg font-bold">{s.name}</h1>
            <StatusBadge status={s.status} />
            {!s.is_active && <span className="badge bg-line text-muted">بایگانی‌شده</span>}
          </div>
          <p className="text-xs text-muted mt-1">
            <Mono>{s.main_ip}</Mono>
            {s.hostname && <> · {s.hostname}</>}
            {s.datacenter_name && <> · {s.datacenter_name}</>}
            {s.location && <> · {s.location}</>}
            {s.os && <> · {s.os}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => setShowAgent(true)}>
            نصب ایجنت
          </button>
          <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
            ویرایش
          </button>
        </div>
      </div>

      {detail.error && (
        <div className="border border-danger/30 bg-danger/10 text-danger rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-3">
          <span>آخرین به‌روزرسانی ناموفق بود: {detail.error}</span>
          <button type="button" onClick={detail.reload} className="underline shrink-0">تلاش دوباره</button>
        </div>
      )}

      {s.status !== 'up' && (
        <Notice type="error">
          این سرور {s.status === 'down' ? 'قطع است' : 'وضعیت نامشخصی دارد'}. آخرین گزارش ایجنت:{' '}
          {formatJalaliTime(s.last_seen_at)} ({timeAgo(s.last_seen_at)})
        </Notice>
      )}

      {/* کارت‌های وضعیت */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard
          title="پردازنده"
          value={formatPercent(s.cpu_percent, 1)}
          sub={`${faNum(s.cpu_cores ?? 0)} هسته · بار ${faNum((s.load1 ?? 0).toFixed(2))}`}
          tone={(s.cpu_percent ?? 0) > 90 ? 'danger' : (s.cpu_percent ?? 0) > 75 ? 'warn' : 'default'}
        />
        <StatCard
          title="حافظه"
          value={formatPercent(ramPct, 1)}
          sub={`${formatBytes(s.ram_used_bytes)} از ${formatBytes(s.ram_total_bytes)}`}
          tone={ramPct > 90 ? 'danger' : ramPct > 75 ? 'warn' : 'default'}
        />
        <StatCard
          title="دیسک"
          value={formatPercent(diskPct, 1)}
          sub={`${formatBytes(s.disk_used_bytes)} از ${formatBytes(s.disk_total_bytes)}`}
          tone={diskPct > 90 ? 'danger' : diskPct > 75 ? 'warn' : 'default'}
        />
        <StatCard
          title="دانلود لحظه‌ای"
          value={formatMbps(s.rx_bps)}
          sub={`آپلود: ${formatMbps(s.tx_bps)}`}
          tone="cyan"
        />
        <StatCard title="آپ‌تایم" value={formatDuration(s.uptime_sec)} sub={`از زمان آخرین راه‌اندازی`} />
        <StatCard
          title="در دسترس بودن ۳۰ روز"
          value={d.uptime30 === null ? '—' : formatPercent(d.uptime30, 2)}
          sub={`بر پایه ${faNum(d.uptimeDays)} روز داده`}
          tone={d.uptime30 !== null && d.uptime30 < 99 ? 'warn' : 'ok'}
        />
      </div>

      {/* مصرف ترافیک */}
      <section className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-sm font-bold">مصرف ترافیک</h2>
          <span className="text-[11px] text-muted">
            عدد بزرگ: {d.billing ? DIRECTION_LABEL[d.billing.rates.billing_direction] : 'مجموع دو جهت'}
          </span>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mb-4">
          {[
            { label: 'امروز', v: d.traffic.today },
            { label: d.traffic.month.label, v: d.traffic.month },
            { label: d.traffic.year.label, v: d.traffic.year },
          ].map((row) => (
            <div key={row.label} className="bg-panel2 rounded-lg p-3">
              <p className="text-[11px] text-muted mb-1.5">{row.label}</p>
              <p className="text-lg font-bold">{formatTB(billableOf(row.v.rx, row.v.tx))}</p>
              <p className="text-[11px] text-muted mt-1">
                <span className="text-cyan">↓</span> {formatBytes(row.v.rx)} ·{' '}
                <span className="text-amber">↑</span> {formatBytes(row.v.tx)}
              </p>
            </div>
          ))}
        </div>

        {quotaBytes > 0 ? (
          <UsageBar
            percent={(monthBytes / quotaBytes) * 100}
            label={`سهمیه ${d.traffic.month.label}`}
            right={`${formatTB(monthBytes, 2)} از ${formatTB(quotaBytes, 2)}`}
          />
        ) : (
          <p className="text-[11px] text-muted">سهمیه ترافیک برای این سرور تعریف نشده — نامحدود در نظر گرفته می‌شود.</p>
        )}
      </section>

      {/* حسابداری */}
      {d.billing && (
        <section className="card p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="text-sm font-bold">هزینه {d.traffic.month.label}</h2>
            <Link href={`/billing?datacenter_id=${s.datacenter_id ?? 'all'}`} className="text-xs text-muted hover:text-cyan">
              حسابداری کامل ←
            </Link>
          </div>

          {!s.datacenter_id ? (
            <Notice type="info">
              این سرور به دیتاسنتری وصل نیست، پس هزینه ترافیک و آی‌پی برایش محاسبه نمی‌شود.
              از دکمه «ویرایش» دیتاسنترش را مشخص کنید.
            </Notice>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <div className="bg-panel2 rounded-lg p-3">
                  <p className="text-[11px] text-muted mb-1">هزینه ترافیک</p>
                  <p className="text-base font-bold">{formatToman(d.billing.cost.traffic_cost)}</p>
                  <p className="text-[10px] text-muted mt-1">
                    {faFloat(d.billing.cost.billable_tb, 3)} از {faFloat(d.billing.cost.used_tb, 3)} ترابایت
                  </p>
                </div>
                <div className="bg-panel2 rounded-lg p-3">
                  <p className="text-[11px] text-muted mb-1">هزینه آی‌پی</p>
                  <p className="text-base font-bold">{formatToman(d.billing.cost.ip_cost)}</p>
                  <p className="text-[10px] text-muted mt-1">
                    {faNum(d.billing.cost.billable_ips)} از {faNum(d.billing.cost.ip_count)} آی‌پی پولی است
                  </p>
                </div>
                <div className="bg-panel2 rounded-lg p-3">
                  <p className="text-[11px] text-muted mb-1">اجاره ماهانه</p>
                  <p className="text-base font-bold">{formatToman(d.billing.cost.rent)}</p>
                </div>
                <div className="bg-panel2 rounded-lg p-3 border border-cyan/25">
                  <p className="text-[11px] text-muted mb-1">جمع ماه</p>
                  <p className="text-base font-bold text-cyan">{formatToman(d.billing.cost.total)}</p>
                </div>
              </div>

              {d.billing.cost.included_tb > 0 && (
                <UsageBar
                  percent={d.billing.cost.quota_percent ?? 0}
                  label="سهمیه رایگان دیتاسنتر"
                  right={`${faFloat(d.billing.cost.used_tb, 2)} از ${faFloat(d.billing.cost.included_tb, 2)} ترابایت`}
                />
              )}

              <p className="text-[11px] text-muted/70 mt-3">
                مبنای صورتحساب: {DIRECTION_LABEL[d.billing.rates.billing_direction]} ·
                ترابایت با مبنای {faNum(d.billing.rates.tb_base)} ·
                هر ترابایت {formatToman(d.billing.rates.price_per_tb)} ·
                هر آی‌پی {formatToman(d.billing.rates.price_per_ip)}
                {d.billing.rates.overridden.length > 0 && (
                  <span className="text-amber"> · قیمت اختصاصی این سرور: {d.billing.rates.overridden.join('، ')}</span>
                )}
              </p>
            </>
          )}
        </section>
      )}

      {/* نمودارها */}
      <section className="space-y-3">
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
          {metrics.loading && <span className="text-[11px] text-muted">در حال بارگذاری…</span>}
          {metrics.error && <span className="text-[11px] text-danger">{metrics.error}</span>}
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          <div className="card p-4">
            <h3 className="text-sm font-bold mb-2">پردازنده و حافظه</h3>
            <Chart
              points={points}
              height={200}
              series={[
                { key: 'cpu', label: 'پردازنده', color: '#3ED6C5', percent: true },
                { key: 'ram_pct', label: 'حافظه', color: '#F2B44C', percent: true },
              ]}
              format={(v) => `${faNum(v.toFixed(0))}٪`}
              formatTime={timeLabel}
            />
          </div>

          <div className="card p-4">
            <h3 className="text-sm font-bold mb-2">دیسک و بار سیستم</h3>
            <Chart
              points={points}
              height={180}
              fill={false}
              series={[
                { key: 'disk_pct', label: 'دیسک (درصد)', color: '#F2555A', percent: true },
              ]}
              format={(v) => `${faNum(v.toFixed(0))}٪`}
              formatTime={timeLabel}
            />
          </div>
        </div>
      </section>

      {/* تفکیک دانلود و آپلود */}
      <section className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-sm font-bold">تفکیک دانلود و آپلود</h2>
          <span className="text-[11px] text-muted">
            بازه {RANGES.find((r) => r.key === range)?.label}
            {d.billing && <> · مبنای صورتحساب: {DIRECTION_LABEL[d.billing.rates.billing_direction]}</>}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <TrafficSide
            title="دانلود — دریافتی"
            color="#3ED6C5"
            now={s.rx_bps}
            peak={peakRx}
            today={d.traffic.today.rx}
            month={monthRx}
            monthLabel={d.traffic.month.label}
            billed={rxBilled}
          />
          <TrafficSide
            title="آپلود — ارسالی"
            color="#F2B44C"
            now={s.tx_bps}
            peak={peakTx}
            today={d.traffic.today.tx}
            month={monthTx}
            monthLabel={d.traffic.month.label}
            billed={txBilled}
          />
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-[11px] text-muted mb-1">سرعت دانلود</p>
            <Chart
              points={points}
              height={150}
              maxValue={speedScale}
              series={[{ key: 'rx_bps', label: 'دریافتی', color: '#3ED6C5' }]}
              format={(v) => formatBps(v, 0)}
              formatTime={timeLabel}
            />
          </div>
          <div>
            <p className="text-[11px] text-muted mb-1">سرعت آپلود</p>
            <Chart
              points={points}
              height={150}
              maxValue={speedScale}
              series={[{ key: 'tx_bps', label: 'ارسالی', color: '#F2B44C' }]}
              format={(v) => formatBps(v, 0)}
              formatTime={timeLabel}
            />
          </div>
        </div>

        {isLongRange && (
          <div className="mt-4 pt-4 border-t border-line/60 space-y-3">
            <p className="text-xs font-bold">حجم هر بازه</p>
            <div>
              <p className="text-[11px] text-muted mb-1">دانلود</p>
              <Chart
                points={points}
                height={130}
                maxValue={volumeScale}
                series={[{ key: 'rx_bytes', label: 'دریافتی', color: '#3ED6C5' }]}
                format={(v) => formatBytes(v, 0)}
                formatTime={timeLabel}
              />
            </div>
            <div>
              <p className="text-[11px] text-muted mb-1">آپلود</p>
              <Chart
                points={points}
                height={130}
                maxValue={volumeScale}
                series={[{ key: 'tx_bytes', label: 'ارسالی', color: '#F2B44C' }]}
                format={(v) => formatBytes(v, 0)}
                formatTime={timeLabel}
              />
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted/70 mt-3">
          دو نمودار عمداً روی یک مقیاس‌اند تا نسبت دانلود به آپلود درست دیده شود. اگر هرکدام
          مقیاس خودش را داشت، آپلود کوچک هم‌اندازه دانلود بزرگ به نظر می‌رسید.
        </p>
      </section>

      {/* مشخصات و آی‌پی‌ها */}
      <div className="grid lg:grid-cols-3 gap-3">
        <section className="card p-4">
          <h2 className="text-sm font-bold mb-3">مشخصات</h2>
          <dl className="text-xs space-y-2">
            {[
              ['پردازنده', s.cpu_model ? `${s.cpu_model} (${faNum(s.cpu_cores ?? 0)} هسته)` : '—'],
              ['حافظه', formatBytes(s.ram_total_bytes)],
              ['دیسک', formatBytes(s.disk_total_bytes)],
              ['سواپ', s.swap_total_bytes ? `${formatBytes(s.swap_used_bytes)} از ${formatBytes(s.swap_total_bytes)}` : '—'],
              ['ظرفیت پورت', s.port_mbps ? `${faNum(s.port_mbps)} مگابیت` : '—'],
              ['پردازه‌ها', s.process_count ? faNum(s.process_count) : '—'],
              ['اتصال‌های TCP', s.tcp_conn_count ? faNum(s.tcp_conn_count) : '—'],
              ['هزینه ماهانه', formatToman(s.monthly_cost)],
              ['دیتاسنتر', s.datacenter_name || 'وصل نشده'],
              ['مشتری', s.customer || '—'],
              ['نسخه ایجنت', s.agent_version || 'نصب نشده'],
              ['رابط شمرده‌شده', s.net_iface || '—'],
              ['آخرین گزارش', s.metric_ts ? timeAgo(s.metric_ts) : 'هرگز'],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-3">
                <dt className="text-muted shrink-0">{k}</dt>
                <dd className="text-end truncate">{v}</dd>
              </div>
            ))}
          </dl>
          {s.notes && <p className="text-xs text-muted mt-3 pt-3 border-t border-line/60">{s.notes}</p>}
        </section>

        <section className="card lg:col-span-2 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-bold">آی‌پی‌های این سرور ({faNum(d.ips.length)})</h2>
            <Link href={`/ips?server_id=${s.id}`} className="text-xs text-muted hover:text-cyan">
              مدیریت ←
            </Link>
          </div>
          {d.ips.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted">آی‌پی‌ای به این سرور تخصیص نیافته است.</p>
          ) : (
            <div className="table-wrap">
              <table className="tbl min-w-[520px]">
                <thead>
                  <tr>
                    <th>آی‌پی</th>
                    <th>وضعیت</th>
                    <th>رکورد معکوس</th>
                    <th>پینگ</th>
                  </tr>
                </thead>
                <tbody>
                  {d.ips.map((ip) => (
                    <tr key={ip.id}>
                      <td><Mono>{ip.ip}</Mono></td>
                      <td><IpBadge status={ip.status} /></td>
                      <td className="text-xs text-muted truncate max-w-[200px]">{ip.ptr || '—'}</td>
                      <td className="text-xs">
                        {!ip.is_monitored ? (
                          <span className="text-muted">پایش نمی‌شود</span>
                        ) : ip.ping_ok === null ? (
                          <span className="text-muted">—</span>
                        ) : ip.ping_ok ? (
                          <span className="text-ok">{faNum((ip.ping_ms ?? 0).toFixed(0))} م‌ث</span>
                        ) : (
                          <span className="text-danger">بی‌پاسخ</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* رویدادها */}
      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h2 className="text-sm font-bold">رویدادهای اخیر</h2>
          <Link href={`/incidents?server_id=${s.id}`} className="text-xs text-muted hover:text-cyan">
            همه ←
          </Link>
        </div>
        {d.incidents.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted">رویدادی برای این سرور ثبت نشده است.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {d.incidents.map((inc) => (
              <li key={inc.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${inc.resolved_at ? 'bg-muted' : 'bg-danger'}`} />
                <span className="text-xs text-muted w-28 shrink-0 truncate">
                  {INCIDENT_KIND_LABEL[inc.kind] ?? inc.kind}
                </span>
                <span className="flex-1 truncate text-xs">{inc.message}</span>
                <span className="text-[11px] text-muted shrink-0">
                  {inc.resolved_at ? 'برطرف شد' : 'باز'} · {timeAgo(inc.started_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EditServerModal
        open={editing}
        server={s}
        datacenters={dcs.data?.datacenters ?? []}
        onClose={() => setEditing(false)}
        onDone={detail.reload}
      />

      <Modal open={showAgent} title="نصب ایجنت روی این سرور" onClose={() => setShowAgent(false)} wide>
        <AgentPanel serverId={s.id} token={s.agent_token} onRotated={detail.reload} />
      </Modal>
    </div>
  );
}

/** خلاصه یک جهت ترافیک: سرعت لحظه‌ای، اوج بازه، و حجم امروز و ماه */
function TrafficSide({
  title,
  color,
  now,
  peak,
  today,
  month,
  monthLabel,
  billed,
}: {
  title: string;
  color: string;
  now: number | null;
  peak: number;
  today: number;
  month: number;
  monthLabel: string;
  billed: boolean;
}) {
  return (
    <div className="bg-panel2 rounded-lg p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2 text-xs font-bold">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
          {title}
        </span>
        {billed && <span className="badge bg-cyan/15 text-cyan shrink-0">محاسبه می‌شود</span>}
      </div>

      <p className="text-xl font-bold" style={{ color }}>
        {formatMbps(now)}
      </p>

      <dl className="text-[11px] mt-2.5 space-y-1">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">اوج بازه</dt>
          <dd>{formatBps(peak, 1)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">حجم امروز</dt>
          <dd>{formatBytes(today)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">حجم {monthLabel}</dt>
          <dd>{formatTB(month, 2)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** بخش ایجنت با امکان ساخت توکن تازه */
function AgentPanel({ serverId, token, onRotated }: { serverId: number; token: string; onRotated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rotate() {
    if (!confirm('با ساخت توکن تازه، ایجنت فعلی دیگر نمی‌تواند گزارش بفرستد و باید دوباره نصب شود. ادامه می‌دهید؟')) {
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/api/servers/${serverId}?action=rotate-token`);
      onRotated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ساخت توکن تازه انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <InstallInstructions token={token} serverId={serverId} />
      {err && <Notice type="error">{err}</Notice>}
      <div className="border-t border-line pt-4">
        <button type="button" className="btn-danger text-xs" onClick={rotate} disabled={busy}>
          {busy ? 'در حال ساخت…' : 'ساخت توکن تازه'}
        </button>
      </div>
    </div>
  );
}

/** فرم ویرایش سرور */
function EditServerModal({
  open,
  server,
  datacenters,
  onClose,
  onDone,
}: {
  open: boolean;
  server: Detail['server'];
  datacenters: { id: number; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: server.name,
    main_ip: server.main_ip,
    hostname: server.hostname ?? '',
    ssh_port: String(server.ssh_port ?? 22),
    datacenter_id: server.datacenter_id ? String(server.datacenter_id) : '',
    location: server.location ?? '',
    // خالی یعنی «از دیتاسنتر ارث ببر» — با صفر فرق دارد
    price_per_tb: server.price_per_tb === null ? '' : String(server.price_per_tb),
    price_per_ip: server.price_per_ip === null ? '' : String(server.price_per_ip),
    included_tb: server.included_tb === null ? '' : String(server.included_tb),
    included_ips: server.included_ips === null ? '' : String(server.included_ips),
    customer: server.customer ?? '',
    port_mbps: String(server.port_mbps ?? 1000),
    traffic_quota_gb: String(server.traffic_quota_gb ?? 0),
    monthly_cost: String(server.monthly_cost ?? 0),
    notes: server.notes ?? '',
    status: server.status,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.patch(`/api/servers/${server.id}`, {
        ...form,
        datacenter_id: form.datacenter_id ? Number(form.datacenter_id) : null,
        ssh_port: Number(form.ssh_port) || 22,
        port_mbps: Number(form.port_mbps) || 1000,
        traffic_quota_gb: Number(form.traffic_quota_gb) || 0,
        monthly_cost: Number(form.monthly_cost) || 0,
        // رشته خالی به null تبدیل می‌شود تا دوباره از دیتاسنتر ارث ببرد
        price_per_tb: form.price_per_tb === '' ? null : Number(form.price_per_tb),
        price_per_ip: form.price_per_ip === '' ? null : Number(form.price_per_ip),
        included_tb: form.included_tb === '' ? null : Number(form.included_tb),
        included_ips: form.included_ips === '' ? null : Number(form.included_ips),
      });
      onDone();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'ذخیره تغییرات انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!confirm('این سرور بایگانی شود؟ داده‌های تاریخی می‌مانند و فقط از فهرست فعال خارج می‌شود.')) return;
    try {
      await api.del(`/api/servers/${server.id}`);
      window.location.href = '/servers';
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'بایگانی انجام نشد');
    }
  }

  return (
    <Modal open={open} title={`ویرایش ${server.name}`} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام سرور"><input className="input" value={form.name} onChange={set('name')} /></Field>
          <Field label="آی‌پی اصلی"><input className="input ltr" value={form.main_ip} onChange={set('main_ip')} /></Field>
          <Field label="نام میزبان"><input className="input ltr" value={form.hostname} onChange={set('hostname')} /></Field>
          <Field label="پورت SSH"><input className="input ltr" value={form.ssh_port} onChange={set('ssh_port')} /></Field>
          <Field label="دیتاسنتر" hint="قیمت ترافیک و آی‌پی از اینجا ارث می‌رسد">
            <select className="input" value={form.datacenter_id} onChange={set('datacenter_id')}>
              <option value="">وصل نشده</option>
              {datacenters.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="موقعیت"><input className="input" value={form.location} onChange={set('location')} /></Field>
          <Field label="مشتری"><input className="input" value={form.customer} onChange={set('customer')} /></Field>
          <Field label="ظرفیت پورت (مگابیت)"><input className="input ltr" value={form.port_mbps} onChange={set('port_mbps')} /></Field>
          <Field label="سهمیه ترافیک ماهانه (گیگابایت)" hint="صفر یعنی نامحدود">
            <input className="input ltr" value={form.traffic_quota_gb} onChange={set('traffic_quota_gb')} />
          </Field>
          <Field label="هزینه ماهانه (تومان)"><input className="input ltr" value={form.monthly_cost} onChange={set('monthly_cost')} /></Field>
          <Field label="وضعیت" hint="حالت تعمیرات هشدار قطعی نمی‌فرستد">
            <select className="input" value={form.status} onChange={set('status')}>
              <option value="up">در دسترس</option>
              <option value="down">قطع</option>
              <option value="unknown">نامشخص</option>
              <option value="maintenance">تعمیرات</option>
            </select>
          </Field>
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-bold mb-1">قیمت اختصاصی این سرور</h3>
          <p className="text-[11px] text-muted mb-3">
            خالی بگذارید تا از دیتاسنتر ارث ببرد. فقط وقتی پر کنید که قرارداد این سرور با بقیه فرق دارد —
            صفر یعنی «رایگان»، نه «تعیین‌نشده».
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="هزینه هر ترابایت (تومان)">
              <input className="input ltr" value={form.price_per_tb} onChange={set('price_per_tb')} placeholder="ارث از دیتاسنتر" />
            </Field>
            <Field label="هزینه ماهانه هر آی‌پی (تومان)">
              <input className="input ltr" value={form.price_per_ip} onChange={set('price_per_ip')} placeholder="ارث از دیتاسنتر" />
            </Field>
            <Field label="ترافیک رایگان (ترابایت)">
              <input className="input ltr" value={form.included_tb} onChange={set('included_tb')} placeholder="ارث از دیتاسنتر" />
            </Field>
            <Field label="آی‌پی رایگان">
              <input className="input ltr" value={form.included_ips} onChange={set('included_ips')} placeholder="ارث از دیتاسنتر" />
            </Field>
          </div>
        </div>

        <Field label="یادداشت">
          <textarea className="input h-20 resize-none" value={form.notes} onChange={set('notes')} />
        </Field>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-between">
          <button type="button" className="btn-danger" onClick={archive}>
            بایگانی سرور
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
