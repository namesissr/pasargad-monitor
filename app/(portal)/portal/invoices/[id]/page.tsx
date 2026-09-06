'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { InvoiceDoc, type InvoiceDetailData } from '@/components/InvoiceDoc';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalaliDay, formatToman } from '@/lib/format';

interface Data extends InvoiceDetailData {
  gatewayReady: boolean;
}

/** روزهای مانده تا مهلت؛ منفی یعنی گذشته */
function daysLeft(due: string | null) {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function PortalInvoicePage({ params }: { params: { id: string } }) {
  const { data, loading, error, reload } = useLoad<Data>(`/api/portal/invoices/${params.id}`);
  const [paying, setPaying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pay() {
    setMsg(null);
    setPaying(true);
    try {
      const res = await api.post<{ url: string }>(`/api/portal/invoices/${params.id}/pay`);
      // جایگزینی به‌جای پنجره تازه، تا مسدودکننده پنجره جلویش را نگیرد
      window.location.href = res.url;
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'شروع پرداخت ناموفق بود');
      setPaying(false);
    }
  }

  if (loading || error || !data) {
    return (
      <LoadState loading={loading} error={error} onRetry={reload}>
        {null}
      </LoadState>
    );
  }

  const inv = data.invoice;
  const left = daysLeft(inv.due_at);
  const overdue = inv.status === 'unpaid' && left !== null && left < 0;

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between gap-3 flex-wrap">
        <Link href="/portal/invoices" className="text-xs text-muted hover:text-cyan">
          ← بازگشت به فاکتورها
        </Link>

        <button
          type="button"
          className="btn-ghost text-xs px-4 py-1.5"
          onClick={() => window.print()}
        >
          چاپ فاکتور
        </button>
      </div>

      {msg && (
        <div className="no-print">
          <Notice type="error">{msg}</Notice>
        </div>
      )}

      {/* ── نوار پرداخت ────────────────────────────────────
          بالای سند است نه پایینش: کسی که این صفحه را باز می‌کند اغلب
          برای پرداخت آمده، نه برای خواندن. */}
      {inv.status === 'unpaid' && (
        <div
          className={`no-print card p-4 sm:p-5 flex items-center justify-between gap-4 flex-wrap ${
            overdue ? 'border-danger/40' : 'border-amber/30'
          }`}
        >
          <div>
            <div className="text-sm font-bold">{formatToman(inv.amount_toman)}</div>
            <p className={`text-[11px] mt-0.5 ${overdue ? 'text-danger' : 'text-muted'}`}>
              {inv.due_at ? (
                <>
                  مهلت {formatJalaliDay(inv.due_at)}
                  {left !== null &&
                    (overdue
                      ? ` — ${faNum(Math.abs(left))} روز گذشته`
                      : left === 0
                        ? ' — امروز'
                        : ` — ${faNum(left)} روز مانده`)}
                </>
              ) : (
                'در انتظار پرداخت'
              )}
            </p>
          </div>

          <button
            type="button"
            className="btn-primary text-xs px-5 py-2"
            onClick={pay}
            disabled={!data.gatewayReady || paying}
          >
            {paying ? 'در حال انتقال…' : 'پرداخت آنلاین'}
          </button>
        </div>
      )}

      {!data.gatewayReady && inv.status === 'unpaid' && (
        <div className="no-print">
          <Notice type="warn">
            درگاه پرداخت آنلاین در دسترس نیست. برای پرداخت با پشتیبانی تماس بگیرید.
          </Notice>
        </div>
      )}

      {/* پول ممکن است کم شده باشد و مشتری منتظر باشد. این را نباید
          فقط در لاگ ما بماند. */}
      {inv.status === 'unpaid' && inv.payment_error && (
        <div className="no-print">
          <Notice type="warn">
            آخرین تلاش پرداخت به نتیجه نرسید. اگر مبلغ از حسابتان کم شده، شماره پیگیری بانک را
            به پشتیبانی بدهید — پرداخت دوباره لازم نیست.
          </Notice>
        </div>
      )}

      <InvoiceDoc data={data} />

      {/* ── مسیر ادامه ────────────────────────────────────
          فاکتور پرداخت‌شده یک بن‌بست است اگر لینکی به سرویسِ خریداری‌شده
          نداشته باشد. */}
      {inv.status === 'paid' && (data.server || data.order) && (
        <div className="no-print card p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted">این فاکتور بابت سرویس زیر بود</p>
          {data.server ? (
            <Link
              href={`/portal/servers/${data.server.id}`}
              className="text-xs text-cyan hover:underline"
            >
              {data.server.name} ←
            </Link>
          ) : (
            <span className="text-xs">{data.order?.product_name}</span>
          )}
        </div>
      )}

      <p className="no-print text-[11px] text-muted/70 leading-relaxed">
        شماره پیگیری را تا زمان تأیید نهایی نگه دارید. اگر مبلغ از حسابتان کم شد ولی فاکتور
        پرداخت‌نشده ماند، همان شماره را به پشتیبانی بدهید.
      </p>
    </div>
  );
}
