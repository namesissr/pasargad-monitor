'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { TopupForm } from '@/components/TopupForm';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalaliDay, formatToman, timeAgo } from '@/lib/format';

interface TopupRow {
  id: number;
  server_id: number;
  server_name: string;
  customer_name: string | null;
  gb: number;
  price_toman: number | null;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
}

interface TopupData {
  topups: TopupRow[];
  // در نمای همه سرورها فقط مجموع خرید معنا دارد: جمع موجودی چند سرور
  // عدد بی‌معنایی است، چون هر سرور دفتر خودش را دارد.
  totals: { purchased: number } | null;
}

export default function TopupsPage() {
  const { data, loading, error, reload } = useLoad<TopupData>('/api/topups?limit=200');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function remove(t: TopupRow) {
    if (
      !confirm(
        'این ردیف حذف شود؟ برای اصلاح اشتباه بهتر است ترافیک منفی ثبت کنید تا هر دو ردیف در تاریخچه بمانند.',
      )
    ) {
      return;
    }
    try {
      await api.del(`/api/topups?id=${t.id}`);
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'حذف شارژ ناموفق بود' });
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">خرید ترافیک</h1>
          <p className="text-xs text-muted mt-0.5">
            سرور اختصاصی سهمیه ماهانه ندارد؛ مشترک ترافیک می‌خرد و هر وقت تمام شد دوباره
            می‌خرد. ترافیک خریداری‌شده انقضا ندارد.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          + خرید ترافیک
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      <div className="card p-4">
        <div className="text-xs text-muted">مجموع ترافیک فروخته‌شده</div>
        <div className="text-2xl font-bold mt-1">
          {faNum((data.totals?.purchased ?? 0).toFixed(0))} گیگ
        </div>
        <div className="text-[11px] text-muted mt-0.5">
          موجودی باقی‌مانده هر سرور در صفحه خودش دیده می‌شود
        </div>
      </div>

      {!data.topups.length ? (
        <Notice type="warn">هنوز ترافیکی فروخته نشده.</Notice>
      ) : (
        <div className="card table-wrap">
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th>تاریخ</th>
                <th>سرور</th>
                <th>مشتری</th>
                <th>مقدار</th>
                <th>مبلغ</th>
                <th>ثبت‌کننده</th>
                <th>توضیح</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.topups.map((t) => (
                <tr key={t.id}>
                  <td className="text-xs whitespace-nowrap" title={t.created_at}>
                    {formatJalaliDay(t.created_at)}
                    <span className="text-muted block text-[11px]">{timeAgo(t.created_at)}</span>
                  </td>
                  <td className="text-xs">{t.server_name}</td>
                  <td className="text-xs">{t.customer_name || '—'}</td>
                  {/* عدد منفی یعنی اصلاح اشتباه و باید از خرید جدا دیده شود */}
                  <td className={`text-xs font-bold ${t.gb < 0 ? 'text-danger' : 'text-ok'}`}>
                    {t.gb > 0 ? '+' : ''}
                    {faNum(t.gb.toFixed(0))} گیگ
                  </td>
                  <td className="text-xs">{t.price_toman ? formatToman(t.price_toman) : '—'}</td>
                  <td className="text-xs text-muted">{t.created_by_name || '—'}</td>
                  <td className="text-xs max-w-[180px]">
                    <span className="truncate block" title={t.note || undefined}>
                      {t.note || '—'}
                    </span>
                  </td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-danger"
                      onClick={() => remove(t)}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <TopupForm
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
