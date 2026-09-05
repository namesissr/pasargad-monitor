import { requireCustomer } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { customerInvoices, paypingConfig } from '@/lib/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** فاکتورهای مشتری — پرداخت‌نشده و پرداخت‌شده، همه در یک فهرست */
export async function GET() {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const invoices = await customerInvoices(customerId);
    const cfg = await paypingConfig();

    // مشتری باید بداند دکمه پرداخت چرا نیست. توکن برنمی‌گردد.
    return ok({ invoices, gatewayReady: cfg.enabled });
  });
}
