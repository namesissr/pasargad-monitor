import { queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * تأیید دیدن یا بستن دستی یک رویداد.
 * «تأیید دیدن» جلوی تکرار پیامک را می‌گیرد ولی رویداد را باز نگه می‌دارد.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const user = await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه رویداد نامعتبر است', 400);

    const { action } = await readJson<{ action?: string }>(req);

    if (action === 'ack') {
      const row = await queryOne(
        `UPDATE incidents SET ack_at = now(), ack_by = $2 WHERE id = $1 RETURNING id`,
        [id, user.uid],
      );
      if (!row) return fail('رویداد پیدا نشد', 404);
      return ok({ ok: true });
    }

    if (action === 'resolve') {
      const row = await queryOne(
        `UPDATE incidents SET resolved_at = COALESCE(resolved_at, now()) WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!row) return fail('رویداد پیدا نشد', 404);
      return ok({ ok: true });
    }

    return fail('عملیات نامشخص است. یکی از ack یا resolve', 400);
  });
}
