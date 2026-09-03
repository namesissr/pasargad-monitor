import { query, queryOne } from '@/lib/db';
import { fail, ok, readJson } from '@/lib/http';
import { notifyAll } from '@/lib/sms';

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

    const touched: number[] = [];

    for (const r of results) {
      const ipText = String(r.ip ?? '').trim();
      if (!ipText) continue;
      const isOk = r.ok === true;

      const row = await queryOne<{ id: number }>(
        `SELECT id FROM ip_addresses WHERE ip = $1::inet AND access_watch`,
        [ipText],
      ).catch(() => null);
      if (!row) continue;

      await query(
        `INSERT INTO ip_probe_state (ip_id, probe_id, ok, ms, ok_streak, fail_streak, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (ip_id, probe_id) DO UPDATE SET
           ok          = EXCLUDED.ok,
           ms          = EXCLUDED.ms,
           checked_at  = now(),
           ok_streak   = CASE WHEN EXCLUDED.ok THEN ip_probe_state.ok_streak + 1 ELSE 0 END,
           fail_streak = CASE WHEN EXCLUDED.ok THEN 0 ELSE ip_probe_state.fail_streak + 1 END`,
        [row.id, probe.id, isOk, Number.isFinite(Number(r.ms)) ? Number(r.ms) : null, isOk ? 1 : 0, isOk ? 0 : 1],
      );
      touched.push(row.id);
    }

    const transitions = await evaluate(Array.from(new Set(touched)));
    await announce(transitions);

    return ok({ ok: true, evaluated: touched.length, transitions: transitions.length });
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

/** ارزیابی وضعیت آی‌پی‌های تازه‌گزارش‌شده */
async function evaluate(ipIds: number[]): Promise<Transition[]> {
  const out: Transition[] = [];

  for (const ipId of ipIds) {
    const ip = await queryOne<{
      id: number;
      ip: string;
      iran_access_status: string;
      bind_ok: boolean | null;
      blocked_days: number | null;
    }>(
      `SELECT id, host(ip) AS ip, iran_access_status, bind_ok,
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
      // فقط دیدبان داخل ایران می‌تواند اکسس‌بودن را اثبات کند. بایند
      // موفق چیزی را ثابت نمی‌کند جز اینکه آدرس روی کارت نشسته.
      if (aliveInside) target = 'blocked';
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
      await query(
        `UPDATE ip_addresses SET iran_access_status = 'released', access_released_at = now(), updated_at = now()
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
    await notifyAll(
      `پاسارگاد میزبان — ${released.length} آی‌پی از اکسس درآمد و قابل استفاده است:\n${list(released)}`,
    ).catch((e) => console.error('[probe] پیامک آزادشدن ناموفق:', e.message));
  }
  if (blocked.length) {
    await notifyAll(`پاسارگاد میزبان — ${blocked.length} آی‌پی اکسس شد:\n${list(blocked)}`).catch((e) =>
      console.error('[probe] پیامک اکسس ناموفق:', e.message),
    );
  }
}
