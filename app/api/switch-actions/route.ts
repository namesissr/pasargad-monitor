import { query, queryOne } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';
import { SWITCH_CAN_BACKUP, SWITCH_CAN_RATE_LIMIT, SWITCH_CAN_WRITE } from '@/lib/switches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * فرمان‌های سوییچ: shut / no shut، توضیح پورت، محدودیت سرعت، و پشتیبان‌گیری
 * دستی از پیکربندی.
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
        `SELECT id, switch_id, port_id, port_name, action, value, save_config, reason, status,
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
      `SELECT id, port_id, port_name, action, value, save_config, reason, status,
              requested_by_name, requested_at, started_at, finished_at, result
         FROM switch_actions WHERE switch_id = $1
        ORDER BY requested_at DESC LIMIT 100`,
      [switchId],
    );
    return ok({ actions });
  });
}

type Action = 'shutdown' | 'no_shutdown' | 'description' | 'rate_limit' | 'backup';
const ACTIONS: Action[] = ['shutdown', 'no_shutdown', 'description', 'rate_limit', 'backup'];

/** همان قاعده worker/nxapi.mjs؛ هر چه به CLI سوییچ می‌رود «;» و خط تازه ندارد */
function cleanDescription(v: unknown, max: number): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(v ?? '').trim();
  if (/[;\r\n\t]/.test(s)) return { ok: false, error: 'توضیح نباید «;» یا خط تازه داشته باشد' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return { ok: false, error: 'توضیح نویسه کنترلی دارد' };
  if (s.length > max) return { ok: false, error: `توضیح حداکثر ${max} نویسه است` };
  return { ok: true, value: s };
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);

    const action = ACTIONS.find((a) => a === body.action);
    if (!action) return fail('عملیات نامعتبر است', 400);
    const reason = String(body.reason ?? '').trim().slice(0, 500) || null;

    if (action === 'backup') return queueBackup(body, user, reason);

    const portId = Number(body.port_id);
    if (!Number.isInteger(portId) || portId <= 0) return fail('پورت نامعتبر است', 400);

    const port = await queryOne<{
      id: number;
      switch_id: number;
      name: string;
      kind: string;
      speed_mbps: number | null;
      is_protected: boolean;
      is_present: boolean;
      switch_active: boolean;
      switch_status: string;
      protocol: string;
      if_index: number | null;
      can_write: boolean;
      can_rate_limit: boolean;
    }>(
      `SELECT p.id, p.switch_id, p.name, p.kind, p.speed_mbps, p.is_protected, p.is_present, p.if_index,
              w.is_active AS switch_active, w.status AS switch_status, w.protocol,
              ${SWITCH_CAN_WRITE} AS can_write,
              ${SWITCH_CAN_RATE_LIMIT} AS can_rate_limit
         FROM switch_ports p
         JOIN switches w ON w.id = p.switch_id
        WHERE p.id = $1`,
      [portId],
    );
    if (!port) return fail('پورت پیدا نشد', 404);
    if (!port.switch_active) return fail('سوییچ غیرفعال است', 400);
    if (!port.is_present) return fail('این پورت در آخرین خواندن سوییچ نبود', 400);
    if (!['ethernet', 'port-channel'].includes(port.kind)) {
      return fail('از پنل فقط روی پورت اترنت و پورت‌چنل فرمان اجرا می‌شود', 400);
    }
    if (!port.can_write) {
      return fail(
        'برای این سوییچ اجازه نوشتن تنظیم نشده. در SNMP v2c کامیونیتی نوشتنی، و در v3 «اجازه نوشتن» را در ویرایش سوییچ بدهید.',
        400,
      );
    }
    if (port.protocol === 'snmp' && !port.if_index) {
      return fail('شماره اینترفیس این پورت هنوز خوانده نشده؛ پس از خواندن بعدی سوییچ دوباره تلاش کنید', 400);
    }
    if (action === 'shutdown' && port.is_protected) {
      return fail('این پورت محافظت‌شده است. اگر واقعا باید خاموش شود، اول محافظت را بردارید.', 400);
    }

    let value: string | null = null;
    if (action === 'description') {
      // ifAlias در SNMP حداکثر ۶۴ نویسه است
      const d = cleanDescription(body.value, port.protocol === 'snmp' ? 64 : 254);
      if (!d.ok) return fail(d.error, 400);
      value = d.value;
    }
    if (action === 'rate_limit') {
      if (!port.can_rate_limit) return fail('محدودیت سرعت فقط برای سوییچ NX-API پشتیبانی می‌شود', 400);
      if (port.is_protected) return fail('پورت محافظت‌شده (آپلینک) محدودیت سرعت نمی‌گیرد', 400);
      const mbps = Number(body.value);
      if (!Number.isInteger(mbps) || mbps < 0 || mbps > 400_000) {
        return fail('سرعت باید عدد صحیح مگابیت بر ثانیه باشد (صفر یعنی برداشتن محدودیت)', 400);
      }
      if (mbps > 0 && port.speed_mbps && mbps >= port.speed_mbps) {
        return fail(`سرعت این پورت ${port.speed_mbps} مگابیت است؛ محدودیت باید کمتر از آن باشد`, 400);
      }
      value = String(mbps);
    }

    try {
      const row = await queryOne<{ id: number }>(
        `INSERT INTO switch_actions (switch_id, port_id, port_name, action, value, save_config, reason,
                                     requested_by, requested_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [port.switch_id, port.id, port.name, action, value, body.save_config === true, reason, user.uid, user.username],
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

/** پشتیبان‌گیری دستی از پیکربندی؛ در سطح سوییچ، نه پورت */
async function queueBackup(body: Record<string, unknown>, user: { uid: number; username: string }, reason: string | null) {
  const switchId = Number(body.switch_id);
  if (!Number.isInteger(switchId) || switchId <= 0) return fail('سوییچ نامعتبر است', 400);
  const sw = await queryOne<{ is_active: boolean; can_backup: boolean }>(
    `SELECT w.is_active, ${SWITCH_CAN_BACKUP} AS can_backup FROM switches w WHERE w.id = $1`,
    [switchId],
  );
  if (!sw) return fail('سوییچ پیدا نشد', 404);
  if (!sw.is_active) return fail('سوییچ غیرفعال است', 400);
  if (!sw.can_backup) return fail('پشتیبان پیکربندی فقط برای سوییچ NX-API ممکن است', 400);
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO switch_actions (switch_id, action, reason, requested_by, requested_by_name)
       VALUES ($1, 'backup', $2, $3, $4) RETURNING id`,
      [switchId, reason, user.uid, user.username],
    );
    return ok({ id: row?.id }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return fail('پشتیبان‌گیری این سوییچ همین حالا در جریان است', 409);
    throw err;
  }
}
