import { query } from './db';
import { getSettings } from './settings';
import { listAllIps, writeVpsIps, virtualizorConfigured } from './virtualizor';

/**
 * چرخه خودکار آی‌پی‌های اکسس‌شده با ویژالیزور.
 *
 * سه گام در هر اجرا:
 *
 *   ۱. وارد کردن — آی‌پی‌های آزاد مخزن به پنل اضافه و تحت پایش می‌روند
 *   ۲. چسباندن  — آی‌پی‌های هنوز اکسس‌شده به وی‌پی‌اس لنگر تخصیص می‌یابند
 *                 تا زنده بمانند و قابل سنجش باشند
 *   ۳. آزادکردن — آی‌پی‌هایی که «آزاد شد» گرفته‌اند از لنگر برداشته و به
 *                 مخزن برمی‌گردند تا برای مشتری قابل استفاده شوند
 *
 * محافظ‌ها — هرکدام برای خطری که واقعاً می‌تواند رخ دهد:
 *
 *   • فقط وی‌پی‌اس لنگر دست می‌خورد. اگر شناسه لنگر خالی باشد هیچ نوشتنی
 *     انجام نمی‌شود.
 *   • فقط آدرسی از لنگر برداشته می‌شود که پنل خودش چسبانده باشد
 *     (managed_by_panel). آدرسی که ادمین دستی گذاشته هرگز دست نمی‌خورد.
 *   • آدرسی که در ویژالیزور به وی‌پی‌اس دیگری تخصیص یافته اصلاً وارد
 *     نمی‌شود — آن آدرس در حال استفاده است.
 *   • سقف هر اجرا. تخصیص هزار آدرس یکجا به یک وی‌پی‌اس، هم ویژالیزور را
 *     کند می‌کند هم پیکربندی شبکه مهمان را.
 *   • حالت آزمایشی پیش‌فرض است.
 */

export interface SyncReport {
  ok: boolean;
  dryRun: boolean;
  imported: number;
  attached: string[];
  detached: string[];
  skipped: string[];
  error?: string;
  /** بدنه‌ای که به ویژالیزور فرستاده می‌شد — فقط در حالت آزمایشی */
  preview?: Record<string, string>;
}

export async function runVzSync(opts: { dryRun?: boolean } = {}): Promise<SyncReport> {
  const dryRun = opts.dryRun !== false;
  const empty: SyncReport = { ok: false, dryRun, imported: 0, attached: [], detached: [], skipped: [] };

  if (!virtualizorConfigured()) {
    return { ...empty, error: 'اتصال ویژالیزور در .env تنظیم نشده است' };
  }

  const s = await getSettings();
  const anchor = String(s.vz_anchor_vpsid || '').trim();
  if (!/^\d+$/.test(anchor)) {
    return { ...empty, error: 'شناسه وی‌پی‌اس لنگر در تنظیمات وارد نشده است' };
  }

  const poolId = String(s.vz_pool_id || '').trim() || undefined;
  const cap = Math.min(Math.max(Number(s.vz_max_per_run) || 200, 1), 1000);

  const listing = await listAllIps({ poolId });
  if (!listing.ok) return { ...empty, error: listing.error };

  // وضعیت فعلی پنل. یک کوئری، نه یکی به‌ازای هر آدرس.
  const known = await query<{
    ip: string;
    iran_access_status: string;
    access_watch: boolean;
    managed_by_panel: boolean;
  }>(
    `SELECT host(ip) AS ip, iran_access_status, access_watch, managed_by_panel
       FROM ip_addresses WHERE version = 4`,
  );
  const byIp = new Map(known.map((k) => [k.ip, k]));

  const attached: string[] = [];
  const detached: string[] = [];
  const skipped: string[] = [];
  const toImport: { ip: string; ipid: string }[] = [];

  for (const row of listing.ips) {
    const panel = byIp.get(row.ip);
    const onAnchor = row.vpsid === anchor;
    const free = row.vpsid === '0' || row.vpsid === '';

    if (row.locked) {
      skipped.push(row.ip);
      continue;
    }

    // روی وی‌پی‌اس دیگری است — یعنی در حال استفاده. دست نمی‌زنیم.
    if (!free && !onAnchor) {
      skipped.push(row.ip);
      continue;
    }

    if (!panel) {
      if (free) toImport.push({ ip: row.ip, ipid: row.ipid });
      continue;
    }

    if (panel.iran_access_status === 'released') {
      // آزاد شده: اگر روی لنگر است و پنل خودش چسبانده، برداریمش
      if (onAnchor && panel.managed_by_panel) detached.push(row.ip);
      continue;
    }

    // هنوز اکسس‌شده یا نامشخص: باید روی لنگر باشد تا قابل سنجش بماند
    if (free && panel.access_watch) attached.push(row.ip);
  }

  // ورودی‌های تازه هم باید چسبانده شوند
  const importSlice = toImport.slice(0, cap);
  for (const row of importSlice) attached.push(row.ip);

  const attachSlice = attached.slice(0, cap);

  if (dryRun) {
    const preview = await writeVpsIps(anchor, [], { dryRun: true });
    return {
      ok: true,
      dryRun,
      imported: importSlice.length,
      attached: attachSlice,
      detached,
      skipped,
      preview: preview.ok ? preview.data?.sent : undefined,
      error: preview.ok ? undefined : preview.error,
    };
  }

  // ورود به پنل — پیش از تخصیص، تا اگر تخصیص شکست خورد باز هم رد داشته باشیم
  if (importSlice.length) {
    await query(
      `INSERT INTO ip_addresses (ip, version, status, access_watch, iran_access_status,
                                 access_blocked_since, vz_ipid, vz_vpsid, vz_synced_at)
       SELECT u.ip::inet, 4, 'blocked', TRUE, 'unknown', now(), u.ipid, $3, now()
         FROM unnest($1::text[], $2::text[]) AS u(ip, ipid)
       ON CONFLICT (ip) DO UPDATE
         SET vz_ipid = EXCLUDED.vz_ipid, vz_synced_at = now(), updated_at = now()`,
      [importSlice.map((r) => r.ip), importSlice.map((r) => r.ipid), anchor],
    );
  }

  // فهرست نهایی وی‌پی‌اس لنگر: آنچه باید بماند، منهای آزادشده‌ها
  const currentOnAnchor = listing.ips.filter((r) => r.vpsid === anchor).map((r) => r.ip);
  const finalList = Array.from(
    new Set([...currentOnAnchor.filter((ip) => !detached.includes(ip)), ...attachSlice]),
  );

  const write = await writeVpsIps(anchor, finalList, { dryRun: false });
  if (!write.ok) {
    await query(
      `INSERT INTO vz_sync_runs (dry_run, imported, attached, detached, ok, detail)
       VALUES (FALSE, $1, 0, 0, FALSE, $2)`,
      [importSlice.length, write.error ?? 'خطای نامشخص'],
    );
    return { ...empty, imported: importSlice.length, error: write.error };
  }

  if (attachSlice.length) {
    await query(
      `UPDATE ip_addresses SET managed_by_panel = TRUE, vz_vpsid = $2, vz_synced_at = now()
        WHERE host(ip) = ANY($1::text[])`,
      [attachSlice, anchor],
    );
  }
  if (detached.length) {
    await query(
      `UPDATE ip_addresses SET managed_by_panel = FALSE, vz_vpsid = NULL, vz_synced_at = now()
        WHERE host(ip) = ANY($1::text[])`,
      [detached],
    );
  }

  await query(
    `INSERT INTO vz_sync_runs (dry_run, imported, attached, detached, ok, detail)
     VALUES (FALSE, $1, $2, $3, TRUE, $4)`,
    [
      importSlice.length,
      attachSlice.length,
      detached.length,
      `لنگر ${anchor}: ${finalList.length} آدرس`,
    ],
  );

  return {
    ok: true,
    dryRun: false,
    imported: importSlice.length,
    attached: attachSlice,
    detached,
    skipped,
  };
}
