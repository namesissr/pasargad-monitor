import { currentUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * آیا بازدیدکننده از قبل وارد شده؟
 *
 * فروشگاه عمومی برای همه باز است، ولی فرم سفارش باید بداند سه مرحله
 * حساب را نشان بدهد یا نه. بدون این، مشتری قدیمی هم فرم ورود می‌بیند و
 * فکر می‌کند نشستش پریده.
 *
 * ── چرا اینقدر کم برمی‌گرداند ──────────────────────────────
 *
 * فقط «وارد شده یا نه» و نام. این مسیر بدون نگهبان است و هرچه بیشتر
 * برگرداند، بیشتر از یک بازدیدکننده ناشناس اطلاعات نشتی می‌دهد. شناسه
 * مشتری هم برنمی‌گردد: هیچ صفحه‌ای لازمش ندارد و هر مسیری که کارِ
 * واقعی می‌کند آن را از توکن می‌خواند نه از مرورگر.
 */
export async function GET() {
  return handle(async () => {
    const user = await currentUser();

    if (!user || user.role !== 'customer' || !user.cid) {
      return ok({ signedIn: false });
    }

    return ok({ signedIn: true, username: user.username });
  });
}
