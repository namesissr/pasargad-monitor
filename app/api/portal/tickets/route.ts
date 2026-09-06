import { query, queryOne } from '@/lib/db';
import { requireCustomer, ForbiddenError } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { getSettings } from '@/lib/settings';
import { addMessage, announceCustomerMessage, nextTicketNumber } from '@/lib/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * تیکت‌های مشتری.
 *
 * وضعیت از دید ماست: open یعنی نوبت پاسخ ماست. در پرتال با برچسب
 * «در انتظار پاسخ» و «پاسخ داده شد» نشان داده می‌شود تا برای مشتری
 * معنی داشته باشد.
 */
export async function GET() {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const tickets = await query(
      `SELECT t.id, t.number, t.subject, t.status, t.priority,
              t.last_reply_at, t.last_reply_by, t.created_at,
              s.id AS server_id, s.name AS server_name,
              COALESCE(m.cnt, 0)::int AS message_count
         FROM tickets t
         LEFT JOIN servers s ON s.id = t.server_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS cnt FROM ticket_messages x WHERE x.ticket_id = t.id
         ) m ON TRUE
        WHERE t.customer_id = $1
        ORDER BY t.last_reply_at DESC
        LIMIT 200`,
      [customerId],
    );

    // سرورهای مشتری، تا بتواند تیکت را به یکی وصل کند
    const servers = await query(
      `SELECT id, name FROM servers WHERE customer_id = $1 AND is_active ORDER BY name`,
      [customerId],
    );

    const s = await getSettings();
    return ok({ tickets, servers, enabled: s.tickets_enabled !== 'false' });
  });
}

/** تیکت تازه */
export async function POST(req: Request) {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const s = await getSettings();
    if (s.tickets_enabled === 'false') return fail('بخش پشتیبانی در دسترس نیست', 503);

    const body = await readJson<Record<string, unknown>>(req);

    const subject = String(body.subject ?? '').trim().slice(0, 200);
    if (!subject) return fail('موضوع تیکت را بنویسید', 400);

    const text = String(body.body ?? '').trim().slice(0, 10_000);
    if (!text) return fail('متن تیکت را بنویسید', 400);

    const priority = ['low', 'normal', 'high'].includes(String(body.priority))
      ? String(body.priority)
      : 'normal';

    // سرور اختیاری است، ولی اگر داده شد باید مال همین مشتری باشد —
    // وگرنه تیکت به سرور کس دیگری وصل می‌شود و در پنل گمراه‌کننده است
    const serverIdRaw = Number(body.server_id);
    const serverId = Number.isInteger(serverIdRaw) && serverIdRaw > 0 ? serverIdRaw : null;

    if (serverId !== null) {
      const owned = await queryOne<{ id: number }>(
        `SELECT id FROM servers WHERE id = $1 AND customer_id = $2 AND is_active`,
        [serverId, customerId],
      );
      if (!owned) throw new ForbiddenError('سرور پیدا نشد');
    }

    const number = await nextTicketNumber();
    const ticket = await queryOne<{ id: number }>(
      `INSERT INTO tickets (number, customer_id, server_id, subject, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [number, customerId, serverId, subject, priority],
    );

    const ticketId = Number(ticket?.id);
    await addMessage(ticketId, 'customer', text);

    // خبر به ادمین بیرون از مسیر اصلی: شکستش نباید جلوی ثبت تیکت را
    // بگیرد. تیکت ثبت شده و همان واقعیت است.
    await announceCustomerMessage(ticketId, text, true);

    return ok({ id: ticketId, number }, { status: 201 });
  });
}
