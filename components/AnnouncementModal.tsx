'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatJalali } from '@/lib/format';

interface Announcement {
  id: number;
  title: string;
  body: string;
  severity: 'info' | 'warn' | 'danger';
  created_at: string;
}

/**
 * پاپ‌آپ اطلاعیه.
 *
 * ── چرا یکی‌یکی، نه همه با هم ──────────────────────────────
 *
 * اگر سه اطلاعیه باز باشد، نشان‌دادن هر سه در یک پنجره یعنی کاربر
 * هیچ‌کدام را نمی‌خواند. یکی‌یکی نشان داده می‌شوند و شمارنده می‌گوید چند
 * تا مانده.
 *
 * ── چرا با کلیک بیرون بسته نمی‌شود ─────────────────────────
 *
 * تنها راه بستن، دکمه «متوجه شدم» است. اطلاعیه‌ای که با کلیک اتفاقی
 * بسته شود، هم خوانده نشده و هم دیگر برنمی‌گردد.
 *
 * Escape هم عمدا کاری نمی‌کند، به همین دلیل.
 *
 * ── اگر ثبت «متوجه شدم» شکست بخورد ────────────────────────
 *
 * پنجره بسته **نمی‌شود** و خطا نشان داده می‌شود. بستنش یعنی کاربر فکر
 * می‌کند تمام شده ولی دفعه بعد همان اطلاعیه دوباره می‌آید — که بدتر از
 * یک پیام خطای صریح است.
 */
export function AnnouncementModal() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;

    api
      .get<{ announcements: Announcement[] }>('/api/portal/announcements')
      .then((res) => {
        if (!alive) return;
        setItems(res.announcements ?? []);
        // یک قاب تأخیر تا انیمیشن ورود واقعا دیده شود
        if (res.announcements?.length) requestAnimationFrame(() => setShown(true));
      })
      // اطلاعیه حیاتی نیست: اگر نیامد، پرتال باید عادی کار کند
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  const current = items[0];

  const dismiss = useCallback(async () => {
    if (!current || busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/portal/announcements', { id: current.id });
      setItems((list) => list.slice(1));
    } catch {
      setError('ثبت نشد. اتصال را بررسی کنید و دوباره بزنید.');
    } finally {
      setBusy(false);
    }
  }, [current, busy]);

  // تا وقتی پنجره باز است، صفحه پشتش نباید اسکرول شود
  useEffect(() => {
    if (!current) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [current]);

  if (!current) return null;

  const tone = {
    info: {
      icon: 'ℹ',
      ring: 'border-cyan/40',
      glow: 'bg-cyan',
      chip: 'bg-cyan/15 text-cyan border-cyan/30',
      label: 'اطلاعیه',
    },
    warn: {
      icon: '⚠',
      ring: 'border-amber/40',
      glow: 'bg-amber',
      chip: 'bg-amber/15 text-amber border-amber/30',
      label: 'هشدار',
    },
    danger: {
      icon: '✖',
      ring: 'border-danger/40',
      glow: 'bg-danger',
      chip: 'bg-danger/15 text-danger border-danger/30',
      label: 'اختلال',
    },
  }[current.severity];

  return (
    <div
      className="no-print fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ann-title"
    >
      {/* پرده. کلیک روی آن عمدا کاری نمی‌کند. */}
      <div
        className={`absolute inset-0 bg-rack/80 backdrop-blur-sm transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        className={`relative w-full max-w-lg card border ${tone.ring} overflow-hidden
                    transition-all duration-300 ${
                      shown ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-95'
                    }`}
      >
        {/* هاله رنگی پشت سربرگ — تنها عنصر تزئینی، و همان چیزی است که
            شدت اطلاعیه را پیش از خواندن متن منتقل می‌کند */}
        <div
          className={`absolute -top-24 -start-24 w-56 h-56 rounded-full blur-3xl opacity-20 ${tone.glow}`}
          aria-hidden="true"
        />

        <div className="relative p-6 sm:p-7 space-y-5">
          <div className="flex items-start gap-4">
            <span
              className={`shrink-0 w-11 h-11 rounded-xl border grid place-items-center text-lg ${tone.chip}`}
              aria-hidden="true"
            >
              {tone.icon}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`badge border ${tone.chip}`}>{tone.label}</span>
                <span className="text-[11px] text-muted">{formatJalali(current.created_at)}</span>
              </div>
              <h2 id="ann-title" className="text-base font-bold mt-2 leading-relaxed">
                {current.title}
              </h2>
            </div>
          </div>

          {/* متن اطلاعیه همان‌طور که نوشته شده: خط‌ها حفظ می‌شوند و
              آدرس بلند از قاب بیرون نمی‌زند */}
          <p className="text-sm leading-7 whitespace-pre-wrap break-anywhere max-h-[45vh] overflow-y-auto">
            {current.body}
          </p>

          {error && (
            <p className="text-xs text-danger border border-danger/30 bg-danger/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-muted">
              {items.length > 1 ? `${items.length - 1} اطلاعیه دیگر` : ''}
            </span>

            <button
              type="button"
              className="btn-primary px-6 py-2.5"
              onClick={dismiss}
              disabled={busy}
              autoFocus
            >
              {busy ? 'لطفا صبر کنید…' : 'متوجه شدم'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
