import { queryOne } from '@/lib/db';
import { ForbiddenError, requireCustomer } from '@/lib/auth';

/**
 * مالکیت سرور، پیش از هر کوئری دیگری.
 *
 * مسیرهای پرتال که شناسه سرور می‌گیرند یک خطر مشترک دارند: مشتری عدد
 * را در آدرس عوض می‌کند و داده سرور دیگری را می‌بیند. جلوگیری از آن با
 * «یادم باشد در هر کوئری customer_id را هم بگذارم» کار نمی‌کند — دیر یا
 * زود یک کوئری بدون آن نوشته می‌شود و هیچ خطایی هم نمی‌دهد.
 *
 * پس یک دروازه: شناسه سرور فقط بعد از تأیید مالکیت برمی‌گردد. هر کوئری
 * بعدی روی همان شناسه تأییدشده کار می‌کند.
 *
 * سرور غیرفعال هم رد می‌شود؛ مشتری نباید سروری را ببیند که دیگر مال او
 * نیست.
 */
export async function requireOwnedServer(rawId: unknown): Promise<{
  customerId: number;
  serverId: number;
}> {
  const { customerId } = await requireCustomer();

  const serverId = Number(rawId);
  if (!Number.isInteger(serverId) || serverId <= 0) {
    throw new ForbiddenError('سرور پیدا نشد');
  }

  const row = await queryOne<{ id: number }>(
    `SELECT id FROM servers WHERE id = $1 AND customer_id = $2 AND is_active`,
    [serverId, customerId],
  );

  // پیام عمدا «پیدا نشد» است نه «دسترسی ندارید»: با پیام دوم، مشتری
  // می‌فهمد آن شناسه وجود دارد و مال کس دیگری است.
  if (!row) throw new ForbiddenError('سرور پیدا نشد');

  return { customerId, serverId };
}

/**
 * مالکیت تیکت، پیش از هر کوئری دیگری.
 *
 * همان دلیل requireOwnedServer: مشتری عدد را در آدرس عوض می‌کند و
 * گفتگوی پشتیبانی مشتری دیگری را می‌خواند. و برخلاف داده سرور، محتوای
 * تیکت اغلب شخصی‌تر است.
 */
export async function requireOwnedTicket(rawId: unknown): Promise<{
  customerId: number;
  ticketId: number;
}> {
  const { customerId } = await requireCustomer();

  const ticketId = Number(rawId);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    throw new ForbiddenError('تیکت پیدا نشد');
  }

  const row = await queryOne<{ id: number }>(
    `SELECT id FROM tickets WHERE id = $1 AND customer_id = $2`,
    [ticketId, customerId],
  );

  // «پیدا نشد» نه «دسترسی ندارید»: با پیام دوم، مشتری می‌فهمد آن تیکت
  // وجود دارد و مال کس دیگری است.
  if (!row) throw new ForbiddenError('تیکت پیدا نشد');

  return { customerId, ticketId };
}

/**
 * مالکیت فاکتور، پیش از هر کوئری.
 *
 * همان دلیل requireOwnedServer. فاکتور مبلغ، مشخصات هویتی و شناسه
 * پرداخت را کنار هم دارد؛ دیدن فاکتور کس دیگری بدتر از دیدن نمودار
 * مصرف اوست.
 */
export async function requireOwnedInvoice(rawId: unknown): Promise<{
  customerId: number;
  invoiceId: number;
}> {
  const { customerId } = await requireCustomer();

  const invoiceId = Number(rawId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    throw new ForbiddenError('فاکتور پیدا نشد');
  }

  const row = await queryOne<{ id: number }>(
    `SELECT id FROM invoices WHERE id = $1 AND customer_id = $2`,
    [invoiceId, customerId],
  );

  // «پیدا نشد» نه «دسترسی ندارید»: با پیام دوم، مشتری می‌فهمد آن فاکتور
  // وجود دارد و مال کس دیگری است.
  if (!row) throw new ForbiddenError('فاکتور پیدا نشد');

  return { customerId, invoiceId };
}
