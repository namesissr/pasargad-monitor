import { query, queryOne } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * shut / no shut پورت سوییچ.
 *
 * این مسیر فرمان را اجرا نمی‌کند؛ فقط در صف می‌گذارد و ورکر ظرف چند ثانیه
 * اجرایش می‌کند، سپس وضعیت واقعی پورت را از سوییچ می‌خواند. رابط با
 * GET ?id= نتیجه را دنبال می‌کند.
 *
 * فقط مدیر. همه شرط‌ها اینجا بررسی می‌شوند تا خطا فوری دیده شود، و در
 * ورکر دوباره، چون بین ثبت و اجرا چیزی ممکن است عوض شده باشد.
 */

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const id = idParam(url, 'id');
    if (id !== null) {
      const action = await queryOne(
        `SELECT id, switch_id, port_id, port_name, action, save_config, reason, status,
                requested_by_name, requested_at, started_at, finished_at, result
           FROM switch_actions WHERE id = $1`,
        [id],
      );
      if (!action) return fail('درخواست پیدا نشد', 404);
      return ok({ action });
    }

    const switchId = idParam(url, 'switch_id');
    if (switchId === null) return fail('شناسه سوییچ نامعتبر است', 400);
    const actions = await query(
      `SELECT id, port_id, port_name, action, save_config, reason, status,
              requested_by_name, requested_at, started_at, finished_at, result
         FROM switch_actions WHERE switch_id = $1
        ORDER BY requested_at DESC LIMIT 100`,
      [switchId],
    );
    return ok({ actions });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);

    const portId = Number(body.port_id);
    if (!Number.isInteger(portId) || portId <= 0) return fail('پورت نامعتبر است', 400);
    const action = body.action === 'shutdown' ? 'shutdown' : body.action === 'no_shutdown' ? 'no_shutdown' : null;
    if (!action) return fail('عملیات باید shutdown یا no_shutdown باشد', 400);

    const port = await queryOne<{
      id: number;
      switch_id: number;
      name: string;
      kind: string;
      is_protected: boolean;
      is_present: boolean;
      switch_active: boolean;
      switch_status: string;
    }>(
      `SELECT p.id, p.switch_id, p.name, p.kind, p.is_protected, p.is_present,
              w.is_active AS switch_active, w.status AS switch_status
         FROM switch_ports p
         JOIN switches w ON w.id = p.switch_id
        WHERE p.id = $1`,
      [portId],
    );
    if (!port) return fail('پورت پیدا نشد', 404);
    if (!port.switch_active) return fail('سوییچ غیرفعال است', 400);
    if (!port.is_present) return fail('این پورت در آخرین خواندن سوییچ نبود', 400);
    if (!['ethernet', 'port-channel'].includes(port.kind)) {
      return fail('از پنل فقط پورت اترنت و پورت‌چنل خاموش و روشن می‌شود', 400);
    }
    if (action === 'shutdown' && port.is_protected) {
      return fail('این پورت محافظت‌شده است. اگر واقعا باید خاموش شود، اول محافظت را بردارید.', 400);
    }

    const reason = String(body.reason ?? '').trim().slice(0, 500) || null;

    try {
      const row = await queryOne<{ id: number }>(
        `INSERT INTO switch_actions (switch_id, port_id, port_name, action, save_config, reason,
                                     requested_by, requested_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [port.switch_id, port.id, port.name, action, body.save_config === true, reason, user.uid, user.username],
      );
      return ok({ id: row?.id }, { status: 201 });
    } catch (err) {
      // ایندکس یکتای درخواست باز
      if ((err as { code?: string }).code === '23505') {
        return fail('برای این پورت یک درخواست دیگر در حال اجراست', 409);
      }
      throw err;
    }
  });
}
