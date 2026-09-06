'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { faNum, formatJalaliDay, timeAgo } from '@/lib/format';

interface Ticket {
  id: number;
  number: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  priority: 'low' | 'normal' | 'high';
  last_reply_at: string;
  last_reply_by: string;
  created_at: string;
  customer_id: number;
  customer_name: string;
  customer_email: string | null;
  server_id: number | null;
  server_name: string | null;
  message_count: number;
}

interface Data {
  tickets: Ticket[];
  totals: { open: number; answered: number } | null;
}

/**
 * وضعیت از دید ماست: open یعنی نوبت پاسخ ماست. برچسب پنل هم همین را
 * می‌گوید — «منتظر پاسخ ما» — تا کسی آن را با «باز است پس کاری ندارد»
 * اشتباه نگیرد.
 */
const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'منتظر پاسخ ما', cls: 'bg-amber/15 text-amber' },
  answered: { label: 'پاسخ داده شد', cls: 'bg-ok/15 text-ok' },
  closed: { label: 'بسته', cls: 'bg-line text-muted' },
};

const PRIORITY: Record<string, { label: string; cls: string }> = {
  high: { label: 'زیاد', cls: 'bg-danger/15 text-danger' },
  normal: { label: 'عادی', cls: 'bg-line text-muted' },
  low: { label: 'کم', cls: 'bg-line text-muted/70' },
};

const FILTERS = [
  { key: '', label: 'همه' },
  { key: 'open', label: 'منتظر پاسخ ما' },
  { key: 'answered', label: 'پاسخ داده‌شده' },
  { key: 'closed', label: 'بسته' },
];

export default function TicketsPage() {
  // پیش‌فرض روی «منتظر پاسخ ما» است: صف کار همین است و باز کردن صفحه
  // نباید با فهرست تیکت‌های بسته شروع شود
  const [filter, setFilter] = useState('open');
  const { data, loading, error, reload } = useLoad<Data>(
    `/api/tickets${filter ? `?status=${filter}` : ''}`,
  );

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">پشتیبانی</h1>
          <p className="text-xs text-muted mt-0.5">
            {data.totals
              ? `${faNum(data.totals.open)} تیکت منتظر پاسخ · ${faNum(data.totals.answered)} پاسخ‌داده‌شده`
              : 'تیکت‌های مشتریان'}
          </p>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              filter === f.key
                ? 'bg-cyan/10 text-cyan border-cyan/30'
                : 'border-line text-muted hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!data.tickets.length ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-muted">تیکتی در این وضعیت نیست.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>موضوع</th>
                  <th>مشتری</th>
                  <th className="col-sm">سرور</th>
                  <th>وضعیت</th>
                  <th className="col-sm">اولویت</th>
                  <th className="col-md">آخرین پیام</th>
                </tr>
              </thead>
              <tbody>
                {data.tickets.map((t) => {
                  const st = STATUS[t.status] || STATUS.closed;
                  const pr = PRIORITY[t.priority] || PRIORITY.normal;
                  return (
                    <tr key={t.id}>
                      <td className="text-xs">
                        <Link href={`/tickets/${t.id}`} className="font-medium hover:text-cyan">
                          {t.subject}
                        </Link>
                        <span className="block text-[11px] text-muted ltr">{t.number}</span>
                      </td>
                      <td className="text-xs">
                        {t.customer_name}
                        <span className="block text-[11px] text-muted">
                          {faNum(t.message_count)} پیام
                        </span>
                      </td>
                      <td className="text-xs text-muted col-sm">
                        {t.server_name ? (
                          <Link href={`/servers/${t.server_id}`} className="hover:text-cyan">
                            {t.server_name}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-xs">
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="text-xs col-sm">
                        <span className={`badge ${pr.cls}`}>{pr.label}</span>
                      </td>
                      <td className="text-xs text-muted col-md sm:whitespace-nowrap">
                        {timeAgo(t.last_reply_at)}
                        <span className="block text-[11px]">
                          {formatJalaliDay(t.last_reply_at)}
                          {t.last_reply_by === 'customer' ? ' — مشتری' : ' — ما'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
