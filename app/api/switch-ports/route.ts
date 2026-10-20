import { query, queryOne } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * پورت‌های سوییچ از دید سرور، و تنظیم پیوند پورت به سرور.
 *
 * GET ?server_id=  پورت‌های وصل به یک سرور، برای صفحه سرور
 * PATCH            سرور، مبنای ترافیک، محافظت و هشدار یک پورت
 *
 * PATCH فقط از حساب مدیر: «مبنای ترافیک» مستقیم روی سهمیه و حسابداری
 * اثر دارد، و «محافظت‌شده» تنها مانع خاموش‌شدن تصادفی آپلینک است.
 */

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const serverId = idParam(new URL(req.url), 'server_id');
    if (serverId === null) return fail('شناسه سرور نامعتبر است', 400);

    const ports = await query(
      `SELECT p.id, p.name, p.description, p.kind, p.admin_up, p.oper_up, p.oper_reason,
              p.speed_mbps, p.in_bps::float8 AS in_bps, p.out_bps::float8 AS out_bps,
              p.count_traffic, p.count_since, p.is_protected, p.alert_down, p.is_present,
              p.transceiver, p.last_change_at,
              w.id AS switch_id, w.name AS switch_name, w.status AS switch_status,
              COALESCE(t.in_bytes, 0)::float8  AS today_in,
              COALESCE(t.out_bytes, 0)::float8 AS today_out
         FROM switch_ports p
         JOIN switches w ON w.id = p.switch_id
         LEFT JOIN switch_port_daily t ON t.port_id = p.id AND t.day = CURRENT_DATE
        WHERE p.server_id = $1
        ORDER BY w.name, p.name`,
      [serverId],
    );
    return ok({ ports });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه پورت نامعتبر است', 400);

    const port = await queryOne<{ id: number; kind: string; count_traffic: boolean; server_id: number | null }>(
      `SELECT id, kind, count_traffic, server_id FROM switch_ports WHERE id = $1`,
      [id],
    );
    if (!port) return fail('پورت پیدا نشد', 404);

    // null و رشته خالی یعنی «بدون سرور»؛ Number(null) صفر است و نباید به
    // «سرور شماره صفر» تبدیل شود
    let serverId: number | null = null;
    if (body.server_id !== null && body.server_id !== undefined && body.server_id !== '') {
      const n = Number(body.server_id);
      if (!Number.isInteger(n) || n <= 0) return fail('سرور نامعتبر است', 400);
      const srv = await queryOne(`SELECT 1 FROM servers WHERE id = $1`, [n]);
      if (!srv) return fail('سرور پیدا نشد', 404);
      serverId = n;
    }

    const countTraffic = body.count_traffic === true;
    if (countTraffic && serverId === null) {
      return fail('برای شمردن ترافیک، اول سرور این پورت را انتخاب کنید', 400);
    }
    if (countTraffic && !['ethernet', 'port-channel'].includes(port.kind)) {
      return fail('فقط پورت اترنت یا پورت‌چنل می‌تواند مبنای ترافیک باشد', 400);
    }

    const note = String(body.note ?? '').trim().slice(0, 500) || null;

    // count_since فقط وقتی تازه روشن می‌شود یا سرورش عوض می‌شود از نو
    // تنظیم می‌شود. ساعت‌های پیش از آن عدد ایجنت را نگه می‌دارند.
    await query(
      `UPDATE switch_ports
          SET server_id     = $2,
              count_traffic = $3,
              count_since   = CASE
                                WHEN NOT $3 THEN NULL
                                WHEN count_traffic AND server_id IS NOT DISTINCT FROM $2 THEN count_since
                                ELSE now()
                              END,
              is_protected  = $4,
              alert_down    = $5,
              note          = $6,
              updated_at    = now()
        WHERE id = $1`,
      [id, serverId, countTraffic, body.is_protected === true, body.alert_down === true, note],
    );

    return ok({ ok: true });
  });
}
