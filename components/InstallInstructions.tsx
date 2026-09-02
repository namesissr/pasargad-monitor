'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Mono, Notice } from './ui';

/**
 * دستور نصب ایجنت روی سرور.
 *
 * عمداً در components است نه داخل فایل page، چون فایل‌های page در نکست فقط
 * چند خروجی مشخص می‌پذیرند و خروجی نام‌دار دلخواه از آن‌ها رفتار تعریف‌شده‌ای
 * ندارد.
 */
export function InstallInstructions({
  token,
  serverId,
  onClose,
}: {
  token: string;
  serverId: number;
  onClose?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://panel.example.com';
  const cmd = `curl -fsSL ${origin}/agent/install.sh | bash -s -- ${origin} ${token}`;

  return (
    <div className="space-y-4">
      <Notice type="info">
        این دستور را روی خود سرور اجرا کنید. ایجنت یک اسکریپت پایتون بدون وابستگی است که به‌عنوان سرویس
        systemd نصب می‌شود و هر ۱۰ ثانیه گزارش می‌فرستد.
      </Notice>

      <div>
        <p className="label">دستور نصب</p>
        <div className="bg-rack border border-line rounded-lg p-3 ltr font-mono text-[11px] break-all">{cmd}</div>
        <button
          type="button"
          className="btn-ghost mt-2 text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'کپی شد ✓' : 'کپی دستور'}
        </button>
        <p className="text-[11px] text-muted/70 mt-2">
          اگر گواهی سرور خودامضاست، در انتهای دستور <span className="ltr font-mono">--insecure</span> اضافه کنید.
        </p>
      </div>

      <div>
        <p className="label">توکن ایجنت</p>
        <Mono className="text-cyan break-all">{token}</Mono>
        <p className="text-[11px] text-muted/70 mt-1">
          این توکن مثل گذرواژه است. هرکس آن را داشته باشد می‌تواند به نام این سرور داده بفرستد.
        </p>
      </div>

      <div className="flex gap-2 justify-end">
        <Link href={`/servers/${serverId}`} className="btn-ghost">
          رفتن به صفحه سرور
        </Link>
        {onClose && (
          <button type="button" className="btn-primary" onClick={onClose}>
            تمام
          </button>
        )}
      </div>
    </div>
  );
}
