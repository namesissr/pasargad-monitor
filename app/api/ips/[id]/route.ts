import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EDITABLE: Record<string, 'text' | 'int' | 'bool' | 'status'> = {
  status: 'status',
  server_id: 'int',
  subnet_id: 'int',
  customer: 'text',
  ptr: 'text',
  mac: 'text',
  notes: 'text',
  is_monitored: 'bool',
};

const VALID_STATUS = ['free', 'assigned', 'reserved', 'blocked', 'abuse'];

/** ویرایش آی‌پی — فقط فیلدهای فرستاده‌شده */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه آی‌پی نامعتبر است', 400);

    const body = await readJson<Record<string, unknown>>(req);
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, kind] of Object.entries(EDITABLE)) {
      if (!(key in body)) continue;
      const raw = body[key];
      let value: unknown;

      if (kind === 'status') {
        const s = String(raw);
        if (!VALID_STATUS.includes(s)) return fail('وضعیت آی‌پی نامعتبر است', 400);
        value = s;
      } else if (kind === 'int') {
        value = raw === null || raw === '' ? null : Number(raw);
        if (value !== null && !Number.isFinite(value as number)) return fail(`مقدار «${key}» باید عدد باشد`, 400);
      } else if (kind === 'bool') {
        value = Boolean(raw);
      } else {
        const s = String(raw ?? '').trim();
        value = s === '' ? null : s;
      }

      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }

    if (!sets.length) return fail('هیچ فیلدی برای تغییر فرستاده نشده است', 400);

    values.push(id);
    const row = await queryOne<{ id: number }>(
      `UPDATE ip_addresses SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING id`,
      values,
    );
    if (!row) return fail('آی‌پی پیدا نشد', 404);

    return ok({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه آی‌پی نامعتبر است', 400);
    await query('DELETE FROM ip_addresses WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}
