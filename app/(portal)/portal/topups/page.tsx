'use client';

import Link from 'next/link';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { faNum, formatFromGb, formatJalaliDay, formatPercent, formatToman, timeAgo } from '@/lib/format';

interface TopupData {
  topups: {
    id: number;
    gb: number;
    price_toman: number | null;
    note: string | null;
    created_at: string;
    server_id: number;
    server_name: string;
  }[];
  servers: {
    id: number;
    name: string;
    purchased_gb: number;
    used_gb: number;
    balance_gb: number;
  }[];
}

export default function PortalTopupsPage() {
  const { data, loading, error, reload } = useLoad<TopupData>('/api/portal/topups');

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const totalPurchased = data.servers.reduce((a, s) => a + Number(s.purchased_gb || 0), 0);
  const totalUsed = data.servers.reduce((a, s) => a + Number(s.used_gb || 0), 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">خرید ترافیک</h1>
        <p className="text-xs text-muted mt-0.5">
          ترافیک خریداری‌شده انقضا ندارد و تا مصرف کامل باقی می‌ماند.
        </p>
      </div>

      {/* ── وضعیت هر سرور ──────────────────────────────────── */}
      {!data.servers.length ? (
        <Notice type="warn">هنوز سروری به حساب شما تخصیص نیافته است.</Notice>
      ) : (
        <section className="card overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-line flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold">وضعیت ترافیک</h2>
            <span className="text-[11px] text-muted">
              مجموع {formatFromGb(totalPurchased)} خرید · {formatFromGb(totalUsed)} مصرف
            </span>
          </div>

          <ul className="divide-y divide-line/60">
            {data.servers.map((s) => {
              const purchased = Number(s.purchased_gb || 0);
              const pct = purchased > 0 ? Math.min(100, (Number(s.used_gb) / purchased) * 100) : null;
              const balance = Number(s.balance_gb || 0);

              return (
                <li key={s.id} className="px-4 sm:px-5 py-3.5">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                    <Link
                      href={`/portal/servers/${s.id}`}
                      className="text-sm font-medium hover:text-cyan"
                    >
                      {s.name}
                    </Link>
                    {purchased > 0 ? (
                      <span className={`text-xs ${balance <= 0 ? 'text-danger' : 'text-muted'}`}>
                        {formatFromGb(Math.max(0, balance))} باقی‌مانده از{' '}
                        {formatFromGb(purchased)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">ترافیکی ثبت نشده</span>
                    )}
                  </div>

                  {pct !== null && (
                    <div className="h-2 rounded-full bg-line overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-amber' : 'bg-cyan'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  {pct !== null && (
                    <p className="text-[11px] text-muted mt-1.5">{formatPercent(pct)} مصرف شده</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── تاریخچه ────────────────────────────────────────── */}
      <section className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">تاریخچه خرید</h2>
        </div>

        {!data.topups.length ? (
          <p className="p-6 text-center text-xs text-muted">هنوز خریدی ثبت نشده.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl sm:min-w-[560px]">
              <thead>
                <tr>
                  <th>تاریخ</th>
                  <th>سرور</th>
                  <th>مقدار</th>
                  <th className="col-sm">مبلغ</th>
                  <th className="col-md">توضیح</th>
                </tr>
              </thead>
              <tbody>
                {data.topups.map((t) => (
                  <tr key={t.id}>
                    <td className="text-xs sm:whitespace-nowrap" title={t.created_at}>
                      {formatJalaliDay(t.created_at)}
                      <span className="text-muted block text-[11px]">{timeAgo(t.created_at)}</span>
                    </td>
                    <td className="text-xs">
                      <Link
                        href={`/portal/servers/${t.server_id}`}
                        className="hover:text-cyan"
                      >
                        {t.server_name}
                      </Link>
                    </td>
                    {/* عدد منفی یعنی اصلاح یک ثبت اشتباه */}
                    <td className={`text-xs font-bold ${t.gb < 0 ? 'text-danger' : 'text-ok'}`}>
                      {t.gb > 0 ? '+' : ''}
                      {formatFromGb(t.gb)}
                    </td>
                    <td className="text-xs col-sm">
                      {t.price_toman ? formatToman(t.price_toman) : '—'}
                    </td>
                    <td className="text-xs text-muted col-md">
                      <span className="truncate block max-w-[220px]" title={t.note || undefined}>
                        {t.note || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted/70 leading-relaxed">
        {faNum(data.topups.length)} ردیف نشان داده شده. برای خرید ترافیک تازه با پشتیبانی تماس
        بگیرید.
      </p>
    </div>
  );
}
