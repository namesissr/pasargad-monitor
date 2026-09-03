import { q, q1, settingNum, log, logErr } from './db.mjs';
import { listIps, listPools, listVpses, listUsers, writeVpsIps } from './virtualizor.mjs';

/**
 * کشف و همگام‌سازی نودهای ویژالیزور.
 *
 * دو کار مستقل:
 *
 *   کشف (discover) — فقط خواندن. فهرست مخزن‌ها، آی‌پی‌ها، وی‌پی‌اس‌ها و
 *   کاربران هر نود خوانده و در پنل ثبت می‌شود. آی‌پی تخصیص‌یافته نام
 *   مشتری‌اش را می‌گیرد. هر ساعت خودکار اجرا می‌شود.
 *
 *   اعمال (apply) — می‌نویسد. آی‌پی‌های هنوز اکسس‌شده به وی‌پی‌اس لنگر
 *   تخصیص می‌یابند و آزادشده‌ها برداشته می‌شوند. فقط با درخواست صریح.
 *
 * کشف هرگز نمی‌نویسد. این تفکیک عمدی است: چیزی که هر ساعت خودکار اجرا
 * می‌شود نباید بتواند چیزی را خراب کند.
 */

/** نام مشتری از روی وی‌پی‌اس و کاربر — هرچه معنادارتر باشد */
function customerLabel(vps, user) {
  if (!vps) return null;
  const parts = [];
  if (user?.name) parts.push(user.name);
  else if (user?.email) parts.push(user.email);
  if (vps.hostname && vps.hostname !== parts[0]) parts.push(vps.hostname);
  const label = parts.join(' — ').trim();
  return label || null;
}

/**
 * ماسک شبکه نقطه‌ای به طول پرفیکس.
 *
 * شمردن بیت‌های یک کافی نیست: «255.255.255.1» هم ۲۵ بیت یک دارد ولی ماسک
 * معتبری نیست چون بیت‌ها پیوسته نیستند. پذیرفتنش یک ساب‌نت غلط در پنل
 * می‌سازد — و پرفیکس بایند از همان ساب‌نت می‌آید، یعنی آدرس‌ها با ماسک
 * اشتباه روی لنگر می‌نشینند. پس پیوستگی بررسی می‌شود.
 */
function maskToPrefix(netmask) {
  const parts = String(netmask || '').split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }

  let bits = 0;
  for (let i = 31; i >= 0; i--) {
    if (((value >>> i) & 1) === 0) break;
    bits++;
  }
  // همه بیت‌های بعد از پرفیکس باید صفر باشند
  const expected = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  if ((value >>> 0) !== expected) return null;

  return bits >= 8 && bits <= 32 ? bits : null;
}

/** شبکه یک آدرس با طول پرفیکس داده‌شده */
function networkOf(ip, prefix) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4 || prefix === null) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (value & mask) >>> 0;
  return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`;
}

/**
 * کشف یک نود — فقط خواندن.
 *
 * ترتیب مهم است: مخزن‌ها اول، تا آی‌پی‌ها بتوانند به ساب‌نت وصل شوند.
 */
export async function discoverNode(node) {
  const started = Date.now();

  const [pools, ips, vpses, users] = await Promise.all([
    listPools(node),
    listIps(node),
    listVpses(node),
    listUsers(node),
  ]);

  // فهرست آی‌پی‌ها تنها چیزی است که بدونش کشف بی‌معنی است. بقیه اگر
  // نیامدند کار ادامه می‌یابد و فقط نام مشتری یا ساب‌نت جا می‌ماند —
  // ناقص بهتر از هیچ است، ولی باید در لاگ دیده شود.
  if (!ips.ok) {
    await q(
      `UPDATE vz_nodes SET last_error = $2, last_sync_at = now() WHERE id = $1`,
      [node.id, ips.error],
    );
    await q(
      `INSERT INTO vz_sync_runs (node_id, kind, dry_run, ok, detail) VALUES ($1, 'discover', TRUE, FALSE, $2)`,
      [node.id, ips.error],
    );
    return { ok: false, error: ips.error };
  }
  for (const [name, res] of [['مخزن‌ها', pools], ['وی‌پی‌اس‌ها', vpses], ['کاربران', users]]) {
    if (!res.ok) logErr(`نود ${node.name}: خواندن ${name} ناموفق —`, res.error);
  }

  // ── ساب‌نت‌ها ────────────────────────────────────────────────
  if (pools.ok) {
    for (const pool of pools.items) {
      const prefix = maskToPrefix(pool.netmask);
      const cidr = networkOf(pool.firstip, prefix);
      if (!cidr) continue;
      await q(
        `INSERT INTO ip_subnets (cidr, version, gateway, label, vz_node_id, vz_poolid)
         VALUES ($1::cidr, 4, NULLIF($2,'')::inet, $3, $4, $5)
         ON CONFLICT (cidr) DO UPDATE
           SET gateway    = COALESCE(EXCLUDED.gateway, ip_subnets.gateway),
               label      = COALESCE(NULLIF(EXCLUDED.label,''), ip_subnets.label),
               vz_node_id = EXCLUDED.vz_node_id,
               vz_poolid  = EXCLUDED.vz_poolid`,
        [cidr, pool.gateway, pool.name || null, node.id, pool.poolid],
      ).catch((e) => logErr(`ساب‌نت ${cidr} ثبت نشد:`, e.message));
    }
  }

  // ── نگاشت وی‌پی‌اس و کاربر ──────────────────────────────────
  const userById = new Map((users.ok ? users.items : []).map((u) => [u.uid, u]));
  const vpsById = new Map((vpses.ok ? vpses.items : []).map((v) => [v.vpsid, v]));

  // ── آی‌پی‌ها، دسته‌ای ────────────────────────────────────────
  const addr = [];
  const ipid = [];
  const vpsid = [];
  const hostname = [];
  const customer = [];
  const assigned = [];

  for (const row of ips.items) {
    const free = row.vpsid === '0' || row.vpsid === '';
    const vps = free ? null : vpsById.get(row.vpsid);
    addr.push(row.ip);
    ipid.push(row.ipid);
    vpsid.push(free ? null : row.vpsid);
    hostname.push(vps?.hostname || null);
    customer.push(free ? null : customerLabel(vps, userById.get(vps?.uid)));
    assigned.push(!free);
  }

  if (addr.length) {
    // آی‌پی آزاد تازه خودکار تحت پایش می‌رود و به سرور لنگر گره می‌خورد.
    // آن گره‌خوردن حیاتی است: ایجنت pasargad-bind روی همان وی‌پی‌اس فقط
    // آدرس‌هایی را می‌بیند که bind_server_id‌شان خودش است. بدون آن، آدرس
    // در ویژالیزور تخصیص می‌یابد ولی داخل مهمان روی کارت نمی‌نشیند و
    // هیچ‌وقت جواب نمی‌دهد — برای همیشه «روت نشده».
    //
    // فقط برای رکورد تازه. آدرسی که از قبل در پنل هست وضعیت پایشش دست
    // نمی‌خورد، چون ممکن است ادمین عمداً خاموشش کرده باشد.
    // host() اجباری است: مقایسه inet در پستگرس ماسک را هم حساب می‌کند و
    // «x/24» با «x» برابر نیست.
    await q(
      `INSERT INTO ip_addresses (ip, version, status, customer, vz_ipid, vz_vpsid,
                                 vz_hostname, vz_node_id, vz_synced_at,
                                 access_watch, iran_access_status, access_blocked_since,
                                 bind_server_id)
       SELECT host(u.ip::inet)::inet, 4,
              CASE WHEN u.assigned THEN 'assigned' ELSE 'free' END,
              u.customer, u.ipid, u.vpsid, u.hostname, $7, now(),
              (NOT u.assigned) AND $8, 'unknown',
              CASE WHEN (NOT u.assigned) AND $8 THEN now() END,
              CASE WHEN (NOT u.assigned) AND $8 THEN $9::int END
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::boolean[])
              AS u(ip, ipid, vpsid, hostname, customer, assigned)
        -- محافظ دوم: اگر فیلتر بالادست روزی عوض شود، آدرس نسخه ۶ نباید
        -- با برچسب «نسخه ۴» وارد شود
        WHERE family(u.ip::inet) = 4
       ON CONFLICT (ip) DO UPDATE
         SET vz_ipid     = EXCLUDED.vz_ipid,
             vz_vpsid    = EXCLUDED.vz_vpsid,
             vz_hostname = EXCLUDED.vz_hostname,
             vz_node_id  = EXCLUDED.vz_node_id,
             vz_synced_at = now(),
             updated_at  = now(),
             -- نام مشتری فقط وقتی از ویژالیزور نوشته می‌شود که ادمین
             -- دستی چیزی ننوشته باشد؛ ورودی دستی نباید هر ساعت پاک شود
             customer    = CASE WHEN ip_addresses.customer_manual
                                THEN ip_addresses.customer
                                ELSE EXCLUDED.customer END,
             -- وضعیت آی‌پی تحت پایش اکسس دست نمی‌خورد: آن آدرس عمداً روی
             -- لنگر است و «assigned» خواندنش گمراه‌کننده می‌شود
             status      = CASE WHEN ip_addresses.access_watch
                                THEN ip_addresses.status
                                ELSE EXCLUDED.status END`,
      [
        addr, ipid, vpsid, hostname, customer, assigned, node.id,
        node.auto_watch_free !== false && Boolean(node.bind_server_id),
        node.bind_server_id ?? null,
      ],
    );
  }

  // آدرس‌هایی که در این نود دیگر نیستند، پیوندشان پاک می‌شود تا داده کهنه
  // به‌عنوان واقعیت نماند
  await q(
    `UPDATE ip_addresses
        SET vz_ipid = NULL, vz_vpsid = NULL, vz_hostname = NULL, vz_node_id = NULL, updated_at = now()
      WHERE vz_node_id = $1 AND NOT (host(ip) = ANY($2::text[]))`,
    [node.id, addr],
  );

  await q(`UPDATE vz_nodes SET last_error = NULL, last_sync_at = now() WHERE id = $1`, [node.id]);
  await q(
    `INSERT INTO vz_sync_runs (node_id, kind, dry_run, discovered, ok, detail)
     VALUES ($1, 'discover', TRUE, $2, TRUE, $3)`,
    [
      node.id,
      addr.length,
      `${addr.length} آدرس، ${pools.ok ? pools.items.length : 0} مخزن، ${
        vpses.ok ? vpses.items.length : 0
      } وی‌پی‌اس`,
    ],
  );

  log(`نود ${node.name}: ${addr.length} آدرس کشف شد در ${Math.round((Date.now() - started) / 1000)} ثانیه`);
  return { ok: true, discovered: addr.length };
}

/**
 * اعمال روی یک نود — می‌نویسد.
 *
 * محافظ‌ها، هرکدام برای خطری که واقعاً می‌تواند رخ دهد:
 *   • بدون شناسه لنگر هیچ نوشتنی انجام نمی‌شود
 *   • آدرسی که به وی‌پی‌اس دیگری تخصیص یافته دست نمی‌خورد
 *   • از لنگر فقط آدرسی برداشته می‌شود که پنل خودش چسبانده
 *   • آدرس قفل‌شده دست نمی‌خورد
 *   • سقف هر اجرا
 */
export async function applyNode(node, { dryRun = true } = {}) {
  const anchor = String(node.anchor_vpsid || '').trim();
  if (!/^\d+$/.test(anchor)) {
    return { ok: false, error: 'شناسه وی‌پی‌اس لنگر برای این نود تعیین نشده است' };
  }

  const ips = await listIps(node);
  if (!ips.ok) return { ok: false, error: ips.error };

  const known = await q(
    `SELECT host(ip) AS ip, iran_access_status, access_watch, managed_by_panel
       FROM ip_addresses WHERE version = 4 AND (vz_node_id = $1 OR vz_node_id IS NULL)`,
    [node.id],
  );
  const byIp = new Map(known.map((k) => [k.ip, k]));

  const cap = Math.min(Math.max(Number(node.max_per_run) || 200, 1), 1000);
  const attach = [];
  const detach = [];
  const skipped = [];

  for (const row of ips.items) {
    const free = row.vpsid === '0' || row.vpsid === '';
    const onAnchor = row.vpsid === anchor;

    if (row.locked || (!free && !onAnchor)) {
      skipped.push(row.ip);
      continue;
    }

    const panel = byIp.get(row.ip);
    if (!panel) continue;

    if (panel.iran_access_status === 'released') {
      if (onAnchor && panel.managed_by_panel) detach.push(row.ip);
      continue;
    }
    if (free && panel.access_watch) attach.push(row.ip);
  }

  const attachSlice = attach.slice(0, cap);
  const onAnchorNow = ips.items.filter((r) => r.vpsid === anchor).map((r) => r.ip);
  const finalList = Array.from(
    new Set([...onAnchorNow.filter((ip) => !detach.includes(ip)), ...attachSlice]),
  );

  const write = await writeVpsIps(node, anchor, finalList, { dryRun });
  if (!write.ok) {
    await q(
      `INSERT INTO vz_sync_runs (node_id, kind, dry_run, ok, detail) VALUES ($1, 'apply', $2, FALSE, $3)`,
      [node.id, dryRun, write.error],
    );
    return { ok: false, error: write.error };
  }

  if (!dryRun) {
    if (attachSlice.length) {
      await q(
        `UPDATE ip_addresses
            SET managed_by_panel = TRUE, vz_vpsid = $2, vz_synced_at = now(),
                bind_server_id = COALESCE($3::int, bind_server_id)
          WHERE host(ip) = ANY($1::text[])`,
        [attachSlice, anchor, node.bind_server_id ?? null],
      );
    }
    if (detach.length) {
      // access_watch از قبل هنگام «آزاد شد» خاموش شده؛ اینجا پیوند لنگر
      // هم پاک می‌شود تا ایجنت آدرس را از کارت شبکه بردارد
      await q(
        `UPDATE ip_addresses
            SET managed_by_panel = FALSE, vz_vpsid = NULL, bind_server_id = NULL, vz_synced_at = now()
          WHERE host(ip) = ANY($1::text[])`,
        [detach],
      );
    }
  }

  await q(
    `INSERT INTO vz_sync_runs (node_id, kind, dry_run, attached, detached, ok, detail)
     VALUES ($1, 'apply', $2, $3, $4, TRUE, $5)`,
    [
      node.id,
      dryRun,
      attachSlice.length,
      detach.length,
      `${dryRun ? 'آزمایشی — ' : ''}لنگر ${anchor}: ${finalList.length} آدرس، ${skipped.length} دست‌نخورده`,
    ],
  );

  return { ok: true, dryRun, attached: attachSlice, detached: detach, skipped };
}

/** کشف دوره‌ای همه نودهای فعال */
export async function discoverAll() {
  const hours = Math.max(1, await settingNum('vz_discover_hours', 1));
  const nodes = await q(
    `SELECT * FROM vz_nodes
      WHERE is_active
        AND (last_sync_at IS NULL OR last_sync_at < now() - ($1 || ' hours')::interval)
      ORDER BY id`,
    [String(hours)],
  );

  for (const node of nodes) {
    // خطای یک نود نباید بقیه را متوقف کند — شش نود داریم و یکی ممکن است
    // موقتاً در دسترس نباشد
    try {
      await discoverNode(node);
    } catch (err) {
      logErr(`کشف نود ${node.name} خطا داد:`, err.message);
      await q(`UPDATE vz_nodes SET last_error = $2, last_sync_at = now() WHERE id = $1`, [
        node.id,
        err.message,
      ]).catch(() => {});
    }
  }
}

/** درخواست‌های صف‌شده از پنل */
export async function drainQueue() {
  for (;;) {
    const job = await q1(
      `UPDATE vz_sync_queue SET taken_at = now()
        WHERE id = (SELECT id FROM vz_sync_queue WHERE taken_at IS NULL
                     ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, node_id, kind, dry_run`,
    );
    if (!job) return;

    const node = await q1(`SELECT * FROM vz_nodes WHERE id = $1`, [job.node_id]);
    if (!node) continue;

    try {
      if (job.kind === 'discover') await discoverNode(node);
      else await applyNode(node, { dryRun: job.dry_run });
    } catch (err) {
      logErr(`درخواست ${job.kind} روی نود ${node.name} خطا داد:`, err.message);
      await q(
        `INSERT INTO vz_sync_runs (node_id, kind, dry_run, ok, detail) VALUES ($1, $2, $3, FALSE, $4)`,
        [node.id, job.kind, job.dry_run, err.message],
      ).catch(() => {});
    }
  }
}
