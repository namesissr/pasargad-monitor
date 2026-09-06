'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
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
  server_id: number | null;
  server_name: string | null;
  message_count: number;
}

interface ServerRow {
  id: number;
  name: string;
}

interface Data {
  tickets: Ticket[];
  servers: ServerRow[];
  enabled: boolean;
}

/**
 * وضعیت در دیتابیس از دید ماست (open یعنی نوبت پاسخ ماست). برچسبی که
 * مشتری می‌بیند برعکس ترجمه می‌شود، وگرنه «باز» را «هنوز جواب ندادم»
 * می‌فهمد.
 */
const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'در انتظار پاسخ', cls: 'bg-amber/15 text-amber' },
  answered: { label: 'پاسخ داده شد', cls: 'bg-ok/15 text-ok' },
  closed: { label: 'بسته شده', cls: 'bg-line text-muted' },
};

export default function PortalTicketsPage() {
  const { data, loading, error, reload } = useLoad<Data>('/api/portal/tickets');

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [serverId, setServerId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await api.post('/api/portal/tickets', {
        subject,
        body,
        priority,
        server_id: serverId ? Number(serverId) : null,
      });
      setSubject('');
      setBody('');
      setServerId('');
      setPriority('normal');
      setOpen(false);
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'ثبت تیکت ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const waiting = data.tickets.filter((t) => t.status === 'open').length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">پشتیبانی</h1>
          <p className="text-xs text-muted mt-0.5">
            {waiting > 0
              ? `${faNum(waiting)} تیکت در انتظار پاسخ ماست.`
              : 'پاسخ تیکت‌ها به ایمیل شما هم فرستاده می‌شود.'}
          </p>
        </div>

        {data.enabled && (
          <button type="button" className="btn-primary text-xs px-4 py-1.5" onClick={() => setOpen((v) => !v)}>
            {open ? 'انصراف' : 'تیکت تازه'}
          </button>
        )}
      </div>

      {msg && <Notice type="error">{msg}</Notice>}

      {!data.enabled && (
        <Notice type="warn">ثبت تیکت تازه فعلاً غیرفعال است. برای موارد فوری تماس بگیرید.</Notice>
      )}

      {/* ── تیکت تازه ──────────────────────────────────────── */}
      {open && data.enabled && (
        <form onSubmit={submit} className="card p-4 sm:p-5 space-y-3">
          <Field label="موضوع">
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="مثلا: قطعی سرور یا سوال درباره ترافیک"
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="سرور مربوطه (اختیاری)">
              <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
                <option value="">مربوط به سرور خاصی نیست</option>
                {data.servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="اولویت">
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">کم</option>
                <option value="normal">عادی</option>
                <option value="high">زیاد — سرویس از کار افتاده</option>
              </select>
            </Field>
          </div>

          <Field label="شرح">
            <textarea
              className="input min-h-[140px] leading-relaxed"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={10000}
              placeholder="هرچه دقیق‌تر بنویسید — پیام خطا، ساعت رخ‌دادن، آی‌پی — زودتر حل می‌شود."
              required
            />
          </Field>

          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary text-xs px-4 py-1.5" disabled={busy}>
              {busy ? 'در حال ارسال…' : 'ارسال تیکت'}
            </button>
            <span className="text-[11px] text-muted">پاسخ به ایمیل شما هم می‌رسد.</span>
          </div>
        </form>
      )}

      {/* ── فهرست ─────────────────────────────────────────── */}
      {!data.tickets.length ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-muted">هنوز تیکتی ثبت نکرده‌اید.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.tickets.map((t) => {
            const st = STATUS[t.status] || STATUS.closed;
            return (
              <Link
                key={t.id}
                href={`/portal/tickets/${t.id}`}
                className="card p-4 flex items-start justify-between gap-3 hover:border-cyan/40 transition-colors"
              >
                <div className="min-w-0">
                  <h3 className="text-sm font-bold truncate">{t.subject}</h3>
                  <p className="text-[11px] text-muted mt-1">
                    <span className="ltr">{t.number}</span>
                    {t.server_name && ` · ${t.server_name}`}
                    {t.priority === 'high' && ' · اولویت زیاد'}
                    {` · ${faNum(t.message_count)} پیام`}
                  </p>
                  <p className="text-[11px] text-muted/70 mt-0.5">
                    آخرین پیام {timeAgo(t.last_reply_at)} — {formatJalaliDay(t.last_reply_at)}
                  </p>
                </div>

                <span className={`badge shrink-0 ${st.cls}`}>{st.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted/70 leading-relaxed">
        اولویت «زیاد» را فقط برای قطعی سرویس بگذارید. اگر روی همه تیکت‌ها گذاشته شود، دیگر
        هیچ تیکتی جلو نمی‌افتد.
      </p>
    </div>
  );
}
