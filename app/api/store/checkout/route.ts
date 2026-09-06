import { queryOne } from '@/lib/db';
import { currentUser, verifyPassword } from '@/lib/auth';
import { startSession } from '@/lib/signin';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { normalizePhone, registerCustomer } from '@/lib/register';
import { createProductOrder } from '@/lib/shop-order';
import { notify } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * سفارش از فروشگاه عمومی، با ثبت‌نام یا ورود در همان مرحله.
 *
 * ── سه حالت، یک مسیر ───────────────────────────────────────
 *
 *   mode=session   از قبل وارد شده — فقط سفارش
 *   mode=login     حساب دارد — ورود و بعد سفارش
 *   mode=register  حساب ندارد — ثبت‌نام و بعد سفارش
 *
 * یکی‌بودنشان عمدی است: در هر سه حالت، سفارش از **همان**
 * createProductOrder می‌گذرد. اگر مسیر جدا می‌بود، قاعده «قیمت از
 * دیتابیس» باید دو جا نگه داشته می‌شد.
 *
 * ── قاعده‌ای که نباید شکسته شود ────────────────────────────
 *
 * **شناسه مشتری هرگز از بدنه درخواست نمی‌آید.** یا از نشست جاری است، یا
 * از حسابی که همین‌جا احراز یا ساخته شد. اگر از بدنه بیاید، هر کسی از
 * اینترنت به نام هر مشتری‌ای سفارش ثبت می‌کند.
 *
 * ── نقش سخت‌کدشده ──────────────────────────────────────────
 *
 * ثبت‌نام همیشه نقش customer می‌سازد. این در lib/register.ts سخت‌کد شده
 * و از ورودی خوانده نمی‌شود.
 *
 * ── سقف نرخ ────────────────────────────────────────────────
 *
 * این مسیر حساب می‌سازد و از اینترنت باز در دسترس است. بدون سقف، یک
 * اسکریپت در چند دقیقه هزاران مشتری و سفارش می‌سازد.
 */

// type است نه interface: کوئری pg محدودیت T extends QueryResultRow
// دارد و تایپ‌اسکریپت فقط به type alias امضای ایندکس ضمنی می‌دهد.
type AuthRow = {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  is_active: boolean;
  customer_id: number | null;
};

export async function POST(req: Request) {
  return handle(async () => {
    const s = await getSettings();
    if (s.store_public_enabled === 'false' || s.shop_enabled === 'false') {
      return fail('ثبت سفارش آنلاین در حال حاضر در دسترس نیست', 503);
    }

    const ip = clientIp(req);
    const limit = rateLimit(`store-checkout:${ip}`, 8, 600);
    if (!limit.ok) {
      return fail(
        `درخواست بیش از حد. ${limit.retryAfter} ثانیه دیگر دوباره امتحان کنید.`,
        429,
      );
    }

    const body = await readJson<Record<string, unknown>>(req);
    const mode = String(body.mode ?? 'session');

    let customerId: number | null = null;

    // ── ۱) از قبل وارد شده ────────────────────────────────
    if (mode === 'session') {
      const user = await currentUser();
      if (!user || user.role !== 'customer' || !user.cid) {
        return fail('برای ثبت سفارش وارد شوید یا ثبت‌نام کنید', 401);
      }
      customerId = user.cid;
    }

    // ── ۲) ورود ───────────────────────────────────────────
    else if (mode === 'login') {
      const username = normalizePhone(body.username) || String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      if (!username || !password) return fail('شماره موبایل و گذرواژه لازم است', 400);

      const user = await queryOne<AuthRow>(
        `SELECT id, username, password_hash, role, is_active, customer_id
           FROM users WHERE lower(username) = lower($1)`,
        [username],
      );

      // پیام یکسان برای حساب ناموجود و گذرواژه غلط
      if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
        return fail('شماره موبایل یا گذرواژه درست نیست', 401);
      }
      if (user.role !== 'customer' || !user.customer_id) {
        return fail('این حساب حساب مشتری نیست', 403);
      }

      await startSession(user);
      customerId = user.customer_id;
    }

    // ── ۳) ثبت‌نام ────────────────────────────────────────
    else if (mode === 'register') {
      const reg = await registerCustomer({
        name: String(body.name ?? ''),
        phone: String(body.phone ?? ''),
        password: String(body.password ?? ''),
        email: String(body.email ?? ''),
        company: String(body.company ?? ''),
        nationalId: String(body.national_id ?? ''),
        address: String(body.address ?? ''),
      });
      if (!reg.ok || !reg.user) {
        return fail(reg.error || 'ثبت‌نام ناموفق بود', reg.status ?? 400);
      }

      await startSession(reg.user);
      customerId = reg.user.customer_id;
    } else {
      return fail('حالت درخواست نامعتبر است', 400);
    }

    // نگهبان ساختاری: هر سه شاخه بالا یا شناسه می‌گذارند یا برمی‌گردند،
    // پس اینجا هرگز تهی نیست. اگر روزی شاخه چهارمی اضافه شد و این را
    // فراموش کرد، سفارش بی‌صاحب ساخته نمی‌شود.
    if (customerId === null) return fail('حساب مشتری تعیین نشد', 500);

    // ── سفارش ─────────────────────────────────────────────
    //
    // از همان تابعی که فروشگاه پرتال استفاده می‌کند. قیمت از دیتابیس
    // می‌آید، نه از بدنه درخواست.
    const result = await createProductOrder({
      customerId,
      productId: body.product_id,
      discountCode: body.discount_code,
      note: body.note,
      // فقط شناسه و تعداد از مشتری می‌آید؛ قیمت هر دو از دیتابیس
      addonPackageId: body.addon_package_id,
      addonIps: body.addon_ips,
    });

    if (!result.ok) {
      // حساب ساخته یا وارد شده و سفارش نشده. حساب را پس نمی‌گیریم:
      // مشتری می‌تواند وارد شود و دوباره سفارش بدهد. پاک‌کردنش یعنی
      // گذرواژه‌ای که تازه انتخاب کرده هم می‌رود.
      return fail(result.error || 'ثبت سفارش ناموفق بود', result.status ?? 400);
    }

    // خبر به ادمین. سفارش تازه از یک مشتری تازه، همان چیزی است که
    // نباید لای بقیه گم شود.
    const who = await queryOne<{ name: string; phone: string | null }>(
      `SELECT name, phone FROM customers WHERE id = $1`,
      [customerId],
    );
    await notify(
      `پاسارگاد میزبان — سفارش تازه از فروشگاه\n\n` +
        `${result.orderNumber} · ${who?.name ?? ''}` +
        (who?.phone ? ` · ${who.phone}` : '') +
        `\nفاکتور ${result.number}` +
        (mode === 'register' ? '\n(مشتری تازه، همین حالا ثبت‌نام کرد)' : ''),
    ).catch((e) =>
      console.error('[store] خبر سفارش به ادمین نرسید:', e instanceof Error ? e.message : e),
    );

    return ok(
      {
        invoiceId: result.invoiceId,
        number: result.number,
        orderNumber: result.orderNumber,
        payable: result.payable,
        discount: result.discount,
        paid: result.paid,
      },
      { status: 201 },
    );
  });
}
