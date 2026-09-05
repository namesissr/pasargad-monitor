import { query, queryOne } from '@/lib/db';
import { requireCustomer, ForbiddenError } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { paypingConfig } from '@/lib/invoices';
import { createPayment } from '@/worker/payping.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * شروع پرداخت یک فاکتور.
 *
 * مالکیت فاکتور مثل مالکیت سرور یک دروازه است: فاکتور فقط وقتی
 * برمی‌گردد که customer_id آن با نشست بخواند. بدون این، مشتری با
 * عوض‌کردن عدد آدرس، فاکتور دیگری را پرداخت می‌کند — یا بدتر، مبلغ
 * فاکتور کس دیگری را می‌بیند.
 *
 * مبلغ از همین ردیف می‌آید و هرگز از ورودی گرفته نمی‌شود.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const invoiceId = Number(params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new ForbiddenError('فاکتور پیدا نشد');
    }

    const inv = await queryOne<{
      id: number;
      number: string;
      title: string;
      status: string;
      amount_toman: number;
    }>(
      `SELECT i.id, i.number, i.title, i.status, i.amount_toman::float8 AS amount_toman
         FROM invoices i
        WHERE i.id = $1 AND i.customer_id = $2`,
      [invoiceId, customerId],
    );

    // پیام «پیدا نشد» است نه «دسترسی ندارید»: با دومی، مشتری می‌فهمد آن
    // فاکتور وجود دارد و مال کس دیگری است.
    if (!inv) throw new ForbiddenError('فاکتور پیدا نشد');

    if (inv.status === 'paid') return fail('این فاکتور قبلا پرداخت شده است', 400);
    if (inv.status === 'canceled') return fail('این فاکتور لغو شده است', 400);

    const cfg = await paypingConfig();
    if (!cfg.enabled) return fail('درگاه پرداخت هنوز فعال نشده است', 503);

    const s = await getSettings();
    const base = String(s.panel_url || '').replace(/\/+$/, '');
    if (!base) {
      return fail('آدرس عمومی پنل در تنظیمات ثبت نشده؛ بدون آن بازگشت از درگاه ممکن نیست', 503);
    }

    const customer = await queryOne<{ name: string; phone: string | null }>(
      `SELECT name, phone FROM customers WHERE id = $1`,
      [customerId],
    );

    const result = await createPayment(cfg, {
      amountToman: Number(inv.amount_toman),
      invoiceNumber: inv.number,
      description: `${inv.title} — فاکتور ${inv.number}`,
      // بازگشت به یک مسیر ای‌پی‌آی می‌رود نه به صفحه: درگاه با POST
      // برمی‌گردد و صفحه نکست POST نمی‌پذیرد. آن مسیر تأیید می‌کند و
      // بعد با ۳۰۳ به صفحه نتیجه می‌فرستد.
      returnUrl: `${base}/api/pay/return/${inv.id}`,
      payerName: customer?.name ?? null,
      payerIdentity: customer?.phone ?? null,
    });

    await query(
      `UPDATE invoices
          SET payment_code = $2, gateway = 'payping', updated_at = now()
        WHERE id = $1`,
      [inv.id, result.code],
    );

    return ok({ url: result.url });
  });
}
