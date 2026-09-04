import { q, q1, settingNum, log, logErr } from './db.mjs';
import { clientFor } from './hypervisor.mjs';

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
 *
 * ویژالیزور ماسک را گاهی نقطه‌ای («255.255.255.0») و گاهی عددی («24»)
 * می‌دهد؛ هر دو پذیرفته می‌شوند.
 */
function maskToPrefix(netmask) {
  const raw = String(netmask || '').trim();

  if (/^\d{1,2}$/.test(raw)) {
    const n = Number(raw);
    return n >= 8 && n <= 32 ? n : null;
  }

  const parts = raw.split('.');
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
  const api = clientFor(node);

  const [pools, ips, vpses, users] = await Promise.all([
    api.listPools(node),
    api.listIps(node),
    api.listVpses(node),
    api.listUsers(node),
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
    if (!res.ok) {
      logErr(`نود ${node.name}: خواندن ${name} ناموفق —`, res.error);
      continue;
    }
    // فهرست خالی بی‌صدا نماند. یک بار فهرست مخزن‌ها خالی برگشت و چون هیچ
    // لاگی نداشت، تشخیصش چند دور طول کشید: معلوم نبود پاسخ خالی است یا
    // کلیدش عوض شده یا فیلتر همه را انداخته.
    if (!res.items.length) {
      logErr(
        `نود ${node.name}: فهرست ${name} خالی است.`,
        `ردیف خام: ${res.rawCount ?? '؟'}،`,
        `کلیدهای پاسخ: ${(res.topKeys || []).join(', ') || 'ندارد'}.`,
        `نمونه پاسخ: ${String(res.raw || '').slice(0, 200)}`,
      );
    } else if (res.rawCount && res.rawCount > res.items.length) {
      log(
        `نود ${node.name}: ${res.rawCount - res.items.length} ردیف ${name} فیلتر شد`,
        `(نسخه ۶ یا داده ناقص) از ${res.rawCount}`,
      );
    }
  }

  // ── بلوک‌ها ─────────────────────────────────────────────────
  //
  // منبع اصلی خودِ ردیف‌های آی‌پی است، نه فهرست مخزن‌ها. هر ردیف آی‌پی
  // گیت‌وی، ماسک و شناسه مخزنش را دارد. وقتی بلوک‌ها را به یک فراخوانی
  // دوم گره زدیم، آن فراخوانی خالی برگشت و هیچ بلوکی ساخته نشد — پس
  // ماسک و گیت‌وی خالی ماند و پرفیکس بایند به ۳۲ برگشت.
  //
  // فهرست مخزن‌ها فقط مکمل است: مخزنی که هیچ آی‌پی‌ای ندارد از آنجا می‌آید.
  const blocks = new Map();

  const addBlock = (poolid, name, gateway, netmask, source, total) => {
    const prefix = maskToPrefix(netmask);
    const cidr = networkOf(gateway, prefix);
    if (!cidr) {
      if (!blocks.has('bad:' + poolid)) {
        blocks.set('bad:' + poolid, null);
        logErr(
          `نود ${node.name}: بلوک «${name || poolid}» (${source}) خوانده نشد —`,
          `گیت‌وی «${gateway}» یا ماسک «${netmask}» معتبر نیست`,
        );
      }
      return;
    }
    const existing = blocks.get(cidr);
    if (!existing) {
      blocks.set(cidr, { cidr, poolid, name, gateway, total: total ?? null });
      return;
    }
    // بلوک اول از ردیف‌های آی‌پی ساخته می‌شود و تعداد اعلامی ندارد؛ آن
    // تعداد فقط در فهرست مخزن‌ها هست. بدون این ادغام، عدد دور ریخته
    // می‌شد و پنل ناچار ظرفیت سی‌آی‌دی‌آر را نشان می‌داد — که برای بلوک
    // فهرستی کاملا غلط است (۲۵۴ به‌جای ۸۶).
    if (existing.total === null && total !== null && total !== undefined) {
      existing.total = total;
    }
    if (!existing.poolid && poolid) existing.poolid = poolid;
    if (!existing.name && name) existing.name = name;
  };

  for (const row of ips.items) {
    if (!row.gateway || !row.netmask) continue;
    addBlock(row.ippoolid, row.poolName, row.gateway, row.netmask, 'از آی‌پی');
  }
  if (pools.ok) {
    for (const pool of pools.items) {
      addBlock(pool.poolid, pool.name, pool.gateway, pool.netmask, 'از مخزن', pool.totalIps);
    }
  }

  for (const block of blocks.values()) {
    if (!block) continue;
    await q(
      `INSERT INTO ip_subnets (cidr, version, gateway, label, vz_node_id, vz_poolid)
       VALUES ($1::cidr, 4, NULLIF($2,'')::inet, NULLIF($3,''), $4, NULLIF($5,''))
       -- یکتایی ترکیبی است: یک سی‌آی‌دی‌آر می‌تواند در دو هایپروایزر
       -- باشد و هرکدام ردیف خودش را دارد
       ON CONFLICT (cidr, vz_node_id) WHERE vz_node_id IS NOT NULL DO UPDATE
         SET gateway    = COALESCE(EXCLUDED.gateway, ip_subnets.gateway),
             label      = COALESCE(EXCLUDED.label, ip_subnets.label),
             vz_node_id = EXCLUDED.vz_node_id,
             vz_poolid  = COALESCE(EXCLUDED.vz_poolid, ip_subnets.vz_poolid)`,
      [block.cidr, block.gateway, block.name || null, node.id, block.poolid || null],
    ).catch((e) => logErr(`بلوک ${block.cidr} ثبت نشد:`, e.message));
  }

  // گزارش خلاصه هر بلوک. بدون این، «چرا تعداد کل خالی است» فقط با حدس
  // قابل پیگیری بود — و همین چند دور رفت‌وبرگشت هزینه داد.
  {
    const listed = Array.from(blocks.values()).filter(Boolean);
    const summary = listed
      .map((b) => `${b.cidr}(مخزن ${b.poolid || '؟'}، کل ${b.total ?? 'ندارد'})`)
      .join('، ');
    log(
      `نود ${node.name}: مخزن‌ها ${pools.ok ? pools.items.length : 'ناموفق'}،`,
      `بلوک‌ها ${listed.length} → ${summary || 'هیچ'}`,
    );
  }

  const madeBlocks = Array.from(blocks.values()).filter(Boolean).length;
  if (!madeBlocks && ips.items.length) {
    logErr(
      `نود ${node.name}: هیچ بلوکی ساخته نشد با اینکه ${ips.items.length} آدرس آمد.`,
      'یعنی ردیف‌های آی‌پی گیت‌وی یا ماسک ندارند — بدون بلوک، پرفیکس بایند ۳۲ می‌ماند',
      'و آدرس‌ها روی لنگر کار نمی‌کنند.',
    );
  } else if (madeBlocks) {
    log(`نود ${node.name}: ${madeBlocks} بلوک ثبت شد`);
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
  const poolid = [];
  const watchable = [];
  // آدرس قفل‌شده در ویژالیزور وارد نمی‌شود. ادمین عمداً کنارش گذاشته و
  // مسیر اعمال هم هرگز به لنگر نمی‌چسباندش — پس بودنش در فهرست پایش
  // فقط یک «روت نشده» دائمی و بی‌دلیل می‌سازد.
  const lockedAddr = [];
  // فهرست کامل شامل قفل‌شده‌ها، برای تشخیص آدرس‌هایی که واقعا از نود
  // حذف شده‌اند. بدون این، آدرس قفل‌شده «حذف‌شده از نود» حساب می‌شد.
  const allAddr = ips.items.map((r) => r.ip);

  for (const row of ips.items) {
    if (row.locked) {
      lockedAddr.push(row.ip);
      continue;
    }
    const free = row.vpsid === '0' || row.vpsid === '';
    // آدرس رزروشده خودکار تحت پایش نمی‌رود.
    //
    // رزرو یعنی ادمین عمدا کنارش گذاشته — شاید برای مشتری خاصی. اگر
    // خودکار پایش شود، چسباندنش به لنگر پرچم رزرو را پاک می‌کند و آن
    // تصمیم بی‌صدا از بین می‌رود. ادمین می‌تواند دستی تیکش را بزند.
    const autoWatchable = free && !row.isReserved;
    const vps = free ? null : vpsById.get(row.vpsid);
    addr.push(row.ip);
    watchable.push(autoWatchable);
    ipid.push(row.ipid);
    poolid.push(row.ippoolid || null);
    vpsid.push(free ? null : row.vpsid);
    // بعضی کلاینت‌ها نام سرور و مالک را در خود ردیف آی‌پی می‌دهند
    // (سولوس)، بعضی باید از نگاشت وی‌پی‌اس و کاربر ساخته شود (ویژالیزور)
    hostname.push(row.hostname || vps?.hostname || null);
    customer.push(free ? null : row.customer || customerLabel(vps, userById.get(vps?.uid)) || null);
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
                                 bind_server_id, subnet_id)
       SELECT host(u.ip::inet)::inet, 4,
              CASE WHEN u.assigned THEN 'assigned' ELSE 'free' END,
              u.customer, u.ipid, u.vpsid, u.hostname, $7, now(),
              u.watchable AND $8, 'unknown',
              CASE WHEN u.watchable AND $8 THEN now() END,
              -- سرور لنگر از لنگر همان بلوک می‌آید؛ با چند لنگر، یک
              -- مقدار ثابت برای کل نود غلط می‌شد
              CASE WHEN u.watchable AND $8 THEN (
                SELECT an.bind_server_id FROM ip_subnets sb
                  JOIN vz_anchors an ON an.id = sb.anchor_id
                 WHERE sb.vz_node_id = $7 AND sb.vz_poolid = u.poolid LIMIT 1
              ) END,
              -- بدون این پیوند، پرفیکس بایند به ۳۲ برمی‌گشت و آدرس یک شبکه
              -- مستقل می‌شد به‌جای عضوی از بلوک — روی کارت می‌نشست ولی
              -- تجهیزات بالادست نمی‌دیدندش.
              -- اول با شناسه مخزن ویژالیزور، وگرنه با دربرگیری.
              -- ترتیب مهم است: اول شناسه مخزن همین نود، بعد دربرگیری در
              -- بلوک همین نود، و آخر بلوک دستی. بدون قید نود، آدرس ممکن
              -- بود به ردیف بلوک هایپروایزر دیگری وصل شود — و لنگرش هم از
              -- آنجا می‌آمد.
              COALESCE(
                (SELECT sp.id FROM ip_subnets sp
                  WHERE sp.vz_node_id = $7 AND sp.vz_poolid = u.poolid LIMIT 1),
                (SELECT sn.id FROM ip_subnets sn
                  WHERE sn.vz_node_id = $7 AND host(u.ip::inet)::inet << sn.cidr
                  ORDER BY masklen(sn.cidr) DESC LIMIT 1),
                (SELECT sc.id FROM ip_subnets sc
                  WHERE sc.vz_node_id IS NULL AND host(u.ip::inet)::inet << sc.cidr
                  ORDER BY masklen(sc.cidr) DESC LIMIT 1)
              )
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                     $6::boolean[], $9::text[], $10::boolean[])
              AS u(ip, ipid, vpsid, hostname, customer, assigned, poolid, watchable)
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
                                ELSE EXCLUDED.status END,
             -- ساب‌نت فقط وقتی پر می‌شود که خالی باشد؛ انتخاب دستی ادمین
             -- نباید هر ساعت بازنویسی شود
             subnet_id   = COALESCE(ip_addresses.subnet_id, EXCLUDED.subnet_id),
             -- رکوردهایی که پیش از تعیین لنگر وارد شده‌اند اینجا گره
             -- می‌خورند، وگرنه تا ابد بدون لنگر می‌مانند و ایجنت هرگز
             -- نمی‌بیندشان. سرور لنگر از لنگر همان بلوک می‌آید.
             bind_server_id = CASE
               WHEN ip_addresses.access_watch AND ip_addresses.bind_server_id IS NULL
               THEN EXCLUDED.bind_server_id ELSE ip_addresses.bind_server_id END`,
      [
        addr, ipid, vpsid, hostname, customer, assigned, node.id,
        node.auto_watch_free !== false,
        poolid,
        watchable,
      ],
    );
  }

  // آدرس‌هایی که در این نود دیگر نیستند، پیوندشان پاک می‌شود تا داده کهنه
  // به‌عنوان واقعیت نماند.
  //
  // ردیفشان حذف نمی‌شود — ممکن است ادمین دستی واردش کرده باشد یا
  // یادداشت و مشتری داشته باشد. ولی اگر تحت پایش باشد باید گفته شود:
  // آدرسی که در ویژالیزور نیست هرگز به لنگر تخصیص نمی‌یابد، پس تا ابد
  // «روت نشده» گزارش می‌شود بدون اینکه علتش معلوم باشد.
  const orphans = await q(
    `UPDATE ip_addresses
        SET vz_ipid = NULL, vz_vpsid = NULL, vz_hostname = NULL, vz_node_id = NULL, updated_at = now()
      WHERE vz_node_id = $1 AND NOT (host(ip) = ANY($2::text[]))
      RETURNING host(ip) AS ip, access_watch`,
    [node.id, allAddr],
  );
  const watchedOrphans = orphans.filter((r) => r.access_watch);
  if (watchedOrphans.length) {
    logErr(
      `نود ${node.name}: ${watchedOrphans.length} آدرس تحت پایش دیگر در این نود نیست —`,
      'تا در ویژالیزور نباشند به لنگر تخصیص نمی‌یابند و همیشه «روت نشده» می‌مانند:',
      watchedOrphans.slice(0, 10).map((r) => r.ip).join('، '),
    );
  }

  // هر آدرسی که روی وی‌پی‌اس لنگر نشسته، تحت مدیریت پنل است.
  //
  // چرا لازم شد: جداکردن فقط آدرسی را برمی‌داشت که managed_by_panel
  // داشت، و آن علامت فقط با یک اعمال موفق ست می‌شد. تا وقتی اعمال کار
  // نمی‌کرد، هیچ آدرس آزادشده‌ای هم از لنگر برداشته نمی‌شد — یعنی همان
  // آی‌پی که «آزاد شد» گرفته بود، همچنان اشغال می‌ماند.
  //
  // محافظ اصلی سر جایش است: آدرسی که روی وی‌پی‌اس دیگری باشد هرگز دست
  // نمی‌خورد. لنگر به‌تعریف اختصاصی است و مشتری رویش نیست.
  const anchors = await q(
    `SELECT id, anchor_vpsid, bind_server_id FROM vz_anchors WHERE node_id = $1`,
    [node.id],
  );
  if (anchors.length) {
    const adopted = await q(
      `UPDATE ip_addresses i
          SET managed_by_panel = TRUE,
              anchor_id = a.id,
              bind_server_id = COALESCE(i.bind_server_id, a.bind_server_id),
              updated_at = now()
         FROM unnest($2::text[], $3::int[], $4::int[]) AS a(vpsid, id, bind_server_id)
        WHERE i.vz_node_id = $1 AND i.vz_vpsid = a.vpsid
          AND (NOT i.managed_by_panel OR i.anchor_id IS DISTINCT FROM a.id)
        RETURNING i.id`,
      [
        node.id,
        anchors.map((a) => String(a.anchor_vpsid)),
        anchors.map((a) => a.id),
        anchors.map((a) => a.bind_server_id),
      ],
    );
    if (adopted.length) {
      log(`نود ${node.name}: ${adopted.length} آدرس روی لنگرها تحت مدیریت پنل ثبت شد`);
    }
  }

  // آدرس‌های قفل‌شده: علامت می‌خورند و از پایش خارج می‌شوند. حذف خودکار
  // نمی‌شوند چون ممکن است یادداشت یا نام مشتری داشته باشند.
  if (lockedAddr.length) {
    const unwatched = await q(
      `UPDATE ip_addresses
          SET vz_locked = TRUE, vz_node_id = $2, vz_synced_at = now(),
              access_watch = FALSE, updated_at = now()
        WHERE host(ip) = ANY($1::text[]) AND (access_watch OR NOT vz_locked)
        RETURNING host(ip) AS ip`,
      [lockedAddr, node.id],
    );
    if (unwatched.length) {
      log(`نود ${node.name}: ${unwatched.length} آدرس قفل‌شده از پایش خارج شد`);
    }
  }
  // آدرسی که قفلش برداشته شده باید علامتش هم برداشته شود
  if (addr.length) {
    await q(
      `UPDATE ip_addresses SET vz_locked = FALSE
        WHERE vz_node_id = $2 AND vz_locked AND host(ip) = ANY($1::text[])`,
      [addr, node.id],
    );
  }

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

  log(
    `نود ${node.name}: ${addr.length} آدرس کشف شد` +
      (lockedAddr.length ? `، ${lockedAddr.length} قفل‌شده نادیده گرفته شد` : '') +
      ` در ${Math.round((Date.now() - started) / 1000)} ثانیه`,
  );
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
/**
 * اعمال روی یک هایپروایزر — می‌نویسد.
 *
 * هر هایپروایزر می‌تواند چند لنگر داشته باشد، چون نودهایش ممکن است در
 * دیتاسنترهای مختلف باشند. آدرسی از دیتاسنتر «الف» روی لنگری که در
 * دیتاسنتر «ب» است هرگز روت نمی‌شود.
 *
 * تقسیم بر اساس بلوک است نه نود: روت‌شدن یک آدرس به بلوکش بستگی دارد.
 * هر آدرس لنگرش را از بلوکش می‌گیرد؛ بلوک بدون لنگر به لنگر پیش‌فرض
 * می‌رود.
 *
 * محافظ‌ها، هرکدام برای خطری که واقعا می‌تواند رخ دهد:
 *   • بدون هیچ لنگری هیچ نوشتنی انجام نمی‌شود
 *   • آدرسی که به وی‌پی‌اس دیگری تخصیص یافته دست نمی‌خورد
 *   • از لنگر فقط آدرسی برداشته می‌شود که پنل خودش چسبانده
 *   • آدرس قفل‌شده دست نمی‌خورد
 *   • سقف هر اجرا، جدا برای هر لنگر
 *   • شکست یک لنگر بقیه را متوقف نمی‌کند
 */
export async function applyNode(node, { dryRun = true } = {}) {
  const api = clientFor(node);

  const anchors = await q(
    `SELECT id, name, anchor_vpsid, bind_server_id, max_per_run, is_default
       FROM vz_anchors WHERE node_id = $1 ORDER BY is_default DESC, name`,
    [node.id],
  );
  if (!anchors.length) {
    return { ok: false, error: 'برای این هایپروایزر هیچ لنگری تعریف نشده است' };
  }

  const ips = await api.listIps(node);
  if (!ips.ok) return { ok: false, error: ips.error };

  const fallback = anchors.find((a) => a.is_default) || null;

  // لنگر هر آدرس از بلوکش می‌آید. آدرسی که بلوکش لنگر ندارد به لنگر
  // پیش‌فرض می‌رود؛ اگر پیش‌فرضی هم نباشد، کنار گذاشته می‌شود تا روی
  // لنگر اشتباه ننشیند.
  const known = await q(
    `SELECT host(i.ip) AS ip, i.iran_access_status, i.access_watch, i.managed_by_panel,
            COALESCE(i.anchor_id, s.anchor_id) AS anchor_id
       FROM ip_addresses i
       LEFT JOIN ip_subnets s ON s.id = i.subnet_id
      WHERE i.version = 4 AND (i.vz_node_id = $1 OR i.vz_node_id IS NULL)`,
    [node.id],
  );
  const byIp = new Map(known.map((k) => [k.ip, k]));

  const byAnchor = new Map(anchors.map((a) => [String(a.id), { anchor: a, attach: [], detach: [] }]));
  const skipped = [];
  const homeless = [];

  for (const row of ips.items) {
    const free = row.vpsid === '0' || row.vpsid === '';
    const holder = anchors.find((a) => String(a.anchor_vpsid) === row.vpsid) || null;

    if (row.locked || (!free && !holder)) {
      skipped.push(row.ip);
      continue;
    }

    const panel = byIp.get(row.ip);
    if (!panel) continue;

    if (panel.iran_access_status === 'released') {
      if (holder && panel.managed_by_panel) {
        byAnchor.get(String(holder.id))?.detach.push(row.ip);
      }
      continue;
    }

    if (!free || !panel.access_watch) continue;

    const target = panel.anchor_id
      ? anchors.find((a) => a.id === panel.anchor_id)
      : fallback;
    if (!target) {
      homeless.push(row.ip);
      continue;
    }
    byAnchor.get(String(target.id))?.attach.push(row.ip);
  }

  if (homeless.length) {
    logErr(
      `${node.name}: ${homeless.length} آدرس لنگر ندارد —`,
      'بلوکشان لنگر تعیین‌شده ندارد و لنگر پیش‌فرضی هم نیست:',
      homeless.slice(0, 8).join('، '),
    );
  }

  const attachedAll = [];
  const detachedAll = [];
  const failures = [];
  let previewFields = 0;
  let previewDisks = false;

  for (const [, plan] of byAnchor) {
    const a = plan.anchor;
    const cap = Math.min(Math.max(Number(a.max_per_run) || 200, 1), 1000);
    const attachSlice = plan.attach.slice(0, cap);

    const onAnchorNow = ips.items
      .filter((r) => r.vpsid === String(a.anchor_vpsid))
      .map((r) => r.ip);
    const finalList = Array.from(
      new Set([...onAnchorNow.filter((ip) => !plan.detach.includes(ip)), ...attachSlice]),
    );

    // اگر برای این لنگر هیچ تغییری نیست، اصلا درخواستی فرستاده نمی‌شود
    if (!attachSlice.length && !plan.detach.length) continue;

    const write = await api.writeVpsIps(node, a.anchor_vpsid, finalList, { dryRun });
    if (!write.ok) {
      failures.push(`${a.name}: ${write.error}`);
      continue;
    }

    const sentKeys = Object.keys(write.sent || {});
    if (sentKeys.length > previewFields) previewFields = sentKeys.length;
    if (sentKeys.some((k) => k.startsWith('disks'))) previewDisks = true;

    attachedAll.push(...attachSlice);
    detachedAll.push(...plan.detach);

    if (!dryRun) {
      if (attachSlice.length) {
        await q(
          `UPDATE ip_addresses
              SET managed_by_panel = TRUE, vz_vpsid = $2, anchor_id = $4, vz_synced_at = now(),
                  bind_server_id = COALESCE($3::int, bind_server_id)
            WHERE host(ip) = ANY($1::text[])`,
          [attachSlice, String(a.anchor_vpsid), a.bind_server_id ?? null, a.id],
        );
      }
      if (plan.detach.length) {
        await q(
          `UPDATE ip_addresses
              SET managed_by_panel = FALSE, vz_vpsid = NULL, bind_server_id = NULL,
                  vz_synced_at = now()
            WHERE host(ip) = ANY($1::text[])`,
          [plan.detach],
        );
      }
    }
  }

  const payloadNote = dryRun && previewFields
    ? ` — بدنه: ${previewFields} فیلد، دیسک ${previewDisks ? 'هست' : 'ندارد'}`
    : '';
  const detail =
    `${dryRun ? 'آزمایشی — ' : ''}${anchors.length} لنگر، ` +
    `${attachedAll.length} چسبید، ${detachedAll.length} جدا شد، ` +
    `${skipped.length} دست‌نخورده` +
    (homeless.length ? `، ${homeless.length} بدون لنگر` : '') +
    payloadNote;

  await q(
    `INSERT INTO vz_sync_runs (node_id, kind, dry_run, attached, detached, ok, detail)
     VALUES ($1, 'apply', $2, $3, $4, $5, $6)`,
    [
      node.id,
      dryRun,
      attachedAll.length,
      detachedAll.length,
      failures.length === 0,
      failures.length ? `${detail} | ناموفق: ${failures.join(' | ')}` : detail,
    ],
  );

  if (failures.length) {
    return { ok: false, error: failures.join(' | '), attached: attachedAll, detached: detachedAll };
  }

  return { ok: true, dryRun, attached: attachedAll, detached: detachedAll, skipped, homeless };
}

/** کشف دوره‌ای همه نودهای فعال */
export async function discoverAll() {
  const hours = Math.max(1, await settingNum('vz_discover_hours', 3));
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
