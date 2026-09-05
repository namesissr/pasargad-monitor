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
  const [kind, setKind] = useState<'linux' | 'esxi'>('linux');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://panel.example.com';

  const cmd =
    kind === 'linux'
      ? `curl -fsSL ${origin}/agent/install.sh | bash -s -- ${origin} ${token}`
      : `curl -fsSL -o /usr/local/bin/esxi-agent.py ${origin}/agent/esxi-agent.py && \
python3 /usr/local/bin/esxi-agent.py --host <آی‌پی-هاست> --community <نام-جامعه> --probe`;

  return (
    <div className="space-y-4">
      {/* ESXi هسته لینوکس ندارد و ایجنت معمولی رویش اجرا نمی‌شود؛ اگر
          این تفکیک اینجا نباشد، کاربر دستور لینوکسی را روی هاست می‌زند
          و با خطای نامفهوم روبه‌رو می‌شود. */}
      <div className="flex gap-1 p-1 bg-rack border border-line rounded-lg w-fit">
        {([
          ['linux', 'لینوکس'],
          ['esxi', 'VMware ESXi'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`px-3 py-1 rounded text-xs ${
              kind === k ? 'bg-cyan/15 text-cyan' : 'text-muted hover:text-fg'
            }`}
            onClick={() => setKind(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === 'linux' ? (
        <Notice type="info">
          این دستور را روی خود سرور اجرا کنید. ایجنت یک اسکریپت پایتون بدون وابستگی است که به‌عنوان سرویس
          systemd نصب می‌شود و هر ۱۰ ثانیه گزارش می‌فرستد.
        </Notice>
      ) : (
        <Notice type="warn">
          این دستور را <b>روی سرور پنل</b> اجرا کنید، نه روی خود ESXi. هسته ESXi فایل‌های
          <span className="ltr font-mono"> /proc </span>
          لینوکس را ندارد و ایجنت معمولی رویش کار نمی‌کند. جمع‌کننده از راه SNMP فقط‌خواندنی
          آمار می‌گیرد و با همین توکن به پنل می‌فرستد. راهنمای کامل در مخزن:{' '}
          <span className="ltr font-mono">docs/esxi.md</span>
        </Notice>
      )}

      <div>
        <p className="label">{kind === 'linux' ? 'دستور نصب' : 'اول ببینید هاست چه دارد'}</p>
        <div className="bg-rack border border-line rounded-lg p-3 ltr font-mono text-[11px] break-all whitespace-pre-wrap">{cmd}</div>
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
          {kind === 'linux' ? (
            <>
              اگر گواهی سرور خودامضاست، در انتهای دستور{' '}
              <span className="ltr font-mono">--insecure</span> اضافه کنید.
            </>
          ) : (
            <>
              پیش از این، روی ESXi باید SNMP فقط‌خواندنی فعال باشد. خروجی{' '}
              <span className="ltr font-mono">--probe</span> نشان می‌دهد کدام رابط و کدام
              دیتااستور شمرده می‌شود؛ بعد از تأیید آن، دستور دائمی را از راهنما بردارید.
            </>
          )}
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
