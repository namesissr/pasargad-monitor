import { query, queryOne } from '@/lib/db';
import { fail, ok, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ارتباط دیدبان‌ها با پنل — برای پایش «ایران اکسس».
 *
 * جهت فیلترینگ زیرساخت برعکس شهود اولیه است:
 *   آی‌پی اکسس‌شده از داخل ایران پینگ می‌دهد ولی از خارج نه.
 *
 * پس قاعده تصمیم:
 *   دیدبان خارج جواب گرفت (۳ بار پیاپی)          → آزاد شد
 *   همه دیدبان‌های خارج ۳ بار پیاپی جواب نگرفتند
 *     و دیدبان داخل ایران جواب گرفت              → در اکسس
 *     و داخل هم جواب نگرفت ولی بایند شده         → روت نشده
 *     و بایند هم نشده                            → نامشخص
 *
 * تفکیک «در اکسس» از «روت نشده» حیاتی است. موفقیت «ip addr add» هیچ
 * اثباتی نیست: تقریباً همیشه موفق می‌شود، حتی وقتی دیتاسنتر بلوک را به آن
 * سرور روت نکرده. اگر آن را نشانه زنده‌بودن بگیریم، آی‌پی روت‌نشده تا ابد
 * «در اکسس» گزارش می‌شود و آزادشدنش هرگز دیده نمی‌شود — چون از اول هم از
 * هیچ‌جا در دسترس نبود.
 *
 * پیامد: دیدبان داخل ایران اختیاری نیست. بدون آن، «در اکسس» و «روت نشده»
 * از هم قابل تشخیص نیستند و همه در حالت «روت نشده» می‌مانند.
 *
 * این مسیر مثل ingest بیرون از نگهبان نشست است و با توکن دیدبان احراز
 * می‌شود. تشخیص تغییر وضعیت همین‌جا انجام می‌شود، نه در ورکر — تا فاصله‌ای
 * بین رسیدن نتیجه و اعلام نباشد.
 */

const STREAK = 3;               // چند بررسی پیاپی تا تغییر وضعیت
const FRESH_WINDOW = '2 hours'; // نتیجه قدیمی‌تر از این در تصمیم نمی‌آید
const PROBE_INTERVAL = 600;     // فاصله پیشنهادی بررسی دیدبان، ثانیه

type ProbeRow = { id: number; name: string; location: string };

async function authProbe(req: Request): Promise<ProbeRow | null> {
  const url = new URL(req.url);
  const token = (req.headers.get('x-probe-token') || url.searchParams.get('token') || '').trim();
  if (!token) return null;
  const probe = await queryOne<ProbeRow>(
    `UPDATE probes SET last_seen_at = now() WHERE token = $1 AND is_active
     RETURNING id, name, location`,
    [token],
  );
  return probe;
}

/** فهرست آی‌پی‌هایی که دیدبان باید بسنجد */
export async function GET(req: Request) {
  const probe = await authProbe(req);
  if (!probe) return fail('توکن دیدبان نامعتبر است', 403);

  // فقط نسخه ۴ — پینگ نسخه ۶ روی همه دیدبان‌ها یکدست نیست
  const ips = await query<{ ip: string }>(
    `SELECT host(ip) AS ip FROM ip_addresses WHERE access_watch AND version = 4 ORDER BY ip`,
  );

  return ok({ ips: ips.map((r) => r.ip), interval: PROBE_INTERVAL });
}

interface ResultRow {
  ip?: string;
  ok?: boolean;
  ms?: number | null;
  /** آدرس روی خود دیدبان بایند است — نتیجه‌اش اثبات چیزی نیست */
  local?: boolean;
}

/** دریافت نتیجه‌ها و ارزیابی تغییر وضعیت */
export async function POST(req: Request) {
  try {
    const probe = await authProbe(req);
    if (!probe) return fail('توکن دیدبان نامعتبر است', 403);

    const body = await readJson<{ results?: ResultRow[] }>(req);
    const results = Array.isArray(body.results) ? body.results : [];
    if (!results.length) return ok({ ok: true, evaluated: 0 });
    if (results.length > 20_000) return fail('تعداد نتیجه‌ها بیش از حد است', 400);

    // یک جست‌وجوی دسته‌ای به‌جای یکی به‌ازای هر آدرس. با هزاران آی‌پی،
    // حلقه قبلی دو کوئری در هر آدرس می‌زد — یعنی هزاران رفت‌وبرگشت در
    // هر دور، هر ده دقیقه.
    const seen = new Set<string>();
    const wanted: string[] = [];
    for (const r of results) {
      const ipText = String(r.ip ?? '').trim();
      if (ipText && !seen.has(ipText)) {
        seen.add(ipText);
        wanted.push(ipText);
      }
    }

    const known = await query<{ id: number; ip: string }>(
      `SELECT id, host(ip) AS ip FROM ip_addresses WHERE access_watch AND ip = ANY($1::inet[])`,
      [wanted],
    );
    const byIp = new Map(known.map((k) => [k.ip, k.id]));

    const ids: number[] = [];
    const oks: (boolean | null)[] = [];
    const times: (number | null)[] = [];
    const skipped: string[] = [];

    for (const r of results) {
      const ipText = String(r.ip ?? '').trim();
      if (!ipText) continue;
      const id = byIp.get(ipText);
      if (id === undefined) {
        // این حالت قبلاً «catch(() => null)» بود و بی‌صدا رد می‌شد: پست با
        // کد ۲۰۰ برمی‌گشت و هیچ ردیفی ثبت نمی‌شد، بدون سرنخ در هیچ لاگی.
        skipped.push(ipText);
        continue;
      }
      ids.push(id);
      // پینگ به آدرسی که روی خود دیدبان بایند است از لوپ‌بک رد می‌شود و
      // همیشه موفق است. NULL یعنی «نتیجه‌ای که نباید قضاوت شود» و در
      // شمارش پیاپی هم صفر می‌ماند.
      oks.push(r.local === true ? null : r.ok === true);
      times.push(Number.isFinite(Number(r.ms)) ? Number(r.ms) : null);
    }

    if (ids.length) {
      await query(
        `INSERT INTO ip_probe_state (ip_id, probe_id, ok, ms, ok_streak, fail_streak, checked_at)
         SELECT u.ip_id, $1, u.ok, u.ms,
                CASE WHEN u.ok IS TRUE  THEN 1 ELSE 0 END,
                CASE WHEN u.ok IS FALSE THEN 1 ELSE 0 END,
                now()
           FROM unnest($2::int[], $3::boolean[], $4::real[]) AS u(ip_id, ok, ms)
         ON CONFLICT (ip_id, probe_id) DO UPDATE SET
           ok          = EXCLUDED.ok,
           ms          = EXCLUDED.ms,
           checked_at  = now(),
           ok_streak   = CASE WHEN EXCLUDED.ok IS NULL THEN 0
                              WHEN EXCLUDED.ok THEN ip_probe_state.ok_streak + 1
                              ELSE 0 END,
           fail_streak = CASE WHEN EXCLUDED.ok IS NULL THEN 0
                              WHEN EXCLUDED.ok THEN 0
                              ELSE ip_probe_state.fail_streak + 1 END`,
        [probe.id, ids, oks, times],
      );
    }

    const touched = ids;

    const transitions = await evaluate(Array.from(new Set(touched)));
    await announce(transitions);
    await queueRelease(transitions);

    if (skipped.length) {
      console.error('[probe] آدرس‌های ثبت‌نشده یا بدون تیک پایش:', skipped.join(', '));
    }

    return ok({
      ok: true,
      evaluated: touched.length,
      skipped: skipped.length,
      transitions: transitions.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطای ناشناخته';
    console.error('[probe]', message);
    return fail(`ثبت نتیجه دیدبان انجام نشد: ${message}`, 500);
  }
}

interface Transition {
  ipId: number;
  ip: string;
  from: string;
  to: 'blocked' | 'released';
  blockedDays: number | null;
}

/**
 * صف‌کردن اعمال برای آی‌پی‌های تازه‌آزادشده.
 *
 * آی‌پی که «آزاد شد» می‌گیرد تا وقتی از وی‌پی‌اس لنگر برداشته نشود عملا
 * اشغال است و برای ساخت سرور تازه قابل استفاده نیست. منتظر ماندن تا
 * چرخه بعدی یا کلیک ادمین یعنی ساعت‌ها یا روزها اشغال بی‌مورد.
 *
 * پس همان لحظه یک درخواست اعمال برای نود همان آی‌پی در صف می‌رود؛ ورکر
 * ظرف حدود بیست ثانیه برش می‌دارد.
 *
 * سه شرط: تنظیم vz_auto_apply روشن باشد، نود شناسه لنگر داشته باشد، و
 * درخواست مشابهی از قبل در صف نباشد — وگرنه چند آزادشدن همزمان چند
 * نوشتن تکراری روی ویژالیزور می‌ساخت.
 */
async function queueRelease(transitions: Transition[]): Promise<void> {
  const released = transitions.filter((t) => t.to === 'released').map((t) => t.ipId);
  if (!released.length) return;

  const s = await getSettings();
  if (s.vz_auto_apply === 'false') return;

  const queued = await query<{ node_id: number }>(
    `INSERT INTO vz_sync_queue (node_id, kind, dry_run)
     SELECT DISTINCT i.vz_node_id, 'apply', FALSE
       FROM ip_addresses i
       JOIN vz_nodes n ON n.id = i.vz_node_id
      WHERE i.id = ANY($1::int[])
        AND n.is_active
        AND EXISTS (SELECT 1 FROM vz_anchors a WHERE a.node_id = n.id)
        AND NOT EXISTS (
          SELECT 1 FROM vz_sync_queue q
           WHERE q.node_id = i.vz_node_id AND q.kind = 'apply'
             AND NOT q.dry_run AND q.taken_at IS NULL
        )
     RETURNING node_id`,
    [released],
  ).catch((e) => {
    console.error('[probe] صف‌کردن اعمال ناموفق:', e instanceof Error ? e.message : e);
    return [] as { node_id: number }[];
  });

  if (queued.length) {
    console.log(
      `[probe] ${released.length} آی‌پی آزاد شد؛ اعمال برای ${queued.length} نود در صف رفت`,
    );
  }
}

/** ارزیابی وضعیت آی‌پی‌های تازه‌گزارش‌شده */
async function evaluate(ipIds: number[]): Promise<Transition[]> {
  const out: Transition[] = [];

  for (const ipId of ipIds) {
    const ip = await queryOne<{
      id: number;
      ip: string;
      iran_access_status: string;
      bind_ok: boolean | null;
      bind_routed: boolean | null;
      blocked_days: number | null;
    }>(
      `SELECT id, host(ip) AS ip, iran_access_status, bind_ok, bind_routed,
              EXTRACT(EPOCH FROM (now() - access_blocked_since))::float8 / 86400 AS blocked_days
         FROM ip_addresses WHERE id = $1`,
      [ipId],
    );
    if (!ip) continue;

    const states = await query<{ location: string; ok: boolean | null; ok_streak: number; fail_streak: number }>(
      `SELECT p.location, s.ok, s.ok_streak, s.fail_streak
         FROM ip_probe_state s
         JOIN probes p ON p.id = s.probe_id AND p.is_active
        WHERE s.ip_id = $1 AND s.checked_at > now() - $2::interval`,
      [ipId, FRESH_WINDOW],
    );

    const outside = states.filter((s) => s.location === 'outside');
    if (!outside.length) continue; // بدون دیدبان خارج، قضاوتی ممکن نیست

    const releasedNow = outside.some((s) => s.ok_streak >= STREAK);
    const allOutsideDown = outside.every((s) => s.fail_streak >= STREAK);
    const aliveInside = states.some((s) => s.location === 'inside' && s.ok === true);

    let target = ip.iran_access_status;
    if (releasedNow) {
      target = 'released';
    } else if (allOutsideDown) {
      // دو نشانه معتبر برای زنده و روت بودن:
      //   ۱. دیدبان داخل ایران از یک ماشین دیگر جواب گرفته باشد
      //   ۲. تست روت لنگر موفق باشد — پینگ به گیت‌وی با مبدأ همین آدرس
      // موفقیت خود «ip addr add» نشانه نیست؛ تقریباً همیشه موفق می‌شود.
      if (aliveInside || ip.bind_routed === true) target = 'blocked';
      else if (ip.bind_ok === true) target = 'unreachable';
      else target = 'unknown';
    }

    if (target === ip.iran_access_status) continue;

    if (target === 'unreachable') {
      await query(
        `UPDATE ip_addresses SET iran_access_status = 'unreachable', updated_at = now() WHERE id = $1`,
        [ipId],
      );
      continue;
    }

    if (target === 'released') {
      // پایش خاموش می‌شود تا لنگر آدرس را رها کند و برای سرور دیگری قابل
      // استفاده شود. بدون این، آی‌پی آزادشده روی وی‌پی‌اس ایران می‌ماند —
      // یعنی همان کاری که کل این بخش برایش ساخته شده ناتمام می‌ماند.
      // ردیف در فیلتر «آزادشده‌ها» می‌ماند؛ آن فیلتر به access_watch وابسته نیست.
      await query(
        `UPDATE ip_addresses
            SET iran_access_status = 'released', access_released_at = now(),
                access_watch = FALSE, updated_at = now()
          WHERE id = $1`,
        [ipId],
      );
      out.push({ ipId, ip: ip.ip, from: ip.iran_access_status, to: 'released', blockedDays: ip.blocked_days });
    } else if (target === 'blocked') {
      // ساعت اکسس فقط وقتی از نو شروع می‌شود که آی‌پی قبلاً آزاد شده بود.
      // گذر از «روت نشده» به «در اکسس» یعنی تازه توانستیم بسنجیمش، نه
      // اینکه تازه اکسس شده باشد — ریست کردن تاریخ، مدت اکسس را دروغ می‌کرد.
      await query(
        `UPDATE ip_addresses SET iran_access_status = 'blocked',
                access_blocked_since = CASE WHEN $2 = 'released' OR access_blocked_since IS NULL
                                            THEN now() ELSE access_blocked_since END,
                access_released_at = NULL, updated_at = now()
          WHERE id = $1`,
        [ipId, ip.iran_access_status],
      );
      out.push({ ipId, ip: ip.ip, from: ip.iran_access_status, to: 'blocked', blockedDays: null });
    } else {
      await query(`UPDATE ip_addresses SET iran_access_status = 'unknown', updated_at = now() WHERE id = $1`, [ipId]);
    }
  }

  return out;
}

/**
 * اعلام تغییرها: یک پیامک گروهی برای هر جهت، و یک رویداد بسته برای تاریخچه.
 *
 * رویداد از قبل بسته ثبت می‌شود چون سازوکار تکرار پیامک ورکر برای مشکل باز
 * است؛ اکسس‌شدن دو ماه طول می‌کشد و یادآوری مکررش فقط هشدارها را بی‌ارزش
 * می‌کند. هر تغییر یک بار اعلام می‌شود و در صفحه رویدادها می‌ماند.
 */
async function announce(transitions: Transition[]): Promise<void> {
  if (!transitions.length) return;

  const released = transitions.filter((t) => t.to === 'released');
  const blocked = transitions.filter((t) => t.to === 'blocked');

  for (const t of transitions) {
    const message =
      t.to === 'released'
        ? `آی‌پی ${t.ip} از اکسس درآمد${t.blockedDays ? ` (پس از ${Math.round(t.blockedDays)} روز)` : ''}.`
        : `آی‌پی ${t.ip} اکسس شد — دسترسی بین‌الملل بسته شد.`;
    await query(
      `INSERT INTO incidents (ip_id, kind, severity, message, started_at, resolved_at, notified_at)
       VALUES ($1, $2, 'warning', $3, now(), now(), now())`,
      [t.ipId, t.to === 'released' ? 'ip_access_released' : 'ip_access_blocked', message],
    ).catch((e) => console.error('[probe] ثبت رویداد ناموفق:', e.message));
  }

  const list = (items: Transition[]) => {
    const shown = items.slice(0, 8).map((t) => t.ip).join('، ');
    const more = items.length > 8 ? ` و ${items.length - 8} مورد دیگر` : '';
    return shown + more;
  };

  if (released.length) {
    await notify(
      `پاسارگاد میزبان — ${released.length} آی‌پی از اکسس درآمد و قابل استفاده است:\n${list(released)}`,
    ).catch((e) => console.error('[probe] پیامک آزادشدن ناموفق:', e.message));
  }
  if (blocked.length) {
    await notify(`پاسارگاد میزبان — ${blocked.length} آی‌پی اکسس شد:\n${list(blocked)}`).catch((e) =>
      console.error('[probe] پیامک اکسس ناموفق:', e.message),
    );
  }
}
