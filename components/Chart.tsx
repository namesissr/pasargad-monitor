'use client';

import { useMemo, useState } from 'react';
import { faNum } from '@/lib/format';

/**
 * نمودار سری زمانی با SVG خالص — بدون کتابخانه بیرونی.
 *
 * محور زمان عمداً چپ‌به‌راست است. همان قرارداد جهانی نمودارهاست و کاربر
 * ایرانی هم گذشته را سمت چپ و حال را سمت راست انتظار دارد. فقط برچسب‌ها
 * فارسی‌اند.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
  /** اگر مقدار درصد باشد، محور روی ۰ تا ۱۰۰ ثابت می‌ماند */
  percent?: boolean;
}

interface ChartProps {
  points: Record<string, unknown>[];
  series: Series[];
  height?: number;
  /** قالب‌بندی مقدار در راهنما و محور عمودی */
  format: (v: number) => string;
  /** قالب‌بندی برچسب زمان */
  formatTime: (t: string) => string;
  fill?: boolean;
  emptyText?: string;
  /**
   * سقف محور عمودی. وقتی دو نمودار کنار هم مقایسه می‌شوند باید یک مقیاس
   * داشته باشند، وگرنه آپلود کوچک به‌اندازه دانلود بزرگ دیده می‌شود و
   * نسبتشان گمراه‌کننده می‌شود.
   */
  maxValue?: number;
}

const PAD = { top: 12, right: 8, bottom: 22, left: 52 };

export function Chart({
  points,
  series,
  height = 200,
  format,
  formatTime,
  fill = true,
  emptyText = 'داده‌ای برای این بازه ثبت نشده است',
  maxValue,
}: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 800; // مختصات داخلی؛ viewBox مقیاس را به عرض واقعی می‌رساند

  const { max, paths, areas, xs, ys } = useMemo(() => {
    const inner = { w: width - PAD.left - PAD.right, h: height - PAD.top - PAD.bottom };
    const isPercent = series.every((s) => s.percent);

    let peak = 0;
    for (const p of points) {
      for (const s of series) {
        const v = Number(p[s.key]);
        if (Number.isFinite(v) && v > peak) peak = v;
      }
    }
    const maxV = maxValue && maxValue > 0
      ? maxValue
      : isPercent ? 100 : peak <= 0 ? 1 : peak * 1.15;

    const xAt = (i: number) =>
      PAD.left + (points.length <= 1 ? inner.w / 2 : (i / (points.length - 1)) * inner.w);
    const yAt = (v: number) => PAD.top + inner.h - (Math.max(0, Math.min(v, maxV)) / maxV) * inner.h;

    const paths: Record<string, string> = {};
    const areas: Record<string, string> = {};

    for (const s of series) {
      let d = '';
      let started = false;
      points.forEach((p, i) => {
        const v = Number(p[s.key]);
        if (!Number.isFinite(v)) return;
        d += `${started ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
        started = true;
      });
      paths[s.key] = d;
      if (d && fill) {
        const firstI = points.findIndex((p) => Number.isFinite(Number(p[s.key])));
        const lastI = points.length - 1 - [...points].reverse().findIndex((p) => Number.isFinite(Number(p[s.key])));
        areas[s.key] =
          `${d}L${xAt(lastI).toFixed(1)},${(PAD.top + inner.h).toFixed(1)}` +
          `L${xAt(firstI).toFixed(1)},${(PAD.top + inner.h).toFixed(1)}Z`;
      }
    }

    const ys = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: PAD.top + inner.h - f * inner.h,
      v: maxV * f,
    }));

    return { max: maxV, paths, areas, xs: xAt, ys };
  }, [points, series, height, fill, maxValue]);

  if (!points.length) {
    return (
      <div className="flex items-center justify-center text-muted text-xs" style={{ height }}>
        {emptyText}
      </div>
    );
  }

  const hoverPoint = hover !== null ? (points[hover] ?? null) : null;

  return (
    <div className="relative" dir="ltr">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full block"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          const inner = width - PAD.left - PAD.right;
          const ratio = Math.max(0, Math.min(1, (x - PAD.left) / inner));
          setHover(Math.round(ratio * (points.length - 1)));
        }}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ys.map((g, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={g.y} x2={width - PAD.right} y2={g.y} stroke="#1E2633" strokeWidth="1" />
            <text x={PAD.left - 6} y={g.y + 3} textAnchor="end" fontSize="10" fill="#7C8AA0">
              {format(g.v)}
            </text>
          </g>
        ))}

        {series.map((s) =>
          areas[s.key] ? <path key={`a-${s.key}`} d={areas[s.key]} fill={`url(#g-${s.key})`} /> : null,
        )}

        {series.map((s) => (
          <path
            key={`p-${s.key}`}
            d={paths[s.key]}
            fill="none"
            stroke={s.color}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {hover !== null && (
          <line
            x1={xs(hover)}
            y1={PAD.top}
            x2={xs(hover)}
            y2={height - PAD.bottom}
            stroke="#3ED6C5"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        <text x={PAD.left} y={height - 6} fontSize="10" fill="#7C8AA0">
          {formatTime(String(points[0]?.t ?? ''))}
        </text>
        <text x={width - PAD.right} y={height - 6} fontSize="10" fill="#7C8AA0" textAnchor="end">
          {formatTime(String(points[points.length - 1]?.t ?? ''))}
        </text>
      </svg>

      {hoverPoint && (
        <div
          className="pointer-events-none absolute top-1 bg-rack/95 border border-line rounded-lg px-2.5 py-1.5 text-[11px] shadow-lg"
          dir="rtl"
          style={{
            left: `${Math.min(78, Math.max(2, ((xs(hover!) - PAD.left) / (width - PAD.left - PAD.right)) * 100))}%`,
          }}
        >
          <div className="text-muted mb-1">{formatTime(String(hoverPoint.t))}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
              <span className="text-muted">{s.label}</span>
              <span className="text-white">
                {Number.isFinite(Number(hoverPoint[s.key])) ? format(Number(hoverPoint[s.key])) : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 mt-2 text-[11px]" dir="rtl">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-muted">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="text-muted/60 ms-auto">بیشینه محور: {format(max)}</span>
      </div>
    </div>
  );
}

/** نمودار میله‌ای برای گزارش‌های دوره‌ای */
export function BarChart({
  bars,
  format,
  height = 190,
  color = '#3ED6C5',
}: {
  bars: { label: string; value: number; sub?: string }[];
  format: (v: number) => string;
  height?: number;
  color?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));

  if (!bars.length) {
    return <div className="text-muted text-xs text-center py-10">داده‌ای ثبت نشده است</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1.5 min-w-full" style={{ height }} dir="ltr">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 min-w-[18px] flex flex-col items-center justify-end h-full group">
            <span className="text-[10px] text-muted opacity-0 group-hover:opacity-100 transition-opacity mb-1 whitespace-nowrap">
              {format(b.value)}
            </span>
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${Math.max(2, (b.value / max) * 100)}%`,
                background: `linear-gradient(180deg, ${color}, ${color}44)`,
              }}
              title={`${b.label}: ${format(b.value)}`}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5" dir="ltr">
        {bars.map((b, i) => (
          <div
            key={i}
            className="flex-1 min-w-[18px] text-[9px] text-muted text-center truncate"
            title={b.label}
          >
            {bars.length > 20 ? (i % 3 === 0 ? b.label : '') : b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/** نوار مصرف با رنگ‌بندی بر اساس درصد */
export function UsageBar({ percent, label, right }: { percent: number; label?: string; right?: string }) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color = p >= 90 ? 'bg-danger' : p >= 75 ? 'bg-amber' : 'bg-cyan';

  return (
    <div>
      {(label || right) && (
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-muted">{label}</span>
          <span className="text-white/80">{right ?? `${faNum(p.toFixed(0))}٪`}</span>
        </div>
      )}
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
