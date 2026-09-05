import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';
import { nextInvoiceNumber, settleInvoice } from '@/lib/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * مدیریت فاکتور از پنل.
 *
 * ادمین می‌تواند فاکتور دستی صادر کند (مثلاً بابت خدمتی خارج از تمدید)،
 * فاکتور را لغو کند، یا پرداخت نقدی/کارت‌به‌کارت را دستی ثبت کند.
 *
 * ثبت دستی پرداخت از همان settleInvoice می‌گذرد که تمدید سرور و
 * اطلاع‌رسانی را انجام می‌دهد — وگرنه پرداخت دستی سرویس را تمدید
 * نمی‌کرد و کسی هم متوجه نمی‌شد.
 */

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const status = url.searchParams.get('status') || '';
    const customerId = idParam(url, 'customer_id');

    const params: unknown[] = [];
    const where: string[] = [];

    if (['unpaid', 'paid', 'canceled'].includes(status)) {
      params.push(status);
      where.push(`i.status = $${params.length}`);
    }
    if (customerId !== null) {
      params.push(customerId);
      where.push(`i.customer_id = $${params.length}`);
    }

    const rows = await query(
      `SELECT i.id, i.number, i.title, i.kind, i.status,
              i.amount_toman::float8 AS amount_toman,
              i.period_from, i.period_to, i.due_at, i.paid_at, i.created_at,
              i.payment_ref, i.card_number, i.gateway, i.note,
              i.payment_error, i.last_attempt_at,
              c.id AS customer_id, c.name AS customer_name,
              s.id AS server_id, s.name AS server_name
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id
         LEFT JOIN servers s ON s.id = i.server_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY i.created_at DESC
        LIMIT 300`,
      params,
    );

    const totals = await queryOne<{ unpaid: number; paid_month: number; unpaid_count: number }>(
      `SELECT COALESCE(SUM(amount_toman) FILTER (WHERE status = 'unpaid'), 0)::float8 AS unpaid,
              COALESCE(SUM(amount_toman) FILTER (
                WHERE status = 'paid' AND paid_at >= date_trunc('month', now())
              ), 0)::float8 AS paid_month,
              COUNT(*) FILTER (WHERE status = 'unpaid')::int AS unpaid_count
         FROM invoices`,
    );

    return ok({ invoices: rows, totals });
  });
}

/** فاکتور دستی */
export async function POST(req: Request) {
  return handle(async () => {
    const session = await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const customerId = Number(body.customer_id);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return fail('مشتری را انتخاب کنید', 400);
    }

    const amount = Math.round(Number(body.amount_toman));
    if (!Number.isFinite(amount) || amount <= 0) return fail('مبلغ را وارد کنید', 400);
    if (amount > 10_000_000_000) return fail('مبلغ بیش از حد بزرگ است', 400);

    const title = String(body.title ?? '').trim();
    if (!title) return fail('عنوان فاکتور را وارد کنید', 400);

    const serverIdRaw = Number(body.server_id);
    const serverId = Number.isInteger(serverIdRaw) && serverIdRaw > 0 ? serverIdRaw : null;

    // سرور باید مال همان مشتری باشد، وگرنه فاکتور به سرور کس دیگری
    // وصل می‌شود و تمدید اشتباهی انجام می‌شود
    if (serverId !== null) {
      const owned = await queryOne<{ id: number }>(
        `SELECT id FROM servers WHERE id = $1 AND customer_id = $2`,
        [serverId, customerId],
      );
      if (!owned) return fail('این سرور به آن مشتری تعلق ندارد', 400);
    }

    const number = await nextInvoiceNumber();
    const row = await queryOne<{ id: number; number: string }>(
      `INSERT INTO invoices
         (number, customer_id, server_id, kind, title, amount_toman, due_at, note, created_by)
       VALUES ($1, $2, $3, 'manual', $4, $5, NULLIF($6,'')::date, NULLIF($7,''), $8)
       RETURNING id, number`,
      [
        number,
        customerId,
        serverId,
        title,
        amount,
        String(body.due_at ?? ''),
        String(body.note ?? '').trim(),
        session.uid,
      ],
    );

    return ok({ id: row?.id, number: row?.number }, { status: 201 });
  });
}

/** لغو فاکتور یا ثبت دستی پرداخت */
export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<{ id?: number; action?: string; note?: string }>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه فاکتور نامعتبر است', 400);

    if (body.action === 'cancel') {
      const rows = await query<{ id: number }>(
        `UPDATE invoices SET status = 'canceled', updated_at = now()
          WHERE id = $1 AND status = 'unpaid'
          RETURNING id`,
        [id],
      );
      if (!rows.length) return fail('فقط فاکتور پرداخت‌نشده لغو می‌شود', 400);
      return ok({ ok: true });
    }

    if (body.action === 'mark_paid') {
      // از همان مسیر پرداخت درگاه می‌گذرد: تمدید سرور و اطلاع‌رسانی
      // هم انجام می‌شود، نه فقط عوض‌کردن یک ستون.
      const result = await settleInvoice(id, {
        refId: null,
        paymentCode: null,
        cardNumber: null,
      });
      if (!result.ok) return fail(result.error || 'ثبت پرداخت ناموفق بود', 400);
      return ok(result);
    }

    return fail('عملیات نامعتبر است', 400);
  });
}
