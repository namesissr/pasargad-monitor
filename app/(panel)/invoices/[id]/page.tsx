'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { InvoiceDoc, type InvoiceDetailData } from '@/components/InvoiceDoc';
import { api, ApiError } from '@/lib/api';
import { formatJalali, formatToman } from '@/lib/format';

const ORDER_STATUS: Record<string, string> = {
  pending: 'در انتظار پرداخت',
  paid: 'پرداخت‌شده — منتظر تحویل',
  provisioned: 'تحویل شد',
  canceled: 'لغو شده',
};

/**
 * پارامترهای خام درگاه، خوانا.
 *
 * ذخیره‌شده به‌شکل جیسون. اگر پارس نشد، همان متن خام نشان داده می‌شود:
 * چیزی که درگاه فرستاده مهم‌تر از تمیز بودن نمایشش است.
 */
function CallbackTrace({ raw }: { raw: string }) {
  let pairs: [string, string][] = [];
  let fallback = '';

  try {
    const parsed = JSON.parse(raw) as { params?: Record<string, string> };
    pairs = Object.entries(parsed.params ?? {}).map(([k, v]) => [k, String(v)]);
    if (!pairs.length) fallback = raw;
  } catch {
    fallback = raw;
  }

  if (fallback) {
    return <pre className="text-[11px] ltr break-anywhere whitespace-pre-wrap">{fallback}</pre>;
  }

  return (
    <div className="space-y-0.5">
      {pairs.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[11px]">
          <span className="text-muted shrink-0 ltr">{k}</span>
          <span className="ltr break-anywhere">{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const { data, loading, error, reload } = useLoad<InvoiceDetailData>(
    `/api/invoices?id=${params.id}`,
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function act(action: 'cancel' | 'mark_paid' | 'retry_verify') {
    if (!data) return;
    const inv = data.invoice;

    const question =
      action === 'cancel'
        ? `فاکتور ${inv.number} لغو شود؟`
        : action === 'retry_verify'
          ? `تأیید پرداخت فاکتور ${inv.number} دوباره از درگاه گرفته شود؟\n\n` +
            'پرداخت تازه‌ای انجام نمی‌شود؛ همان شناسه پرداخت قبلی دوباره تأیید می‌شود.'
          : `فاکتور ${inv.number} به مبلغ ${formatToman(inv.amount_toman)} پرداخت‌شده ثبت شود؟\n\n` +
            'سرویس تحویل می‌شود و به مشتری پیامک و ایمیل می‌رود.';
    if (!confirm(question)) return;

    setMsg(null);
    setBusy(true);
    try {
      await api.patch('/api/invoices', { id: inv.id, action });
      setMsg({
        type: 'success',
        text:
          action === 'cancel'
            ? 'فاکتور لغو شد.'
            : action === 'retry_verify'
              ? 'پرداخت تأیید شد و سرویس تحویل شد.'
              : 'پرداخت ثبت شد و سرویس تحویل شد.',
      });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'عملیات ناموفق بود' });
    } finally {
      setBusy(false);
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

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between gap-3 flex-wrap">
        <Link href="/invoices" className="text-xs text-muted hover:text-cyan">
          ← بازگشت به فاکتورها
        </Link>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn-ghost text-xs px-4 py-1.5"
            onClick={() => window.print()}
          >
            چاپ
          </button>

          {inv.status === 'unpaid' && (
            <>
              {/* شناسه پرداخت قبلی ذخیره شده، پس می‌شود بدون پرداخت
                  دوباره تأییدش کرد — مشتری دو بار پول نمی‌دهد */}
              {inv.payment_error && (
                <button
                  type="button"
                  className="btn-primary text-xs px-4 py-1.5"
                  onClick={() => act('retry_verify')}
                  disabled={busy}
                >
                  تأیید دوباره
                </button>
              )}
              <button
                type="button"
                className="btn-ghost text-xs px-4 py-1.5"
                onClick={() => act('mark_paid')}
                disabled={busy}
              >
                ثبت پرداخت
              </button>
              <button
                type="button"
                className="btn-danger text-xs px-4 py-1.5"
                onClick={() => act('cancel')}
                disabled={busy}
              >
                لغو فاکتور
              </button>
            </>
          )}
        </div>
      </div>

      {msg && (
        <div className="no-print">
          <Notice type={msg.type}>{msg.text}</Notice>
        </div>
      )}

      <InvoiceDoc data={data} />

      {/* ── چیزهایی که مشتری نمی‌بیند ─────────────────────── */}
      <div className="no-print grid lg:grid-cols-2 gap-4">
        {/* ردپای پرداخت */}
        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-bold">ردپای پرداخت</h3>

          {!inv.payment_error && !inv.callback_raw && !inv.payment_ref ? (
            <p className="text-xs text-muted">هنوز تلاش پرداختی ثبت نشده.</p>
          ) : (
            <>
              {inv.payment_error && (
                <Notice type="error">
                  آخرین خطای درگاه: {inv.payment_error}
                  {inv.last_attempt_at && (
                    <span className="block text-[11px] mt-1 opacity-80">
                      {formatJalali(inv.last_attempt_at)}
                    </span>
                  )}
                </Notice>
              )}

              {inv.callback_raw && (
                <div>
                  <p className="text-[11px] text-muted mb-1">پارامترهای خام بازگشت از درگاه</p>
                  <div className="bg-rack border border-line rounded-lg p-3 overflow-x-auto">
                    <CallbackTrace raw={inv.callback_raw} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* اطلاعات داخلی */}
        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-bold">اطلاعات داخلی</h3>

          <div className="space-y-1 text-xs">
            {data.customer && (
              <div className="flex gap-2">
                <span className="text-muted shrink-0">مشتری:</span>
                <Link href="/customers" className="hover:text-cyan">
                  {data.customer.name}
                </Link>
              </div>
            )}
            {data.server && (
              <div className="flex gap-2">
                <span className="text-muted shrink-0">سرور:</span>
                <Link href={`/servers/${data.server.id}`} className="hover:text-cyan">
                  {data.server.name}
                </Link>
              </div>
            )}
            {data.server?.renews_at && (
              <div className="flex gap-2">
                <span className="text-muted shrink-0">تمدید بعدی:</span>
                <span>{formatJalali(data.server.renews_at)}</span>
              </div>
            )}
            {data.order && (
              <div className="flex gap-2">
                <span className="text-muted shrink-0">سفارش:</span>
                <Link href="/orders" className="hover:text-cyan ltr">
                  {data.order.number}
                </Link>
                <span className="text-muted">
                  ({ORDER_STATUS[data.order.status] ?? data.order.status})
                </span>
              </div>
            )}
            {inv.created_by_name && (
              <div className="flex gap-2">
                <span className="text-muted shrink-0">صادرکننده:</span>
                <span>{inv.created_by_name}</span>
              </div>
            )}
          </div>

          {inv.note && (
            <div className="pt-2 border-t border-line">
              <p className="text-[11px] text-muted mb-1">یادداشت فاکتور</p>
              <p className="text-xs leading-relaxed whitespace-pre-wrap break-anywhere">
                {inv.note}
              </p>
            </div>
          )}

          {data.order?.note && (
            <div className="pt-2 border-t border-line">
              <p className="text-[11px] text-muted mb-1">یادداشت مشتری هنگام سفارش</p>
              <p className="text-xs leading-relaxed whitespace-pre-wrap break-anywhere">
                {data.order.note}
              </p>
            </div>
          )}

          {data.order?.admin_note && (
            <div className="pt-2 border-t border-line">
              <p className="text-[11px] text-muted mb-1">یادداشت داخلی سفارش</p>
              <p className="text-xs leading-relaxed whitespace-pre-wrap break-anywhere">
                {data.order.admin_note}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
