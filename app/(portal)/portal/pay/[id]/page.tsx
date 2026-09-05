'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatToman } from '@/lib/format';

/**
 * صفحه بازگشت از درگاه.
 *
 * درگاه کاربر را با پارامترهایی به اینجا برمی‌گرداند و این صفحه آن‌ها را
 * به مسیر تأیید می‌فرستد. خود تأیید سمت سرور انجام می‌شود — هرگز اینجا،
 * چون هرچه در مرورگر باشد قابل دستکاری است.
 *
 * **رفرش این صفحه بی‌خطر است.** مسیر تأیید اید‌مپوتنت است: اگر فاکتور از
 * قبل پرداخت شده باشد، همان نتیجه برمی‌گردد و چیزی دو بار انجام نمی‌شود.
 *
 * ref جلوی اجرای دوباره در حالت توسعه نکست را می‌گیرد؛ آنجا هر افکت دو
 * بار اجرا می‌شود و بدون این، دو درخواست تأیید همزمان می‌رفت.
 */

interface VerifyResult {
  ok: boolean;
  canceled?: boolean;
  alreadyPaid?: boolean;
  message?: string;
  error?: string;
  invoice?: { id: number; number: string; amount_toman: number; title: string };
}

export default function PayReturnPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [state, setState] = useState<'working' | 'done'>('working');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;

    const qs = search.toString();

    async function verify() {
      try {
        const res = await api.get<VerifyResult>(
          `/api/portal/invoices/${id}/verify${qs ? `?${qs}` : ''}`,
        );
        setResult(res);
      } catch (e) {
        setFailed(e instanceof ApiError ? e.message : 'تأیید پرداخت انجام نشد');
      } finally {
        setState('done');
      }
    }

    void verify();
  }, [id, search]);

  return (
    <div className="max-w-lg mx-auto space-y-4 py-6">
      {state === 'working' && (
        <div className="card p-8 text-center">
          <p className="text-sm">در حال تأیید پرداخت…</p>
          <p className="text-xs text-muted mt-2">این صفحه را نبندید.</p>
        </div>
      )}

      {state === 'done' && (
        <div className="card p-6 sm:p-8 text-center space-y-4">
          {failed ? (
            <>
              <div className="text-3xl">⚠</div>
              <h1 className="text-base font-bold">تأیید پرداخت انجام نشد</h1>
              <Notice type="error">{failed}</Notice>
              <p className="text-xs text-muted leading-relaxed">
                اگر مبلغ از حسابتان کم شده، نگران نباشید — تا ۷۲ ساعت به‌صورت خودکار
                برمی‌گردد. شماره پیگیری را به پشتیبانی بدهید تا سریع‌تر بررسی شود.
              </p>
            </>
          ) : result?.canceled ? (
            <>
              <div className="text-3xl">↩</div>
              <h1 className="text-base font-bold">پرداخت انجام نشد</h1>
              <p className="text-xs text-muted">
                {result.message || 'پرداخت لغو شد یا ناتمام ماند. فاکتور همچنان باز است.'}
              </p>
            </>
          ) : result?.ok ? (
            <>
              <div className="text-3xl">✓</div>
              <h1 className="text-base font-bold text-ok">
                {result.alreadyPaid ? 'این فاکتور قبلا پرداخت شده بود' : 'پرداخت با موفقیت انجام شد'}
              </h1>
              {result.invoice && (
                <div className="text-sm space-y-1">
                  <p>{result.invoice.title}</p>
                  <p className="font-bold">{formatToman(result.invoice.amount_toman)}</p>
                  <p className="text-xs text-muted ltr">{result.invoice.number}</p>
                </div>
              )}
              {!result.alreadyPaid && (
                <p className="text-xs text-muted">رسید پرداخت برای شما پیامک و ایمیل شد.</p>
              )}
            </>
          ) : (
            <>
              <div className="text-3xl">⚠</div>
              <h1 className="text-base font-bold">پرداخت تأیید نشد</h1>
              <Notice type="error">{result?.error || 'علت نامشخص'}</Notice>
            </>
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
      )}
    </div>
  );
}
