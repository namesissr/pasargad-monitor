import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import { SiteFooter } from '@/components/SiteFooter';
import { ErrorBoundary } from '@/components/ui';

/**
 * چیدمان فروشگاه عمومی.
 *
 * ── بدون نگهبان، عمدا ──────────────────────────────────────
 *
 * تنها بخش سایت که بدون ورود دیده می‌شود. مشتری تازه باید بتواند
 * محصولات را ببیند و سفارش بدهد؛ ثبت‌نام حین همان سفارش انجام می‌شود.
 *
 * ── سرصفحه می‌داند کاربر وارد شده یا نه ────────────────────
 *
 * اگر وارد شده، لینک «پنل کاربری» می‌بیند نه «ورود». بدون این، مشتری
 * قدیمی هم دوباره فرم ورود می‌بیند و فکر می‌کند نشستش پریده.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="no-print border-b border-line bg-panel/60 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/store" className="flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-md bg-cyan/15 border border-cyan/30 grid place-items-center text-cyan text-sm">
              ⬢
            </span>
            <span className="font-bold text-sm">پاسارگاد میزبان</span>
          </Link>

          {user ? (
            <Link
              href={user.role === 'customer' ? '/portal' : '/'}
              className="text-xs text-cyan hover:underline"
            >
              {user.role === 'customer' ? 'پنل کاربری' : 'پنل مدیریت'}
            </Link>
          ) : (
            <Link href="/login" className="text-xs text-muted hover:text-white">
              ورود
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-4 py-5 sm:py-8">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      <SiteFooter />
    </div>
  );
}
