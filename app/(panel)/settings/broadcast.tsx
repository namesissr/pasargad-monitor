'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalali } from '@/lib/format';

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

interface Broadcast {
  id: number;
  channel: 'email' | 'sms';
  subject: string | null;
  body: string;
  target: string;
  status: 'queued' | 'sending' | 'done' | 'canceled';
  total: number;
  sent: number;
  failed: number;
  created_at: string;
  created_by_name: string | null;
}

interface Data {
  broadcasts: Broadcast[];
  customers: Customer[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: 'در صف', cls: 'bg-line text-muted' },
  sending: { label: 'در حال ارسال', cls: 'bg-cyan/15 text-cyan' },
  done: { label: 'تمام', cls: 'bg-ok/15 text-ok' },
  canceled: { label: 'لغو شده', cls: 'bg-danger/15 text-danger' },
};

const SMS_MAX = 480;

/**
 * ارسال همگانی، جدا برای ایمیل و پیامک.
 *
 * ── چرا دو کارت جدا و نه یک فرم با انتخاب کانال ────────────
 *
 * متنشان فرق دارد، گیرنده‌هایشان فرق دارد، و مهم‌تر: پیامک هزینه دارد.
 * با یک فرم مشترک، کسی که عجله دارد کانال را نگاه نمی‌کند و بدون اینکه
 * بخواهد چند صد پیامک می‌فرستد.
 */
function BroadcastForm({
  channel,
  customers,
  onSent,
}: {
  channel: 'email' | 'sms';
  customers: Customer[];
  onSent: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<'all' | 'selected'>('all');
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const isSms = channel === 'sms';

  // فقط مشتری‌هایی که این کانال را دارند. نشان‌دادن بقیه یعنی ادمین
  // انتخابشان می‌کند و بعد می‌بیند پیام نرفته.
  const reachable = customers.filter((c) => (isSms ? c.phone : c.email));
  const chosen = target === 'all' ? reachable.length : picked.length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const question = isSms
      ? `پیامک به ${chosen} مشتری فرستاده شود؟\n\nپیامک هزینه دارد و برگشت‌پذیر نیست.`
      : `ایمیل به ${chosen} مشتری فرستاده شود؟`;
    if (!confirm(question)) return;

    setBusy(true);
    try {
      const res = await api.post<{ total: number }>('/api/broadcasts', {
        channel,
        subject: isSms ? '' : subject,
        body,
        target,
        customer_ids: picked,
      });
      setMsg({
        type: 'success',
        text: `در صف قرار گرفت: ${faNum(res.total)} گیرنده. ارسال در پس‌زمینه انجام می‌شود.`,
      });
      setSubject('');
      setBody('');
      setPicked([]);
      setTarget('all');
      onSent();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ثبت ارسال ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-line rounded-xl p-4 space-y-4">
      <h3 className="text-xs font-bold">{isSms ? 'پیامک همگانی' : 'ایمیل همگانی'}</h3>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {!isSms && (
        <Field label="موضوع">
          <input
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            required
          />
        </Field>
      )}

      <Field
        label="متن"
        hint={isSms ? `حداکثر ${SMS_MAX} کاراکتر — هر پیامک هزینه دارد` : undefined}
      >
        <textarea
          className="input min-h-[110px] leading-relaxed"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={isSms ? SMS_MAX : 5000}
          required
        />
      </Field>

      {isSms && (
        <p className="text-[11px] text-muted -mt-2">
          {faNum(body.length)} از {faNum(SMS_MAX)} کاراکتر
        </p>
      )}

      <div className="flex gap-1">
        {(
          [
            ['all', `همه (${faNum(reachable.length)})`],
            ['selected', 'انتخابی'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTarget(key)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              target === key
                ? 'bg-cyan/10 text-cyan border-cyan/30'
                : 'border-line text-muted hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {target === 'selected' && (
        <div className="border border-line rounded-lg max-h-52 overflow-y-auto divide-y divide-line/60">
          {!reachable.length ? (
            <p className="text-xs text-muted p-3 text-center">
              هیچ مشتری‌ای {isSms ? 'شماره' : 'ایمیل'} ثبت‌شده ندارد.
            </p>
          ) : (
            reachable.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-panel2/60"
              >
                <input
                  type="checkbox"
                  className="accent-cyan"
                  checked={picked.includes(c.id)}
                  onChange={(e) =>
                    setPicked((list) =>
                      e.target.checked ? [...list, c.id] : list.filter((x) => x !== c.id),
                    )
                  }
                />
                <span className="text-xs flex-1 min-w-0 truncate">{c.name}</span>
                <span className="text-[11px] text-muted ltr truncate max-w-[45%]">
                  {isSms ? c.phone : c.email}
                </span>
              </label>
            ))
          )}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          className="btn-primary text-xs px-4 py-1.5"
          disabled={busy || chosen === 0 || !body.trim()}
        >
          {busy ? 'در حال ثبت…' : `ارسال به ${faNum(chosen)} مشتری`}
        </button>
        <span className="text-[11px] text-muted">
          {isSms
            ? 'مشتری‌های بدون شماره در فهرست نمی‌آیند.'
            : 'مشتری‌های بدون ایمیل در فهرست نمی‌آیند.'}
        </span>
      </div>
    </form>
  );
}

export function BroadcastPanel() {
  // در حال ارسال، پیشرفت باید دیده شود؛ بدون آن ادمین نمی‌داند کار
  // پیش می‌رود یا گیر کرده
  const { data, loading, error, reload } = useLoad<Data>('/api/broadcasts', 10_000);
  const [msg, setMsg] = useState<string | null>(null);

  async function cancel(b: Broadcast) {
    if (
      !confirm(
        'ارسال لغو شود؟\n\nپیام‌هایی که رفته‌اند برنمی‌گردند؛ لغو فقط جلوی بقیه را می‌گیرد.',
      )
    ) {
      return;
    }
    setMsg(null);
    try {
      await api.patch('/api/broadcasts', { id: b.id, action: 'cancel' });
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'لغو ناموفق بود');
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold">ارسال همگانی</h2>
        <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
          ارسال در پس‌زمینه و دسته‌دسته انجام می‌شود، پس بستن این صفحه مشکلی ندارد.
        </p>
      </div>

      {msg && <Notice type="error">{msg}</Notice>}

      <div className="grid lg:grid-cols-2 gap-4">
        <BroadcastForm channel="email" customers={data.customers} onSent={reload} />
        <BroadcastForm channel="sms" customers={data.customers} onSent={reload} />
      </div>

      {data.broadcasts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold">ارسال‌های اخیر</h3>

          {data.broadcasts.map((b) => {
            const st = STATUS[b.status] || STATUS.done;
            const done = b.sent + b.failed;
            const pct = b.total > 0 ? Math.round((done / b.total) * 100) : 0;

            return (
              <div key={b.id} className="border border-line rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold">
                      {b.channel === 'sms' ? 'پیامک' : 'ایمیل'}
                      {b.subject && ` — ${b.subject}`}
                      <span className={`badge ms-2 ${st.cls}`}>{st.label}</span>
                    </h4>
                    <p className="text-[11px] text-muted mt-1 line-clamp-1">{b.body}</p>
                    <p className="text-[11px] text-muted/70 mt-1">
                      {formatJalali(b.created_at)}
                      {b.created_by_name && ` · ${b.created_by_name}`}
                      {' · '}
                      {faNum(b.sent)} موفق
                      {b.failed > 0 && (
                        <span className="text-danger"> · {faNum(b.failed)} ناموفق</span>
                      )}
                      {' از '}
                      {faNum(b.total)}
                    </p>
                  </div>

                  {(b.status === 'queued' || b.status === 'sending') && (
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-danger shrink-0"
                      onClick={() => cancel(b)}
                    >
                      لغو
                    </button>
                  )}
                </div>

                {/* نوار پیشرفت فقط تا وقتی کار تمام نشده */}
                {(b.status === 'queued' || b.status === 'sending') && (
                  <div className="h-1.5 rounded-full bg-line overflow-hidden">
                    <div
                      className="h-full bg-cyan transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
