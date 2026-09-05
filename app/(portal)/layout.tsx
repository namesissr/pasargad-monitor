import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

/**
 * چیدمان پرتال مشتری.
 *
 * عمدا از چیدمان پنل مدیریت جداست و منوی آن را ندارد: مشتری نباید حتی
 * نام بخش‌هایی مثل حسابداری یا هایپروایزرها را ببیند.
 *
 * محافظت اینجا فقط برای تجربه کاربری است — تغییر مسیر به‌جای صفحه خالی.
 * محافظت واقعی روی مسیرهای ای‌پی‌آی است، چون رابط را می‌شود دور زد ولی
 * ای‌پی‌آی را نه.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'customer') redirect('/');

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/portal" className="font-bold text-sm">
            پاسارگاد میزبان
          </Link>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="text-xs text-muted hover:text-white">
              خروج
            </button>
          </form>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
