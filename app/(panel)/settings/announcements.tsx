'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalali } from '@/lib/format';

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

interface Data {
  announcements: Announcement[];
  customers: number;
}

const TONE: Record<string, { label: string; cls: string }> = {
  info: { label: 'اطلاعیه', cls: 'bg-cyan/15 text-cyan' },
  warn: { label: 'هشدار', cls: 'bg-amber/15 text-amber' },
  danger: { label: 'اختلال', cls: 'bg-danger/15 text-danger' },
};

const EMPTY = {
  title: '',
  body: '',
  severity: 'info' as 'info' | 'warn' | 'danger',
  starts_at: '',
  ends_at: '',
};

/**
 * مدیریت اطلاعیه‌ها.
 *
 * اطلاعیه فعال به‌شکل پاپ‌آپ به هر مشتری نشان داده می‌شود تا وقتی
 * «متوجه شدم» را بزند. خوانده‌شدن برای هر مشتری جداست.
 */
export function AnnouncementsPanel() {
  const { data, loading, error, reload } = useLoad<Data>('/api/announcements');

  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  function reset() {
    setForm(EMPTY);
    setEditing(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      if (editing) {
        await api.patch('/api/announcements', { id: editing, ...form });
      } else {
        await api.post('/api/announcements', form);
      }
      setMsg({ type: 'success', text: editing ? 'اطلاعیه ذخیره شد.' : 'اطلاعیه منتشر شد.' });
      reset();
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ثبت اطلاعیه ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a: Announcement) {
    setMsg(null);
    try {
      await api.patch('/api/announcements', { id: a.id, action: 'toggle' });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'تغییر وضعیت ناموفق بود' });
    }
  }

  async function remove(a: Announcement) {
    if (!confirm(`اطلاعیه «${a.title}» حذف شود؟`)) return;
    setMsg(null);
    try {
      await api.del(`/api/announcements?id=${a.id}`);
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'حذف ناموفق بود' });
    }
  }

  function edit(a: Announcement) {
    setEditing(a.id);
    setForm({
      title: a.title,
      body: a.body,
      severity: a.severity,
      // ورودی datetime-local ثانیه و منطقه زمانی نمی‌پذیرد
      starts_at: a.starts_at ? a.starts_at.slice(0, 16) : '',
      ends_at: a.ends_at ? a.ends_at.slice(0, 16) : '',
    });
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold">اطلاعیه</h2>
        <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
          اطلاعیه فعال به‌شکل پاپ‌آپ به مشتری نشان داده می‌شود تا وقتی «متوجه شدم» را بزند.
          هرکس جداگانه می‌بندد.
        </p>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      <form onSubmit={submit} className="space-y-4 border border-line rounded-xl p-4">
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
          <Field label="نوع" hint="رنگ و آیکون پاپ‌آپ">
            <select
              className="input"
              value={form.severity}
              onChange={(e) => {
                const severity = e.target.value as 'info' | 'warn' | 'danger';
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
            className="input min-h-[120px] leading-relaxed"
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
          <Field label="نمایش تا" hint="خالی یعنی تا وقتی غیرفعالش کنید">
            <input
              className="input ltr"
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
            />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary text-xs px-4 py-1.5" disabled={busy}>
            {busy ? 'در حال ثبت…' : editing ? 'ذخیره تغییرات' : 'انتشار اطلاعیه'}
          </button>
          {editing && (
            <button type="button" className="text-xs text-muted hover:text-white" onClick={reset}>
              انصراف از ویرایش
            </button>
          )}
        </div>
      </form>

      {!data.announcements.length ? (
        <p className="text-xs text-muted text-center py-4">هنوز اطلاعیه‌ای ثبت نشده.</p>
      ) : (
        <div className="space-y-2">
          {data.announcements.map((a) => {
            const t = TONE[a.severity] || TONE.info;
            return (
              <div key={a.id} className="border border-line rounded-lg p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold">
                      {a.title}
                      <span className={`badge ms-2 ${t.cls}`}>{t.label}</span>
                      {!a.is_active && <span className="badge ms-1 bg-line text-muted">خاموش</span>}
                    </h3>
                    <p className="text-[11px] text-muted mt-1 line-clamp-2 leading-relaxed">
                      {a.body}
                    </p>
                    <p className="text-[11px] text-muted/70 mt-1">
                      {formatJalali(a.created_at)}
                      {a.created_by_name && ` · ${a.created_by_name}`}
                      {' · '}
                      {/* بدون این عدد معلوم نیست اطلاعیه به دست کسی
                          رسیده یا نه */}
                      {faNum(a.seen)} از {faNum(data.customers)} دیدند
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <button
                      type="button"
                      className="text-muted hover:text-cyan"
                      onClick={() => edit(a)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className="text-muted hover:text-white"
                      onClick={() => toggle(a)}
                    >
                      {a.is_active ? 'خاموش' : 'روشن'}
                    </button>
                    {a.seen === 0 && (
                      <button
                        type="button"
                        className="text-muted hover:text-danger"
                        onClick={() => remove(a)}
                      >
                        حذف
                      </button>
                    )}
                  </div>
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
    </section>
  );
}
