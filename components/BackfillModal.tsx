'use client';

import { useState } from 'react';
import { Field, Modal, Notice } from './ui';
import { api, ApiError } from '@/lib/api';
import { toGregorian } from '@/lib/jalali';
import { faNum, formatBytes } from '@/lib/format';

/**
 * وارد کردن دستی مصرف روزهای گذشته.
 *
 * ایجنت گذشته را نمی‌سازد — شمارنده‌های کارت شبکه تجمعی از زمان بوت‌اند و
 * تفکیک روزانه‌شان هیچ‌جا ذخیره نشده. اگر ایجنت وسط دوره صورتحساب نصب شود،
 * تنها راه پرکردن آن روزها، عددی است که پنل دیتاسنتر یا vnstat می‌دهد.
 *
 * ورودی عمداً آزاد است: تاریخ شمسی یا میلادی، جداکننده کاما یا تب یا فاصله،
 * و واحد قابل انتخاب. کسی که دارد از پنل دیتاسنتر کپی می‌کند نباید مجبور
 * باشد اول همه‌چیز را دستی تبدیل کند — همان‌جا که اشتباه وارد می‌شود.
 */

const UNITS: { key: string; label: string; bytes: number }[] = [
  { key: 'gb1024', label: 'گیگابایت (۱۰۲۴)', bytes: Math.pow(1024, 3) },
  { key: 'gb1000', label: 'گیگابایت (۱۰۰۰)', bytes: 1e9 },
  { key: 'tb1024', label: 'ترابایت (۱۰۲۴)', bytes: Math.pow(1024, 4) },
  { key: 'tb1000', label: 'ترابایت (۱۰۰۰)', bytes: 1e12 },
  { key: 'mb1024', label: 'مگابایت (۱۰۲۴)', bytes: Math.pow(1024, 2) },
  { key: 'byte', label: 'بایت', bytes: 1 },
];

interface ParsedRow {
  day: string;      // میلادی YYYY-MM-DD
  original: string; // آنچه کاربر نوشته، برای نمایش خطا
  rx: number;
  tx: number;
  error?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ارقام فارسی و عربی به لاتین */
function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * تاریخ را می‌پذیرد چه شمسی چه میلادی.
 * تشخیص از روی سال است: چهار رقمی زیر ۱۷۰۰ یعنی شمسی.
 */
function parseDate(raw: string): string | null {
  const parts = toLatinDigits(raw).trim().split(/[-/.]/).map((x) => x.trim());
  if (parts.length !== 3) return null;

  const [a, b, c] = parts.map(Number);
  if (![a, b, c].every(Number.isFinite)) return null;
  if (b < 1 || b > 12 || c < 1 || c > 31) return null;

  if (a >= 1200 && a <= 1700) {
    const g = toGregorian(a, b, c);
    return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
  }
  if (a >= 1900 && a <= 2200) {
    return `${a}-${pad(b)}-${pad(c)}`;
  }
  return null;
}

function parseInput(text: string, unitBytes: number): ParsedRow[] {
  const out: ParsedRow[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const cells = toLatinDigits(trimmed).split(/[,\t;]+|\s{2,}|\s+/).filter(Boolean);
    if (cells.length < 3) {
      out.push({ day: '', original: trimmed, rx: 0, tx: 0, error: 'سه ستون لازم است: تاریخ، دانلود، آپلود' });
      continue;
    }

    const day = parseDate(cells[0]);
    if (!day) {
      out.push({ day: '', original: trimmed, rx: 0, tx: 0, error: 'تاریخ خوانده نشد' });
      continue;
    }

    const rxRaw = Number(cells[1].replace(/,/g, ''));
    const txRaw = Number(cells[2].replace(/,/g, ''));
    if (!Number.isFinite(rxRaw) || !Number.isFinite(txRaw)) {
      out.push({ day, original: trimmed, rx: 0, tx: 0, error: 'مقدار عددی نیست' });
      continue;
    }

    out.push({
      day,
      original: trimmed,
      rx: Math.round(rxRaw * unitBytes),
      tx: Math.round(txRaw * unitBytes),
    });
  }

  return out;
}

export function BackfillModal({
  open,
  serverId,
  serverName,
  onClose,
  onDone,
}: {
  open: boolean;
  serverId: string;
  serverName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [unit, setUnit] = useState('gb1024');
  const [source, setSource] = useState('manual');
  const [note, setNote] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    added: number;
    updated: number;
    skipped: { day: string; reason: string }[];
  } | null>(null);

  const unitBytes = UNITS.find((u) => u.key === unit)?.bytes ?? 1;
  const parsed = parseInput(text, unitBytes);
  const valid = parsed.filter((r) => !r.error);
  const invalid = parsed.filter((r) => r.error);
  const totalRx = valid.reduce((a, r) => a + r.rx, 0);
  const totalTx = valid.reduce((a, r) => a + r.tx, 0);

  async function submit() {
    setErr(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await api.post<{
        added: number;
        updated: number;
        skipped: { day: string; reason: string }[];
      }>('/api/traffic/backfill', {
        server_id: Number(serverId),
        source,
        note,
        overwrite,
        days: valid.map((r) => ({ day: r.day, rx: r.rx, tx: r.tx })),
      });
      setResult(res);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'وارد کردن انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={`وارد کردن مصرف گذشته — ${serverName}`} onClose={onClose} wide>
      <div className="space-y-4">
        <Notice type="info">
          ایجنت گذشته را نمی‌سازد: شمارنده کارت شبکه تجمعی از زمان بوت است و تفکیک روزانه‌اش
          هیچ‌جا ذخیره نشده. عدد این روزها را از <strong>پنل دیتاسنتر</strong> — همان جایی که
          فاکتور می‌دهد — یا از <strong>vnstat</strong> خود نود بردارید.
        </Notice>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="واحد ستون‌های حجم">
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u.key} value={u.key}>{u.label}</option>
              ))}
            </select>
          </Field>
          <Field label="منبع">
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="manual">پنل دیتاسنتر (دستی)</option>
              <option value="vnstat">vnstat خود نود</option>
            </select>
          </Field>
          <Field label="یادداشت" hint="مثلا: از فاکتور شهریور">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <Field
          label="داده‌ها"
          hint="هر خط: تاریخ، دانلود، آپلود. تاریخ شمسی یا میلادی هر دو قبول است. جداکننده کاما، تب یا فاصله."
        >
          <textarea
            className="input h-40 ltr font-mono text-xs resize-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'1405/06/01, 812.4, 240.1\n1405/06/02, 790.0, 231.7\n2026-08-25, 803.2, 238.9'}
          />
        </Field>

        {/* پیش‌نمایش پیش از ثبت */}
        {parsed.length > 0 && (
          <div className="bg-panel2 rounded-lg p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted">ردیف معتبر</span>
              <span>{faNum(valid.length)}</span>
            </div>
            {valid.length > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">بازه</span>
                  <span className="ltr font-mono">
                    {valid.map((r) => r.day).sort()[0]} … {valid.map((r) => r.day).sort().slice(-1)[0]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">جمع دانلود</span>
                  <span className="text-cyan">{formatBytes(totalRx)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">جمع آپلود</span>
                  <span className="text-amber">{formatBytes(totalTx)}</span>
                </div>
              </>
            )}
            {invalid.length > 0 && (
              <div className="pt-1.5 border-t border-line/60">
                <p className="text-danger mb-1">{faNum(invalid.length)} خط خوانده نشد:</p>
                <ul className="space-y-0.5">
                  {invalid.slice(0, 4).map((r, i) => (
                    <li key={i} className="text-muted">
                      <span className="ltr font-mono">{r.original.slice(0, 40)}</span> — {r.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          روزهایی که داده ایجنت دارند هم بازنویسی شوند
        </label>
        {overwrite && (
          <Notice type="error">
            داده ایجنت اندازه‌گیری واقعی است و معمولاً از عدد دستی دقیق‌تر. فقط وقتی این را بزنید
            که مطمئنید داده ایجنت آن روزها ناقص یا اشتباه بوده.
          </Notice>
        )}

        {err && <Notice type="error">{err}</Notice>}
        {result && (
          <Notice type={result.skipped.length ? 'info' : 'success'}>
            {faNum(result.added)} روز اضافه و {faNum(result.updated)} روز به‌روزرسانی شد.
            {result.skipped.length > 0 && (
              <>
                <p className="mt-1.5">{faNum(result.skipped.length)} روز رد شد:</p>
                <ul className="mt-1 space-y-0.5">
                  {result.skipped.slice(0, 5).map((s, i) => (
                    <li key={i}>
                      <span className="ltr font-mono">{s.day}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Notice>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>بستن</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy || !valid.length}>
            {busy ? 'در حال ثبت…' : `ثبت ${faNum(valid.length)} روز`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
