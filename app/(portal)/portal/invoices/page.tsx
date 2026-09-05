'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalaliDay, formatToman, timeAgo } from '@/lib/format';

interface Invoice {
  id: number;
  number: string;
  title: string;
  kind: string;
  status: 'unpaid' | 'paid' | 'canceled';
  amount_toman: number;
  period_from: string | null;
  period_to: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  payment_ref: string | null;
  card_number: string | null;
  payment_error: string | null;
  server_id: number | null;
  server_name: string | null;
}

interface Data {
  invoices: Invoice[];
  gatewayReady: boolean;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  unpaid: { label: 'در انتظار پرداخت', cls: 'bg-amber/15 text-amber' },
  paid: { label: 'پرداخت‌شده', cls: 'bg-ok/15 text-ok' },
  canceled: { label: 'لغو شده', cls: 'bg-line text-muted' },
};

/** روزهای مانده تا مهلت؛ منفی یعنی گذشته */
function daysLeft(due: string | null) {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function PortalInvoicesPage() {
  const { data, loading, error, reload } = useLoad<Data>('/api/portal/invoices');
  const [paying, setPaying] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function pay(inv: Invoice) {
    setMsg(null);
    setPaying(inv.id);
    try {
      const res = await api.post<{ url: string }>(`/api/portal/invoices/${inv.id}/pay`);
      // هدایت به درگاه. جایگزینی به‌جای باز کردن پنجره تازه است تا
      // مسدودکننده پنجره مرورگر جلویش را نگیرد.
      window.location.href = res.url;
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'شروع پرداخت ناموفق بود');
      setPaying(null);
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const unpaid = data.invoices.filter((i) => i.status === 'unpaid');
  const history = data.invoices.filter((i) => i.status !== 'unpaid');
  const dueTotal = unpaid.reduce((a, i) => a + Number(i.amount_toman), 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">فاکتورها</h1>
        <p className="text-xs text-muted mt-0.5">
          فاکتور تمدید چند روز پیش از موعد صادر می‌شود و همین‌جا قابل پرداخت است.
        </p>
      </div>

      {msg && <Notice type="error">{msg}</Notice>}

      {!data.gatewayReady && unpaid.length > 0 && (
        <Notice type="warn">
          درگاه پرداخت آنلاین در دسترس نیست. برای پرداخت با پشتیبانی تماس بگیرید.
        </Notice>
      )}

      {/* ── در انتظار پرداخت ───────────────────────────────── */}
      {unpaid.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold">
              در انتظار پرداخت ({faNum(unpaid.length)})
            </h2>
            <span className="text-xs text-muted">
              مجموع {formatToman(dueTotal)}
            </span>
          </div>

          {unpaid.map((inv) => {
            const left = daysLeft(inv.due_at);
            const overdue = left !== null && left < 0;

            return (
              <div
                key={inv.id}
                className={`card p-4 sm:p-5 ${overdue ? 'border-danger/40' : 'border-amber/30'}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold">{inv.title}</h3>
                    <p className="text-[11px] text-muted mt-1">
                      فاکتور <span className="ltr">{inv.number}</span>
                      {inv.server_name && (
                        <>
                          {' · '}
                          <Link
                            href={`/portal/servers/${inv.server_id}`}
                            className="hover:text-cyan"
                          >
                            {inv.server_name}
                          </Link>
                        </>
                      )}
                    </p>
                    {/* اگر تلاش پرداختی ناموفق بوده، مشتری باید بداند —
                        شاید پولش کم شده و منتظر است */}
                    {inv.payment_error && (
                      <p className="text-[11px] mt-1.5 text-amber leading-relaxed">
                        آخرین تلاش پرداخت ناموفق بود. اگر مبلغ از حسابتان کم شده، شماره پیگیری
                        بانک را به پشتیبانی بدهید.
                      </p>
                    )}
                    {inv.due_at && (
                      <p className={`text-[11px] mt-1 ${overdue ? 'text-danger' : 'text-muted'}`}>
                        مهلت: {formatJalaliDay(inv.due_at)}
                        {left !== null && (
                          <>
                            {' — '}
                            {overdue
                              ? `${faNum(Math.abs(left))} روز گذشته`
                              : left === 0
                                ? 'امروز'
                                : `${faNum(left)} روز مانده`}
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="text-end shrink-0">
                    <div className="text-lg font-bold">{formatToman(inv.amount_toman)}</div>
                    <button
                      type="button"
                      className="btn-primary mt-2 text-xs px-4 py-1.5"
                      onClick={() => pay(inv)}
                      disabled={!data.gatewayReady || paying === inv.id}
                    >
                      {paying === inv.id ? 'در حال انتقال…' : 'پرداخت'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {unpaid.length === 0 && (
        <Notice type="success">فاکتور پرداخت‌نشده‌ای ندارید.</Notice>
      )}

      {/* ── تاریخچه ────────────────────────────────────────── */}
      <section className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">تاریخچه پرداخت</h2>
        </div>

        {!history.length ? (
          <p className="p-6 text-center text-xs text-muted">هنوز پرداختی ثبت نشده.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl sm:min-w-[640px]">
              <thead>
                <tr>
                  <th>فاکتور</th>
                  <th>بابت</th>
                  <th>مبلغ</th>
                  <th>وضعیت</th>
                  <th className="col-sm">تاریخ پرداخت</th>
                  <th className="col-md">پیگیری</th>
                </tr>
              </thead>
              <tbody>
                {history.map((inv) => {
                  const st = STATUS[inv.status] || STATUS.canceled;
                  return (
                    <tr key={inv.id}>
                      <td className="text-xs ltr sm:whitespace-nowrap">{inv.number}</td>
                      <td className="text-xs">
                        {inv.title}
                        {inv.server_name && (
                          <span className="text-muted block text-[11px]">{inv.server_name}</span>
                        )}
                      </td>
                      <td className="text-xs sm:whitespace-nowrap">
                        {formatToman(inv.amount_toman)}
                      </td>
                      <td className="text-xs">
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="text-xs text-muted col-sm sm:whitespace-nowrap">
                        {inv.paid_at ? (
                          <>
                            {formatJalaliDay(inv.paid_at)}
                            <span className="block text-[11px]">{timeAgo(inv.paid_at)}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-xs text-muted col-md">
                        {inv.payment_ref ? (
                          <span className="ltr break-anywhere">{inv.payment_ref}</span>
                        ) : (
                          '—'
                        )}
                        {inv.card_number && (
                          <span className="block text-[11px] ltr">{inv.card_number}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted/70 leading-relaxed">
        شماره پیگیری را تا زمان تأیید نهایی نگه دارید. اگر مبلغ از حسابتان کم شد ولی فاکتور
        پرداخت‌نشده ماند، همان شماره را به پشتیبانی بدهید.
      </p>
    </div>
  );
}
