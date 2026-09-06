'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalali, timeAgo } from '@/lib/format';

interface Announcement {
  id: number;
  title: string;
  body: string;
  severity: 'info' | 'warn' | 'danger';
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  created_by_name: string | null;
  seen: number;
}

interface Reader {
  id: number;
  name: string;
  phone: string | null;
  read_at: string | null;
  seen: boolean;
}

interface Data {
  announcements: Announcement[];
  customers: number;
}

type Severity = 'info' | 'warn' | 'danger';

const TONE: Record<Severity, { label: string; chip: string; icon: string; glow: string }> = {
  info: { label: 'اطلاعیه', chip: 'bg-cyan/15 text-cyan border-cyan/30', icon: 'ℹ', glow: 'bg-cyan' },
  warn: { label: 'هشدار', chip: 'bg-amber/15 text-amber border-amber/30', icon: '⚠', glow: 'bg-amber' },
  danger: {
    label: 'اختلال',
    chip: 'bg-danger/15 text-danger border-danger/30',
    icon: '✖',
    glow: 'bg-danger',
  },
};

const EMPTY = {
  title: '',
  body: '',
  severity: 'info' as Severity,
  starts_at: '',
  ends_at: '',
};

const FILTERS = [
  ['', 'همه'],
  ['live', 'در حال نمایش'],
  ['scheduled', 'زمان‌بندی‌شده'],
  ['expired', 'منقضی'],
  ['off', 'خاموش'],
] as const;

/**
 * وضعیت واقعی یک اطلاعیه.
 *
 * «فعال» به‌تنهایی کافی نیست: اطلاعیه فعالی که بازه‌اش تمام شده یا هنوز
 * شروع نشده، به هیچ مشتری‌ای نشان داده نمی‌شود — و اگر پنل فقط «فعال»
 * بگوید، ادمین منتظر می‌ماند که چرا کسی ندیده.
 */
function state(a: Announcement): 'live' | 'scheduled' | 'expired' | 'off' {
  if (!a.is_active) return 'off';
  const now = Date.now();
  if (a.starts_at && new Date(a.starts_at).getTime() > now) return 'scheduled';
  if (a.ends_at && new Date(a.ends_at).getTime() <= now) return 'expired';
  return 'live';
}

const STATE_LABEL: Record<string, { label: string; cls: string }> = {
  live: { label: 'در حال نمایش', cls: 'bg-ok/15 text-ok' },
  scheduled: { label: 'زمان‌بندی‌شده', cls: 'bg-cyan/15 text-cyan' },
  expired: { label: 'منقضی', cls: 'bg-line text-muted' },
  off: { label: 'خاموش', cls: 'bg-line text-muted' },
};

/**
 * پیش‌نمایش پاپ‌آپ، همان‌طور که مشتری می‌بیند.
 *
 * بدون آن، ادمین اطلاعیه را می‌نویسد و تا وقتی یک مشتری واقعی وارد
 * نشود نمی‌داند چه شکلی شده — و آن موقع دیگر دیر است.
 */
function Preview({ title, body, severity }: { title: string; body: string; severity: Severity }) {
  const tone = TONE[severity];
  return (
    <div className="relative card border overflow-hidden p-5 space-y-4">
      <div
        className={`absolute -top-20 -start-20 w-48 h-48 rounded-full blur-3xl opacity-20 ${tone.glow}`}
        aria-hidden="true"
      />
      <div className="relative flex items-start gap-3">
        <span
          className={`shrink-0 w-10 h-10 rounded-xl border grid place-items-center ${tone.chip}`}
          aria-hidden="true"
        >
          {tone.icon}
        </span>
        <div className="min-w-0">
          <span className={`badge border ${tone.chip}`}>{tone.label}</span>
          <h3 className="text-sm font-bold mt-2 leading-relaxed break-anywhere">
            {title || 'عنوان اطلاعیه'}
          </h3>
        </div>
      </div>
      <p className="relative text-xs leading-7 whitespace-pre-wrap break-anywhere text-muted max-h-40 overflow-y-auto">
        {body || 'متن اطلاعیه اینجا نشان داده می‌شود.'}
      </p>
      <div className="relative flex justify-end">
        <span className="btn-primary text-xs px-5 py-2 pointer-events-none opacity-80">
          متوجه شدم
        </span>
      </div>
    </div>
  );
}

/** چه کسانی دیدند، چه کسانی ندیدند */
function Audience({ id, title, onClose }: { id: number; title: string; onClose: () => void }) {
  const { data, loading, error, reload } = useLoad<{ readers: Reader[] }>(
    `/api/announcements?id=${id}`,
  );
  const [tab, setTab] = useState<'pending' | 'seen'>('pending');

  const readers = data?.readers ?? [];
  const seen = readers.filter((r) => r.seen);
  const pending = readers.filter((r) => !r.seen);
  const list = tab === 'seen' ? seen : pending;

  return (
    <Modal open title={`مخاطبان: ${title}`} onClose={onClose}>
      {loading || error || !data ? (
        <LoadState loading={loading} error={error} onRetry={reload}>
          {null}
        </LoadState>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-1">
            {(
              [
                ['pending', `ندیده‌اند (${faNum(pending.length)})`],
                ['seen', `دیده‌اند (${faNum(seen.length)})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  tab === key
                    ? 'bg-cyan/10 text-cyan border-cyan/30'
                    : 'border-line text-muted hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!list.length ? (
            <p className="text-xs text-muted text-center py-6">
              {tab === 'seen' ? 'هنوز کسی ندیده.' : 'همه دیده‌اند.'}
            </p>
          ) : (
            <div className="border border-line rounded-lg max-h-72 overflow-y-auto divide-y divide-line/60">
              {list.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-xs truncate">{r.name}</span>
                  <span className="text-[11px] text-muted shrink-0 ltr">
                    {r.read_at ? timeAgo(r.read_at) : r.phone || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'pending' && pending.length > 0 && (
            <p className="text-[11px] text-muted/70 leading-relaxed">
              «ندیده» یعنی هنوز وارد پرتال نشده یا دکمه را نزده. برای خبر فوری، ارسال همگانی
              مطمئن‌تر است.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function AnnouncementsPage() {
  const { data, loading, error, reload } = useLoad<Data>('/api/announcements');

  const [filter, setFilter] = useState<string>('');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  function reset() {
    setForm(EMPTY);
    setEditing(null);
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      if (editing) await api.patch('/api/announcements', { id: editing, ...form });
      else await api.post('/api/announcements', form);
      setMsg({ type: 'success', text: editing ? 'اطلاعیه ذخیره شد.' : 'اطلاعیه منتشر شد.' });
      reset();
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ثبت اطلاعیه ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  async function act(a: Announcement, what: 'toggle' | 'delete') {
    if (what === 'delete' && !confirm(`اطلاعیه «${a.title}» حذف شود؟`)) return;
    setMsg(null);
    try {
      if (what === 'toggle') await api.patch('/api/announcements', { id: a.id, action: 'toggle' });
      else await api.del(`/api/announcements?id=${a.id}`);
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'عملیات ناموفق بود' });
    }
  }

  function edit(a: Announcement) {
    setEditing(a.id);
    setForm({
      title: a.title,
      body: a.body,
      severity: a.severity,
      // datetime-local ثانیه و منطقه زمانی نمی‌پذیرد
      starts_at: a.starts_at ? a.starts_at.slice(0, 16) : '',
      ends_at: a.ends_at ? a.ends_at.slice(0, 16) : '',
    });
    setOpen(true);
  }

  /** تکثیر: متن همان، ولی اطلاعیه تازه — سابقه قبلی دست‌نخورده می‌ماند */
  function duplicate(a: Announcement) {
    setEditing(null);
    setForm({
      title: a.title,
      body: a.body,
      severity: a.severity,
      starts_at: '',
      ends_at: '',
    });
    setOpen(true);
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const all = data.announcements;
  const live = all.filter((a) => state(a) === 'live');
  const shown = filter ? all.filter((a) => state(a) === filter) : all;

  // نرخ دیده‌شدن اطلاعیه‌های در حال نمایش. عدد خام «چند نفر دیدند» بدون
  // مخرج معنی ندارد.
  const reach =
    live.length && data.customers
      ? Math.round(
          (live.reduce((s, a) => s + a.seen, 0) / (live.length * data.customers)) * 100,
        )
      : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">اطلاعیه‌ها</h1>
          <p className="text-xs text-muted mt-0.5">
            اطلاعیه فعال به‌شکل پاپ‌آپ روی هر صفحه پرتال نشان داده می‌شود تا مشتری «متوجه شدم» را
            بزند.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          + اطلاعیه تازه
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs text-muted">در حال نمایش</div>
          <div className="text-2xl font-bold mt-1 text-ok">{faNum(live.length)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">مجموع اطلاعیه‌ها</div>
          <div className="text-2xl font-bold mt-1">{faNum(all.length)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">نرخ دیده‌شدن</div>
          <div className="text-2xl font-bold mt-1">{faNum(reach)}٪</div>
          <div className="text-[11px] text-muted mt-0.5">
            از {faNum(data.customers)} مشتری فعال
          </div>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        {FILTERS.map(([key, label]) => (
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
      </div>

      {!shown.length ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-muted">
            {all.length ? 'اطلاعیه‌ای با این فیلتر نیست.' : 'هنوز اطلاعیه‌ای ثبت نشده.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((a) => {
            const tone = TONE[a.severity];
            const st = STATE_LABEL[state(a)];
            const pct = data.customers ? Math.round((a.seen / data.customers) * 100) : 0;

            return (
              <div key={a.id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex items-start gap-3">
                    <span
                      className={`shrink-0 w-9 h-9 rounded-lg border grid place-items-center ${tone.chip}`}
                      aria-hidden="true"
                    >
                      {tone.icon}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold">
                        {a.title}
                        <span className={`badge ms-2 ${st.cls}`}>{st.label}</span>
                      </h3>
                      <p className="text-[11px] text-muted mt-1 line-clamp-2 leading-relaxed">
                        {a.body}
                      </p>
                      <p className="text-[11px] text-muted/70 mt-1">
                        {formatJalali(a.created_at)}
                        {a.created_by_name && ` · ${a.created_by_name}`}
                        {a.starts_at && ` · از ${formatJalali(a.starts_at)}`}
                        {a.ends_at && ` · تا ${formatJalali(a.ends_at)}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <button
                      type="button"
                      className="text-cyan hover:underline"
                      onClick={() => setAudience(a)}
                    >
                      مخاطبان
                    </button>
                    <button
                      type="button"
                      className="text-muted hover:text-cyan"
                      onClick={() => edit(a)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className="text-muted hover:text-cyan"
                      onClick={() => duplicate(a)}
                    >
                      تکثیر
                    </button>
                    <button
                      type="button"
                      className="text-muted hover:text-white"
                      onClick={() => act(a, 'toggle')}
                    >
                      {a.is_active ? 'خاموش' : 'روشن'}
                    </button>
                    {a.seen === 0 && (
                      <button
                        type="button"
                        className="text-muted hover:text-danger"
                        onClick={() => act(a, 'delete')}
                      >
                        حذف
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="h-1.5 rounded-full bg-line overflow-hidden flex-1">
                    <div
                      className="h-full bg-cyan transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted shrink-0">
                    {faNum(a.seen)} از {faNum(data.customers)} دیدند
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted/70 leading-relaxed">
        اطلاعیه‌ای که مشتری‌ها دیده‌اند حذف نمی‌شود، فقط خاموش می‌شود — سابقه «چه کسی چه چیزی را
        دید» همان چیزی است که وقتی مشتری می‌گوید «به من اطلاع ندادید» لازم می‌شود.
      </p>

      {/* ── فرم ─────────────────────────────────────────── */}
      {open && (
        <Modal
          open
          title={editing ? 'ویرایش اطلاعیه' : 'اطلاعیه تازه'}
          onClose={reset}
        >
          <form onSubmit={submit} className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <Field label="عنوان">
                  <input
                    className="input"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="اختلال شبکه دیتاسنتر"
                    maxLength={200}
                    required
                  />
                </Field>
              </div>
              <Field label="نوع">
                <select
                  className="input"
                  value={form.severity}
                  onChange={(e) => {
                    const severity = e.target.value as Severity;
                    setForm((f) => ({ ...f, severity }));
                  }}
                >
                  <option value="info">اطلاعیه</option>
                  <option value="warn">هشدار</option>
                  <option value="danger">اختلال</option>
                </select>
              </Field>
            </div>

            <Field label="متن">
              <textarea
                className="input min-h-[130px] leading-relaxed"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="به دلیل اختلال در شبکه دیتاسنتر، ممکن است تا ساعت ۱۴ قطعی کوتاه داشته باشید. تیم فنی در حال پیگیری است."
                maxLength={5000}
                required
              />
            </Field>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="نمایش از" hint="خالی یعنی از همین حالا">
                <input
                  className="input ltr"
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                />
              </Field>
              <Field label="نمایش تا" hint="خالی یعنی تا وقتی خاموشش کنید">
                <input
                  className="input ltr"
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                />
              </Field>
            </div>

            <div>
              <p className="label">پیش‌نمایش — همان چیزی که مشتری می‌بیند</p>
              <Preview title={form.title} body={form.body} severity={form.severity} />
            </div>

            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'در حال ثبت…' : editing ? 'ذخیره تغییرات' : 'انتشار اطلاعیه'}
              </button>
              <button type="button" className="btn-ghost" onClick={reset}>
                انصراف
              </button>
            </div>
          </form>
        </Modal>
      )}

      {audience && (
        <Audience id={audience.id} title={audience.title} onClose={() => setAudience(null)} />
      )}
    </div>
  );
}
