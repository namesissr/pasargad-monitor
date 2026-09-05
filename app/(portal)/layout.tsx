import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { PortalNav } from '@/components/PortalNav';

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
    <div className="min-h-screen">
      <PortalNav />
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-5 sm:py-6">{children}</main>
    </div>
  );
}
