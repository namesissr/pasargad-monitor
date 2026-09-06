'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatJalali, timeAgo } from '@/lib/format';

interface Message {
  id: number;
  author: 'customer' | 'admin';
  body: string;
  created_at: string;
  author_name: string | null;
}

interface Ticket {
  id: number;
  number: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  priority: 'low' | 'normal' | 'high';
  last_reply_at: string;
  created_at: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  server_id: number | null;
  server_name: string | null;
}

interface Data {
  ticket: Ticket | null;
  messages: Message[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'منتظر پاسخ ما', cls: 'bg-amber/15 text-amber' },
  answered: { label: 'پاسخ داده شد', cls: 'bg-ok/15 text-ok' },
  closed: { label: 'بسته', cls: 'bg-line text-muted' },
};

export default function TicketPage({ params }: { params: { id: string } }) {
  const { data, loading, error, reload } = useLoad<Data>(`/api/tickets?id=${params.id}`);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send(close: boolean) {
    if (!body.trim()) {
      setMsg('متن پاسخ را بنویسید');
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      await api.patch('/api/tickets', { id: Number(params.id), action: 'reply', body, close });
      setBody('');
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'ارسال پاسخ ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  async function patch(payload: Record<string, unknown>) {
    setMsg(null);
    setBusy(true);
    try {
      await api.patch('/api/tickets', { id: Number(params.id), ...payload });
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'تغییر انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  if (loading || error || !data || !data.ticket) {
    return (
      <LoadState loading={loading} error={error} onRetry={reload}>
        {null}
      </LoadState>
    );
  }

  const t = data.ticket;
  const st = STATUS[t.status] || STATUS.closed;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/tickets" className="text-xs text-muted hover:text-cyan">
          ← بازگشت به تیکت‌ها
        </Link>

        <div className="flex items-start justify-between gap-3 flex-wrap mt-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold">{t.subject}</h1>
            <p className="text-[11px] text-muted mt-1">
              <span className="ltr">{t.number}</span> · {t.customer_name}
              {t.server_name && (
                <>
                  {' · '}
                  <Link href={`/servers/${t.server_id}`} className="hover:text-cyan">
                    {t.server_name}
                  </Link>
                </>
              )}
              {' · '}
              ثبت {formatJalali(t.created_at)}
            </p>
            <p className="text-[11px] text-muted/70 mt-0.5 ltr">
              {[t.customer_email, t.customer_phone].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>

          <span className={`badge shrink-0 ${st.cls}`}>{st.label}</span>
        </div>
      </div>

      {msg && <Notice type="error">{msg}</Notice>}

      {/* ایمیل پاسخ فقط وقتی می‌رود که مشتری ایمیل داشته باشد. اگر ندارد
          باید همین‌جا معلوم باشد، نه بعد از فرستادن پاسخی که هیچ‌کس
          خبردار نمی‌شود. */}
      {!t.customer_email && (
        <Notice type="warn">
          این مشتری ایمیل ثبت‌شده ندارد؛ پاسخ فقط در پرتال دیده می‌شود و ایمیلی ارسال نمی‌شود.
        </Notice>
      )}

      {/* ── ابزار ─────────────────────────────────────────── */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <label className="label mb-0 text-[11px]">اولویت</label>
        <select
          className="input w-auto py-1 text-xs"
          value={t.priority}
          onChange={(e) => patch({ action: 'priority', priority: e.target.value })}
          disabled={busy}
        >
          <option value="low">کم</option>
          <option value="normal">عادی</option>
          <option value="high">زیاد</option>
        </select>

        <label className="label mb-0 text-[11px]">وضعیت</label>
        <select
          className="input w-auto py-1 text-xs"
          value={t.status}
          onChange={(e) => patch({ action: 'status', status: e.target.value })}
          disabled={busy}
        >
          <option value="open">منتظر پاسخ ما</option>
          <option value="answered">پاسخ داده شد</option>
          <option value="closed">بسته</option>
        </select>
      </div>

      {/* ── گفتگو ─────────────────────────────────────────── */}
      <div className="space-y-3">
        {data.messages.map((m) => {
          const ours = m.author === 'admin';
          return (
            <div key={m.id} className={`card p-4 ${ours ? 'border-cyan/30 bg-cyan/[0.03]' : ''}`}>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <span className={`text-xs font-bold ${ours ? 'text-cyan' : 'text-white'}`}>
                  {ours ? `پشتیبانی${m.author_name ? ` — ${m.author_name}` : ''}` : t.customer_name}
                </span>
                <span className="text-[11px] text-muted/70">
                  {timeAgo(m.created_at)} — {formatJalali(m.created_at)}
                </span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-anywhere">{m.body}</p>
            </div>
          );
        })}
      </div>

      {/* ── پاسخ ──────────────────────────────────────────── */}
      <div className="card p-4 sm:p-5 space-y-3">
        <textarea
          className="input min-h-[140px] leading-relaxed"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          placeholder="پاسخ به مشتری…"
        />

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="btn-primary text-xs px-4 py-1.5"
            onClick={() => send(false)}
            disabled={busy}
          >
            {busy ? 'در حال ارسال…' : 'ارسال پاسخ'}
          </button>

          <button
            type="button"
            className="btn-ghost text-xs px-4 py-1.5"
            onClick={() => send(true)}
            disabled={busy}
          >
            ارسال و بستن
          </button>

          <span className="text-[11px] text-muted">
            پاسخ برای مشتری ایمیل می‌شود و در پرتال هم دیده می‌شود.
          </span>
        </div>
      </div>
    </div>
  );
}
