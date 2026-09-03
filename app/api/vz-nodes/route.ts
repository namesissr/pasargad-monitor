import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * مدیریت نودهای ویژالیزور.
 *
 * کلید و رمز ای‌پی‌آی هرگز برگردانده نمی‌شوند — فقط اینکه تنظیم شده‌اند یا
 * نه. راز باید یک‌طرفه باشد: نوشتنی، نه خواندنی.
 *
 * خود عملیات ویژالیزور اینجا انجام نمی‌شود. این مسیر فقط پیکربندی را
 * نگه می‌دارد و درخواست در صف می‌گذارد؛ کار واقعی در ورکر است تا دو
 * پیاده‌سازی از یک عملیات مخرب وجود نداشته باشد.
 */

const SELECT = `
  SELECT n.id, n.name, n.url, n.anchor_vpsid, n.max_per_run, n.is_active,
         n.last_sync_at, n.last_error,
         (n.api_key <> '' AND n.api_pass <> '') AS has_credentials,
         (SELECT COUNT(*)::int FROM ip_addresses i WHERE i.vz_node_id = n.id) AS ip_count,
         (SELECT COUNT(*)::int FROM ip_addresses i
           WHERE i.vz_node_id = n.id AND i.vz_vpsid IS NOT NULL) AS assigned_count
    FROM vz_nodes n ORDER BY n.name`;

export async function GET() {
  return handle(async () => {
    await requireUser();
    const nodes = await query(SELECT);
    return ok({ nodes });
  });
}

function clean(body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  const url = String(body.url ?? '').trim().replace(/\/+$/, '');
  const anchor = String(body.anchor_vpsid ?? '').trim();
  const maxPerRun = Number(body.max_per_run);

  if (!name) return { error: 'نام نود را وارد کنید' };
  if (!/^https?:\/\/.+/i.test(url)) return { error: 'آدرس نود باید با http یا https شروع شود' };
  if (anchor && !/^\d+$/.test(anchor)) return { error: 'شناسه وی‌پی‌اس لنگر باید عدد باشد' };

  return {
    name,
    url,
    anchor: anchor || null,
    maxPerRun: Number.isInteger(maxPerRun) && maxPerRun > 0 ? Math.min(maxPerRun, 1000) : 200,
    isActive: body.is_active !== false,
  };
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);
    const c = clean(body);
    if ('error' in c) return fail(c.error, 400);

    const key = String(body.api_key ?? '').trim();
    const pass = String(body.api_pass ?? '').trim();
    if (!key || !pass) return fail('کلید و رمز ای‌پی‌آی را وارد کنید', 400);

    const row = await queryOne<{ id: number }>(
      `INSERT INTO vz_nodes (name, url, api_key, api_pass, anchor_vpsid, max_per_run, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [c.name, c.url, key, pass, c.anchor, c.maxPerRun, c.isActive],
    );

    // کشف بی‌درنگ صف می‌شود تا کاربر بلافاصله نتیجه اتصالش را ببیند
    await query(`INSERT INTO vz_sync_queue (node_id, kind, dry_run) VALUES ($1, 'discover', TRUE)`, [
      row?.id,
    ]);

    return ok({ id: row?.id }, { status: 201 });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);
    const id = Number(body.id);
    if (!Number.isInteger(id)) return fail('شناسه نود نامعتبر است', 400);

    const c = clean(body);
    if ('error' in c) return fail(c.error, 400);

    // خالی یعنی «عوض نکن» — وگرنه هر ذخیره‌ای که رمز را دوباره نمی‌نویسد،
    // اتصال را خراب می‌کرد
    const key = String(body.api_key ?? '').trim();
    const pass = String(body.api_pass ?? '').trim();

    await query(
      `UPDATE vz_nodes
          SET name = $2, url = $3, anchor_vpsid = $4, max_per_run = $5, is_active = $6,
              api_key  = CASE WHEN $7 = '' THEN api_key  ELSE $7 END,
              api_pass = CASE WHEN $8 = '' THEN api_pass ELSE $8 END
        WHERE id = $1`,
      [id, c.name, c.url, c.anchor, c.maxPerRun, c.isActive, key, pass],
    );

    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id)) return fail('شناسه نود نامعتبر است', 400);

    // آی‌پی‌ها می‌مانند و فقط پیوندشان با نود پاک می‌شود — موجودی آی‌پی
    // نباید با حذف یک نود از بین برود
    await query('DELETE FROM vz_nodes WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}
