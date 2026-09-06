import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { PortalNav } from '@/components/PortalNav';
import { SiteFooter } from '@/components/SiteFooter';
import { AnnouncementModal } from '@/components/AnnouncementModal';

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
    <div className="min-h-screen flex flex-col">
      <PortalNav />

      {/* اطلاعیه روی هر صفحه پرتال می‌آید، نه فقط صفحه اول: مشتری ممکن
          است مستقیم روی لینک فاکتور یا تیکت وارد شود */}
      <AnnouncementModal />
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-4 py-5 sm:py-6">{children}</main>
      <SiteFooter compact />
    </div>
  );
}
