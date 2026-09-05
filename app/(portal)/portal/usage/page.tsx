'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { faNum, formatBytes } from '@/lib/format';

interface UsageData {
  periods: string[];
  totals: { label: string; from_day: string; rx: number; tx: number }[];
  perServer: { server_id: number; server_name: string; label: string; rx: number; tx: number }[];
}

const SPANS = [
  [6, '۶ ماه'],
  [12, '۱۲ ماه'],
  [24, '۲۴ ماه'],
] as const;

export default function PortalUsagePage() {
  const [months, setMonths] = useState(12);
  const { data, loading, error, reload } = useLoad<UsageData>(`/api/portal/usage?months=${months}`);

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  // بیشترین مجموع، مبنای عرض میله‌ها. بدون مقیاس مشترک، ماه کم‌مصرف و
  // پرمصرف یک‌اندازه دیده می‌شوند و نمودار دروغ می‌گوید.
  const peak = Math.max(1, ...data.totals.map((t) => Number(t.rx) + Number(t.tx)));

  // تفکیک به‌ازای سرور، گروه‌بندی‌شده بر اساس سرور
  const byServer = new Map<number, { name: string; rows: Map<string, { rx: number; tx: number }> }>();
  for (const row of data.perServer) {
    let entry = byServer.get(row.server_id);
    if (!entry) {
      entry = { name: row.server_name, rows: new Map() };
      byServer.set(row.server_id, entry);
    }
    entry.rows.set(row.label, { rx: Number(row.rx), tx: Number(row.tx) });
  }
  const servers = Array.from(byServer.entries());

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">گزارش مصرف</h1>
          <p className="text-xs text-muted mt-0.5">
            مجموع همه سرورهای شما، ماه به ماه. مبنا ترافیک دانلود و آپلود است.
          </p>
        </div>
        <div className="flex gap-1">
          {SPANS.map(([n, label]) => (
            <button
              key={n}
              type="button"
              onClick={() => setMonths(n)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                months === n
                  ? 'bg-cyan/10 text-cyan border-cyan/30'
                  : 'border-line text-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!data.totals.length ? (
        <Notice type="warn">هنوز داده مصرفی ثبت نشده.</Notice>
      ) : (
        <>
          {/* نمودار میله‌ای افقی: روی موبایل از نمودار عمودی خواناتر است
              و برچسب ماه شمسی جا می‌گیرد */}
          <section className="card p-4 sm:p-5">
            <h2 className="text-sm font-bold mb-4">مصرف ماهانه</h2>
            <div className="space-y-2.5">
              {data.totals.map((t) => {
                const total = Number(t.rx) + Number(t.tx);
                return (
                  <div key={t.label}>
                    <div className="flex items-baseline justify-between gap-3 text-xs mb-1">
                      <span className="text-muted shrink-0">{t.label}</span>
                      <span className="font-medium">{formatBytes(total, 2)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-line overflow-hidden flex">
                      <div
                        className="h-full bg-cyan"
                        style={{ width: `${(Number(t.rx) / peak) * 100}%` }}
                        title="دانلود"
                      />
                      <div
                        className="h-full bg-amber"
                        style={{ width: `${(Number(t.tx) / peak) * 100}%` }}
                        title="آپلود"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-4 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-cyan" /> دانلود
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber" /> آپلود
              </span>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-line">
              <h2 className="text-sm font-bold">جدول ماهانه</h2>
            </div>
            <div className="table-wrap">
              <table className="tbl sm:min-w-[520px]">
                <thead>
                  <tr>
                    <th>ماه</th>
                    <th>دانلود</th>
                    <th>آپلود</th>
                    <th className="col-sm">مجموع</th>
                  </tr>
                </thead>
                <tbody>
                  {data.totals.map((t) => (
                    <tr key={t.label}>
                      <td className="text-xs sm:whitespace-nowrap">{t.label}</td>
                      <td className="text-xs text-cyan">{formatBytes(t.rx, 2)}</td>
                      <td className="text-xs text-amber">{formatBytes(t.tx, 2)}</td>
                      <td className="text-xs col-sm">
                        {formatBytes(Number(t.rx) + Number(t.tx), 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {servers.length > 1 && (
            <section className="card overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-line">
                <h2 className="text-sm font-bold">تفکیک به‌ازای سرور</h2>
                <p className="text-[11px] text-muted mt-0.5">مجموع دانلود و آپلود هر ماه</p>
              </div>
              <div className="table-wrap">
                <table className="tbl sm:min-w-[640px]">
                  <thead>
                    <tr>
                      <th>سرور</th>
                      {data.periods.map((p) => (
                        <th key={p}>{p}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {servers.map(([id, srv]) => (
                      <tr key={id}>
                        <td className="text-xs font-medium sm:whitespace-nowrap">{srv.name}</td>
                        {data.periods.map((p) => {
                          const cell = srv.rows.get(p);
                          const total = cell ? cell.rx + cell.tx : 0;
                          return (
                            <td key={p} className="text-xs sm:whitespace-nowrap">
                              {total ? formatBytes(total, 1) : <span className="text-muted">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <p className="text-[11px] text-muted/70 leading-relaxed">
        سهمیه ترافیک بر اساس <b>دانلود</b> حساب می‌شود، چون دیتاسنتر همان را صورتحساب می‌کند.
        عدد آپلود اینجا فقط برای اطلاع است. {faNum(months)} ماه اخیر نشان داده شده.
      </p>
    </div>
  );
}
