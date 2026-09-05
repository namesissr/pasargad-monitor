import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { verifyAndSettle } from '@/lib/invoices';
import { readCallback } from '@/worker/payping.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * بازگشت از درگاه پرداخت.
 *
 * ── چرا این مسیر لازم شد ───────────────────────────────────
 *
 * نسخه اول، آدرس بازگشت را مستقیم روی صفحه پرتال گذاشته بود. نتیجه‌اش
 * خطای ۵۰۰ بود و علتش زنجیره‌ای از سه چیز:
 *
 *  ۱. پی‌پینگ نتیجه را با **POST** برمی‌گرداند، نه GET.
 *  ۲. کوکی نشست sameSite=lax است و در POST بین‌سایتی فرستاده نمی‌شود.
 *  ۳. میان‌افزار نشست نمی‌دید و ریدایرکت می‌کرد؛ ریدایرکت ۳۰۷ متد POST
 *     را نگه می‌دارد، پس POST به صفحه ورود می‌رفت و آنجا می‌ترکید.
 *
 * پس بازگشت باید به یک مسیر بیاید که:
 *  • هر متدی را بپذیرد
 *  • **عمومی باشد** — چون کوکی در آن درخواست وجود ندارد
 *  • با ۳۰۳ ریدایرکت کند، که POST را به GET تبدیل می‌کند
 *
 * بعد از آن ریدایرکت، مرورگر یک GET هم‌سایتی به صفحه ما می‌زند و کوکی
 * lax این بار فرستاده می‌شود.
 *
 * ── چرا تأیید همین‌جا انجام می‌شود ─────────────────────────
 *
 * اگر تأیید را به صفحه پرتال بسپاریم و نشست مشتری در فاصله پرداخت
 * منقضی شده باشد، او به صفحه ورود می‌رود و **پرداخت هرگز ثبت نمی‌شود**
 * — پول رفته و سرویس تمدید نشده. بدترین حالت ممکن.
 *
 * پس تأیید همین‌جا و بدون نیاز به نشست انجام می‌شود. این امن است چون:
 *  • شناسه پرداخت را فقط درگاه می‌دهد و قابل حدس نیست
 *  • مبلغ از دیتابیس می‌آید، نه از پارامتر
 *  • اگر درگاه clientRefId برگرداند، با شماره فاکتور سنجیده می‌شود
 *  • تسویه اید‌مپوتنت است و دو بار اجرا نمی‌شود
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

  const callback = readCallback(await collect(req, url));

  // نبودِ شناسه پرداخت یعنی کاربر انصراف داده یا پرداخت ناموفق بوده.
  // این خطای ما نیست و نباید مثل خطا ثبت شود.
  if (!callback.refId) return to('canceled');

  try {
    const inv = await queryOne<{ id: number; number: string; status: string }>(
      `SELECT id, number, status FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!inv) return to('notfound');

    // اگر درگاه شماره فاکتور را پس داده، باید با همین فاکتور بخواند.
    // بدون این بررسی، کسی که یک شناسه پرداخت معتبر دارد می‌تواند
    // فاکتور دیگری با همان مبلغ را تسویه کند.
    if (callback.clientRefId && callback.clientRefId !== inv.number) {
      console.error(
        '[pay] شماره فاکتور بازگشتی با فاکتور نمی‌خواند:',
        callback.clientRefId,
        inv.number,
      );
      return to('mismatch');
    }

    const result = await verifyAndSettle(invoiceId, callback);
    return to(result.ok ? (result.alreadyPaid ? 'already' : 'paid') : 'failed');
  } catch (err) {
    // خطای تأیید نباید صفحه ۵۰۰ بدهد. کاربر باید یک پیام قابل خواندن
    // ببیند و شماره پیگیری‌اش را داشته باشد.
    console.error('[pay] تأیید پرداخت خطا داد:', err instanceof Error ? err.message : err);
    return to('failed');
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handleReturn(req, params.id);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleReturn(req, params.id);
}
