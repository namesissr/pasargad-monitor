import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * لنگرهای هر هایپروایزر.
 *
 * یک هایپروایزر می‌تواند چند لنگر داشته باشد، چون نودهایش ممکن است در
 * دیتاسنترهای مختلف باشند. آدرسی از یک دیتاسنتر روی لنگری در دیتاسنتر
 * دیگر هرگز روت نمی‌شود.
 *
 * هر بلوک آی‌پی به یک لنگر وصل می‌شود و آدرس‌ها لنگرشان را از بلوکشان
 * می‌گیرند. بلوک بدون لنگر به لنگر پیش‌فرض می‌رود.
 */

const SELECT = `
  SELECT a.id, a.node_id, a.name, a.anchor_vpsid, a.bind_server_id,
         a.max_per_run, a.is_default,
         n.name AS node_name, n.kind,
         s.name AS bind_server_name,
         (SELECT COUNT(*)::int FROM ip_subnets b WHERE b.anchor_id = a.id) AS block_count,
         (SELECT COUNT(*)::int FROM ip_addresses i WHERE i.anchor_id = a.id) AS ip_count
    FROM vz_anchors a
    JOIN vz_nodes n ON n.id = a.node_id
    LEFT JOIN servers s ON s.id = a.bind_server_id
   ORDER BY n.name, a.is_default DESC, a.name`;

export async function GET() {
  return handle(async () => {
    await requireUser();
    const anchors = await query(SELECT);
    return ok({ anchors });
  });
}

type Clean =
  | { ok: false; error: string }
  | {
      ok: true;
      value: {
        nodeId: number;
        name: string;
        vpsid: string;
        bindServerId: number | null;
        maxPerRun: number;
        isDefault: boolean;
      };
    };

function clean(body: Record<string, unknown>): Clean {
  const nodeId = Number(body.node_id);
  const name = String(body.name ?? '').trim();
  const vpsid = String(body.anchor_vpsid ?? '').trim();
  const maxPerRun = Number(body.max_per_run);
  const bindServerId = body.bind_server_id ? Number(body.bind_server_id) : null;

  if (!Number.isInteger(nodeId)) return { ok: false, error: 'هایپروایزر را انتخاب کنید' };
  if (!name) return { ok: false, error: 'نام لنگر را وارد کنید' };
  if (!/^\d+$/.test(vpsid)) return { ok: false, error: 'شناسه وی‌پی‌اس لنگر باید عدد باشد' };
  if (bindServerId !== null && !Number.isInteger(bindServerId)) {
    return { ok: false, error: 'سرور لنگر نامعتبر است' };
  }

  return {
    ok: true,
    value: {
      nodeId,
      name,
      vpsid,
      bindServerId,
      maxPerRun: Number.isInteger(maxPerRun) && maxPerRun > 0 ? Math.min(maxPerRun, 1000) : 200,
      isDefault: body.is_default === true,
    },
  };
}

/**
 * فقط یک لنگر پیش‌فرض برای هر هایپروایزر.
 *
 * دیتابیس با ایندکس یکتا همین را تضمین می‌کند، ولی اگر اینجا پاک نشود،
 * ذخیره با خطای پایگاه داده شکست می‌خورد و کاربر پیامی می‌بیند که به او
 * نمی‌گوید چه کند.
 */
async function clearDefault(nodeId: number, exceptId?: number) {
  await query(
    `UPDATE vz_anchors SET is_default = FALSE
      WHERE node_id = $1 AND is_default AND ($2::int IS NULL OR id <> $2)`,
    [nodeId, exceptId ?? null],
  );
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const parsed = clean(await readJson<Record<string, unknown>>(req));
    if (!parsed.ok) return fail(parsed.error, 400);
    const c = parsed.value;

    if (c.isDefault) await clearDefault(c.nodeId);

    const row = await queryOne<{ id: number }>(
      `INSERT INTO vz_anchors (node_id, name, anchor_vpsid, bind_server_id, max_per_run, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (node_id, anchor_vpsid) DO UPDATE
         SET name = EXCLUDED.name,
             bind_server_id = EXCLUDED.bind_server_id,
             max_per_run = EXCLUDED.max_per_run,
             is_default = EXCLUDED.is_default
       RETURNING id`,
      [c.nodeId, c.name, c.vpsid, c.bindServerId, c.maxPerRun, c.isDefault],
    );

    return ok({ id: row?.id }, { status: 201 });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);
    const id = Number(body.id);
    if (!Number.isInteger(id)) return fail('شناسه لنگر نامعتبر است', 400);

    const parsed = clean(body);
    if (!parsed.ok) return fail(parsed.error, 400);
    const c = parsed.value;

    if (c.isDefault) await clearDefault(c.nodeId, id);

    await query(
      `UPDATE vz_anchors
          SET name = $2, anchor_vpsid = $3, bind_server_id = $4,
              max_per_run = $5, is_default = $6
        WHERE id = $1`,
      [id, c.name, c.vpsid, c.bindServerId, c.maxPerRun, c.isDefault],
    );

    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id)) return fail('شناسه لنگر نامعتبر است', 400);

    // بلوک‌ها و آدرس‌ها می‌مانند و فقط پیوندشان پاک می‌شود (ON DELETE SET
    // NULL). بعدش به لنگر پیش‌فرض می‌روند؛ اگر پیش‌فرضی نباشد، اعمال
    // صریح گزارش می‌دهد که چند آدرس بی‌لنگر مانده.
    await query('DELETE FROM vz_anchors WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}
