'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Mono, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, timeAgo } from '@/lib/format';

interface RunRow {
  id: number;
  started_at: string;
  dry_run: boolean;
  imported: number;
  attached: number;
  detached: number;
  ok: boolean;
  detail: string | null;
}

interface VzData {
  configured: boolean;
  anchor: string;
  error?: string;
  summary: { total: number; free: number; onAnchor: number; inUse: number } | null;
  runs: RunRow[];
}

interface Report {
  dryRun: boolean;
  imported: number;
  attached: string[];
  detached: string[];
  skipped: string[];
}

export default function VirtualizorPage() {
  const { data, loading, error, reload } = useLoad<VzData>('/api/virtualizor');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function run(apply: boolean) {
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.post<Report>('/api/virtualizor', { apply });
      setReport(res);
      setMsg({
        type: 'success',
        text: apply ? 'همگام‌سازی انجام شد.' : 'پیش‌نمایش آماده است — هنوز چیزی تغییر نکرده.',
      });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'همگام‌سازی ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const ready = data.configured && Boolean(data.anchor);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">ویژالیزور</h1>
        <p className="text-xs text-muted mt-1">
          وارد کردن خودکار آی‌پی‌های آزاد، نگه‌داشتنشان روی وی‌پی‌اس لنگر تا زمان آزادشدن، و
          برگرداندن آزادشده‌ها به مخزن.
        </p>
      </div>

      {!data.configured && (
        <Notice type="error">
          اتصال ویژالیزور در فایل <Mono>.env</Mono> تنظیم نشده است — <Mono>VIRTUALIZOR_URL</Mono>،{' '}
          <Mono>VIRTUALIZOR_API_KEY</Mono> و <Mono>VIRTUALIZOR_API_PASS</Mono>.
        </Notice>
      )}

      {data.configured && !data.anchor && (
        <Notice type="warn">
          شناسه وی‌پی‌اس لنگر در تنظیمات وارد نشده است. تا وارد نشود هیچ تغییری روی ویژالیزور انجام
          نمی‌شود. یک وی‌پی‌اس خالی بسازید که فقط برای همین کار باشد.
        </Notice>
      )}

      {data.error && <Notice type="error">{data.error}</Notice>}

      {data.summary && (
        <div className="grid sm:grid-cols-4 gap-3">
          {([
            ['کل مخزن', data.summary.total, 'text-white'],
            ['آزاد', data.summary.free, 'text-ok'],
            ['روی لنگر', data.summary.onAnchor, 'text-amber'],
            ['در استفاده', data.summary.inUse, 'text-muted'],
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="card p-4">
              <div className="text-xs text-muted">{label}</div>
              <div className={`text-2xl font-bold mt-1 ${tone}`}>{faNum(value)}</div>
            </div>
          ))}
        </div>
      )}

      <Notice type="warn">
        این کار روی پنل ویژالیزور واقعی می‌نویسد. همیشه اول پیش‌نمایش بگیرید و فهرست را ببینید.
        آدرسی که به وی‌پی‌اس دیگری تخصیص یافته هرگز دست نمی‌خورد، و از لنگر فقط آدرسی برداشته
        می‌شود که پنل خودش چسبانده باشد.
      </Notice>

      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn-ghost" onClick={() => run(false)} disabled={busy || !ready}>
          {busy ? 'در حال بررسی…' : 'پیش‌نمایش بدون تغییر'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => run(true)}
          disabled={busy || !ready || !report || report.dryRun === false}
          title={!report ? 'اول پیش‌نمایش بگیرید' : undefined}
        >
          اجرای واقعی
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {report && (
        <section className="card p-5 space-y-4">
          <h2 className="text-sm font-bold">
            {report.dryRun ? 'پیش‌نمایش — هیچ تغییری اعمال نشده' : 'نتیجه اجرا'}
          </h2>
          <div className="grid sm:grid-cols-4 gap-3 text-xs">
            <div><span className="text-muted">وارد شد:</span> {faNum(report.imported)}</div>
            <div><span className="text-muted">به لنگر چسبید:</span> {faNum(report.attached.length)}</div>
            <div><span className="text-muted">از لنگر جدا شد:</span> {faNum(report.detached.length)}</div>
            <div><span className="text-muted">دست‌نخورده:</span> {faNum(report.skipped.length)}</div>
          </div>

          {([
            ['به لنگر می‌چسبند', report.attached],
            ['از لنگر جدا می‌شوند', report.detached],
          ] as const).map(([label, list]) =>
            list.length ? (
              <div key={label}>
                <div className="text-xs text-muted mb-1">{label}</div>
                <div className="max-h-40 overflow-y-auto text-xs ltr font-mono leading-6 bg-black/20 rounded-md p-2">
                  {list.slice(0, 300).join('  ')}
                  {list.length > 300 && ` … و ${faNum(list.length - 300)} مورد دیگر`}
                </div>
              </div>
            ) : null,
          )}
        </section>
      )}

      <section className="card p-5">
        <h2 className="text-sm font-bold mb-3">اجراهای اخیر</h2>
        {!data.runs.length ? (
          <p className="text-xs text-muted">هنوز اجرایی ثبت نشده.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="text-start py-1">زمان</th>
                  <th className="text-start py-1">حالت</th>
                  <th className="text-start py-1">وارد</th>
                  <th className="text-start py-1">چسبید</th>
                  <th className="text-start py-1">جدا شد</th>
                  <th className="text-start py-1">نتیجه</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-1.5">{timeAgo(r.started_at)}</td>
                    <td className="py-1.5">{r.dry_run ? 'آزمایشی' : 'واقعی'}</td>
                    <td className="py-1.5">{faNum(r.imported)}</td>
                    <td className="py-1.5">{faNum(r.attached)}</td>
                    <td className="py-1.5">{faNum(r.detached)}</td>
                    <td className="py-1.5">
                      {r.ok ? (
                        <span className="text-ok">موفق</span>
                      ) : (
                        <span className="text-danger" title={r.detail || undefined}>ناموفق</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
