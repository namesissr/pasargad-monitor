import { q, q1, settingNum, log, logErr } from './db.mjs';
import { openIncident, resolveIncident } from './incidents.mjs';
import { formatPercent } from './format.mjs';
import { createHash } from 'node:crypto';
import { counterDelta, nxapiDriver } from './nxapi.mjs';
import { snmpDriver } from './snmp.mjs';
import { suggestLinks } from './switch-match.mjs';

/**
 * پایش سوییچ‌ها: خواندن دوره‌ای، اجرای shut/no shut از صف، و تجمیع.
 *
 * هر خواندن شمارنده همه پورت‌ها را با هم می‌گیرد، به‌علاوه منابع سوییچ.
 * بقیه — محیط، ماژول نوری، نسخه — کندتر عوض می‌شوند و با فاصله بیشتر
 * خوانده می‌شوند تا پردازنده کنترل‌پلین سوییچ بی‌دلیل درگیر نشود.
 *
 * اینکه سوییچ با NX-API خوانده می‌شود یا SNMP فقط در «درایور» است
 * (worker/nxapi.mjs و worker/snmp.mjs). از اینجا به بعد — دلتا، ذخیره،
 * هشدار، صف فرمان — برای هر دو یکی است.
 */

const driverFor = (sw) => (sw.protocol === 'snmp' ? snmpDriver : nxapiDriver);

// ستون‌هایی که هر دو درایور لازم دارند
const SWITCH_COLUMNS = `id, name, protocol, url, username, password, insecure_tls,
  snmp_version, snmp_host, snmp_port, snmp_community, snmp_write_community, snmp_user,
  snmp_auth_proto, snmp_auth_pass, snmp_priv_proto, snmp_priv_pass, snmp_write, vendor`;

const SLOW_MS = {
  version: 5 * 60_000,
  env: 5 * 60_000,
  xcvr: 10 * 60_000,
  // همسایه‌ها، جدول MAC و ARP
  nbr: 5 * 60_000,
};

// زمان آخرین خواندن کند، در حافظه. با ری‌استارت ورکر یک بار زودتر خوانده
// می‌شوند؛ ضرری ندارد.
const lastSlow = new Map();

function isDue(sw, kind) {
  return Date.now() - (lastSlow.get(`${sw.id}:${kind}`) ?? 0) >= SLOW_MS[kind];
}

function markDone(sw, kind) {
  lastSlow.set(`${sw.id}:${kind}`, Date.now());
}

// پورتی که سرعتش نمونه خام می‌گیرد. ویلن و لوپ‌بک معمولا شمارنده بایت
// ندارند و نمونه‌شان فقط ردیف صفر می‌ساخت.
const COUNTED_KINDS = new Set(['ethernet', 'port-channel', 'mgmt']);

// قطعی لینک کوتاه‌تر از این رویداد نمی‌سازد. یک فلپ چندثانیه‌ای که خودش
// برگشته، ارزش پیامک ندارد.
const PORT_DOWN_GRACE_SEC = 60;

export async function pollSwitches() {
  // سوییچ غیرفعال رویداد باز نگه ندارد؛ وگرنه یادآوری‌اش تا ابد می‌رفت
  await q(
    `UPDATE incidents SET resolved_at = now()
      WHERE resolved_at IS NULL
        AND switch_id IN (SELECT id FROM switches WHERE NOT is_active)`,
  );

  const list = await q(
    `SELECT ${SWITCH_COLUMNS}, status, fail_streak, model, max_temp_c
       FROM switches WHERE is_active ORDER BY id`,
  );

  // چند سوییچ با هم، ولی نه همه: هر خواندن چند ثانیه طول می‌کشد
  let discovered = false;
  for (let i = 0; i < list.length; i += 4) {
    const results = await Promise.all(
      list.slice(i, i + 4).map((sw) =>
        pollOne(sw).catch((err) => {
          logErr(`خواندن سوییچ ${sw.name} خطا داد:`, err.message);
          return false;
        }),
      ),
    );
    if (results.some(Boolean)) discovered = true;
  }

  // پیشنهاد اتصال سراسری است: MAC روی یک سوییچ و ARP روی سوییچ دیگر
  if (discovered) await refreshSuggestions().catch((err) => logErr('پیشنهاد اتصال پورت خطا داد:', err.message));
}

async function markFailure(sw, message, ms) {
  const row = await q1(
    `UPDATE switches
        SET fail_streak  = fail_streak + 1,
            last_error   = $2,
            last_poll_at = now(),
            last_poll_ms = $3,
            status       = CASE WHEN fail_streak + 1 >= 2 THEN 'down' ELSE status END,
            updated_at   = now()
      WHERE id = $1
      RETURNING fail_streak, status`,
    [sw.id, message, ms],
  );

  // یک شکست تنها می‌تواند یک تایم‌اوت گذرا باشد. دو بار پشت‌سرهم یعنی
  // واقعا دسترسی نیست.
  if (row && row.fail_streak >= 2) {
    if (row.fail_streak === 2) {
      // سرعت قدیمی روی پورت‌ها نماند؛ وگرنه جمع ترافیک سوییچ قطع، عدد
      // لحظه آخرش را نشان می‌داد
      await q(`UPDATE switch_ports SET in_bps = 0, out_bps = 0 WHERE switch_id = $1`, [sw.id]);
      log(`سوییچ ${sw.name} در دسترس نیست: ${message}`);
    }
    await openIncident({
      switchId: sw.id,
      kind: 'switch_down',
      severity: 'critical',
      message: `پنل به سوییچ ${sw.name} دسترسی ندارد: ${message}`,
    });
  }
}

async function pollOne(sw) {
  const started = Date.now();
  const driver = driverFor(sw);

  // بخش کند فقط وقتی خوانده می‌شود که وقتش رسیده باشد
  const due = (kind) => {
    if (!isDue(sw, kind)) return false;
    markDone(sw, kind);
    return true;
  };

  let data;
  try {
    data = await driver.collect(sw, due);
  } catch (err) {
    await markFailure(sw, driver.explain(err), Date.now() - started);
    return false;
  }
  const { ports, res, ver, env, xcvr, notes, discovery } = data;

  const nowMs = Date.now();
  const ts = new Date(nowMs).toISOString();
  const prevRows = await q(
    `SELECT id, name, in_bytes, out_bytes, in_errors, out_errors, in_discards, out_discards,
            crc_errors, counters_at, oper_up, last_change_at, server_id, alert_down, last_change_ticks
       FROM switch_ports WHERE switch_id = $1`,
    [sw.id],
  );
  const prev = new Map(prevRows.map((r) => [r.name, r]));

  const records = [];
  const deltas = new Map();
  // تغییر وضعیت لینک، برای تاریخچه پورت و تشخیص فلپ
  const events = [];

  for (const p of ports) {
    const p0 = prev.get(p.name);
    if (p0 && typeof p0.oper_up === 'boolean' && typeof p.oper_up === 'boolean' && p0.oper_up !== p.oper_up) {
      events.push({ name: p.name, oper_up: p.oper_up, detail: p.oper_up ? 'وصل شد' : p.oper_reason || 'قطع شد' });
    } else if (
      // SNMP: وضعیت همان است ولی ifLastChange عوض شده — یعنی بین دو خواندن
      // قطع و وصل شده و برگشته. بدون این، فلپ‌های سریع اصلا دیده نمی‌شدند.
      p0 && p.last_change_ticks != null && p0.last_change_ticks != null &&
      Number(p0.last_change_ticks) !== p.last_change_ticks && p0.oper_up === p.oper_up
    ) {
      // oper_up تهی: «یک قطع و وصل کامل»، نه تغییر به یک وضعیت
      events.push({ name: p.name, oper_up: null, detail: 'قطع و وصل کوتاه بین دو خواندن' });
    }
    const elapsed = p0?.counters_at ? (nowMs - new Date(p0.counters_at).getTime()) / 1000 : null;

    let inBps = p.in_rate_bps ?? 0;
    let outBps = p.out_rate_bps ?? 0;

    if (p0 && elapsed && elapsed > 0 && COUNTED_KINDS.has(p.kind)) {
      const bits = p.counter_bits ?? 64;
      let dIn = counterDelta(p0.in_bytes, p.in_bytes, bits);
      let dOut = counterDelta(p0.out_bytes, p.out_bytes, bits);
      // شمارنده ۳۲ بیتی: دلتای «سرریز» بیشتر از ظرفیت لینک یعنی در واقع
      // ری‌استارت بوده نه سرریز
      if (bits === 32 && p.speed_mbps) {
        const cap = ((p.speed_mbps * 1e6) / 8) * elapsed * 1.2;
        if (dIn !== null && dIn > cap) dIn = 0;
        if (dOut !== null && dOut > cap) dOut = 0;
      }
      if (dIn !== null && dOut !== null) {
        inBps = Math.round((dIn * 8) / elapsed);
        outBps = Math.round((dOut * 8) / elapsed);
        const errs =
          (counterDelta(p0.in_errors, p.in_errors) ?? 0) +
          (counterDelta(p0.out_errors, p.out_errors) ?? 0) +
          (counterDelta(p0.crc_errors, p.crc_errors) ?? 0);
        const disc =
          (counterDelta(p0.in_discards, p.in_discards) ?? 0) +
          (counterDelta(p0.out_discards, p.out_discards) ?? 0);
        // پورت خاموش بی‌ترافیک ردیف نمی‌گیرد؛ چهل پورت خالی در روز
        // صدهزار ردیف صفر می‌ساختند
        if (p.oper_up !== false || dIn > 0 || dOut > 0) {
          deltas.set(p.name, { in_bytes: dIn, out_bytes: dOut, in_bps: inBps, out_bps: outBps, errors: errs, discards: disc });
        }
      }
    }

    records.push({
      name: p.name,
      kind: p.kind,
      description: p.description,
      admin_up: p.admin_up,
      oper_up: p.oper_up,
      oper_reason: p.oper_reason,
      speed_mbps: p.speed_mbps,
      mtu: p.mtu === null ? null : Math.round(p.mtu),
      mode: p.mode,
      vlan: p.vlan ?? null,
      mac: p.mac,
      member_of: p.member_of,
      hw_type: p.hw_type,
      xcvr_type: p.xcvr_type ?? null,
      last_flap: p.last_flap,
      in_bytes: p.in_bytes,
      out_bytes: p.out_bytes,
      in_errors: p.in_errors,
      out_errors: p.out_errors,
      in_discards: p.in_discards,
      out_discards: p.out_discards,
      crc_errors: p.crc_errors,
      in_bps: p.oper_up === false ? 0 : inBps,
      out_bps: p.oper_up === false ? 0 : outBps,
      transceiver: xcvr ? (xcvr.get(p.name) ?? null) : null,
      if_index: p.if_index ?? null,
      last_change_ticks: p.last_change_ticks ?? null,
    });
  }

  const saved = await q(
    `INSERT INTO switch_ports (
       switch_id, name, kind, description, admin_up, oper_up, oper_reason, speed_mbps, mtu,
       mode, vlan, mac, member_of, hw_type, xcvr_type, last_flap,
       in_bytes, out_bytes, in_errors, out_errors, in_discards, out_discards, crc_errors,
       counters_at, in_bps, out_bps, transceiver, if_index, last_change_ticks,
       is_protected, alert_util, is_present, last_change_at, updated_at
     )
     SELECT $1, r.name, r.kind, r.description, r.admin_up, r.oper_up, r.oper_reason, r.speed_mbps, r.mtu,
            r.mode, r.vlan, r.mac, r.member_of, r.hw_type, r.xcvr_type, r.last_flap,
            r.in_bytes, r.out_bytes, r.in_errors, r.out_errors, r.in_discards, r.out_discards, r.crc_errors,
            $2::timestamptz, r.in_bps, r.out_bps, r.transceiver, r.if_index, r.last_change_ticks,
            -- پورت مدیریت پیش‌فرض محافظت‌شده است: shut کردنش دسترسی پنل
            -- به خود سوییچ را می‌بُرد
            r.kind = 'mgmt', FALSE, TRUE, $2::timestamptz, now()
       FROM jsonb_to_recordset($3::jsonb) AS r(
              name text, kind text, description text, admin_up boolean, oper_up boolean,
              oper_reason text, speed_mbps int, mtu int, mode text, vlan text, mac text,
              member_of text, hw_type text, xcvr_type text, last_flap text,
              in_bytes bigint, out_bytes bigint, in_errors bigint, out_errors bigint,
              in_discards bigint, out_discards bigint, crc_errors bigint,
              in_bps bigint, out_bps bigint, transceiver jsonb, if_index int, last_change_ticks bigint)
     ON CONFLICT (switch_id, name) DO UPDATE SET
       kind           = EXCLUDED.kind,
       description    = EXCLUDED.description,
       admin_up       = EXCLUDED.admin_up,
       oper_up        = EXCLUDED.oper_up,
       oper_reason    = EXCLUDED.oper_reason,
       speed_mbps     = EXCLUDED.speed_mbps,
       mtu            = EXCLUDED.mtu,
       mode           = EXCLUDED.mode,
       vlan           = COALESCE(EXCLUDED.vlan, switch_ports.vlan),
       mac            = EXCLUDED.mac,
       member_of      = EXCLUDED.member_of,
       hw_type        = EXCLUDED.hw_type,
       xcvr_type      = COALESCE(EXCLUDED.xcvr_type, switch_ports.xcvr_type),
       last_flap      = EXCLUDED.last_flap,
       in_bytes       = EXCLUDED.in_bytes,
       out_bytes      = EXCLUDED.out_bytes,
       in_errors      = EXCLUDED.in_errors,
       out_errors     = EXCLUDED.out_errors,
       in_discards    = EXCLUDED.in_discards,
       out_discards   = EXCLUDED.out_discards,
       crc_errors     = EXCLUDED.crc_errors,
       counters_at    = EXCLUDED.counters_at,
       in_bps         = EXCLUDED.in_bps,
       out_bps        = EXCLUDED.out_bps,
       transceiver    = CASE WHEN $4 THEN EXCLUDED.transceiver ELSE switch_ports.transceiver END,
       if_index       = EXCLUDED.if_index,
       last_change_ticks = EXCLUDED.last_change_ticks,
       is_present     = TRUE,
       last_change_at = CASE WHEN switch_ports.oper_up IS DISTINCT FROM EXCLUDED.oper_up
                             THEN EXCLUDED.last_change_at ELSE switch_ports.last_change_at END,
       updated_at     = now()
     RETURNING id, name`,
    [sw.id, ts, JSON.stringify(records), Boolean(xcvr)],
  );
  const idOf = new Map(saved.map((r) => [r.name, r.id]));

  // پورتی که دیگر در خروجی نیست حذف نمی‌شود، فقط علامت می‌خورد
  await q(
    `UPDATE switch_ports
        SET is_present = FALSE, oper_up = NULL, in_bps = 0, out_bps = 0, updated_at = now()
      WHERE switch_id = $1 AND is_present AND NOT (name = ANY($2::text[]))`,
    [sw.id, ports.map((p) => p.name)],
  );

  const metricRows = [];
  for (const [name, d] of deltas) {
    const id = idOf.get(name);
    if (id) metricRows.push({ port_id: id, ...d });
  }
  if (metricRows.length) {
    await q(
      `INSERT INTO switch_port_metrics (port_id, ts, in_bytes, out_bytes, in_bps, out_bps, errors, discards)
       SELECT r.port_id, $1::timestamptz, r.in_bytes, r.out_bytes, r.in_bps, r.out_bps, r.errors, r.discards
         FROM jsonb_to_recordset($2::jsonb) AS r(
                port_id int, in_bytes bigint, out_bytes bigint, in_bps bigint, out_bps bigint,
                errors bigint, discards bigint)
       ON CONFLICT (port_id, ts) DO NOTHING`,
      [ts, JSON.stringify(metricRows)],
    );
  }

  const eventRows = events.map((e) => ({ ...e, port_id: idOf.get(e.name) })).filter((e) => e.port_id);
  if (eventRows.length) {
    await q(
      `INSERT INTO switch_port_events (port_id, ts, oper_up, detail)
       SELECT r.port_id, $1::timestamptz, r.oper_up, r.detail
         FROM jsonb_to_recordset($2::jsonb) AS r(port_id int, oper_up boolean, detail text)`,
      [ts, JSON.stringify(eventRows)],
    );
  }

  if (discovery) await storeDiscovery(sw, discovery, idOf);

  const maxTemp = env?.max_temp_c ?? (sw.max_temp_c === null ? null : Number(sw.max_temp_c));

  await q(
    `UPDATE switches SET
       status          = 'up',
       fail_streak     = 0,
       last_error      = $2,
       last_seen_at    = now(),
       last_poll_at    = now(),
       last_poll_ms    = $3,
       cpu_percent     = COALESCE($4, cpu_percent),
       mem_used_bytes  = COALESCE($5, mem_used_bytes),
       mem_total_bytes = COALESCE($6, mem_total_bytes),
       load1           = COALESCE($7, load1),
       hostname        = COALESCE($8, hostname),
       model           = COALESCE($9, model),
       serial          = COALESCE($10, serial),
       os_version      = COALESCE($11, os_version),
       uptime_sec      = COALESCE($12, uptime_sec),
       env             = CASE WHEN $13 THEN $14::jsonb ELSE env END,
       env_ok          = CASE WHEN $13 THEN $15 ELSE env_ok END,
       env_checked_at  = CASE WHEN $13 THEN now() ELSE env_checked_at END,
       max_temp_c      = $16,
       vendor          = COALESCE($17, vendor),
       sys_object_id   = COALESCE($18, sys_object_id),
       updated_at      = now()
     WHERE id = $1`,
    [
      sw.id,
      notes.length ? notes.join(' | ') : null,
      Date.now() - started,
      res?.cpu_percent ?? null,
      res?.mem_used_bytes ?? null,
      res?.mem_total_bytes ?? null,
      res?.load1 ?? null,
      ver?.hostname ?? null,
      ver?.model ?? null,
      ver?.serial ?? null,
      ver?.os_version ?? null,
      ver?.uptime_sec ?? null,
      Boolean(env),
      env ? JSON.stringify({ temps: env.temps, fans: env.fans, psus: env.psus, problems: env.problems }) : null,
      env ? env.problems.length === 0 : null,
      maxTemp,
      ver?.vendor ?? null,
      ver?.sys_object_id ?? null,
    ],
  );

  if (res) {
    await q(
      `INSERT INTO switch_metrics (switch_id, ts, cpu_percent, mem_used_bytes, mem_total_bytes, load1, max_temp_c)
       VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7)
       ON CONFLICT (switch_id, ts) DO NOTHING`,
      [sw.id, ts, res.cpu_percent, res.mem_used_bytes, res.mem_total_bytes, res.load1, maxTemp],
    );
  }

  await resolveIncident({
    switchId: sw.id,
    kind: 'switch_down',
    recoveryMessage: `پاسارگاد میزبان — سوییچ ${sw.name} دوباره در دسترس است.`,
  });

  if (env) await evaluateEnvironment(sw, env);
  if (res) await evaluateCpu(sw);
  await evaluatePorts(sw, ports, prev, idOf, nowMs);
  await evaluatePortHealth(sw);
  return Boolean(discovery);
}

// ── کشف و پیشنهاد اتصال ────────────────────────────────────

/**
 * همسایه‌ها و MACهای هر پورت، و ARP سوییچ.
 *
 * MAC روی هر پورت حداکثر ۵۰ مورد نگه داشته می‌شود (آپلینک هزاران MAC دارد
 * و نمایش همه‌شان بی‌فایده است)؛ تعداد کامل جداست. اگر خواندن جدول MAC
 * شکست خورده باشد (macs تهی)، MACهای قبلی دست نمی‌خورند — «نخواندیم» با
 * «هیچ MACی نیست» یکی نیست.
 */
async function storeDiscovery(sw, discovery, idOf) {
  const byPort = new Map();
  const entry = (name) => {
    if (!byPort.has(name)) byPort.set(name, { neighbors: [], macs: [], mac_count: 0 });
    return byPort.get(name);
  };
  for (const n of discovery.neighbors ?? []) {
    const { port, ...rest } = n;
    if (idOf.has(port)) entry(port).neighbors.push(rest);
  }
  for (const m of discovery.macs ?? []) {
    if (!idOf.has(m.port)) continue;
    const e = entry(m.port);
    e.mac_count++;
    if (e.macs.length < 50) e.macs.push({ mac: m.mac, vlan: m.vlan });
  }

  const rows = [...idOf].map(([name, id]) => {
    const e = byPort.get(name) ?? { neighbors: [], macs: [], mac_count: 0 };
    return { id, neighbors: e.neighbors, macs: e.macs, mac_count: e.mac_count };
  });
  await q(
    `UPDATE switch_ports p
        SET neighbors     = r.neighbors,
            macs          = CASE WHEN $2 THEN r.macs ELSE p.macs END,
            mac_count     = CASE WHEN $2 THEN r.mac_count ELSE p.mac_count END,
            discovered_at = now()
       FROM jsonb_to_recordset($1::jsonb) AS r(id int, neighbors jsonb, macs jsonb, mac_count int)
      WHERE p.id = r.id`,
    [JSON.stringify(rows), discovery.macs !== null],
  );

  const arp = discovery.arp ?? [];
  const startedAt = new Date().toISOString();
  if (arp.length) {
    await q(
      `INSERT INTO switch_arp (switch_id, ip, mac, interface, seen_at)
       SELECT $1, r.ip::inet, r.mac, r.iface, now()
         FROM jsonb_to_recordset($2::jsonb) AS r(ip text, mac text, iface text)
       ON CONFLICT (switch_id, ip) DO UPDATE SET mac = EXCLUDED.mac, interface = EXCLUDED.interface, seen_at = now()`,
      [sw.id, JSON.stringify(arp)],
    );
  }
  // ورودی‌ای که این بار نبود کنار می‌رود؛ آی‌پی که به MAC دیگری رفته نباید
  // پیشنهاد غلط بسازد
  await q(`DELETE FROM switch_arp WHERE switch_id = $1 AND seen_at < $2::timestamptz`, [sw.id, startedAt]);
}

/** پیشنهاد اتصال پورت به سرور، برای همه سوییچ‌ها با هم */
export async function refreshSuggestions() {
  const ports = await q(
    `SELECT p.id, p.name, p.kind, p.server_id, p.is_protected, p.member_of, p.description,
            p.mac_count, p.macs, p.neighbors, p.suggest_dismissed_server_id
       FROM switch_ports p
       JOIN switches w ON w.id = p.switch_id
      WHERE w.is_active AND p.is_present AND p.discovered_at IS NOT NULL`,
  );
  const servers = await q(
    `SELECT s.id, s.name, s.hostname, host(s.main_ip) AS main_ip,
            COALESCE(array_agg(host(i.ip)) FILTER (WHERE i.ip IS NOT NULL), '{}') AS ips
       FROM servers s
       LEFT JOIN ip_addresses i ON i.server_id = s.id
      WHERE s.is_active
      GROUP BY s.id`,
  );
  // ARP دو روز اخیر؛ قدیمی‌تر ممکن است مال دستگاهی باشد که دیگر نیست
  const arp = await q(`SELECT host(ip) AS ip, mac FROM switch_arp WHERE seen_at > now() - interval '2 days'`);

  const sug = suggestLinks({ ports, servers, arp });
  const rows = ports.map((p) => ({
    id: p.id,
    server_id: sug.get(p.id)?.server_id ?? null,
    reason: sug.get(p.id)?.reason ?? null,
  }));
  if (!rows.length) return;
  await q(
    `UPDATE switch_ports p
        SET suggested_server_id = r.server_id, suggest_reason = r.reason
       FROM jsonb_to_recordset($1::jsonb) AS r(id int, server_id int, reason text)
      WHERE p.id = r.id
        AND (p.suggested_server_id IS DISTINCT FROM r.server_id OR p.suggest_reason IS DISTINCT FROM r.reason)`,
    [JSON.stringify(rows)],
  );
}

// ── سلامت پورت: اشباع، خطا، فلپ ────────────────────────────

const HEALTH_KINDS = ['port_saturated', 'port_errors', 'port_flapping'];

/**
 * سه هشدار برای هر پورت، در یک کوئری:
 *
 *   اشباع  میانگین پنج دقیقه max(ورودی، خروجی) از درصد آستانه ظرفیت لینک
 *          گذشت. فقط پورت‌هایی که «هشدار اشباع» دارند — پورت سرور مشتری که
 *          با تمام ظرفیت کار می‌کند، مشکل نیست.
 *   خطا    مجموع خطای ورودی، خروجی و CRC در پانزده دقیقه از آستانه گذشت.
 *          نشانه کابل یا ماژول خراب. برگشت وقتی نیم ساعت تقریبا بی‌خطا.
 *   فلپ    چند بار قطع و وصل در پانزده دقیقه. برگشت وقتی پانزده دقیقه آرام.
 *
 * خطا و فلپ فقط برای پورت‌هایی که «زیر نظرند»: وصل به سرور، محافظت‌شده،
 * یا با یکی از هشدارها. چهل پورت خالی با کابل شل پیامک نمی‌خواهند.
 */
async function evaluatePortHealth(sw) {
  const utilTh = await settingNum('switch_util_threshold', 90);
  const errTh = await settingNum('switch_err_threshold', 100);
  const flapTh = await settingNum('switch_flap_threshold', 5);

  const rows = await q(
    `SELECT p.id, p.name, p.description, p.server_id, p.speed_mbps, p.alert_util,
            (p.server_id IS NOT NULL OR p.is_protected OR p.alert_down OR p.alert_util) AS watched,
            u.avg_bps, u.n, e.err15, e.err30, f.flaps
       FROM switch_ports p
       LEFT JOIN LATERAL (
         SELECT AVG(GREATEST(m.in_bps, m.out_bps))::float8 AS avg_bps, COUNT(*)::int AS n
           FROM switch_port_metrics m
          WHERE m.port_id = p.id AND m.ts >= now() - interval '5 minutes'
       ) u ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(m.errors) FILTER (WHERE m.ts >= now() - interval '15 minutes'), 0)::float8 AS err15,
                COALESCE(SUM(m.errors), 0)::float8 AS err30
           FROM switch_port_metrics m
          WHERE m.port_id = p.id AND m.ts >= now() - interval '30 minutes'
       ) e ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS flaps
           FROM switch_port_events ev
          WHERE ev.port_id = p.id AND ev.ts >= now() - interval '15 minutes'
       ) f ON TRUE
      WHERE p.switch_id = $1 AND p.is_present AND p.kind IN ('ethernet', 'port-channel')`,
    [sw.id],
  );

  const open = await q(
    `SELECT kind, switch_port_id FROM incidents
      WHERE switch_id = $1 AND resolved_at IS NULL AND kind = ANY($2::text[])`,
    [sw.id, HEALTH_KINDS],
  );
  const isOpen = new Set(open.map((o) => `${o.kind}:${o.switch_port_id}`));

  for (const p of rows) {
    const label = `${p.name}${p.description ? ` (${p.description})` : ''}`;
    const key = { serverId: p.server_id ?? null, switchId: sw.id, switchPortId: p.id };
    const close = async (kind, recoveryMessage = null) => {
      if (isOpen.has(`${kind}:${p.id}`)) await resolveIncident({ ...key, kind, recoveryMessage });
    };

    // اشباع
    const cap = p.speed_mbps ? p.speed_mbps * 1e6 : 0;
    if (p.alert_util && cap && utilTh > 0 && p.n >= 3 && p.avg_bps !== null) {
      const pct = (p.avg_bps / cap) * 100;
      if (pct >= utilTh) {
        await openIncident({
          ...key,
          kind: 'port_saturated',
          severity: 'warning',
          message: `پورت ${label} روی سوییچ ${sw.name} پنج دقیقه است ${formatPercent(pct)} ظرفیت را مصرف می‌کند.`,
          value: pct,
        });
      } else if (pct < utilTh * 0.9) {
        await close('port_saturated');
      }
    } else {
      await close('port_saturated');
    }

    // خطا
    if (p.watched && errTh > 0) {
      if (p.err15 >= errTh) {
        await openIncident({
          ...key,
          kind: 'port_errors',
          severity: 'warning',
          message: `پورت ${label} روی سوییچ ${sw.name} در پانزده دقیقه ${Math.round(p.err15)} خطا داشته — کابل یا ماژول را بررسی کنید.`,
          value: p.err15,
        });
      } else if (p.err30 < Math.max(1, errTh / 10)) {
        await close('port_errors', `پاسارگاد میزبان — خطای پورت ${p.name} روی سوییچ ${sw.name} متوقف شد.`);
      }
    } else {
      await close('port_errors');
    }

    // فلپ
    if (p.watched && flapTh > 0) {
      if (p.flaps >= flapTh) {
        await openIncident({
          ...key,
          kind: 'port_flapping',
          severity: 'warning',
          message: `لینک پورت ${label} روی سوییچ ${sw.name} در پانزده دقیقه ${p.flaps} بار قطع و وصل شده.`,
          value: p.flaps,
        });
      } else if (p.flaps === 0) {
        await close('port_flapping', `پاسارگاد میزبان — لینک پورت ${p.name} روی سوییچ ${sw.name} پایدار شد.`);
      }
    } else {
      await close('port_flapping');
    }
  }
}

async function evaluateEnvironment(sw, env) {
  if (env.problems.length) {
    await openIncident({
      switchId: sw.id,
      kind: 'switch_env',
      severity: 'critical',
      message: `سخت‌افزار سوییچ ${sw.name}: ${env.problems.join('، ')}`,
    });
  } else {
    await resolveIncident({
      switchId: sw.id,
      kind: 'switch_env',
      recoveryMessage: `پاسارگاد میزبان — دما، فن و منبع تغذیه سوییچ ${sw.name} عادی شد.`,
    });
  }
}

/**
 * پردازنده سوییچ: میانگین پنج دقیقه، نه مقدار لحظه‌ای. کنترل‌پلین
 * نکسوس هنگام همگرایی پروتکل‌ها چند ثانیه صددرصد می‌شود و این عادی است.
 * برگشت با حاشیه ده درصد، همان قاعده آستانه‌های سرور.
 */
async function evaluateCpu(sw) {
  const threshold = await settingNum('switch_cpu_threshold', 90);
  if (!(threshold > 0)) return;
  const row = await q1(
    `SELECT AVG(cpu_percent)::float8 AS avg, COUNT(*)::int AS n
       FROM switch_metrics
      WHERE switch_id = $1 AND ts >= now() - interval '5 minutes' AND cpu_percent IS NOT NULL`,
    [sw.id],
  );
  if (!row || row.n < 3 || row.avg === null) return;
  const avg = Number(row.avg);
  if (avg >= threshold) {
    await openIncident({
      switchId: sw.id,
      kind: 'switch_cpu',
      severity: 'warning',
      message: `پردازنده سوییچ ${sw.name} پنج دقیقه است بالای ${formatPercent(threshold)} است (${formatPercent(avg)}).`,
      value: avg,
    });
  } else if (avg < threshold * 0.9) {
    await resolveIncident({ switchId: sw.id, kind: 'switch_cpu' });
  }
}

/**
 * قطعی لینک پورت‌هایی که هشدار رویشان روشن است.
 *
 * پورتی که مدیر shut کرده هشدار نمی‌سازد: قطعی عمدی است. رویداد باز
 * پورتی که هشدارش خاموش شده یا از سوییچ رفته بسته می‌شود، وگرنه
 * یادآوری‌اش تا ابد ادامه پیدا می‌کرد.
 */
async function evaluatePorts(sw, ports, prev, idOf, nowMs) {
  for (const p of ports) {
    const p0 = prev.get(p.name);
    const id = idOf.get(p.name);
    if (!p0 || !id || !p0.alert_down) continue;

    // اگر همین الان عوض شده، last_change_at همین لحظه است
    const changedAt = p0.oper_up !== p.oper_up ? nowMs : p0.last_change_at ? new Date(p0.last_change_at).getTime() : 0;
    const downFor = (nowMs - changedAt) / 1000;
    const serverId = p0.server_id ?? null;

    if (p.admin_up !== false && p.oper_up === false) {
      if (downFor < PORT_DOWN_GRACE_SEC) continue;
      await openIncident({
        serverId,
        switchId: sw.id,
        switchPortId: id,
        kind: 'port_down',
        severity: 'critical',
        message: `پورت ${p.name}${p.description ? ` (${p.description})` : ''} روی سوییچ ${sw.name} قطع شد${p.oper_reason ? `: ${p.oper_reason}` : ''}.`,
      });
    } else if (p.oper_up === true) {
      await resolveIncident({
        serverId,
        switchId: sw.id,
        switchPortId: id,
        kind: 'port_down',
        recoveryMessage: `پاسارگاد میزبان — پورت ${p.name} روی سوییچ ${sw.name} دوباره وصل است.`,
      });
    } else if (p.admin_up === false) {
      await resolveIncident({ serverId, switchId: sw.id, switchPortId: id, kind: 'port_down' });
    }
  }

  await q(
    `UPDATE incidents i SET resolved_at = now()
       FROM switch_ports p
      WHERE i.switch_port_id = p.id AND i.resolved_at IS NULL
        AND i.kind IN ('port_down', 'port_saturated', 'port_errors', 'port_flapping')
        AND p.switch_id = $1
        -- سرورِ پورت عوض شده باشد هم بسته می‌شود؛ کلید رویداد باز سرور را
        -- هم دارد و رویداد قدیمی دیگر هرگز با پورت جور نمی‌شد
        AND (NOT p.is_present OR i.server_id IS DISTINCT FROM p.server_id
             OR (i.kind = 'port_down' AND NOT p.alert_down))`,
    [sw.id],
  );
}

// ── صف shut / no shut ──────────────────────────────────────

/**
 * اجرای درخواست‌های shut/no shut.
 *
 * هر درخواست پیش از اجرا دوباره بررسی می‌شود — محافظت پورت، فعال بودن
 * سوییچ، الگوی نام — چون بین ثبت درخواست و اجرا ممکن است چیزی عوض شده
 * باشد. پس از فرمان، وضعیت واقعی پورت از خود سوییچ خوانده می‌شود: «فرمان
 * بدون خطا رفت» با «پورت واقعا خاموش شد» یکی نیست.
 */
export async function drainSwitchActions() {
  // درخواستی که ورکر وسط اجرایش مرده، تا ابد «در حال اجرا» نماند
  await q(
    `UPDATE switch_actions
        SET status = 'failed', finished_at = now(),
            result = 'اجرا نیمه‌تمام ماند (ورکر ری‌استارت شد). وضعیت پورت را در سوییچ بررسی کنید.'
      WHERE status = 'running' AND started_at < now() - interval '5 minutes'`,
  );

  for (let i = 0; i < 5; i++) {
    const a = await q1(
      `UPDATE switch_actions SET status = 'running', started_at = now()
        WHERE id = (
          SELECT id FROM switch_actions WHERE status = 'pending'
           ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING id, switch_id, port_id, port_name, action, value, save_config, requested_by_name, reason`,
    );
    if (!a) return;
    await runAction(a).catch(async (err) => {
      logErr('اجرای درخواست سوییچ خطا داد:', err.message);
      await q(
        `UPDATE switch_actions SET status = 'failed', finished_at = now(), result = $2 WHERE id = $1`,
        [a.id, err.hint || err.message],
      );
    });
    await snapshotAfterAction(a);
  }
}

/**
 * پس از هر تغییر موفق از پنل، پیکربندی تازه هم پشتیبان می‌شود تا در
 * تاریخچه پیکربندی معلوم باشد کدام نسخه از کدام فرمان آمده. نتیجه فرمان
 * پیش از این ثبت شده؛ کاربر منتظر این نمی‌ماند.
 */
async function snapshotAfterAction(a) {
  if (a.action === 'backup') return;
  const done = await q1(`SELECT status FROM switch_actions WHERE id = $1`, [a.id]);
  if (done?.status !== 'done') return;
  if (!((await settingNum('switch_backup_hours', 24)) > 0)) return;
  const sw = await q1(`SELECT ${SWITCH_COLUMNS}, is_active FROM switches WHERE id = $1`, [a.switch_id]);
  if (!sw?.is_active || !driverFor(sw).canBackup(sw)) return;
  try {
    await takeBackup(sw, 'action', a.requested_by_name);
  } catch (err) {
    log(`پشتیبان پیکربندی پس از فرمان روی ${sw.name} ناموفق: ${driverFor(sw).explain(err)}`);
  }
}

async function runAction(a) {
  const finish = (status, result) =>
    q(`UPDATE switch_actions SET status = $2, result = $3, finished_at = now() WHERE id = $1`, [a.id, status, result]);

  const sw = await q1(`SELECT ${SWITCH_COLUMNS}, is_active FROM switches WHERE id = $1`, [a.switch_id]);
  if (!sw || !sw.is_active) return finish('failed', 'سوییچ غیرفعال یا حذف شده است');
  const driver = driverFor(sw);

  if (a.action === 'backup') {
    if (!driver.canBackup(sw)) return finish('failed', 'پشتیبان پیکربندی فقط برای سوییچ NX-API ممکن است');
    try {
      const r = await takeBackup(sw, 'manual', a.requested_by_name);
      return finish('done', r.changed ? 'پیکربندی ذخیره شد — با نسخه قبلی فرق دارد' : 'پیکربندی بررسی شد — تغییری نسبت به نسخه قبلی ندارد');
    } catch (err) {
      return finish('failed', driver.explain(err));
    }
  }

  const port = a.port_id
    ? await q1(`SELECT id, name, kind, is_protected, if_index FROM switch_ports WHERE id = $1 AND switch_id = $2`, [
        a.port_id,
        a.switch_id,
      ])
    : null;
  if (!port) return finish('failed', 'پورت پیدا نشد');
  // پورت مدیریت، ویلن و لوپ‌بک هرگز؛ خاموش کردن mgmt دسترسی پنل به خود
  // سوییچ را می‌بُرد
  if (!['ethernet', 'port-channel'].includes(port.kind)) {
    return finish('failed', `روی ${port.name} از پنل فرمان اجرا نمی‌شود`);
  }
  if (a.action === 'shutdown' && port.is_protected) {
    return finish('failed', 'پورت محافظت‌شده است و از پنل خاموش نمی‌شود');
  }
  if (!driver.canWrite(sw)) {
    return finish('failed', 'برای این سوییچ اجازه نوشتن تنظیم نشده (کامیونیتی نوشتنی یا «اجازه نوشتن» v3)');
  }

  if (a.action === 'description') return runDescription(a, sw, driver, port, finish);
  if (a.action === 'rate_limit') return runRateLimit(a, sw, driver, port, finish);

  const wantUp = a.action === 'no_shutdown';
  try {
    await driver.setAdmin(sw, port, wantUp);
  } catch (err) {
    return finish('failed', driver.explain(err));
  }

  let saveNote = '';
  if (a.save_config) {
    if (!driver.canSave(sw)) {
      saveNote = ' — ذخیره در startup-config برای این سوییچ از پنل پشتیبانی نمی‌شود';
    } else {
      try {
        await driver.save(sw);
        saveNote = ' و در startup-config ذخیره شد';
      } catch (err) {
        saveNote = ` — ولی ذخیره در startup-config انجام نشد (${driver.explain(err)}) و با ریبوت سوییچ برمی‌گردد`;
      }
    }
  }

  // خواندن وضعیت واقعی پس از فرمان. بعضی سوییچ‌ها وضعیت را با کمی تأخیر
  // به‌روز می‌کنند؛ یک بار دیگر پس از یک ثانیه.
  let after = null;
  for (let i = 0; i < 2 && (!after || after.admin_up !== wantUp); i++) {
    if (i) await new Promise((r) => setTimeout(r, 1000));
    try {
      after = await driver.readPort(sw, port);
    } catch (err) {
      log(`خواندن وضعیت ${port.name} پس از فرمان ناموفق: ${driver.explain(err)}`);
    }
  }

  if (after) {
    await q(
      `UPDATE switch_ports
          SET admin_up = $2, oper_up = $3, oper_reason = $4,
              last_change_at = CASE WHEN oper_up IS DISTINCT FROM $3 THEN now() ELSE last_change_at END,
              in_bps  = CASE WHEN $3 THEN in_bps  ELSE 0 END,
              out_bps = CASE WHEN $3 THEN out_bps ELSE 0 END,
              updated_at = now()
        WHERE id = $1`,
      [port.id, after.admin_up, after.oper_up, after.oper_reason],
    );
  }

  const label = wantUp ? 'روشن (no shutdown)' : 'خاموش (shutdown)';
  log(`سوییچ ${sw.name}: پورت ${port.name} ${label} شد — درخواست ${a.requested_by_name ?? 'نامشخص'}`);

  if (!after) {
    return finish('done', `فرمان پذیرفته شد${saveNote}. خواندن وضعیت بعدی انجام نشد؛ در خواندن بعدی به‌روز می‌شود.`);
  }
  if (after.admin_up !== wantUp) {
    return finish('failed', `فرمان بدون خطا رفت ولی پورت هنوز ${after.admin_up ? 'روشن' : 'خاموش'} است`);
  }
  const link = after.oper_up ? 'لینک بالاست' : `لینک پایین است${after.oper_reason ? ` (${after.oper_reason})` : ''}`;
  return finish('done', `پورت ${label} شد؛ ${link}${saveNote}.`);
}

/** توضیح پورت، روی خود سوییچ؛ پس از موفقیت در پنل هم */
async function runDescription(a, sw, driver, port, finish) {
  if (!driver.canDescribe(sw)) return finish('failed', 'این سوییچ اجازه نوشتن توضیح پورت را ندارد');
  const text = String(a.value ?? '');
  try {
    await driver.setDescription(sw, port, text);
  } catch (err) {
    return finish('failed', driver.explain(err));
  }
  await q(`UPDATE switch_ports SET description = $2, updated_at = now() WHERE id = $1`, [port.id, text.trim() || null]);
  log(`سوییچ ${sw.name}: توضیح ${port.name} «${text}» شد — درخواست ${a.requested_by_name ?? 'نامشخص'}`);
  let saveNote = '';
  if (a.save_config && driver.canSave(sw)) {
    try {
      await driver.save(sw);
      saveNote = ' و در startup-config ذخیره شد';
    } catch (err) {
      saveNote = ` — ولی ذخیره در startup-config انجام نشد (${driver.explain(err)})`;
    }
  }
  return finish('done', text.trim() ? `توضیح پورت «${text.trim()}» شد${saveNote}.` : `توضیح پورت پاک شد${saveNote}.`);
}

/**
 * محدودیت سرعت. روی پورت محافظت‌شده هرگز — محدود کردن آپلینک همه را کند
 * می‌کند. پس از فرمان، وضعیت واقعی از running-config خوانده می‌شود.
 */
async function runRateLimit(a, sw, driver, port, finish) {
  if (!driver.canRateLimit(sw)) return finish('failed', 'محدودیت سرعت فقط برای سوییچ NX-API پشتیبانی می‌شود');
  if (port.is_protected) return finish('failed', 'پورت محافظت‌شده است و محدودیت سرعت نمی‌گیرد');
  const mbps = Number(a.value);
  if (!Number.isInteger(mbps) || mbps < 0 || mbps > 400_000) return finish('failed', 'سرعت نامعتبر است');

  let res;
  try {
    res = await driver.setRateLimit(sw, port, mbps);
  } catch (err) {
    return finish('failed', driver.explain(err));
  }

  let actual = null;
  try {
    actual = await driver.readRateLimit(sw, port);
  } catch (err) {
    log(`خواندن محدودیت ${port.name} پس از فرمان ناموفق: ${driver.explain(err)}`);
  }
  const inMbps = actual ? actual.input : res.input ? mbps : null;
  const outMbps = actual ? actual.output : res.output ? mbps : null;
  await q(
    `UPDATE switch_ports
        SET rate_limit_mbps = $2, rate_limit_in = $3, rate_limit_out = $4, updated_at = now()
      WHERE id = $1`,
    [port.id, inMbps || outMbps || null, Boolean(inMbps), Boolean(outMbps)],
  );

  let saveNote = '';
  if (a.save_config && driver.canSave(sw)) {
    try {
      await driver.save(sw);
      saveNote = ' و در startup-config ذخیره شد';
    } catch (err) {
      saveNote = ` — ولی ذخیره در startup-config انجام نشد (${driver.explain(err)})`;
    }
  }
  log(`سوییچ ${sw.name}: محدودیت ${port.name} ${mbps ? `${mbps}Mbps` : 'برداشته'} شد — درخواست ${a.requested_by_name ?? 'نامشخص'}`);

  if (!mbps) {
    return inMbps || outMbps
      ? finish('failed', 'فرمان رفت ولی محدودیت هنوز روی پورت هست')
      : finish('done', `محدودیت سرعت برداشته شد${saveNote}.`);
  }
  if (inMbps !== mbps) return finish('failed', 'فرمان بدون خطا رفت ولی policy روی ورودی پورت دیده نمی‌شود');
  if (outMbps !== mbps) {
    return finish(
      'done',
      `محدودیت ${mbps} مگابیت فقط روی ورودی (آپلود سرور) گذاشته شد؛ خروجی روی این سوییچ پشتیبانی نشد` +
        `${res.outputError ? ` (${res.outputError})` : ''}${saveNote}.`,
    );
  }
  return finish('done', `محدودیت ${mbps} مگابیت روی هر دو جهت گذاشته شد${saveNote}.`);
}

// ── پشتیبان پیکربندی ───────────────────────────────────────

/**
 * پیکربندی سوییچ‌هایی که وقت پشتیبانشان رسیده. فقط نسخه‌ای که با قبلی فرق
 * دارد ذخیره می‌شود؛ زمان بررسی همیشه ثبت می‌شود تا معلوم باشد پشتیبان‌گیری
 * زنده است.
 */
export async function backupSwitchConfigs() {
  const hours = await settingNum('switch_backup_hours', 24);
  if (!(hours > 0)) return;
  const due = await q(
    `SELECT ${SWITCH_COLUMNS} FROM switches
      WHERE is_active AND protocol = 'nxapi' AND status = 'up'
        AND (config_checked_at IS NULL OR config_checked_at < now() - ($1::text || ' hours')::interval)
      ORDER BY config_checked_at NULLS FIRST
      LIMIT 5`,
    [String(hours)],
  );
  for (const sw of due) {
    try {
      const r = await takeBackup(sw, 'auto', null);
      if (r.changed) log(`پیکربندی سوییچ ${sw.name} تغییر کرده؛ نسخه تازه ذخیره شد`);
    } catch (err) {
      const msg = driverFor(sw).explain(err);
      await q(`UPDATE switches SET config_checked_at = now(), config_error = $2 WHERE id = $1`, [sw.id, msg]);
      logErr(`پشتیبان پیکربندی سوییچ ${sw.name} ناموفق:`, msg);
    }
  }
}

async function takeBackup(sw, trigger, by) {
  const config = await driverFor(sw).backup(sw);
  if (!config || config.length < 20) throw new Error('پیکربندی خالی برگشت');
  const sha = createHash('sha256').update(config).digest('hex');
  const last = await q1(`SELECT sha256 FROM switch_configs WHERE switch_id = $1 ORDER BY taken_at DESC LIMIT 1`, [sw.id]);
  const changed = !last || last.sha256 !== sha;
  if (changed) {
    await q(
      `INSERT INTO switch_configs (switch_id, config, sha256, size_bytes, trigger, taken_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sw.id, config, sha, Buffer.byteLength(config), trigger, by],
    );
  }
  await q(
    `UPDATE switches
        SET config_checked_at = now(), config_error = NULL,
            config_changed_at = CASE WHEN $2 THEN now() ELSE config_changed_at END
      WHERE id = $1`,
    [sw.id, changed],
  );
  return { changed };
}

// ── تجمیع ───────────────────────────────────────────────────

/** تجمیع ساعتی پورت‌ها و منابع سوییچ از نمونه خام */
export async function rollupSwitchHourly(hoursBack = 3) {
  await q(
    `INSERT INTO switch_port_hourly (
       port_id, hour, in_bytes, out_bytes, in_bps_max, out_bps_max, in_bps_avg, out_bps_avg,
       errors, discards, samples
     )
     SELECT port_id, date_trunc('hour', ts),
            COALESCE(SUM(in_bytes), 0), COALESCE(SUM(out_bytes), 0),
            COALESCE(MAX(in_bps), 0), COALESCE(MAX(out_bps), 0),
            COALESCE(AVG(in_bps), 0)::bigint, COALESCE(AVG(out_bps), 0)::bigint,
            COALESCE(SUM(errors), 0), COALESCE(SUM(discards), 0),
            COUNT(*)::int
       FROM switch_port_metrics
      WHERE ts >= date_trunc('hour', now()) - ($1::text || ' hours')::interval
      GROUP BY 1, 2
     ON CONFLICT (port_id, hour) DO UPDATE SET
       in_bytes    = EXCLUDED.in_bytes,
       out_bytes   = EXCLUDED.out_bytes,
       in_bps_max  = EXCLUDED.in_bps_max,
       out_bps_max = EXCLUDED.out_bps_max,
       in_bps_avg  = EXCLUDED.in_bps_avg,
       out_bps_avg = EXCLUDED.out_bps_avg,
       errors      = EXCLUDED.errors,
       discards    = EXCLUDED.discards,
       samples     = EXCLUDED.samples`,
    [String(hoursBack)],
  );

  await q(
    `INSERT INTO switch_metrics_hourly (switch_id, hour, cpu_avg, cpu_max, mem_pct_avg, mem_pct_max, temp_max, samples)
     SELECT switch_id, date_trunc('hour', ts),
            AVG(cpu_percent)::real, MAX(cpu_percent)::real,
            AVG(CASE WHEN mem_total_bytes > 0 THEN mem_used_bytes::float8 / mem_total_bytes * 100 END)::real,
            MAX(CASE WHEN mem_total_bytes > 0 THEN mem_used_bytes::float8 / mem_total_bytes * 100 END)::real,
            MAX(max_temp_c)::real,
            COUNT(*)::int
       FROM switch_metrics
      WHERE ts >= date_trunc('hour', now()) - ($1::text || ' hours')::interval
      GROUP BY 1, 2
     ON CONFLICT (switch_id, hour) DO UPDATE SET
       cpu_avg     = EXCLUDED.cpu_avg,
       cpu_max     = EXCLUDED.cpu_max,
       mem_pct_avg = EXCLUDED.mem_pct_avg,
       mem_pct_max = EXCLUDED.mem_pct_max,
       temp_max    = EXCLUDED.temp_max,
       samples     = EXCLUDED.samples`,
    [String(hoursBack)],
  );
}

/**
 * تجمیع پنج‌دقیقه‌ای برای صدک ۹۵.
 *
 * از حجم بازه حساب می‌شود (بایت × ۸ ÷ ۳۰۰)، نه از میانگین سرعت نمونه‌ها؛
 * همان چیزی که دیتاسنتر از شمارنده‌ها حساب می‌کند. آخرین بازه ناقص در
 * اجرای بعدی دوباره نوشته می‌شود.
 */
export async function rollupSwitch5min(hoursBack = 1) {
  await q(
    `INSERT INTO switch_port_5min (port_id, ts, in_bps, out_bps)
     SELECT port_id, to_timestamp(floor(extract(epoch FROM ts) / 300) * 300),
            (COALESCE(SUM(in_bytes), 0) * 8 / 300)::bigint,
            (COALESCE(SUM(out_bytes), 0) * 8 / 300)::bigint
       FROM switch_port_metrics
      WHERE ts >= date_trunc('hour', now()) - ($1::text || ' hours')::interval
      GROUP BY 1, 2
     ON CONFLICT (port_id, ts) DO UPDATE SET in_bps = EXCLUDED.in_bps, out_bps = EXCLUDED.out_bps`,
    [String(hoursBack)],
  );
}

/** تجمیع روزانه پورت‌ها از ساعتی */
export async function rollupSwitchDaily(daysBack = 3) {
  await q(
    `INSERT INTO switch_port_daily (port_id, day, in_bytes, out_bytes, in_bps_max, out_bps_max, errors, discards, samples)
     SELECT port_id, hour::date,
            COALESCE(SUM(in_bytes), 0), COALESCE(SUM(out_bytes), 0),
            COALESCE(MAX(in_bps_max), 0), COALESCE(MAX(out_bps_max), 0),
            COALESCE(SUM(errors), 0), COALESCE(SUM(discards), 0),
            COALESCE(SUM(samples), 0)::int
       FROM switch_port_hourly
      WHERE hour >= date_trunc('day', now()) - ($1::text || ' days')::interval
      GROUP BY 1, 2
     ON CONFLICT (port_id, day) DO UPDATE SET
       in_bytes    = EXCLUDED.in_bytes,
       out_bytes   = EXCLUDED.out_bytes,
       in_bps_max  = EXCLUDED.in_bps_max,
       out_bps_max = EXCLUDED.out_bps_max,
       errors      = EXCLUDED.errors,
       discards    = EXCLUDED.discards,
       samples     = EXCLUDED.samples`,
    [String(daysBack)],
  );
}

// پورت‌هایی که مبنای ترافیک سرورند. عضوی که پورت‌چنلش هم برای همان
// سرور شمرده می‌شود کنار می‌رود، وگرنه ترافیک دو بار حساب می‌شد.
const COUNTED_PORTS = `
  SELECT p.id AS port_id, p.server_id, COALESCE(p.count_since, now()) AS since
    FROM switch_ports p
    JOIN switches w ON w.id = p.switch_id
   WHERE p.count_traffic AND p.server_id IS NOT NULL AND w.is_active
     AND NOT EXISTS (
       SELECT 1 FROM switch_ports pc
        WHERE pc.switch_id = p.switch_id AND pc.name = p.member_of
          AND pc.count_traffic AND pc.server_id = p.server_id
     )`;

/**
 * ترافیک پورت سوییچ به‌جای ترافیک ایجنت، برای سرورهایی که پورتشان
 * «مبنای ترافیک» است.
 *
 * چرا در تجمیع ساعتی و نه در نمونه خام: نمونه خام همان چیزی است که
 * داشبورد «آخرین ردیف» را از آن می‌خواند. ردیف سوییچ پردازنده و حافظه
 * ندارد؛ اگر کنار ردیف ایجنت نوشته می‌شد، نمای زنده هر چند ثانیه
 * پردازنده را خالی نشان می‌داد. تجمیع ساعتی ولی پایه همه‌چیز پولی است
 * — روزانه، سهمیه، حسابداری، گزارش و پرتال — پس جایگزینی همین‌جا کافی
 * است و مسیر داغ ingest دست نمی‌خورد.
 *
 * جهت: in پورت همان آپلود سرور است (tx) و out پورت دانلودش (rx).
 *
 * باید بعد از rollupHourly سرورها اجرا شود، چون آن هر بار ترافیک ایجنت
 * را دوباره می‌نویسد.
 */
export async function applySwitchTrafficToServers(hoursBack = 3) {
  await q(
    `WITH counted AS (${COUNTED_PORTS}),
     sw AS (
       SELECT c.server_id, h.hour,
              SUM(h.out_bytes)   AS rx_bytes,   SUM(h.in_bytes)    AS tx_bytes,
              SUM(h.out_bps_max) AS rx_bps_max, SUM(h.in_bps_max)  AS tx_bps_max,
              SUM(h.out_bps_avg) AS rx_bps_avg, SUM(h.in_bps_avg)  AS tx_bps_avg
         FROM switch_port_hourly h
         JOIN counted c ON c.port_id = h.port_id
        WHERE h.hour >= date_trunc('hour', now()) - ($1::text || ' hours')::interval
          AND h.hour >= date_trunc('hour', c.since)
        GROUP BY 1, 2
     )
     INSERT INTO server_metrics_hourly (
       server_id, hour, rx_bytes, tx_bytes, rx_bps_max, tx_bps_max, rx_bps_avg, tx_bps_avg, samples
     )
     SELECT server_id, hour, rx_bytes, tx_bytes, rx_bps_max, tx_bps_max, rx_bps_avg, tx_bps_avg, 0
       FROM sw
     ON CONFLICT (server_id, hour) DO UPDATE SET
       rx_bytes   = EXCLUDED.rx_bytes,
       tx_bytes   = EXCLUDED.tx_bytes,
       rx_bps_max = EXCLUDED.rx_bps_max,
       tx_bps_max = EXCLUDED.tx_bps_max,
       rx_bps_avg = EXCLUDED.rx_bps_avg,
       tx_bps_avg = EXCLUDED.tx_bps_avg`,
    [String(hoursBack)],
  );

  // ساعتی که سوییچ داده ندارد (سوییچ از دسترس خارج بوده) ترافیک ایجنت
  // نمی‌گیرد: شمارنده سوییچ پایدار است و همان حجم در اولین خواندن پس از
  // برگشت می‌آید. اگر عدد ایجنت می‌ماند، آن بازه دو بار شمرده می‌شد.
  await q(
    `WITH counted AS (${COUNTED_PORTS}),
     srv AS (SELECT server_id, MIN(since) AS since FROM counted GROUP BY 1)
     UPDATE server_metrics_hourly m
        SET rx_bytes = 0, tx_bytes = 0, rx_bps_max = 0, tx_bps_max = 0, rx_bps_avg = 0, tx_bps_avg = 0
       FROM srv
      WHERE m.server_id = srv.server_id
        AND m.hour >= date_trunc('hour', now()) - ($1::text || ' hours')::interval
        AND m.hour >= date_trunc('hour', srv.since)
        AND (m.rx_bytes <> 0 OR m.tx_bytes <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM switch_port_hourly h
            JOIN counted c ON c.port_id = h.port_id
           WHERE c.server_id = m.server_id AND h.hour = m.hour
        )`,
    [String(hoursBack)],
  );
}

/** پاک‌سازی؛ جدول روزانه پورت مثل سرورها هرگز پاک نمی‌شود */
export async function purgeSwitches() {
  const days = Math.max(1, await settingNum('raw_retention_days', 7));
  await q(`DELETE FROM switch_port_metrics WHERE ts < now() - ($1::text || ' days')::interval`, [String(days)]);
  await q(`DELETE FROM switch_metrics WHERE ts < now() - ($1::text || ' days')::interval`, [String(days)]);
  await q(`DELETE FROM switch_port_hourly WHERE hour < now() - interval '400 days'`);
  await q(`DELETE FROM switch_metrics_hourly WHERE hour < now() - interval '400 days'`);
  await q(`DELETE FROM switch_actions WHERE requested_at < now() - interval '365 days'`);
  const fiveMinDays = Math.max(35, await settingNum('switch_5min_days', 70));
  await q(`DELETE FROM switch_port_5min WHERE ts < now() - ($1::text || ' days')::interval`, [String(fiveMinDays)]);
  await q(`DELETE FROM switch_port_events WHERE ts < now() - interval '90 days'`);
  // ARP سوییچی که دیگر خوانده نمی‌شود
  await q(`DELETE FROM switch_arp WHERE seen_at < now() - interval '7 days'`);
  // تاریخچه پیکربندی: دویست نسخه آخر هر سوییچ
  await q(
    `DELETE FROM switch_configs c
      WHERE c.id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY switch_id ORDER BY taken_at DESC) AS rn FROM switch_configs
        ) x WHERE x.rn > 200
      )`,
  );
}
