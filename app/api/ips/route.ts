import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, num, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUS = ['free', 'assigned', 'reserved', 'blocked', 'abuse'];

/** فهرست آی‌پی‌ها با فیلتر و صفحه‌بندی */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const status = url.searchParams.get('status') || '';
    const serverId = url.searchParams.get('server_id') || '';
    const subnetId = url.searchParams.get('subnet_id') || '';
    const version = url.searchParams.get('version') || '';
    const access = url.searchParams.get('access') || '';
    const search = (url.searchParams.get('q') || '').trim();
    const limit = Math.min(500, Math.max(10, num(url.searchParams.get('limit'), 100)));
    const page = Math.max(1, num(url.searchParams.get('page'), 1));

    const where: string[] = [];
    const p: unknown[] = [];

    if (status && VALID_STATUS.includes(status)) {
      p.push(status);
      where.push(`i.status = $${p.length}`);
    }
    if (serverId === 'none') {
      where.push('i.server_id IS NULL');
    } else if (serverId) {
      p.push(Number(serverId));
      where.push(`i.server_id = $${p.length}`);
    }
    if (subnetId) {
      p.push(Number(subnetId));
      where.push(`i.subnet_id = $${p.length}`);
    }
    // فیلتر اکسس ایران: watch یعنی همه تحت پایش، blocked و released وضعیت مشخص
    if (access === 'watch') {
      where.push('i.access_watch');
    } else if (access === 'blocked' || access === 'released' || access === 'unreachable') {
      p.push(access);
      // «آزادشده» پس از آزادی تیک پایش را از دست می‌دهد، پس این فیلتر
      // نباید به access_watch وابسته باشد وگرنه همان‌هایی که دنبالشانیم
      // ناپدید می‌شوند
      where.push(
        access === 'released'
          ? `i.iran_access_status = $${p.length}`
          : `i.access_watch AND i.iran_access_status = $${p.length}`,
      );
    }
    if (version === '4' || version === '6') {
      p.push(Number(version));
      where.push(`i.version = $${p.length}`);
    }
    if (search) {
      p.push(`%${search}%`);
      where.push(
        `(host(i.ip) ILIKE $${p.length} OR i.ptr ILIKE $${p.length}
          OR i.customer ILIKE $${p.length} OR i.notes ILIKE $${p.length} OR s.name ILIKE $${p.length})`,
      );
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM ip_addresses i LEFT JOIN servers s ON s.id = i.server_id ${clause}`,
      p,
    );

    p.push(limit, (page - 1) * limit);
    const rows = await query(
      `SELECT i.id, host(i.ip) AS ip, i.version, i.status, i.customer, i.ptr, i.mac,
              i.is_monitored, i.ping_ok, i.ping_ms, i.last_ping_at, i.notes,
              i.access_watch, i.iran_access_status, i.access_blocked_since, i.access_released_at,
              i.bind_server_id, i.bind_ok, i.bind_error, i.bind_same_subnet, i.bind_routed,
              (SELECT COUNT(*)::int FROM ip_probe_state ps
                WHERE ps.ip_id = i.id AND ps.checked_at IS NOT NULL) AS probe_checks,
              -- تازه‌ترین شواهد دیدبان خارج. وضعیت ثبت‌شده تا رسیدن به حد
              -- نصاب پیاپی عوض نمی‌شود، ولی در همان فاصله باید معلوم باشد
              -- که سنجش چه می‌گوید — وگرنه پنل فرض اولیه را مثل واقعیت
              -- نشان می‌دهد، حتی وقتی شواهد خلافش را می‌گویند.
              o.ok AS outside_ok, o.ok_streak AS outside_ok_streak,
              o.fail_streak AS outside_fail_streak,
              i.server_id, s.name AS server_name,
              i.subnet_id, n.cidr::text AS subnet,
              masklen(n.cidr) AS subnet_prefix,
              host(COALESCE(i.gateway, n.gateway)) AS gateway,
              i.bind_prefix, i.vz_hostname, i.customer_manual,
              vn.name AS vz_node_name
         FROM ip_addresses i
         LEFT JOIN servers s   ON s.id = i.server_id
         LEFT JOIN ip_subnets n ON n.id = i.subnet_id
         LEFT JOIN vz_nodes vn ON vn.id = i.vz_node_id
         LEFT JOIN LATERAL (
           SELECT s2.ok, s2.ok_streak, s2.fail_streak
             FROM ip_probe_state s2
             JOIN probes p2 ON p2.id = s2.probe_id AND p2.is_active AND p2.location = 'outside'
            WHERE s2.ip_id = i.id AND s2.checked_at > now() - interval '2 hours'
            ORDER BY s2.checked_at DESC
            LIMIT 1
         ) o ON TRUE
         ${clause}
        ORDER BY ${access === 'released' ? 'i.access_released_at DESC NULLS LAST,' : ''} i.ip
        LIMIT $${p.length - 1} OFFSET $${p.length}`,
      p,
    );

    const stats = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*)::int AS cnt FROM ip_addresses GROUP BY status`,
    );

    const accessStats = await queryOne<{ watch: number; blocked: number; released7: number }>(
      `SELECT COUNT(*) FILTER (WHERE access_watch)::int AS watch,
              COUNT(*) FILTER (WHERE access_watch AND iran_access_status = 'blocked')::int AS blocked,
              COUNT(*) FILTER (WHERE access_watch AND iran_access_status = 'unreachable')::int AS unreachable,
              COUNT(*) FILTER (WHERE iran_access_status = 'released'
                               AND access_released_at > now() - interval '7 days')::int AS released7
         FROM ip_addresses`,
    );

    // سلامت دیدبان‌ها. بدون این، «در انتظار اولین بررسی» دو معنی کاملاً
    // متفاوت دارد: یا ۱۰ دقیقه صبر کن، یا هیچ‌وقت اتفاق نمی‌افتد چون
    // دیدبانی نصب نشده. حالت دوم باید صریح گفته شود.
    const probeHealth = await queryOne<{
      outside: number;
      outside_live: number;
      inside: number;
      inside_live: number;
    }>(
      `SELECT COUNT(*) FILTER (WHERE location = 'outside')::int AS outside,
              COUNT(*) FILTER (WHERE location = 'outside'
                               AND last_seen_at > now() - interval '1 hour')::int AS outside_live,
              COUNT(*) FILTER (WHERE location = 'inside')::int AS inside,
              COUNT(*) FILTER (WHERE location = 'inside'
                               AND last_seen_at > now() - interval '1 hour')::int AS inside_live
         FROM probes WHERE is_active`,
    );

    return ok({ ips: rows, total: total?.cnt ?? 0, page, limit, stats, accessStats, probeHealth });
  });
}

/** افزودن یک یا چند آی‌پی — هر ردیف مستقل است و شکست یکی بقیه را متوقف نمی‌کند */
export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const b = await readJson<Record<string, unknown>>(req);

    const raw = String(b.ips ?? b.ip ?? '').trim();
    if (!raw) return fail('حداقل یک آی‌پی وارد کنید', 400);

    const status = VALID_STATUS.includes(String(b.status)) ? String(b.status) : 'free';
    const serverId = b.server_id ? Number(b.server_id) : null;
    const subnetId = b.subnet_id ? Number(b.subnet_id) : null;
    const customer = String(b.customer ?? '').trim() || null;
    const monitored = Boolean(b.is_monitored);
    const accessWatch = Boolean(b.access_watch);
    const bindServerId = b.bind_server_id ? Number(b.bind_server_id) : null;
    const gateway = String(b.gateway ?? '').trim() || null;
    // خالی یا نامعتبر یعنی خودکار — ایجنت پرفیکس را از ساب‌نت می‌گیرد
    const bindPrefix = Number(b.bind_prefix);
    const prefix =
      Number.isInteger(bindPrefix) && bindPrefix >= 8 && bindPrefix <= 32 ? bindPrefix : null;

    const list = raw
      .split(/[\s,،\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (list.length > 2000) return fail('حداکثر ۲۰۰۰ آی‌پی در هر بار', 400);

    const added: string[] = [];
    const failed: { ip: string; reason: string }[] = [];

    for (const ip of list) {
      try {
        await query(
          `INSERT INTO ip_addresses (ip, version, subnet_id, server_id, status, customer, is_monitored)
           VALUES ($1::inet, CASE WHEN $1::text LIKE '%:%' THEN 6 ELSE 4 END, $2, $3, $4, $5, $6)
           ON CONFLICT (ip) DO UPDATE
             SET subnet_id = COALESCE(EXCLUDED.subnet_id, ip_addresses.subnet_id),
                 server_id = COALESCE(EXCLUDED.server_id, ip_addresses.server_id),
                 status    = EXCLUDED.status,
                 customer  = COALESCE(EXCLUDED.customer, ip_addresses.customer),
                 updated_at = now()`,
          [ip, subnetId, serverId, status, customer, monitored],
        );

        // آی‌پی اکسس‌شده که تازه به پایش اضافه می‌شود، «در اکسس» فرض می‌شود —
        // کل سناریو همین است: فهرست بسته‌شده‌ها وارد و منتظر آزادشدن می‌مانیم
        if (gateway || prefix !== 32) {
          await query(
            `UPDATE ip_addresses
                SET gateway = COALESCE(NULLIF($2, '')::inet, gateway),
                    bind_prefix = $3,
                    updated_at = now()
              WHERE ip = $1::inet`,
            [ip, gateway ?? '', prefix],
          );
        }

        if (accessWatch) {
          await query(
            `UPDATE ip_addresses
                SET access_watch = TRUE,
                    bind_server_id = COALESCE($2, bind_server_id),
                    iran_access_status = CASE WHEN iran_access_status = 'unknown' THEN 'blocked'
                                              ELSE iran_access_status END,
                    access_blocked_since = COALESCE(access_blocked_since, now()),
                    updated_at = now()
              WHERE ip = $1::inet`,
            [ip, bindServerId],
          );
        }
        added.push(ip);
      } catch (err) {
        failed.push({ ip, reason: err instanceof Error ? err.message : 'خطای ناشناخته' });
      }
    }

    return ok({ added: added.length, failed }, { status: 201 });
  });
}

/**
 * حذف دسته‌ای آی‌پی‌های یک بلوک.
 *
 * چرا با محافظ: یک بلوک ۲۴ یعنی ۲۵۶ ردیف و برگرداندنشان دستی نشدنی است.
 * پس آدرسی که در حال استفاده است — تخصیص‌یافته به مشتری، یا تحت پایش
 * اکسس — به‌طور پیش‌فرض حذف نمی‌شود و تعدادش گزارش می‌شود تا ادمین
 * آگاهانه تصمیم بگیرد.
 *
 * ?dryRun=1 فقط می‌شمارد و چیزی حذف نمی‌کند.
 * ?force=1 آدرس‌های در حال استفاده را هم حذف می‌کند.
 * ?withSubnet=1 خود رکورد بلوک را هم پاک می‌کند.
 */
export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const subnetId = Number(url.searchParams.get('subnetId'));
    if (!Number.isInteger(subnetId)) return fail('بلوک را مشخص کنید', 400);

    const dryRun = url.searchParams.get('dryRun') === '1';
    const force = url.searchParams.get('force') === '1';
    const withSubnet = url.searchParams.get('withSubnet') === '1';

    const subnet = await queryOne<{ cidr: string }>(
      `SELECT cidr::text AS cidr FROM ip_subnets WHERE id = $1`,
      [subnetId],
    );
    if (!subnet) return fail('بلوک پیدا نشد', 404);

    // «در حال استفاده» یعنی هر نشانه‌ای از اینکه کسی به آن وابسته است
    const inUse = `(status = 'assigned' OR access_watch OR customer IS NOT NULL OR vz_vpsid IS NOT NULL)`;

    const counts = await queryOne<{ total: number; used: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${inUse})::int AS used
         FROM ip_addresses WHERE ip << $1::cidr`,
      [subnet.cidr],
    );

    const total = counts?.total ?? 0;
    const used = counts?.used ?? 0;

    if (dryRun) {
      return ok({ cidr: subnet.cidr, total, used, deleted: 0, dryRun: true });
    }

    if (used > 0 && !force) {
      return fail(
        `${used} آدرس از این بلوک در حال استفاده است (تخصیص‌یافته، تحت پایش، یا دارای مشتری). ` +
          'برای حذف همه، گزینه حذف اجباری را بزنید.',
        409,
      );
    }

    const deleted = await query<{ id: number }>(
      `DELETE FROM ip_addresses
        WHERE ip << $1::cidr ${force ? '' : `AND NOT ${inUse}`}
        RETURNING id`,
      [subnet.cidr],
    );

    if (withSubnet) {
      await query('DELETE FROM ip_subnets WHERE id = $1', [subnetId]);
    }

    return ok({ cidr: subnet.cidr, total, used, deleted: deleted.length, dryRun: false });
  });
}
