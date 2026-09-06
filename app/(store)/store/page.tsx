'use client';

import Link from 'next/link';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { billingLabel, Spec, type StoreProduct } from '@/components/StoreBits';
import { formatToman } from '@/lib/format';

interface Data {
  enabled: boolean;
  products: StoreProduct[];
  intro: string;
  brand?: string;
}

export default function StorePage() {
  const { data, loading, error, reload } = useLoad<Data>('/api/store/products');

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  if (!data.enabled) {
    return (
      <Notice type="warn">
        ثبت سفارش آنلاین در حال حاضر در دسترس نیست. برای سفارش با ما تماس بگیرید.
      </Notice>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2 py-4">
        <h1 className="text-2xl sm:text-3xl font-bold">سرور اختصاصی</h1>
        <p className="text-sm text-muted max-w-2xl mx-auto leading-relaxed">
          {data.intro ||
            'سرور را انتخاب کنید، سفارش بدهید و آنلاین پرداخت کنید. اگر حساب ندارید، همان لحظه ساخته می‌شود.'}
        </p>
      </div>

      {!data.products.length ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-muted">فعلا محصولی برای فروش نیست.</p>
          <p className="text-xs text-muted/70 mt-2">برای سفارش با ما تماس بگیرید.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.products.map((p) => (
            <div key={p.id} className="card p-5 flex flex-col gap-4">
              <div>
                <h2 className="text-sm font-bold">{p.name}</h2>
                {p.summary && (
                  <p className="text-xs text-muted mt-1 leading-relaxed">{p.summary}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Spec label="پردازنده" value={p.spec_cpu} />
                <Spec label="حافظه" value={p.spec_ram} />
                <Spec label="دیسک" value={p.spec_disk} />
                <Spec label="پهنای باند" value={p.spec_bandwidth} />
                <Spec label="موقعیت" value={p.spec_location} />
              </div>

              <div className="mt-auto pt-3 border-t border-line">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold">{formatToman(p.price_toman)}</div>
                    <div className="text-[11px] text-muted">
                      {billingLabel(p.billing_months)}
                      {p.setup_toman > 0 && ` · راه‌اندازی ${formatToman(p.setup_toman)}`}
                    </div>
                  </div>

                  {p.in_stock ? (
                    <Link href={`/store/${p.id}`} className="btn-primary text-xs px-4 py-1.5">
                      سفارش
                    </Link>
                  ) : (
                    <span className="badge bg-line text-muted">ناموجود</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-5">
        <h2 className="text-sm font-bold mb-3">چطور سفارش بدهم؟</h2>
        <ol className="space-y-2 text-xs text-muted leading-relaxed">
          <li>۱. سرور مورد نظرتان را انتخاب کنید.</li>
          <li>
            ۲. اگر قبلا حساب ساخته‌اید با شماره موبایل وارد شوید؛ اگر نه، همان‌جا در چند ثانیه
            ثبت‌نام کنید.
          </li>
          <li>۳. فاکتور صادر می‌شود و آنلاین پرداخت می‌کنید.</li>
          <li>
            ۴. پس از پرداخت، سرور آماده می‌شود و مشخصات و رمز ورودش برایتان ایمیل می‌شود.
          </li>
        </ol>
        <p className="text-[11px] text-muted/70 mt-3 leading-relaxed">
          سرور اختصاصی خودکار تحویل نمی‌شود — آماده‌سازی‌اش کار انسانی است و کمی زمان می‌برد.
        </p>
      </div>
    </div>
  );
}
