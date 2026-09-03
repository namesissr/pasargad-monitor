import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';
import { listAllIps, virtualizorConfigured } from '@/lib/virtualizor';
import { runVzSync } from '@/lib/vz-sync';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** وضعیت اتصال و خلاصه مخزن — فقط خواندن، چیزی تغییر نمی‌کند */
export async function GET() {
  return handle(async () => {
    await requireUser();

    const configured = virtualizorConfigured();
    const s = await getSettings();
    const anchor = String(s.vz_anchor_vpsid || '').trim();

    const runs = await query(
      `SELECT id, started_at, dry_run, imported, attached, detached, ok, detail
         FROM vz_sync_runs ORDER BY started_at DESC LIMIT 10`,
    );

    if (!configured) {
      return ok({ configured: false, anchor, runs, summary: null });
    }

    const listing = await listAllIps({ poolId: String(s.vz_pool_id || '').trim() || undefined });
    if (!listing.ok) {
      return ok({ configured: true, anchor, runs, summary: null, error: listing.error });
    }

    const onAnchor = anchor ? listing.ips.filter((r) => r.vpsid === anchor).length : 0;
    const free = listing.ips.filter((r) => r.vpsid === '0' || r.vpsid === '').length;

    return ok({
      configured: true,
      anchor,
      runs,
      summary: {
        total: listing.ips.length,
        free,
        onAnchor,
        inUse: listing.ips.length - free - onAnchor,
      },
    });
  });
}

/**
 * اجرای همگام‌سازی.
 *
 * حالت آزمایشی پیش‌فرض است و برای اجرای واقعی باید صریح «apply: true»
 * فرستاده شود. این کار روی پنل ویژالیزور واقعی می‌نویسد.
 */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<{ apply?: boolean }>(req);
    const apply = body.apply === true;

    const report = await runVzSync({ dryRun: !apply });
    if (!report.ok) return fail(report.error || 'همگام‌سازی ناموفق بود', 502);
    return ok(report);
  });
}
