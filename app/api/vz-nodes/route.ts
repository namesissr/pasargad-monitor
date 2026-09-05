import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

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
  SELECT n.id, n.name, n.url, n.kind, n.anchor_vpsid, n.max_per_run, n.is_active,
         n.bind_server_id, n.auto_watch_free, s.name AS bind_server_name,
         n.last_sync_at, n.last_error,
         (n.api_key <> '' AND n.api_pass <> '') AS has_credentials,
         (SELECT COUNT(*)::int FROM ip_addresses i WHERE i.vz_node_id = n.id) AS ip_count,
         (SELECT COUNT(*)::int FROM ip_addresses i
           WHERE i.vz_node_id = n.id AND i.vz_vpsid IS NOT NULL) AS assigned_count
    FROM vz_nodes n
    LEFT JOIN servers s ON s.id = n.bind_server_id
   ORDER BY n.name`;

export async function GET() {
  return handle(async () => {
    await requireUser();
    const nodes = await query(SELECT);
    return ok({ nodes });
  });
}

/**
 * یونیون تفکیک‌شده با تگ صریح.
 *
 * دو تلاش قبلی شکست خورد و هر دو درس دارند:
 *
 *   بدون تایپ صریح، تایپ‌اسکریپت دو شاخه را طوری یکی می‌کند که
 *   «'error' in c» باریکش نمی‌کند.
 *
 *   با تایپ صریح ولی بدون تگ، «if (parsed.error)» هم کافی نیست: چون
 *   «error» از نوع string است و رشته خالی هم string است، شاخه خطا با
 *   بررسی درستی حذف نمی‌شود و «value» همچنان ممکن است undefined باشد.
 *
 * تگ بولی «ok» هر دو مشکل را حل می‌کند چون مقدارش literal است.
 */
type CleanResult =
  | { ok: false; error: string }
  | {
      ok: true;
      value: {
        name: string;
        url: string;
        kind: string;
        anchor: string | null;
        maxPerRun: number;
        isActive: boolean;
        bindServerId: number | null;
        autoWatch: boolean;
      };
    };

function clean(body: Record<string, unknown>): CleanResult {
  const name = String(body.name ?? '').trim();
  const url = String(body.url ?? '').trim().replace(/\/+$/, '');
  const kind = body.kind === 'solusvm2' ? 'solusvm2' : 'virtualizor';
  const anchor = String(body.anchor_vpsid ?? '').trim();
  const maxPerRun = Number(body.max_per_run);

  if (!name) return { ok: false, error: 'نام نود را وارد کنید' };
  if (!/^https?:\/\/.+/i.test(url)) {
    return { ok: false, error: 'آدرس نود باید با http یا https شروع شود' };
  }
  if (anchor && !/^\d+$/.test(anchor)) {
    return { ok: false, error: 'شناسه وی‌پی‌اس لنگر باید عدد باشد' };
  }

  const bindServerId = body.bind_server_id ? Number(body.bind_server_id) : null;
  if (bindServerId !== null && !Number.isInteger(bindServerId)) {
    return { ok: false, error: 'سرور لنگر نامعتبر است' };
  }

  return {
    ok: true,
    value: {
      name,
      url,
      kind,
      anchor: anchor || null,
      maxPerRun: Number.isInteger(maxPerRun) && maxPerRun > 0 ? Math.min(maxPerRun, 1000) : 200,
      isActive: body.is_active !== false,
      bindServerId,
      autoWatch: body.auto_watch_free !== false,
    },
  };
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = clean(body);
    if (!parsed.ok) return fail(parsed.error, 400);
    const c = parsed.value;

    const key = String(body.api_key ?? '').trim();
    const pass = String(body.api_pass ?? '').trim();
    if (!key) return fail('کلید ای‌پی‌آی را وارد کنید', 400);
    // سولوس‌وی‌ام فقط توکن دارد؛ رمز جدا ندارد
    if (c.kind === 'virtualizor' && !pass) {
      return fail('رمز ای‌پی‌آی را وارد کنید', 400);
    }

    const row = await queryOne<{ id: number }>(
      `INSERT INTO vz_nodes (name, url, kind, api_key, api_pass, anchor_vpsid, max_per_run,
                             is_active, bind_server_id, auto_watch_free)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [c.name, c.url, c.kind, key, pass, c.anchor, c.maxPerRun, c.isActive, c.bindServerId, c.autoWatch],
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
    if (id === null) return fail('شناسه نود نامعتبر است', 400);

    const parsed = clean(body);
    if (!parsed.ok) return fail(parsed.error, 400);
    const c = parsed.value;

    // خالی یعنی «عوض نکن» — وگرنه هر ذخیره‌ای که رمز را دوباره نمی‌نویسد،
    // اتصال را خراب می‌کرد
    const key = String(body.api_key ?? '').trim();
    const pass = String(body.api_pass ?? '').trim();

    await query(
      `UPDATE vz_nodes
          SET name = $2, url = $3, anchor_vpsid = $4, max_per_run = $5, is_active = $6,
              bind_server_id = $9, auto_watch_free = $10, kind = $11,
              api_key  = CASE WHEN $7 = '' THEN api_key  ELSE $7 END,
              api_pass = CASE WHEN $8 = '' THEN api_pass ELSE $8 END
        WHERE id = $1`,
      [id, c.name, c.url, c.anchor, c.maxPerRun, c.isActive, key, pass, c.bindServerId, c.autoWatch, c.kind],
    );

    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = idParam(new URL(req.url), 'id');
    if (id === null) return fail('شناسه نود نامعتبر است', 400);

    // آی‌پی‌ها می‌مانند و فقط پیوندشان با نود پاک می‌شود — موجودی آی‌پی
    // نباید با حذف یک نود از بین برود
    await query('DELETE FROM vz_nodes WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}
