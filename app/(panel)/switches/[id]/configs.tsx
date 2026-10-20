'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { faNum, formatBytes, formatJalaliTime, timeAgo } from '@/lib/format';
import { runSwitchAction, type SwitchInfo } from './shared';

interface Version {
  id: number;
  taken_at: string;
  size_bytes: number;
  trigger: string;
  taken_by: string | null;
  sha: string;
}

interface DiffLine {
  op: '=' | '-' | '+';
  text: string;
  a?: number;
  b?: number;
}

interface ConfigView {
  version: Version;
  config: string;
  masked: number;
  revealed: boolean;
  diff: {
    against: { id: number; taken_at: string; older: boolean };
    added: number;
    removed: number;
    hunks: { lines: DiffLine[]; skippedBefore: number }[];
    skippedAfter: number;
  } | null;
}

const TRIGGER_LABEL: Record<string, string> = { auto: 'خودکار', manual: 'دستی', action: 'پس از فرمان' };

/**
 * پشتیبان پیکربندی: فهرست نسخه‌ها، تفاوت هر نسخه با قبلی، و متن کامل.
 * فقط مدیر؛ برای بقیه، API پیام «فقط مدیر» برمی‌گرداند و همان نشان داده می‌شود.
 */
export function ConfigTab({ sw, onChanged }: { sw: SwitchInfo; onChanged: () => void }) {
  const list = useLoad<{ versions: Version[]; pending: { id: number } | null }>(`/api/switches/${sw.id}/configs`, 15_000);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'diff' | 'full'>('diff');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const versions = list.data?.versions ?? [];
  const current = selected ?? versions[0]?.id ?? null;
  const view = useLoad<ConfigView>(
    current
      ? `/api/switches/${sw.id}/configs/${current}?${mode === 'full' ? 'compare=none' : ''}${reveal ? '&reveal=1' : ''}`
      : null,
  );

  async function backupNow() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await runSwitchAction({ action: 'backup', switch_id: sw.id }, 150);
      setMsg(r);
      setSelected(null);
      list.reload();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'ثبت درخواست ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  if (!sw.can_backup) {
    return (
      <Notice type="info">
        پشتیبان پیکربندی فقط برای سوییچ NX-API است. در SNMP راه استاندارد و امنی برای خواندن running-config نیست
        (روش TFTP سیسکو پیکربندی را بی‌رمز روی شبکه می‌فرستد).
      </Notice>
    );
  }

  if (!list.data) {
    return (
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload}>
        {null}
      </LoadState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="me-auto text-xs text-muted space-y-0.5">
          <p>
            running-config خودکار در فاصله تنظیم‌شده خوانده می‌شود و فقط وقتی با نسخه قبلی فرق دارد ذخیره می‌شود.
          </p>
          <p>
            آخرین بررسی: {sw.config_checked_at ? timeAgo(sw.config_checked_at) : 'هنوز نه'}
            {sw.config_changed_at && ` · آخرین تغییر: ${timeAgo(sw.config_changed_at)}`}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={backupNow} disabled={busy || Boolean(list.data.pending)}>
          {busy || list.data.pending ? 'در حال خواندن پیکربندی…' : 'پشتیبان‌گیری همین حالا'}
        </button>
      </div>
      {sw.config_error && <Notice type="warn">آخرین پشتیبان‌گیری خودکار ناموفق بود: {sw.config_error}</Notice>}
      {msg && <Notice type={msg.ok ? 'success' : 'error'}>{msg.text}</Notice>}

      {versions.length === 0 ? (
        <p className="text-xs text-muted bg-panel2 rounded-lg px-3 py-6 text-center">هنوز نسخه‌ای ذخیره نشده است.</p>
      ) : (
        <div className="grid lg:grid-cols-[260px_1fr] gap-4">
          <ul className="space-y-1 max-h-[560px] overflow-y-auto">
            {versions.map((v, i) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSelected(v.id)}
                  className={`w-full text-start rounded-lg px-3 py-2 text-xs border transition-colors ${
                    current === v.id ? 'border-cyan/40 bg-cyan/5' : 'border-line hover:border-cyan/20'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>{formatJalaliTime(v.taken_at)}</span>
                    {i === 0 && <span className="badge bg-ok/10 text-ok border border-ok/30">آخرین</span>}
                  </span>
                  <span className="block text-muted text-[10px] mt-0.5">
                    {TRIGGER_LABEL[v.trigger] ?? v.trigger}
                    {v.taken_by ? ` · ${v.taken_by}` : ''} · {formatBytes(v.size_bytes)} ·{' '}
                    <span className="font-mono">{v.sha}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {(['diff', 'full'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 rounded-md text-xs border ${
                    mode === m ? 'bg-cyan/10 text-cyan border-cyan/30' : 'border-line text-muted hover:text-white'
                  }`}
                >
                  {m === 'diff' ? 'تفاوت با نسخه قبل' : 'متن کامل'}
                </button>
              ))}
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer ms-2">
                <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
                نمایش رازها
              </label>
              {current && (
                <a
                  className="ms-auto text-xs text-muted hover:text-cyan"
                  href={`/api/switches/${sw.id}/configs/${current}?download=1${reveal ? '&reveal=1' : ''}`}
                >
                  دانلود فایل {reveal ? '' : '(پوشیده)'}
                </a>
              )}
            </div>
            {view.data && !view.data.revealed && view.data.masked > 0 && (
              <p className="text-[11px] text-muted">
                {faNum(view.data.masked)} راز (هش گذرواژه، کامیونیتی، کلید) پوشیده شده است.
              </p>
            )}
            {reveal && (
              <Notice type="warn">
                رازها نمایش داده می‌شوند. هش گذرواژه هم با شکستن آفلاین به گذرواژه می‌رسد؛ صفحه را جلوی دیگران باز نگذارید.
              </Notice>
            )}

            {view.loading && !view.data ? (
              <p className="text-xs text-muted">در حال بارگذاری…</p>
            ) : view.error ? (
              <Notice type="error">{view.error}</Notice>
            ) : view.data ? (
              mode === 'full' || !view.data.diff ? (
                <>
                  {mode === 'diff' && (
                    <p className="text-[11px] text-muted">این اولین نسخه ذخیره‌شده است؛ نسخه قبلی برای مقایسه نیست.</p>
                  )}
                  <pre className="ltr text-[11px] leading-5 bg-panel2 rounded-lg p-3 overflow-auto max-h-[560px] whitespace-pre">
                    {view.data.config}
                  </pre>
                </>
              ) : (
                <DiffView diff={view.data.diff} />
              )
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: NonNullable<ConfigView['diff']> }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">
        در مقایسه با نسخه {formatJalaliTime(diff.against.taken_at)}:{' '}
        <span className="text-ok">{faNum(diff.added)} خط اضافه</span> ·{' '}
        <span className="text-danger">{faNum(diff.removed)} خط حذف</span>
      </p>
      {diff.hunks.length === 0 ? (
        <p className="text-xs text-muted bg-panel2 rounded-lg px-3 py-4 text-center">تفاوتی نیست.</p>
      ) : (
        <div className="ltr text-[11px] leading-5 bg-panel2 rounded-lg overflow-auto max-h-[560px] font-mono">
          {diff.hunks.map((h, i) => (
            <div key={i}>
              {h.skippedBefore > 0 && (
                <div className="px-3 py-0.5 text-muted bg-line/40 text-center">… {h.skippedBefore} unchanged lines …</div>
              )}
              {h.lines.map((l, j) => (
                <div
                  key={j}
                  className={`px-3 whitespace-pre ${
                    l.op === '+' ? 'bg-ok/10 text-ok' : l.op === '-' ? 'bg-danger/10 text-danger' : 'text-muted'
                  }`}
                >
                  <span className="inline-block w-4 select-none opacity-70">{l.op === '=' ? ' ' : l.op}</span>
                  {l.text}
                </div>
              ))}
            </div>
          ))}
          {diff.skippedAfter > 0 && (
            <div className="px-3 py-0.5 text-muted bg-line/40 text-center">… {diff.skippedAfter} unchanged lines …</div>
          )}
        </div>
      )}
    </div>
  );
}
