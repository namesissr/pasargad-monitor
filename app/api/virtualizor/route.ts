import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * وضعیت و صف درخواست ویژالیزور.
 *
 * هیچ تماسی با ویژالیزور از اینجا انجام نمی‌شود. درخواست در صف گذاشته
 * می‌شود و ورکر ظرف حدود بیست ثانیه برش می‌دارد.
 *
 * چرا: این عملیات روی پنل واقعی می‌نویسد و دو پیاده‌سازی از یک عملیات
 * مخرب دیر یا زود از هم واگرا می‌شوند. یک پیاده‌سازی، در ورکر.
 */

export async function GET() {
  return handle(async () => {
    await requireUser();

    const nodes = await query(
      `SELECT n.id, n.name, n.kind, n.anchor_vpsid, n.is_active, n.last_sync_at, n.last_error,
              n.bind_server_id, sv.name AS bind_server_name,
              (SELECT COUNT(*)::int FROM ip_addresses i WHERE i.vz_node_id = n.id) AS ip_count,
              (SELECT COUNT(*)::int FROM ip_addresses i
                WHERE i.vz_node_id = n.id AND i.vz_vpsid IS NOT NULL) AS assigned_count,
              (SELECT COUNT(*)::int FROM ip_addresses i
                WHERE i.vz_node_id = n.id AND i.access_watch) AS watched_count
         FROM vz_nodes n
         LEFT JOIN servers sv ON sv.id = n.bind_server_id
        ORDER BY n.name`,
    );

    const runs = await query(
      `SELECT r.id, r.node_id, n.name AS node_name, r.started_at, r.kind, r.dry_run,
              r.discovered, r.attached, r.detached, r.ok, r.detail
         FROM vz_sync_runs r
         LEFT JOIN vz_nodes n ON n.id = r.node_id
        ORDER BY r.started_at DESC LIMIT 20`,
    );

    const pending = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM vz_sync_queue WHERE taken_at IS NULL`,
    );

    return ok({ nodes, runs, pending: pending?.cnt ?? 0 });
  });
}

/** صف‌کردن یک درخواست — کشف، یا اعمال آزمایشی و واقعی */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<{ nodeId?: number; kind?: string; apply?: boolean }>(req);

    const nodeId = Number(body.nodeId);
    if (!Number.isInteger(nodeId)) return fail('نود را انتخاب کنید', 400);

    const kind = body.kind === 'apply' ? 'apply' : 'discover';
    const dryRun = kind === 'apply' ? body.apply !== true : true;

    const node = await queryOne<{
      id: number;
      anchor_vpsid: string | null;
      is_active: boolean;
      kind: string;
    }>(
      `SELECT id, anchor_vpsid, is_active, kind FROM vz_nodes WHERE id = $1`,
      [nodeId],
    );
    if (!node) return fail('نود پیدا نشد', 404);
    if (!node.is_active) return fail('این نود غیرفعال است', 400);
    if (kind === 'apply') {
      const anchor = await queryOne<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM vz_anchors WHERE node_id = $1`,
        [nodeId],
      );
      if (!anchor?.cnt) {
        return fail('برای این هایپروایزر هیچ لنگری تعریف نشده است', 400);
      }
    }

    // درخواست تکراری صف را پر نکند — کاربری که دکمه را دوبار می‌زند نباید
    // دو بار روی پنل واقعی بنویسد
    const dup = await queryOne<{ id: number }>(
      `SELECT id FROM vz_sync_queue
        WHERE node_id = $1 AND kind = $2 AND dry_run = $3 AND taken_at IS NULL`,
      [nodeId, kind, dryRun],
    );
    if (dup) return ok({ queued: false, reason: 'همین درخواست از قبل در صف است' });

    await query(`INSERT INTO vz_sync_queue (node_id, kind, dry_run) VALUES ($1, $2, $3)`, [
      nodeId,
      kind,
      dryRun,
    ]);

    return ok({ queued: true });
  });
}
