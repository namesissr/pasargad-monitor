import { requireOwnedInvoice } from '@/lib/portal-guard';
import { fail, handle, ok } from '@/lib/http';
import { customerView, invoiceDetail } from '@/lib/invoice-detail';
import { paypingConfig } from '@/lib/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * جزئیات یک فاکتور، برای مشتری.
 *
 * از همان invoiceDetail پنل می‌گذرد و بعد customerView فیلدهای داخلی را
 * حذف می‌کند — پارامترهای خام درگاه و یادداشت‌های داخلی. دو کوئری جدا
 * دیر یا زود از هم فاصله می‌گیرند.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { invoiceId } = await requireOwnedInvoice(params.id);

    const detail = await invoiceDetail(invoiceId);
    if (!detail) return fail('فاکتور پیدا نشد', 404);

    const cfg = await paypingConfig();
    return ok({ ...customerView(detail), gatewayReady: cfg.enabled });
  });
}
