import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { verifyAndSettle } from '@/lib/invoices';
import { notify } from '@/lib/notify';
import { readCallback } from '@/worker/payping.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * بازگشت از درگاه پرداخت.
 *
 * ── چرا این مسیر لازم است ──────────────────────────────────
 *
 * نسخه اول، آدرس بازگشت را مستقیم روی صفحه پرتال گذاشته بود و نتیجه‌اش
 * خطای ۵۰۰ بود:
 *
 *  ۱. پی‌پینگ نتیجه را با **POST** برمی‌گرداند، نه GET.
 *  ۲. کوکی نشست sameSite=lax است و در POST بین‌سایتی فرستاده نمی‌شود.
 *  ۳. میان‌افزار نشست نمی‌دید و ریدایرکت می‌کرد؛ ریدایرکت ۳۰۷ متد POST
 *     را نگه می‌دارد، پس POST به صفحه ورود می‌رفت و آنجا می‌ترکید.
 *
 * پس این مسیر هر متدی را می‌پذیرد، عمومی است، و با ۳۰۳ ریدایرکت می‌کند
 * که POST را به GET تبدیل می‌کند.
 *
 * ── چرا تأیید همین‌جا انجام می‌شود ─────────────────────────
 *
 * اگر تأیید را به صفحه پرتال بسپاریم و نشست مشتری در فاصله پرداخت
 * منقضی شده باشد، او به صفحه ورود می‌رود و **پرداخت هرگز ثبت نمی‌شود**
 * — پول رفته و سرویس تحویل نشده.
 *
 * امنیتش از چهار جا می‌آید: شناسه پرداخت را فقط درگاه می‌دهد، مبلغ از
 * دیتابیس می‌آید، شماره فاکتور بازگشتی با فاکتور سنجیده می‌شود، و تسویه
 * اید‌مپوتنت است.
 *
 * ── چرا هر شکستی ثبت و اعلام می‌شود ────────────────────────
 *
 * پول کم‌شده و فاکتور بازمانده، بدترین حالت ممکن است. نسخه اول فقط یک
 * خط در لاگ کانتینر می‌گذاشت — یعنی این حالت بی‌سروصدا اتفاق می‌افتاد.
 *
 * حالا هر تلاش ناموفق روی خود فاکتور می‌نشیند و بلافاصله به ادمین خبر
 * می‌رود. پارامترهای خام بازگشتی هم ذخیره می‌شوند: اگر نام پارامترها با
 * انتظار ما نخواند، بدون دیدن آنچه واقعا آمده تشخیصش ممکن نیست.
 */

/** پارامترهای بازگشت، از کوئری و از بدنه فرم */
async function collect(req: Request, url: URL): Promise<[string, string][]> {
  const pairs: [string, string][] = [...url.searchParams.entries()];

  if (req.method === 'POST') {
    try {
      const form = await req.formData();
      for (const [k, v] of form.entries()) pairs.push([k, String(v)]);
    } catch {
      // بدنه فرم نبود؛ پارامترها همان کوئری‌اند
    }
  }

  return pairs;
}

/**
 * ثبت تلاش ناموفق روی فاکتور، و خبر فوری به ادمین.
 *
 * شکست ثبت یا شکست خبر نباید جلوی پاسخ‌دادن به کاربر را بگیرد؛ او
 * منتظر یک صفحه است.
 */
async function recordFailure(
  invoiceId: number,
  reason: string,
  pairs: [string, string][],
  method: string,
) {
  const raw = JSON.stringify({ method, params: Object.fromEntries(pairs) }).slice(0, 2000);

  await query(
    `UPDATE invoices
        SET payment_error = $2, callback_raw = $3, last_attempt_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'unpaid'`,
    [invoiceId, reason.slice(0, 500), raw],
  ).catch((e) =>
    console.error('[pay] ثبت خطای پرداخت ناموفق:', e instanceof Error ? e.message : e),
  );

  const inv = await queryOne<{ number: string; amount_toman: number; customer_name: string }>(
    `SELECT i.number, i.amount_toman::float8 AS amount_toman, c.name AS customer_name
       FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.id = $1`,
    [invoiceId],
  ).catch(() => null);

  await notify(
    `پاسارگاد میزبان — ⚠ پرداخت تأیید نشد.\n` +
      (inv
        ? `فاکتور ${inv.number} · ${Number(inv.amount_toman).toLocaleString('fa-IR')} تومان\n` +
          `مشتری: ${inv.customer_name}\n`
        : `فاکتور شماره ${invoiceId}\n`) +
      `علت: ${reason.slice(0, 200)}\n\n` +
      `اگر مبلغ از حساب مشتری کم شده، فاکتور را دستی ثبت کنید.`,
  ).catch((e) =>
    console.error('[pay] خبر شکست پرداخت به ادمین نرسید:', e instanceof Error ? e.message : e),
  );
}

async function handleReturn(req: Request, rawId: string) {
  const url = new URL(req.url);
  const s = await getSettings();
  const base = String(s.panel_url || url.origin).replace(/\/+$/, '');

  const invoiceId = Number(rawId);
  const to = (status: string) =>
    NextResponse.redirect(
      `${base}/portal/pay/${Number.isInteger(invoiceId) ? invoiceId : 0}?status=${status}`,
      // ۳۰۳ عمدی است: POST درگاه را به GET تبدیل می‌کند تا صفحه پرتال
      // بتواند رندر شود و کوکی نشست هم فرستاده شود
      303,
    );

  if (!Number.isInteger(invoiceId) || invoiceId <= 0) return to('notfound');

  const pairs = await collect(req, url);
  const callback = readCallback(pairs);

  // پارامترهای خام همیشه ثبت می‌شوند، حتی وقتی همه‌چیز درست پیش برود.
  // بدون آن‌ها، اولین اختلاف با درگاه غیرقابل تشخیص است.
  console.log('[pay] بازگشت درگاه:', req.method, JSON.stringify(Object.fromEntries(pairs)));

  try {
    const inv = await queryOne<{ id: number; number: string; status: string }>(
      `SELECT id, number, status FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!inv) return to('notfound');

    // از قبل پرداخت شده: بازگشت دوباره یا رفرش. چیزی تکرار نمی‌شود.
    if (inv.status === 'paid') return to('already');

    // نبودِ شناسه پرداخت یعنی کاربر انصراف داده یا پرداخت ناموفق بوده.
    //
    // ولی ممکن است هم یعنی نام پارامتر با انتظار ما نمی‌خواند — و آن
    // حالت خطرناک است چون پول کم شده. پس همین را هم ثبت و اعلام
    // می‌کنیم، با پارامترهای خام تا معلوم شود کدام بوده.
    if (!callback.refId) {
      await recordFailure(
        invoiceId,
        pairs.length
          ? 'شناسه پرداخت در بازگشت درگاه نبود — یا کاربر انصراف داده یا نام پارامتر ناشناخته است'
          : 'درگاه هیچ پارامتری برنگرداند — احتمالا کاربر انصراف داده',
        pairs,
        req.method,
      );
      return to('canceled');
    }

    // اگر درگاه شماره فاکتور را پس داده، باید با همین فاکتور بخواند.
    // بدون این بررسی، کسی که یک شناسه پرداخت معتبر دارد می‌تواند
    // فاکتور دیگری با همان مبلغ را تسویه کند.
    if (callback.clientRefId && callback.clientRefId !== inv.number) {
      await recordFailure(
        invoiceId,
        `شماره فاکتور بازگشتی «${callback.clientRefId}» با فاکتور «${inv.number}» نمی‌خواند`,
        pairs,
        req.method,
      );
      return to('mismatch');
    }

    const result = await verifyAndSettle(invoiceId, callback);

    if (!result.ok) {
      await recordFailure(invoiceId, result.error || 'علت نامشخص', pairs, req.method);
      return to('failed');
    }

    return to(result.alreadyPaid ? 'already' : 'paid');
  } catch (err) {
    // خطای تأیید نباید صفحه ۵۰۰ بدهد. کاربر باید پیام قابل خواندن
    // ببیند و شماره پیگیری‌اش را داشته باشد.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pay] تأیید پرداخت خطا داد:', message);
    await recordFailure(invoiceId, message, pairs, req.method);
    return to('failed');
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handleReturn(req, params.id);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleReturn(req, params.id);
}
