'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { BarChart, UsageBar } from '@/components/Chart';
import { Mono, Notice, StatCard } from '@/components/ui';
import { DIRECTION_LABEL, type BillingDirection } from '@/lib/billing';
import { faFloat, faNum, formatBytes, formatToman } from '@/lib/format';

interface Rates {
  price_per_tb: number;
  price_per_ip: number;
  included_tb: number;
  included_ips: number;
  billing_direction: BillingDirection;
  tb_base: number;
  overridden: string[];
}

interface Cost {
  billable_bytes: number;
  used_tb: number;
  included_tb: number;
  billable_tb: number;
  traffic_cost: number;
  ip_count: number;
  included_ips: number;
  billable_ips: number;
  ip_cost: number;
  rent: number;
  total: number;
  quota_percent: number | null;
}

interface Row {
  id: number;
  name: string;
  main_ip: string;
  status: string;
  datacenter_id: number | null;
  datacenter_name: string | null;
  rx: number;
  tx: number;
  ip_count: number;
  rent: number;
  rates: Rates;
  cost: Cost;
}

interface Totals {
  servers: number;
  billable_bytes: number;
  billable_tb: number;
  traffic_cost: number;
  ip_cost: number;
  rent: number;
  total: number;
  ips: number;
}

interface DayRow {
  day: string;
  label: string;
  bytes: number;
  traffic_cost: number;
  ip_cost: number;
  rent: number;
  total: number;
}

interface Data {
  period: { key: string; label: string; from: string; to: string };
  months: { key: string; label: string }[];
  rows: Row[];
  byDatacenter: { id: number | null; name: string; totals: Totals }[];
  grand: Totals;
  days: DayRow[];
  today: DayRow | null;
  elapsedTotal: number;
  daysInMonth: number;
  daysElapsed: number;
}

export default function BillingPage() {
  const [month, setMonth] = useState('');
  const [datacenterId, setDatacenterId] = useState('all');
  const [view, setView] = useState<'month' | 'day'>('month');

  useEffect(() => {
    const dc = new URLSearchParams(window.location.search).get('datacenter_id');
    if (dc) setDatacenterId(dc);
  }, []);

  const qs = new URLSearchParams({ datacenter_id: datacenterId });
  if (month) qs.set('month', month);

  const { data, loading, error, reload } = useLoad<Data>(`/api/billing?${qs}`);
  const dcs = useLoad<{ datacenters: { id: number; name: string }[] }>('/api/datacenters');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">حسابداری</h1>
          <p className="text-xs text-muted mt-0.5">
            هزینه‌ای که هر سرور به دیتاسنتر تحمیل می‌کند: اجاره + ترافیک مازاد + آی‌پی مازاد
          </p>
        </div>
        <a href={`/api/billing?${qs}&format=csv`} className="btn-ghost text-xs" download>
          دریافت خروجی CSV
        </a>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select className="input max-w-[170px]" value={month} onChange={(e) => setMonth(e.target.value)}>
          {(data?.months ?? []).slice().reverse().map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        <select className="input max-w-[200px]" value={datacenterId} onChange={(e) => setDatacenterId(e.target.value)}>
          <option value="all">همه دیتاسنترها</option>
          {(dcs.data?.datacenters ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <div className="flex gap-1">
          {([['month', 'ماهانه'], ['day', 'روزانه']] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                view === k ? 'bg-cyan/10 text-cyan border-cyan/30' : 'border-line text-muted hover:text-white'
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
        empty={!!data && data.rows.length === 0}
        emptyText="سروری برای این فیلتر نیست. اول دیتاسنتر بسازید و سرورها را به آن وصل کنید."
      >
        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                title={`هزینه ${data.period.label}`}
                value={formatToman(data.grand.total)}
                sub={`${faNum(data.grand.servers)} سرور`}
                tone="cyan"
              />
              <StatCard
                title="هزینه ترافیک"
                value={formatToman(data.grand.traffic_cost)}
                sub={`${faFloat(data.grand.billable_tb, 2)} ترابایت قابل پرداخت`}
              />
              <StatCard
                title="هزینه آی‌پی"
                value={formatToman(data.grand.ip_cost)}
                sub={`${faNum(data.grand.ips)} آی‌پی تخصیص‌یافته`}
              />
              <StatCard
                title="هزینه امروز"
                value={data.today ? formatToman(data.today.total) : '—'}
                sub={data.today ? `شامل سهم روزانه اجاره و آی‌پی` : 'داده‌ای برای امروز نیست'}
                tone="warn"
              />
            </div>

            {data.grand.total === 0 && (
              <Notice type="info">
                همه هزینه‌ها صفر است. یعنی هنوز قیمتی وارد نکرده‌اید یا سرورها به دیتاسنتر وصل نیستند.{' '}
                <Link href="/datacenters" className="underline">تنظیم قیمت دیتاسنترها</Link>
              </Notice>
            )}

            {/* تفکیک دیتاسنتری */}
            {data.byDatacenter.length > 1 && (
              <section className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-line">
                  <h2 className="text-sm font-bold">تفکیک دیتاسنتری</h2>
                </div>
                <div className="table-wrap">
                  <table className="tbl min-w-[640px]">
                    <thead>
                      <tr>
                        <th>دیتاسنتر</th>
                        <th>سرور</th>
                        <th>ترافیک</th>
                        <th>هزینه ترافیک</th>
                        <th>هزینه آی‌پی</th>
                        <th>اجاره</th>
                        <th>جمع</th>
                        <th>سهم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byDatacenter.map((d) => (
                        <tr key={String(d.id ?? 'none')}>
                          <td className="font-medium">
                            {d.id ? (
                              <Link href={`/datacenters`} className="hover:text-cyan">{d.name}</Link>
                            ) : (
                              <span className="text-muted">{d.name}</span>
                            )}
                          </td>
                          <td className="text-xs">{faNum(d.totals.servers)}</td>
                          <td className="text-xs">{formatBytes(d.totals.billable_bytes, 1)}</td>
                          <td className="text-xs">{formatToman(d.totals.traffic_cost)}</td>
                          <td className="text-xs">{formatToman(d.totals.ip_cost)}</td>
                          <td className="text-xs">{formatToman(d.totals.rent)}</td>
                          <td className="text-xs font-bold text-cyan">{formatToman(d.totals.total)}</td>
                          <td className="w-24">
                            <UsageBar
                              percent={data.grand.total ? (d.totals.total / data.grand.total) * 100 : 0}
                              label=" "
                              right={`${faNum(Math.round(data.grand.total ? (d.totals.total / data.grand.total) * 100 : 0))}٪`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {view === 'month' ? (
              <MonthTable rows={data.rows} grand={data.grand} periodLabel={data.period.label} />
            ) : (
              <DayView data={data} />
            )}
          </>
        )}
      </LoadState>
    </div>
  );
}

function MonthTable({ rows, grand, periodLabel }: { rows: Row[]; grand: Totals; periodLabel: string }) {
  return (
    <>
      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-bold">هزینه هر سرور — {periodLabel}</h2>
        </div>
        <div className="table-wrap">
          <table className="tbl min-w-[980px]">
            <thead>
              <tr>
                <th>سرور</th>
                <th>دیتاسنتر</th>
                <th>ترافیک محاسبه‌شده</th>
                <th>سهمیه</th>
                <th>مازاد</th>
                <th>هزینه ترافیک</th>
                <th>آی‌پی</th>
                <th>هزینه آی‌پی</th>
                <th>اجاره</th>
                <th>جمع</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/servers/${r.id}`} className="hover:text-cyan">
                      <span className="font-medium">{r.name}</span>
                      <br />
                      <Mono className="text-muted">{r.main_ip}</Mono>
                    </Link>
                  </td>
                  <td className="text-xs">
                    {r.datacenter_name || <span className="text-amber">وصل نشده</span>}
                    {r.rates.overridden.length > 0 && (
                      <>
                        <br />
                        <span className="text-[10px] text-amber" title={r.rates.overridden.join('، ')}>
                          قیمت اختصاصی
                        </span>
                      </>
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {faFloat(r.cost.used_tb, 3)} ترابایت
                    <br />
                    <span className="text-[10px] text-muted">{DIRECTION_LABEL[r.rates.billing_direction]}</span>
                  </td>
                  <td className="text-xs w-24">
                    {r.cost.included_tb > 0 ? (
                      <UsageBar
                        percent={r.cost.quota_percent ?? 0}
                        label=" "
                        right={`${faFloat(r.cost.included_tb, 0)} ترابایت`}
                      />
                    ) : (
                      <span className="text-muted">ندارد</span>
                    )}
                  </td>
                  <td className="text-xs">{faFloat(r.cost.billable_tb, 3)}</td>
                  <td className="text-xs">{formatToman(r.cost.traffic_cost)}</td>
                  <td className="text-xs whitespace-nowrap">
                    {faNum(r.cost.ip_count)}
                    {r.cost.billable_ips > 0 && (
                      <span className="text-muted"> ({faNum(r.cost.billable_ips)} پولی)</span>
                    )}
                  </td>
                  <td className="text-xs">{formatToman(r.cost.ip_cost)}</td>
                  <td className="text-xs">{formatToman(r.cost.rent)}</td>
                  <td className="text-xs font-bold text-cyan">{formatToman(r.cost.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-panel2">
                <td colSpan={5} className="font-bold text-xs">جمع کل</td>
                <td className="text-xs font-bold">{formatToman(grand.traffic_cost)}</td>
                <td className="text-xs font-bold">{faNum(grand.ips)}</td>
                <td className="text-xs font-bold">{formatToman(grand.ip_cost)}</td>
                <td className="text-xs font-bold">{formatToman(grand.rent)}</td>
                <td className="text-xs font-bold text-cyan">{formatToman(grand.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <p className="text-[11px] text-muted/70">
        ترافیک هر سرور بر اساس قرارداد همان دیتاسنتر حساب می‌شود — ستون زیر «ترافیک محاسبه‌شده» می‌گوید کدام
        جهت مبناست. اجاره و هزینه آی‌پی کامل حساب می‌شوند چون ماهانه‌اند، ولی ترافیک تا همین لحظه است؛
        پس عدد ماه جاری تا آخر ماه بالا می‌رود.
      </p>
    </>
  );
}

function DayView({ data }: { data: Data }) {
  return (
    <>
      <section className="card p-4">
        <h2 className="text-sm font-bold mb-3">هزینه روزانه — {data.period.label}</h2>
        <BarChart
          bars={data.days.map((d) => ({ label: d.label.replace(/\s\S+$/, ''), value: d.total }))}
          format={(v) => formatToman(v)}
          color="#F2B44C"
        />
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h2 className="text-sm font-bold">تفکیک روزانه</h2>
          <span className="text-[11px] text-muted">
            {faNum(data.daysElapsed)} روز از {faNum(data.daysInMonth)} روز · جمع {formatToman(data.elapsedTotal)}
          </span>
        </div>
        <div className="table-wrap">
          <table className="tbl min-w-[620px]">
            <thead>
              <tr>
                <th>روز</th>
                <th>ترافیک</th>
                <th>هزینه ترافیک</th>
                <th>سهم آی‌پی</th>
                <th>سهم اجاره</th>
                <th>جمع روز</th>
              </tr>
            </thead>
            <tbody>
              {data.days.slice().reverse().map((d) => (
                <tr key={d.day}>
                  <td className="whitespace-nowrap">{d.label}</td>
                  <td className="text-xs">{formatBytes(d.bytes, 1)}</td>
                  <td className="text-xs">{formatToman(d.traffic_cost)}</td>
                  <td className="text-xs text-muted">{formatToman(d.ip_cost)}</td>
                  <td className="text-xs text-muted">{formatToman(d.rent)}</td>
                  <td className="text-xs font-bold text-cyan">{formatToman(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-[11px] text-muted/70">
        سهمیه ترافیک ماهانه است نه روزانه، پس تجمعی حساب می‌شود: تا وقتی جمع ماه زیر سهمیه است هزینه ترافیک
        صفر می‌ماند و از روزی که سهمیه تمام شود فقط مازاد همان روز پول دارد — همان کاری که خود دیتاسنتر
        می‌کند. اجاره و هزینه آی‌پی ماهانه‌اند و به‌طور مساوی بین {faNum(data.daysInMonth)} روز ماه پخش شده‌اند،
        پس جمع ستون روزانه تا پایان ماه با عدد نمای ماهانه یکی نمی‌شود.
      </p>
    </>
  );
}
