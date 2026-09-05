import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['down', 'cpu', 'ram', 'disk', 'traffic', 'load'];

/** فهرست قوانین هشدار */
export async function GET() {
  return handle(async () => {
    await requireUser();
    const rules = await query(
      `SELECT r.id, r.server_id, s.name AS server_name, r.kind, r.threshold,
              r.duration_sec, r.send_sms, r.enabled, r.created_at
         FROM alert_rules r
         LEFT JOIN servers s ON s.id = r.server_id
        ORDER BY r.server_id NULLS FIRST, r.kind`,
    );
    return ok({ rules });
  });
}

/** افزودن قانون */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Record<string, unknown>>(req);

    const kind = String(b.kind ?? '');
    if (!KINDS.includes(kind)) return fail('نوع هشدار نامعتبر است', 400);

    const threshold = Number(b.threshold);
    if (!Number.isFinite(threshold)) return fail('آستانه باید عدد باشد', 400);

    const row = await queryOne<{ id: number }>(
      `INSERT INTO alert_rules (server_id, kind, threshold, duration_sec, send_sms, enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        b.server_id ? Number(b.server_id) : null,
        kind,
        threshold,
        Number(b.duration_sec) || 300,
        b.send_sms !== false,
        b.enabled !== false,
      ],
    );
    return ok({ id: row?.id }, { status: 201 });
  });
}

/** ویرایش قانون */
export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Record<string, unknown>>(req);
    const id = Number(b.id);
    if (id === null) return fail('شناسه قانون نامعتبر است', 400);

    const sets: string[] = [];
    const v: unknown[] = [];

    if ('threshold' in b) {
      const t = Number(b.threshold);
      if (!Number.isFinite(t)) return fail('آستانه باید عدد باشد', 400);
      v.push(t);
      sets.push(`threshold = $${v.length}`);
    }
    if ('duration_sec' in b) {
      v.push(Number(b.duration_sec) || 0);
      sets.push(`duration_sec = $${v.length}`);
    }
    if ('send_sms' in b) {
      v.push(Boolean(b.send_sms));
      sets.push(`send_sms = $${v.length}`);
    }
    if ('enabled' in b) {
      v.push(Boolean(b.enabled));
      sets.push(`enabled = $${v.length}`);
    }

    if (!sets.length) return fail('هیچ فیلدی برای تغییر فرستاده نشده است', 400);

    v.push(id);
    const row = await queryOne(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = $${v.length} RETURNING id`, v);
    if (!row) return fail('قانون پیدا نشد', 404);
    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = idParam(new URL(req.url), 'id');
    if (id === null) return fail('شناسه قانون نامعتبر است', 400);
    await query('DELETE FROM alert_rules WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}
