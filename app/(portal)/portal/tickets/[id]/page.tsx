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
}

interface Ticket {
  id: number;
  number: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  priority: 'low' | 'normal' | 'high';
  last_reply_at: string;
  created_at: string;
  server_id: number | null;
  server_name: string | null;
}

interface Data {
  ticket: Ticket | null;
  messages: Message[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'در انتظار پاسخ', cls: 'bg-amber/15 text-amber' },
  answered: { label: 'پاسخ داده شد', cls: 'bg-ok/15 text-ok' },
  closed: { label: 'بسته شده', cls: 'bg-line text-muted' },
};

export default function PortalTicketPage({ params }: { params: { id: string } }) {
  const { data, loading, error, reload } = useLoad<Data>(`/api/portal/tickets/${params.id}`);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await api.post(`/api/portal/tickets/${params.id}`, { body });
      setBody('');
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'ارسال پاسخ ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setMsg(null);
    setBusy(true);
    try {
      await api.post(`/api/portal/tickets/${params.id}`, { action: 'close' });
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'بستن تیکت ناموفق بود');
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
        <Link href="/portal/tickets" className="text-xs text-muted hover:text-cyan">
          ← بازگشت به تیکت‌ها
        </Link>

        <div className="flex items-start justify-between gap-3 flex-wrap mt-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold">{t.subject}</h1>
            <p className="text-[11px] text-muted mt-1">
              <span className="ltr">{t.number}</span>
              {t.server_name && (
                <>
                  {' · '}
                  <Link href={`/portal/servers/${t.server_id}`} className="hover:text-cyan">
                    {t.server_name}
                  </Link>
                </>
              )}
              {' · '}
              ثبت {formatJalali(t.created_at)}
            </p>
          </div>

          <span className={`badge shrink-0 ${st.cls}`}>{st.label}</span>
        </div>
      </div>

      {msg && <Notice type="error">{msg}</Notice>}

      {/* ── گفتگو ─────────────────────────────────────────── */}
      <div className="space-y-3">
        {data.messages.map((m) => {
          const mine = m.author === 'customer';
          return (
            <div
              key={m.id}
              className={`card p-4 ${mine ? '' : 'border-cyan/30 bg-cyan/[0.03]'}`}
            >
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <span className={`text-xs font-bold ${mine ? 'text-muted' : 'text-cyan'}`}>
                  {mine ? 'شما' : 'پشتیبانی'}
                </span>
                <span className="text-[11px] text-muted/70">
                  {timeAgo(m.created_at)} — {formatJalali(m.created_at)}
                </span>
              </div>
              {/* متن مشتری همان‌طور که نوشته شده نشان داده می‌شود:
                  whitespace-pre-wrap خط‌ها را نگه می‌دارد و break-anywhere
                  جلوی بیرون‌زدن آدرس بلند را می‌گیرد */}
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-anywhere">
                {m.body}
              </p>
            </div>
          );
        })}
      </div>

      {/* ── پاسخ ──────────────────────────────────────────── */}
      <form onSubmit={reply} className="card p-4 sm:p-5 space-y-3">
        {t.status === 'closed' && (
          <Notice type="info">
            این تیکت بسته شده. اگر پاسخ بفرستید دوباره باز می‌شود و سابقه هم حفظ می‌ماند.
          </Notice>
        )}

        <textarea
          className="input min-h-[120px] leading-relaxed"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          placeholder="پاسخ شما…"
          required
        />

        <div className="flex items-center gap-3 flex-wrap">
          <button type="submit" className="btn-primary text-xs px-4 py-1.5" disabled={busy}>
            {busy ? 'در حال ارسال…' : 'ارسال پاسخ'}
          </button>

          {t.status !== 'closed' && (
            <button
              type="button"
              className="btn-ghost text-xs px-4 py-1.5"
              onClick={close}
              disabled={busy}
            >
              مشکل حل شد، ببند
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
