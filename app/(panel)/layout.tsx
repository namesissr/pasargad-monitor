import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  // مشتری به پنل مدیریت راه ندارد. محافظت واقعی روی ای‌پی‌آی است؛ این
  // فقط برای اینکه به‌جای صفحه پر از خطا، جای درست خودش را ببیند.
  if (user.role === 'customer') redirect('/portal');

  return <Shell username={user.username}>{children}</Shell>;
}
