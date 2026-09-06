import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';
import { addMessage, announceAdminReply } from '@/lib/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * تیکت‌ها، از دید پنل.
 *
 * فهرست پیش‌فرض با «باز» شروع می‌شود و open اول می‌آید: آن‌ها کاری
 * هستند که منتظر ماست.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const status = url.searchParams.get('status') || '';
    const ticketId = idParam(url, 'id');

    // یک تیکت مشخص: گفتگوی کامل
    if (ticketId !== null) {
      const ticket = await queryOne(
        `SELECT t.id, t.number, t.subject, t.status, t.priority,
                t.last_reply_at, t.last_reply_by, t.created_at,
                c.id AS customer_id, c.name AS customer_name,
                c.phone AS customer_phone, c.email AS customer_email,
                s.id AS server_id, s.name AS server_name
           FROM tickets t
           JOIN customers c ON c.id = t.customer_id
           LEFT JOIN servers s ON s.id = t.server_id
          WHERE t.id = $1`,
        [ticketId],
      );
      if (!ticket) return fail('تیکت پیدا نشد', 404);

      const messages = await query(
        `SELECT m.id, m.author, m.body, m.created_at, u.username AS author_name
           FROM ticket_messages m
           LEFT JOIN users u ON u.id = m.author_user_id
          WHERE m.ticket_id = $1
          ORDER BY m.created_at`,
        [ticketId],
      );

      return ok({ ticket, messages });
    }

    const params: unknown[] = [];
    let where = '';
    if (['open', 'answered', 'closed'].includes(status)) {
      params.push(status);
      where = `WHERE t.status = $${params.length}`;
    }

    const tickets = await query(
      `SELECT t.id, t.number, t.subject, t.status, t.priority,
              t.last_reply_at, t.last_reply_by, t.created_at,
              c.id AS customer_id, c.name AS customer_name, c.email AS customer_email,
              s.id AS server_id, s.name AS server_name,
              COALESCE(m.cnt, 0)::int AS message_count
         FROM tickets t
         JOIN customers c ON c.id = t.customer_id
         LEFT JOIN servers s ON s.id = t.server_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS cnt FROM ticket_messages x WHERE x.ticket_id = t.id
         ) m ON TRUE
         ${where}
        ORDER BY
          -- تیکت باز اول می‌آید؛ همان است که منتظر ماست
          CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END,
          -- بین باز‌ها، اولویت بالا جلوتر
          CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
          t.last_reply_at DESC
        LIMIT 300`,
      params,
    );

    const totals = await queryOne<{ open: number; answered: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
              COUNT(*) FILTER (WHERE status = 'answered')::int AS answered
         FROM tickets`,
    );

    return ok({ tickets, totals });
  });
}

/** پاسخ ما، یا تغییر وضعیت و اولویت */
export async function PATCH(req: Request) {
  return handle(async () => {
    const session = await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه تیکت نامعتبر است', 400);

    const exists = await queryOne<{ id: number }>(`SELECT id FROM tickets WHERE id = $1`, [id]);
    if (!exists) return fail('تیکت پیدا نشد', 404);

    const action = String(body.action ?? 'reply');

    if (action === 'status') {
      const status = String(body.status ?? '');
      if (!['open', 'answered', 'closed'].includes(status)) {
        return fail('وضعیت نامعتبر است', 400);
      }
      await query(`UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
      return ok({ ok: true });
    }

    if (action === 'priority') {
      const priority = String(body.priority ?? '');
      if (!['low', 'normal', 'high'].includes(priority)) {
        return fail('اولویت نامعتبر است', 400);
      }
      await query(`UPDATE tickets SET priority = $2, updated_at = now() WHERE id = $1`, [
        id,
        priority,
      ]);
      return ok({ ok: true });
    }

    if (action === 'reply') {
      const text = String(body.body ?? '').trim().slice(0, 10_000);
      if (!text) return fail('متن پاسخ را بنویسید', 400);

      await addMessage(id, 'admin', text, session.uid);

      // ایمیل به مشتری. شکستش نباید جلوی ثبت پاسخ را بگیرد — پاسخ ثبت
      // شده و مشتری در پرتال می‌بیندش.
      await announceAdminReply(id, text);

      // بستن همزمان با پاسخ، برای وقتی که پاسخ نهایی است
      if (body.close === true || body.close === 'true') {
        await query(`UPDATE tickets SET status = 'closed', updated_at = now() WHERE id = $1`, [id]);
      }

      return ok({ ok: true });
    }

    return fail('عملیات نامعتبر است', 400);
  });
}
