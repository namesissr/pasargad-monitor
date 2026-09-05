import { queryOne } from '@/lib/db';
import { requireCustomer, ForbiddenError } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { verifyAndSettle } from '@/lib/invoices';
import { readCallback } from '@/worker/payping.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * تأیید پرداخت پس از بازگشت از درگاه.
 *
 * صفحه بازگشت این را صدا می‌زند. **چند بار صدا زدنش بی‌خطر است** —
 * رفرش صفحه بازگشت نباید دو بار سرویس بدهد. اید‌مپوتنت‌بودن در
 * settleInvoice با قفل ردیف انجام می‌شود.
 *
 * درگاه پارامترها را گاهی با GET و گاهی با POST برمی‌گرداند و نام‌ها
 * بین نسخه‌ها فرق می‌کند، پس هر دو مسیر پشتیبانی می‌شود و خواندن
 * پارامترها به readCallback سپرده شده است.
 */
async function run(req: Request, invoiceIdRaw: string) {
  const { customerId } = await requireCustomer();

  const invoiceId = Number(invoiceIdRaw);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    throw new ForbiddenError('فاکتور پیدا نشد');
  }

  const owned = await queryOne<{ id: number }>(
    `SELECT id FROM invoices WHERE id = $1 AND customer_id = $2`,
    [invoiceId, customerId],
  );
  if (!owned) throw new ForbiddenError('فاکتور پیدا نشد');

  const url = new URL(req.url);
  const pairs: [string, string][] = [...url.searchParams.entries()];

  // فرم‌پست درگاه هم خوانده می‌شود؛ بعضی حالت‌ها به‌جای کوئری، بدنه
  // می‌فرستند
  if (req.method === 'POST') {
    try {
      const form = await req.formData();
      for (const [k, v] of form.entries()) pairs.push([k, String(v)]);
    } catch {
      // بدنه فرم نبود — پارامترها همان کوئری‌اند
    }
  }

  const callback = readCallback(pairs);

  // نبودِ شناسه پرداخت یعنی کاربر انصراف داده یا پرداخت ناموفق بوده.
  // این خطای ما نیست و نباید مثل خطا گزارش شود.
  if (!callback.refId) {
    return ok({ ok: false, canceled: true, message: 'پرداخت انجام نشد یا لغو شد' });
  }

  const result = await verifyAndSettle(invoiceId, callback);
  return ok(result);
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle(() => run(req, params.id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(() => run(req, params.id));
}
