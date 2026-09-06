'use client';

import { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatJalali } from '@/lib/format';

interface Status {
  linked: boolean;
  linkedAt: string | null;
  enabled: boolean;
  botUsername: string;
}

/**
 * اتصال تلگرام مشتری.
 *
 * ── چرا پس از ساختن کد، وضعیت را می‌پاید ───────────────────
 *
 * اتصال در تلگرام کامل می‌شود، نه در این صفحه. کاربر لینک را می‌زند،
 * می‌رود تلگرام، Start را می‌زند و برمی‌گردد — و اگر این صفحه همان‌طور
 * بماند، فکر می‌کند کار نکرده و دوباره کد می‌گیرد.
 *
 * پس تا دو دقیقه، هر سه ثانیه وضعیت را می‌پرسد. کوتاه است و فقط وقتی
 * کد فعال است اجرا می‌شود.
 */
export function TelegramLink() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<{ url: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // شمارنده تلاش‌های پایش. با ref نگه داشته می‌شود تا تغییرش رندر تازه
  // نسازد؛ فقط شرط توقف است.
  const polls = useRef(0);

  async function load() {
    try {
      setStatus(await api.get<Status>('/api/portal/telegram'));
    } catch {
      // وضعیت اتصال حیاتی نیست؛ اگر نیامد، بخش نمایش داده نمی‌شود
      setStatus(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // پایش تا وقتی کد فعال است و هنوز وصل نشده
  useEffect(() => {
    if (!link || status?.linked) return;
    if (polls.current > 40) return;

    const t = setTimeout(async () => {
      polls.current += 1;
      const fresh = await api.get<Status>('/api/portal/telegram').catch(() => null);
      if (fresh) {
        setStatus(fresh);
        if (fresh.linked) {
          setLink(null);
          setMsg({ type: 'success', text: 'تلگرام شما با موفقیت وصل شد.' });
        }
      }
    }, 3000);

    return () => clearTimeout(t);
  }, [link, status]);

  async function connect() {
    setMsg(null);
    setBusy(true);
    polls.current = 0;
    try {
      const res = await api.post<{ url: string; code: string }>('/api/portal/telegram');
      setLink(res);
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ساخت لینک ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('اتصال تلگرام قطع شود؟ دیگر هشداری در تلگرام دریافت نمی‌کنید.')) return;
    setMsg(null);
    setBusy(true);
    try {
      await api.del('/api/portal/telegram');
      setLink(null);
      await load();
      setMsg({ type: 'success', text: 'اتصال تلگرام قطع شد.' });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'قطع اتصال ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  if (!status || !status.enabled) return null;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold">تلگرام</h2>
        <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
          هشدار سهمیه ترافیک، موعد تمدید، پرداخت فاکتور و پاسخ تیکت را در تلگرام هم دریافت
          کنید.
        </p>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {status.linked ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="badge bg-ok/15 text-ok">متصل</span>
            {status.linkedAt && (
              <span className="text-[11px] text-muted">از {formatJalali(status.linkedAt)}</span>
            )}
          </div>
          <button
            type="button"
            className="text-xs text-muted hover:text-danger"
            onClick={disconnect}
            disabled={busy}
          >
            قطع اتصال
          </button>
        </div>
      ) : !status.botUsername ? (
        // ربات هنوز شناخته نشده. سکوت اینجا یعنی دکمه‌ای که به لینک
        // خراب می‌رود و کاربر نمی‌فهمد چرا.
        <Notice type="warn">
          ربات تلگرام هنوز آماده نیست. کمی بعد دوباره سر بزنید یا با پشتیبانی تماس بگیرید.
        </Notice>
      ) : link ? (
        <div className="space-y-3">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-xs px-4 py-2 inline-flex"
          >
            باز کردن تلگرام و اتصال
          </a>

          <p className="text-[11px] text-muted leading-relaxed">
            روی دکمه بالا بزنید و در تلگرام دکمه <b>Start</b> را لمس کنید. همین‌جا منتظر بمانید؛
            به‌محض اتصال، همین صفحه به‌روز می‌شود.
          </p>

          <p className="text-[11px] text-muted/70 leading-relaxed">
            اگر دکمه کار نکرد، در تلگرام ربات{' '}
            <span className="ltr">@{status.botUsername}</span> را باز کنید و این را بفرستید:
          </p>
          <code className="block bg-rack border border-line rounded-lg p-2 text-[11px] ltr break-anywhere">
            /start {link.code}
          </code>

          <p className="text-[11px] text-muted/70">
            این کد پنج دقیقه معتبر است و فقط یک بار کار می‌کند.
          </p>
        </div>
      ) : (
        <button
          type="button"
          className="btn-ghost text-xs px-4 py-1.5"
          onClick={connect}
          disabled={busy}
        >
          {busy ? 'در حال ساختن لینک…' : 'اتصال تلگرام'}
        </button>
      )}
    </div>
  );
}
