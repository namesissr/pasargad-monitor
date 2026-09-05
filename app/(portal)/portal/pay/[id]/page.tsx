'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { formatToman } from '@/lib/format';

/**
 * صفحه نتیجه پرداخت.
 *
 * **این صفحه پرداخت را تأیید نمی‌کند.** تأیید در
 * app/api/pay/return/[id] انجام شده — پیش از اینکه کاربر به اینجا
 * برسد.
 *
 * دلیلش این است که درگاه با POST برمی‌گردد و کوکی نشست در POST
 * بین‌سایتی فرستاده نمی‌شود. اگر تأیید را به این صفحه می‌سپردیم و نشست
 * مشتری در فاصله پرداخت منقضی شده بود، او به صفحه ورود می‌رفت و
 * **پرداخت هرگز ثبت نمی‌شد** — پول رفته و سرویس تمدید نشده.
 *
 * پس اینجا فقط نتیجه نشان داده می‌شود: وضعیت از پارامتر آدرس می‌آید و
 * جزئیات فاکتور از ای‌پی‌آی. اگر کسی پارامتر را دستکاری کند، فاکتور
 * واقعی وضعیت درست را نشان می‌دهد.
 */

interface Invoice {
  id: number;
  number: string;
  title: string;
  status: 'unpaid' | 'paid' | 'canceled';
  amount_toman: number;
  payment_ref: string | null;
}

const MESSAGES: Record<string, { icon: string; title: string; tone: 'ok' | 'warn' | 'error' }> = {
  paid: { icon: '✓', title: 'پرداخت با موفقیت انجام شد', tone: 'ok' },
  already: { icon: '✓', title: 'این فاکتور قبلا پرداخت شده بود', tone: 'ok' },
  canceled: { icon: '↩', title: 'پرداخت انجام نشد', tone: 'warn' },
  failed: { icon: '⚠', title: 'پرداخت تأیید نشد', tone: 'error' },
  mismatch: { icon: '⚠', title: 'اطلاعات بازگشتی با فاکتور نمی‌خواند', tone: 'error' },
  notfound: { icon: '⚠', title: 'فاکتور پیدا نشد', tone: 'error' },
};

function PayResult() {
  const { id } = useParams<{ id: string }>();
  const status = useSearchParams().get('status') || 'failed';
  const info = MESSAGES[status] || MESSAGES.failed;

  // فهرست فاکتورها خوانده می‌شود تا وضعیت واقعی — نه پارامتر آدرس —
  // نشان داده شود
  const { data, loading, error, reload } = useLoad<{ invoices: Invoice[] }>(
    '/api/portal/invoices',
  );

  const invoice = data?.invoices.find((i) => String(i.id) === String(id));

  return (
    <div className="max-w-lg mx-auto space-y-4 py-6">
      <div className="card p-6 sm:p-8 text-center space-y-4">
        <div className="text-3xl">{info.icon}</div>
        <h1
          className={`text-base font-bold ${
            info.tone === 'ok' ? 'text-ok' : info.tone === 'error' ? 'text-danger' : ''
          }`}
        >
          {info.title}
        </h1>

        {loading || error || !data ? (
          <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>
        ) : invoice ? (
          <div className="text-sm space-y-1">
            <p>{invoice.title}</p>
            <p className="font-bold">{formatToman(invoice.amount_toman)}</p>
            <p className="text-xs text-muted ltr">{invoice.number}</p>
            {invoice.payment_ref && (
              <p className="text-xs text-muted">
                شماره پیگیری: <span className="ltr">{invoice.payment_ref}</span>
              </p>
            )}

            {/* وضعیت واقعی فاکتور، مستقل از پارامتر آدرس */}
            {invoice.status === 'paid' ? (
              <p className="text-xs text-ok pt-2">
                این فاکتور پرداخت‌شده ثبت است. رسید برای شما پیامک و ایمیل شد.
              </p>
            ) : (
              <p className="text-xs text-amber pt-2">این فاکتور هنوز باز است.</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted">فاکتور در فهرست شما پیدا نشد.</p>
        )}

        {(status === 'failed' || status === 'mismatch') && (
          <Notice type="error">
            اگر مبلغ از حسابتان کم شده، نگران نباشید — تا ۷۲ ساعت به‌صورت خودکار برمی‌گردد.
            شماره پیگیری بانک را به پشتیبانی بدهید تا سریع‌تر بررسی شود.
          </Notice>
        )}

        <div className="flex gap-2 justify-center pt-2">
          <Link href="/portal/invoices" className="btn-ghost text-xs">
            فاکتورها
          </Link>
          <Link href="/portal" className="btn text-xs">
            پرتال
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * useSearchParams باید داخل Suspense باشد.
 *
 * بدون آن، نکست هنگام بیلد خطای «should be wrapped in a suspense
 * boundary» می‌دهد یا کل صفحه را به رندر سمت کلاینت می‌اندازد.
 */
export default function PayReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="card p-8 text-center max-w-lg mx-auto my-6">
          <p className="text-sm">در حال بارگذاری…</p>
        </div>
      }
    >
      <PayResult />
    </Suspense>
  );
}
