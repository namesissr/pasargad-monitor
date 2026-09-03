'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  JALALI_MONTHS,
  isoToJalali,
  jalaliMonthLength,
  toGregorian,
} from '@/lib/jalali';
import { faNum } from '@/lib/format';

/**
 * تقویم شمسی برای انتخاب یک روز.
 *
 * چرا دست‌ساز و نه <input type="date">: آن ورودی تقویمش را از منطقه مرورگر
 * می‌گیرد. روی یک ویندوز با منطقه انگلیسی، تاریخ میلادی نشان می‌دهد و کاربر
 * باید در ذهنش تبدیل کند — دقیقاً همان‌جا که اشتباه می‌شود.
 *
 * مقدار همیشه تاریخ میلادی به شکل YYYY-MM-DD است، چون دیتابیس و ای‌پی‌آی با
 * همان کار می‌کنند. فقط نمایش شمسی است.
 */

const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** تاریخ میلادی YYYY-MM-DD از یک روز شمسی */
function isoFromJalali(jy: number, jm: number, jd: number): string {
  const g = toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

/**
 * ستون شنبه‌محور برای اولین روز ماه.
 * getDay انگلیسی است (یکشنبه صفر) و هفته فارسی از شنبه شروع می‌شود.
 */
function firstColumn(jy: number, jm: number): number {
  const g = toGregorian(jy, jm, 1);
  const weekday = new Date(g.gy, g.gm - 1, g.gd).getDay();
  return (weekday + 1) % 7;
}

export function JalaliDatePicker({
  value,
  onChange,
  label,
  max,
  min,
}: {
  /** تاریخ میلادی YYYY-MM-DD */
  value: string;
  onChange: (iso: string) => void;
  label?: string;
  /** بیشترین تاریخ قابل انتخاب، میلادی */
  max?: string;
  /** کمترین تاریخ قابل انتخاب، میلادی */
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => isoToJalali(value), [value]);
  const [view, setView] = useState({ jy: selected.jy, jm: selected.jm });

  // با عوض‌شدن مقدار از بیرون، تقویم به همان ماه می‌رود
  useEffect(() => {
    setView({ jy: selected.jy, jm: selected.jm });
  }, [selected.jy, selected.jm]);

  // کلیک بیرون و کلید Escape تقویم را می‌بندند
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const days = jalaliMonthLength(view.jy, view.jm);
  const offset = firstColumn(view.jy, view.jm);
  const todayIso = isoOf(new Date());

  const shift = (months: number) => {
    let { jy, jm } = view;
    jm += months;
    while (jm > 12) {
      jm -= 12;
      jy += 1;
    }
    while (jm < 1) {
      jm += 12;
      jy -= 1;
    }
    setView({ jy, jm });
  };

  return (
    <div className="relative" ref={box}>
      {label && <label className="label">{label}</label>}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input flex items-center justify-between gap-2 text-start"
      >
        <span>
          {faNum(selected.jd)} {JALALI_MONTHS[selected.jm - 1]} {faNum(selected.jy)}
        </span>
        <span className="text-muted text-xs shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-[17rem] card p-3 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="w-7 h-7 rounded-md border border-line text-muted hover:text-cyan hover:border-cyan/50"
              aria-label="ماه قبل"
            >
              ›
            </button>
            <span className="text-sm font-medium">
              {JALALI_MONTHS[view.jm - 1]} {faNum(view.jy)}
            </span>
            <button
              type="button"
              onClick={() => shift(1)}
              className="w-7 h-7 rounded-md border border-line text-muted hover:text-cyan hover:border-cyan/50"
              aria-label="ماه بعد"
            >
              ‹
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w) => (
              <span key={w} className="text-[10px] text-muted text-center py-1">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: offset }).map((_, i) => (
              <span key={`pad-${i}`} />
            ))}

            {Array.from({ length: days }).map((_, i) => {
              const day = i + 1;
              const iso = isoFromJalali(view.jy, view.jm, day);
              const isSelected = iso === value;
              const isToday = iso === todayIso;
              const disabled = (max && iso > max) || (min && iso < min);

              return (
                <button
                  key={day}
                  type="button"
                  disabled={!!disabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={`h-8 rounded-md text-xs transition-colors
                    ${isSelected
                      ? 'bg-cyan text-rack font-bold'
                      : disabled
                        ? 'text-muted/30 cursor-not-allowed'
                        : isToday
                          ? 'border border-cyan/40 text-cyan hover:bg-cyan/10'
                          : 'text-white/80 hover:bg-panel2'}`}
                >
                  {faNum(day)}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              onChange(todayIso);
              setOpen(false);
            }}
            className="w-full mt-2 text-xs text-muted hover:text-cyan py-1"
          >
            امروز
          </button>
        </div>
      )}
    </div>
  );
}
