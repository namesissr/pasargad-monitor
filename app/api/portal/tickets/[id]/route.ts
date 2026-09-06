import { query, queryOne } from '@/lib/db';
import { requireOwnedTicket } from '@/lib/portal-guard';
import { fail, handle, ok, readJson } from '@/lib/http';
import { addMessage, announceCustomerMessage } from '@/lib/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * گفتگوی یک تیکت، برای مشتری.
 *
 * مالکیت در requireOwnedTicket تأیید می‌شود و بعد از آن همه کوئری‌ها
 * روی همان شناسه تأییدشده کار می‌کنند — نه روی عددی که از آدرس آمده.
 *
 * شناسه همکاری که پاسخ داده برنمی‌گردد؛ مشتری «پشتیبانی» را می‌بیند نه
 * نام یک نفر. اگر همکار عوض شود، مشتری متوجه چیزی نمی‌شود.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { ticketId } = await requireOwnedTicket(params.id);

    const ticket = await queryOne(
      `SELECT t.id, t.number, t.subject, t.status, t.priority,
              t.last_reply_at, t.last_reply_by, t.created_at,
              s.id AS server_id, s.name AS server_name
         FROM tickets t
         LEFT JOIN servers s ON s.id = t.server_id
        WHERE t.id = $1`,
      [ticketId],
    );

    const messages = await query(
      `SELECT id, author, body, created_at
         FROM ticket_messages
        WHERE ticket_id = $1
        ORDER BY created_at`,
      [ticketId],
    );

    return ok({ ticket, messages });
  });
}

/** پاسخ مشتری، یا بستن تیکت */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { ticketId } = await requireOwnedTicket(params.id);
    const body = await readJson<Record<string, unknown>>(req);

    if (String(body.action ?? '') === 'close') {
      await query(
        `UPDATE tickets SET status = 'closed', updated_at = now() WHERE id = $1`,
        [ticketId],
      );
      return ok({ ok: true });
    }

    const text = String(body.body ?? '').trim().slice(0, 10_000);
    if (!text) return fail('متن پاسخ را بنویسید', 400);

    // پیام مشتری تیکت را باز می‌کند، حتی اگر بسته بوده. مشتری‌ای که
    // پیگیری می‌کند نباید مجبور شود تیکت تازه بسازد و سابقه را از هم
    // بپاشد.
    await addMessage(ticketId, 'customer', text);
    await announceCustomerMessage(ticketId, text, false);

    return ok({ ok: true });
  });
}
