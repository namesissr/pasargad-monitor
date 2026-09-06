'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalali, timeAgo } from '@/lib/format';

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
  finished_at: string | null;
  created_by_name: string | null;
}

interface Recipient {
  id: number;
  address: string;
  status: 'pending' | 'sent' | 'failed';
  error: string | null;
  sent_at: string | null;
  customer_name: string;
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

const ROW_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'در انتظار', cls: 'text-muted' },
  sent: { label: 'رفت', cls: 'text-ok' },
  failed: { label: 'نرفت', cls: 'text-danger' },
};

const SMS_MAX = 480;

/**
 * فرم ارسال، جدا برای هر کانال.
 *
 * ── چرا دو فرم جدا و نه یکی با انتخاب کانال ────────────────
 *
 * متنشان فرق دارد (پیامک کوتاه و بی‌عنوان)، گیرنده‌هایشان فرق دارد، و
 * مهم‌تر: پیامک هزینه دارد. با یک فرم مشترک، کسی که عجله دارد کانال را
 * نگاه نمی‌کند و بدون اینکه بخواهد چند صد پیامک می‌فرستد.
 */
function Composer({
  channel,
  customers,
  preset,
  onSent,
}: {
  channel: 'email' | 'sms';
  customers: Customer[];
  preset?: { subject: string; body: string } | null;
  onSent: () => void;
}) {
  const isSms = channel === 'sms';

  const [subject, setSubject] = useState(preset?.subject ?? '');
  const [body, setBody] = useState(preset?.body ?? '');
  const [target, setTarget] = useState<'all' | 'selected'>('all');
  const [picked, setPicked] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // فقط مشتری‌هایی که این کانال را دارند. نشان‌دادن بقیه یعنی ادمین
  // انتخابشان می‌کند و بعد می‌بیند پیام نرفته.
  const reachable = customers.filter((c) => (isSms ? c.phone : c.email));
  const listed = search
    ? reachable.filter((c) => `${c.name} ${c.phone ?? ''} ${c.email ?? ''}`.includes(search))
    : reachable;
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
    <form onSubmit={submit} className="card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold">{isSms ? 'پیامک همگانی' : 'ایمیل همگانی'}</h2>
        <p className="text-[11px] text-muted mt-0.5">
          {faNum(reachable.length)} مشتری {isSms ? 'شماره' : 'ایمیل'} ثبت‌شده دارند.
        </p>
      </div>

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

      <Field label="متن">
        <textarea
          className="input min-h-[120px] leading-relaxed"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={isSms ? SMS_MAX : 5000}
          required
        />
      </Field>

      {isSms && (
        <p
          className={`text-[11px] -mt-2 ${
            body.length > SMS_MAX * 0.9 ? 'text-amber' : 'text-muted'
          }`}
        >
          {faNum(body.length)} از {faNum(SMS_MAX)} کاراکتر · هر پیامک هزینه دارد
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
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="input py-1.5 text-xs flex-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجوی مشتری"
            />
            <button
              type="button"
              className="btn-ghost text-xs px-3 py-1.5 whitespace-nowrap"
              onClick={() =>
                setPicked((p) =>
                  // انتخاب همه فقط روی همان‌هایی که فیلتر نشان می‌دهد،
                  // نه کل فهرست — وگرنه جستجو بی‌معنی می‌شود
                  p.length === listed.length ? [] : listed.map((c) => c.id),
                )
              }
            >
              {picked.length === listed.length && listed.length ? 'هیچ‌کدام' : 'همه اینها'}
            </button>
          </div>

          <div className="border border-line rounded-lg max-h-56 overflow-y-auto divide-y divide-line/60">
            {!listed.length ? (
              <p className="text-xs text-muted p-3 text-center">مشتری‌ای پیدا نشد.</p>
            ) : (
              listed.map((c) => (
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
        </div>
      )}

      <button
        type="submit"
        className="btn-primary w-full"
        disabled={busy || chosen === 0 || !body.trim()}
      >
        {busy ? 'در حال ثبت…' : `ارسال به ${faNum(chosen)} مشتری`}
      </button>
    </form>
  );
}

/** گیرنده‌های یک ارسال، با وضعیت و علت خطا */
function Detail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  // در حال ارسال، فهرست باید زنده باشد
  const { data, loading, error, reload } = useLoad<{
    broadcast: Broadcast;
    recipients: Recipient[];
  }>(`/api/broadcasts?id=${id}`, 5000);

  const [filter, setFilter] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function retry() {
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.patch<{ retried: number }>('/api/broadcasts', {
        id,
        action: 'retry_failed',
      });
      setMsg(`${faNum(res.retried)} گیرنده دوباره در صف قرار گرفتند.`);
      reload();
      onChanged();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'تلاش دوباره ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.recipients ?? [];
  const shown = filter ? rows.filter((r) => r.status === filter) : rows;
  const failed = rows.filter((r) => r.status === 'failed').length;

  return (
    <Modal open title="گیرنده‌های ارسال" onClose={onClose} wide>
      {loading || error || !data ? (
        <LoadState loading={loading} error={error} onRetry={reload}>
          {null}
        </LoadState>
      ) : (
        <div className="space-y-3">
          <div className="card p-3 bg-panel2/40 text-xs space-y-1">
            <div className="flex justify-between gap-3">
              <span className="text-muted">کانال</span>
              <span>{data.broadcast.channel === 'sms' ? 'پیامک' : 'ایمیل'}</span>
            </div>
            {data.broadcast.subject && (
              <div className="flex justify-between gap-3">
                <span className="text-muted">موضوع</span>
                <span className="truncate max-w-[60%]">{data.broadcast.subject}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-muted">نتیجه</span>
              <span>
                {faNum(data.broadcast.sent)} موفق
                {data.broadcast.failed > 0 && (
                  <span className="text-danger"> · {faNum(data.broadcast.failed)} ناموفق</span>
                )}
                {' از '}
                {faNum(data.broadcast.total)}
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed whitespace-pre-wrap break-anywhere border border-line rounded-lg p-3 max-h-32 overflow-y-auto">
            {data.broadcast.body}
          </p>

          {msg && <Notice type="info">{msg}</Notice>}

          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                ['', 'همه'],
                ['failed', 'ناموفق'],
                ['pending', 'در انتظار'],
                ['sent', 'موفق'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key || 'all'}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  filter === key
                    ? 'bg-cyan/10 text-cyan border-cyan/30'
                    : 'border-line text-muted hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}

            {failed > 0 && (
              <button
                type="button"
                className="btn-ghost text-xs px-3 py-1.5 ms-auto"
                onClick={retry}
                disabled={busy}
              >
                تلاش دوباره برای {faNum(failed)} ناموفق
              </button>
            )}
          </div>

          {!shown.length ? (
            <p className="text-xs text-muted text-center py-6">گیرنده‌ای با این فیلتر نیست.</p>
          ) : (
            <div className="border border-line rounded-lg max-h-72 overflow-y-auto divide-y divide-line/60">
              {shown.map((r) => {
                const st = ROW_STATUS[r.status];
                return (
                  <div key={r.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs truncate">{r.customer_name}</span>
                      <span className={`text-[11px] shrink-0 ${st.cls}`}>
                        {st.label}
                        {r.sent_at && ` · ${timeAgo(r.sent_at)}`}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted ltr truncate">{r.address}</div>
                    {/* علت خطا باید دیده شود، وگرنه «نرفت» هیچ کمکی
                        نمی‌کند */}
                    {r.error && (
                      <div className="text-[11px] text-danger mt-0.5 break-anywhere">{r.error}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function BroadcastsPage() {
  // در حال ارسال، پیشرفت باید دیده شود
  const { data, loading, error, reload } = useLoad<Data>('/api/broadcasts', 10_000);

  const [tab, setTab] = useState<'email' | 'sms'>('email');
  const [detail, setDetail] = useState<number | null>(null);
  const [preset, setPreset] = useState<{ subject: string; body: string } | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>('');
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

  /** همان متن، ارسال تازه — بدون دست‌زدن به سابقه قبلی */
  function reuse(b: Broadcast) {
    setTab(b.channel);
    setPreset({ subject: b.subject ?? '', body: b.body });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const all = data.broadcasts;
  const shown = channelFilter ? all.filter((b) => b.channel === channelFilter) : all;

  const monthAgo = Date.now() - 30 * 86400000;
  const recent = all.filter((b) => new Date(b.created_at).getTime() > monthAgo);
  const smsMonth = recent.filter((b) => b.channel === 'sms').reduce((s, b) => s + b.sent, 0);
  const mailMonth = recent.filter((b) => b.channel === 'email').reduce((s, b) => s + b.sent, 0);
  const running = all.filter((b) => b.status === 'queued' || b.status === 'sending').length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">ارسال همگانی</h1>
        <p className="text-xs text-muted mt-0.5">
          ارسال در پس‌زمینه و دسته‌دسته انجام می‌شود، پس بستن این صفحه مشکلی ندارد.
        </p>
      </div>

      {msg && <Notice type="error">{msg}</Notice>}

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs text-muted">پیامک، سی روز گذشته</div>
          <div className="text-2xl font-bold mt-1 text-amber">{faNum(smsMonth)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">ایمیل، سی روز گذشته</div>
          <div className="text-2xl font-bold mt-1 text-cyan">{faNum(mailMonth)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">در حال ارسال</div>
          <div className={`text-2xl font-bold mt-1 ${running ? 'text-ok' : ''}`}>
            {faNum(running)}
          </div>
        </div>
      </div>

      {/* ── ارسال تازه ───────────────────────────────────── */}
      <div className="flex gap-1">
        {(
          [
            ['email', 'ایمیل'],
            ['sms', 'پیامک'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setPreset(null);
            }}
            className={`px-4 py-2 rounded-lg text-xs border transition-colors ${
              tab === key
                ? 'bg-cyan/10 text-cyan border-cyan/30'
                : 'border-line text-muted hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* key باعث می‌شود با عوض‌شدن تب یا متن پیش‌فرض، فرم از نو ساخته
          شود — وگرنه متن قبلی در فرم دیگر باقی می‌ماند */}
      <Composer
        key={`${tab}-${preset?.body ?? ''}`}
        channel={tab}
        customers={data.customers}
        preset={preset}
        onSent={() => {
          setPreset(null);
          reload();
        }}
      />

      {/* ── تاریخچه ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold">ارسال‌های پیشین</h2>
        <div className="flex gap-1">
          {(
            [
              ['', 'همه'],
              ['email', 'ایمیل'],
              ['sms', 'پیامک'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key || 'all'}
              type="button"
              onClick={() => setChannelFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                channelFilter === key
                  ? 'bg-cyan/10 text-cyan border-cyan/30'
                  : 'border-line text-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!shown.length ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-muted">هنوز ارسالی ثبت نشده.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((b) => {
            const st = STATUS[b.status] || STATUS.done;
            const done = b.sent + b.failed;
            const pct = b.total > 0 ? Math.round((done / b.total) * 100) : 0;

            return (
              <div key={b.id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold">
                      <span className="badge bg-line text-muted me-2">
                        {b.channel === 'sms' ? 'پیامک' : 'ایمیل'}
                      </span>
                      {b.subject || b.body.slice(0, 40)}
                      <span className={`badge ms-2 ${st.cls}`}>{st.label}</span>
                    </h3>
                    <p className="text-[11px] text-muted mt-1 line-clamp-1">{b.body}</p>
                    <p className="text-[11px] text-muted/70 mt-1">
                      {formatJalali(b.created_at)}
                      {b.created_by_name && ` · ${b.created_by_name}`}
                      {' · '}
                      {b.target === 'all' ? 'همه' : 'انتخابی'}
                      {' · '}
                      {faNum(b.sent)} موفق
                      {b.failed > 0 && (
                        <span className="text-danger"> · {faNum(b.failed)} ناموفق</span>
                      )}
                      {' از '}
                      {faNum(b.total)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <button
                      type="button"
                      className="text-cyan hover:underline"
                      onClick={() => setDetail(b.id)}
                    >
                      گیرنده‌ها
                    </button>
                    <button
                      type="button"
                      className="text-muted hover:text-cyan"
                      onClick={() => reuse(b)}
                    >
                      ارسال دوباره
                    </button>
                    {(b.status === 'queued' || b.status === 'sending') && (
                      <button
                        type="button"
                        className="text-muted hover:text-danger"
                        onClick={() => cancel(b)}
                      >
                        لغو
                      </button>
                    )}
                  </div>
                </div>

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

      {detail !== null && (
        <Detail id={detail} onClose={() => setDetail(null)} onChanged={reload} />
      )}
    </div>
  );
}
