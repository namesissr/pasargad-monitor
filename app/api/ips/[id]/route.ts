import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EDITABLE: Record<string, 'text' | 'int' | 'bool' | 'status' | 'prefix' | 'inet'> = {
  status: 'status',
  server_id: 'int',
  subnet_id: 'int',
  customer: 'text',
  ptr: 'text',
  mac: 'text',
  notes: 'text',
  is_monitored: 'bool',
  access_watch: 'bool',
  bind_server_id: 'int',
  bind_prefix: 'prefix',
  gateway: 'inet',
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
      } else if (kind === 'prefix') {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 8 || n > 32) {
          return fail('پرفیکس بایند باید عددی بین ۸ و ۳۲ باشد', 400);
        }
        value = n;
      } else if (kind === 'bool') {
        value = Boolean(raw);
      } else {
        const s = String(raw ?? '').trim();
        value = kind === 'inet' ? s : s === '' ? null : s;
      }

      values.push(value);
      sets.push(kind === 'inet' ? `${key} = NULLIF($${values.length}, '')::inet` : `${key} = $${values.length}`);
    }

    if (!sets.length) return fail('هیچ فیلدی برای تغییر فرستاده نشده است', 400);

    values.push(id);
    const row = await queryOne<{ id: number }>(
      `UPDATE ip_addresses SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING id`,
      values,
    );
    if (!row) return fail('آی‌پی پیدا نشد', 404);

    // با روشن‌شدن پایش، وضعیت اولیه «در اکسس» است — سناریو همین است
    if (body.access_watch === true) {
      await query(
        `UPDATE ip_addresses
            SET iran_access_status = CASE WHEN iran_access_status = 'unknown' THEN 'blocked'
                                          ELSE iran_access_status END,
                access_blocked_since = COALESCE(access_blocked_since, now())
          WHERE id = $1`,
        [id],
      );
    }
    // با خاموش‌شدن پایش، ایجنت لنگر در دور بعدی خودش آی‌پی را جدا می‌کند
    if (body.access_watch === false) {
      await query(
        `UPDATE ip_addresses SET bind_ok = NULL, bind_error = NULL WHERE id = $1`,
        [id],
      );
    }

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
