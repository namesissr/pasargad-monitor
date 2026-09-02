'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * بارگذاری داده با سه حالت روشن: در حال بارگذاری، خطا، داده.
 *
 * قاعده‌ای که یک بار به آن خوردیم: هیچ صفحه‌ای نباید خطا را با catch خالی
 * ببلعد. نتیجه‌اش «در حال بارگذاری…» بی‌پایان بدون هیچ سرنخی است. اینجا
 * خطا همیشه نگه داشته و با دکمه «تلاش دوباره» نشان داده می‌شود.
 *
 * pollMs برای صفحه‌های زنده است. بارگذاری دوره‌ای، حالت loading را روشن
 * نمی‌کند تا صفحه هر چند ثانیه پرش نکند.
 */
export function useLoad<T>(url: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const alive = useRef(true);

  const run = useCallback(
    async (silent: boolean) => {
      if (!url) return;
      if (!silent) setLoading(true);
      try {
        const res = await api.get<T>(url);
        if (!alive.current) return;
        setData(res);
        setError(null);
        setUpdatedAt(new Date());
      } catch (err) {
        if (!alive.current) return;
        const message = err instanceof ApiError ? err.message : 'خطای ناشناخته در بارگذاری';
        // در بارگذاری دوره‌ای، داده قبلی را نگه می‌داریم و فقط خطا را نشان می‌دهیم
        setError(message);
      } finally {
        if (alive.current && !silent) setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    alive.current = true;
    void run(false);
    return () => {
      alive.current = false;
    };
  }, [run]);

  useEffect(() => {
    if (!pollMs || !url) return;
    const t = setInterval(() => void run(true), pollMs);
    return () => clearInterval(t);
  }, [pollMs, url, run]);

  const reload = useCallback(() => void run(false), [run]);

  return { data, loading, error, reload, updatedAt };
}

interface LoadStateProps {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyText?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}

/** نمایش حالت بارگذاری، خطا یا خالی. اگر هیچ‌کدام نبود، children را نشان می‌دهد. */
export function LoadState({ loading, error, empty, emptyText, onRetry, children }: LoadStateProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-muted text-sm">
        <span className="w-4 h-4 border-2 border-cyan/30 border-t-cyan rounded-full animate-spin" />
        در حال بارگذاری…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-danger text-sm mb-1">بارگذاری انجام نشد</p>
        <p className="text-muted text-xs mb-4">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-ghost">
            تلاش دوباره
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="card p-10 text-center text-muted text-sm">{emptyText || 'موردی برای نمایش نیست'}</div>
    );
  }

  return <>{children}</>;
}
