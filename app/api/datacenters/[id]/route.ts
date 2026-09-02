import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIRECTIONS = ['total', 'out', 'in', 'max'];

const EDITABLE: Record<string, 'text' | 'money' | 'tb' | 'int' | 'bool' | 'direction' | 'base'> = {
  name: 'text',
  country: 'text',
  city: 'text',
  website: 'text',
  contact: 'text',
  notes: 'text',
  price_per_tb: 'money',
  price_per_ip: 'money',
  included_tb: 'tb',
  included_ips: 'int',
  billing_direction: 'direction',
  tb_base: 'base',
  is_active: 'bool',
};

/** ویرایش دیتاسنتر — فقط فیلدهای فرستاده‌شده تغییر می‌کنند */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه دیتاسنتر نامعتبر است', 400);

    const body = await readJson<Record<string, unknown>>(req);
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, kind] of Object.entries(EDITABLE)) {
      if (!(key in body)) continue;
      const raw = body[key];
      let value: unknown;

      if (kind === 'money' || kind === 'tb') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return fail(`مقدار «${key}» باید عدد مثبت باشد`, 400);
        value = n;
      } else if (kind === 'int') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return fail(`مقدار «${key}» باید عدد مثبت باشد`, 400);
        value = Math.round(n);
      } else if (kind === 'bool') {
        value = Boolean(raw);
      } else if (kind === 'direction') {
        const s = String(raw);
        if (!DIRECTIONS.includes(s)) return fail('مبنای ترافیک نامعتبر است', 400);
        value = s;
      } else if (kind === 'base') {
        value = Number(raw) === 1024 ? 1024 : 1000;
      } else {
        const s = String(raw ?? '').trim();
        if (key === 'name' && !s) return fail('نام دیتاسنتر نمی‌تواند خالی باشد', 400);
        value = s === '' ? null : s;
      }

      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }

    if (!sets.length) return fail('هیچ فیلدی برای تغییر فرستاده نشده است', 400);

    values.push(id);
    const row = await queryOne<{ id: number }>(
      `UPDATE datacenters SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING id`,
      values,
    );
    if (!row) return fail('دیتاسنتر پیدا نشد', 404);

    return ok({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireUser();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return fail('شناسه دیتاسنتر نامعتبر است', 400);

    // سرورها حذف نمی‌شوند؛ فقط ارجاعشان خالی می‌شود و بدون دیتاسنتر می‌مانند.
    // هشدار می‌دهیم تا کسی به‌اشتباه قیمت‌گذاری چند سرور را از دست ندهد.
    const count = await queryOne<{ cnt: number }>(
      'SELECT COUNT(*)::int AS cnt FROM servers WHERE datacenter_id = $1',
      [id],
    );

    await query('DELETE FROM datacenters WHERE id = $1', [id]);
    return ok({ ok: true, detachedServers: count?.cnt ?? 0 });
  });
}
