'use client';

import { Component, useEffect, type ReactNode } from 'react';
import { IP_STATUS_LABEL, SERVER_STATUS_LABEL } from '@/lib/format';

/** نشان وضعیت سرور */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    up: 'bg-ok/15 text-ok border-ok/30',
    down: 'bg-danger/15 text-danger border-danger/30',
    maintenance: 'bg-amber/15 text-amber border-amber/30',
    unknown: 'bg-line text-muted border-line',
  };
  return (
    <span className={`badge border ${map[status] ?? map.unknown}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'up' ? 'bg-ok animate-pulse' : status === 'down' ? 'bg-danger' : status === 'maintenance' ? 'bg-amber' : 'bg-muted'}`} />
      {SERVER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** نشان وضعیت آی‌پی */
export function IpBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    assigned: 'bg-cyan/15 text-cyan border-cyan/30',
    free: 'bg-ok/10 text-ok border-ok/25',
    reserved: 'bg-amber/15 text-amber border-amber/30',
    blocked: 'bg-danger/15 text-danger border-danger/30',
    abuse: 'bg-danger/25 text-danger border-danger/40',
  };
  return <span className={`badge border ${map[status] ?? 'bg-line text-muted border-line'}`}>{IP_STATUS_LABEL[status] ?? status}</span>;
}

/** کارت آمار کوچک */
export function StatCard({
  title,
  value,
  sub,
  tone = 'default',
  icon,
}: {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'cyan';
  icon?: ReactNode;
}) {
  const tones: Record<string, string> = {
    default: 'text-white',
    ok: 'text-ok',
    warn: 'text-amber',
    danger: 'text-danger',
    cyan: 'text-cyan',
  };
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted mb-1.5">{title}</p>
          <p className={`text-xl font-bold truncate ${tones[tone]}`}>{value}</p>
          {sub && <p className="text-[11px] text-muted mt-1 truncate">{sub}</p>}
        </div>
        {icon && <div className="text-muted/60 shrink-0">{icon}</div>}
      </div>
    </div>
  );
}

/** پنجره مودال ساده */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} my-auto`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 className="font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-white text-xl leading-none px-1" aria-label="بستن">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** فیلد فرم */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted/70 mt-1">{hint}</p>}
    </div>
  );
}

/** پیام خطا یا موفقیت درون فرم */
export function Notice({
  type,
  children,
}: {
  type: 'error' | 'success' | 'info' | 'warn';
  children: ReactNode;
}) {
  const map = {
    error: 'bg-danger/10 border-danger/30 text-danger',
    success: 'bg-ok/10 border-ok/30 text-ok',
    info: 'bg-cyan/10 border-cyan/30 text-cyan',
    // هشدار: کاری که انجام می‌شود درست است ولی محدودیتی دارد که باید بدانید
    warn: 'bg-amber/10 border-amber/30 text-amber',
  };
  return <div className={`border rounded-lg px-3 py-2 text-xs ${map[type]}`}>{children}</div>;
}

/**
 * مرز خطا دور مسیرها.
 * اگر با وجود همه احتیاط‌ها خطای رندر رخ داد، به‌جای صفحه سیاه پیام
 * قابل خواندن با دکمه بارگذاری دوباره نشان داده می‌شود.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ui] خطای رندر:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card p-8 text-center m-4">
          <p className="text-danger font-bold mb-2">این صفحه بالا نیامد</p>
          <p className="text-muted text-xs mb-4 ltr font-mono">{this.state.error.message}</p>
          <button type="button" className="btn-ghost" onClick={() => window.location.reload()}>
            بارگذاری دوباره
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** متن آی‌پی و اعداد — همیشه چپ‌به‌راست */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`ltr font-mono text-xs ${className}`}>{children}</span>;
}
