import { query, queryOne } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { fail, handle, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * فهرست نسخه‌های پیکربندی ذخیره‌شده یک سوییچ.
 *
 * فقط مدیر: پیکربندی رازها را دارد. خود متن در این فهرست نیست؛ با
 * /configs/<id> و پوشیده خوانده می‌شود.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    await requireAdmin();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه سوییچ نامعتبر است', 400);

    const sw = await queryOne(
      `SELECT id, protocol, config_checked_at, config_changed_at, config_error FROM switches WHERE id = $1`,
      [id],
    );
    if (!sw) return fail('سوییچ پیدا نشد', 404);

    const versions = await query(
      `SELECT id, taken_at, size_bytes, trigger, taken_by, left(sha256, 12) AS sha
         FROM switch_configs
        WHERE switch_id = $1
        ORDER BY taken_at DESC
        LIMIT 200`,
      [id],
    );
    const pending = await queryOne(
      `SELECT id, status FROM switch_actions
        WHERE switch_id = $1 AND action = 'backup' AND status IN ('pending', 'running')`,
      [id],
    );
    return ok({ switch: sw, versions, pending });
  });
}
