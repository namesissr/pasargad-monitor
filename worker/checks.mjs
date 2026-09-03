import net from 'node:net';
import { execFile } from 'node:child_process';
import { q, settingNum, log, logErr } from './db.mjs';
import { openIncident, resolveIncident } from './incidents.mjs';
import { formatDuration } from './format.mjs';

/**
 * بررسی سلامت سرورها و آی‌پی‌ها.
 *
 * ترتیب بررسی سرور عمدی است و از ارزان به گران می‌رود:
 *  ۱. ایجنت تازه گزارش داده؟ هیچ کار شبکه‌ای لازم نیست.
 *  ۲. اگر نه، اتصال TCP به پورت SSH. سرور بالاست ولی ایجنت خوابیده.
 *  ۳. اگر نه، پینگ. شاید فایروال پورت را بسته ولی خود ماشین بالاست.
 *  ۴. اگر هیچ‌کدام، سرور قطع است.
 *
 * تفکیک «قطع کامل» از «ایجنت خوابیده» مهم است: اولی یعنی مشتری سرویس ندارد،
 * دومی یعنی فقط آمار نمی‌آید. یک پیامک برای هر دو، هشدارها را بی‌ارزش می‌کند.
 */

const TCP_TIMEOUT_MS = 5_000;
const PING_TIMEOUT_S = 2;

/** اتصال TCP ساده — بدون نیاز به دسترسی ویژه */
export function tcpCheck(host, port, timeout = TCP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, ms: Date.now() - started });
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/** پینگ با دستور سیستمی — کانتینر باید iputils-ping داشته باشد */
export function ping(host) {
  return new Promise((resolve) => {
    execFile(
      'ping',
      ['-n', '-c', '1', '-W', String(PING_TIMEOUT_S), host],
      { timeout: (PING_TIMEOUT_S + 2) * 1000 },
      (err, stdout) => {
        if (err) return resolve({ ok: false, ms: null });
        const m = /time[=<]\s*([\d.]+)\s*ms/i.exec(stdout || '');
        resolve({ ok: true, ms: m ? Number(m[1]) : null });
      },
    );
  });
}

/** اجرای همزمان با سقف — جلوی باز شدن هزاران پروسه پینگ را می‌گیرد */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

export async function checkServers() {
  const downAfter = await settingNum('down_after_sec', 120);

  const servers = await q(
    `SELECT id, name, status, host(main_ip) AS ip, ssh_port, last_seen_at,
            EXTRACT(EPOCH FROM (now() - last_seen_at)) AS since_seen
       FROM servers WHERE is_active`,
  );

  for (const s of servers) {
    // حالت تعمیرات عمداً هیچ هشداری نمی‌سازد
    if (s.status === 'maintenance') continue;

    const since = s.last_seen_at ? Number(s.since_seen) : null;
    const agentFresh = since !== null && since <= downAfter;

    let ok = agentFresh;
    let method = 'agent';
    let latency = null;
    let detail = null;

    if (!agentFresh) {
      const tcp = await tcpCheck(s.ip, s.ssh_port || 22);
      if (tcp.ok) {
        ok = true;
        method = 'tcp';
        latency = tcp.ms;
        detail = 'ایجنت گزارش نمی‌دهد ولی پورت باز است';
      } else {
        const p = await ping(s.ip);
        if (p.ok) {
          ok = true;
          method = 'icmp';
          latency = p.ms;
          detail = 'ایجنت و پورت پاسخ نمی‌دهند ولی پینگ برقرار است';
        } else {
          ok = false;
          method = 'icmp';
          detail = 'نه ایجنت، نه پورت، نه پینگ';
        }
      }
    }

    await q(
      `INSERT INTO server_checks (server_id, ok, method, latency_ms, detail) VALUES ($1, $2, $3, $4, $5)`,
      [s.id, ok, method, latency, detail],
    ).catch((e) => logErr('ثبت نتیجه بررسی ناموفق:', e.message));

    const newStatus = ok ? 'up' : 'down';
    if (s.status !== newStatus) {
      await q('UPDATE servers SET status = $1, updated_at = now() WHERE id = $2', [newStatus, s.id]);
      log(`وضعیت ${s.name} از ${s.status} به ${newStatus} تغییر کرد`);
    }

    if (!ok) {
      const downFor = since === null ? null : Math.round(since);
      await openIncident({
        serverId: s.id,
        kind: 'down',
        severity: 'critical',
        message: `سرور قطع شد. آخرین ارتباط ${downFor === null ? 'ثبت نشده' : formatDuration(downFor) + ' پیش'}.`,
        value: downFor,
      });
      // وقتی سرور کلاً قطع است، هشدار «ایجنت خوابیده» نویز است
      await resolveIncident({ serverId: s.id, kind: 'agent_lost' });
    } else {
      await resolveIncident({
        serverId: s.id,
        kind: 'down',
        recoveryMessage: `پاسارگاد میزبان — سرور ${s.name} دوباره در دسترس است.`,
      });

      if (method !== 'agent') {
        await openIncident({
          serverId: s.id,
          kind: 'agent_lost',
          severity: 'warning',
          message: `سرور بالاست ولی ایجنت گزارش نمی‌فرستد (${detail}). آمار مصرف ثبت نمی‌شود.`,
          value: since,
        });
      } else {
        await resolveIncident({ serverId: s.id, kind: 'agent_lost' });
      }
    }
  }
}

export async function checkIps() {
  // آی‌پی سرورهایی که کلاً قطع‌اند بررسی نمی‌شود؛ وگرنه یک سرور قطع
  // ده‌ها هشدار آی‌پی می‌سازد و پیامک‌ها بی‌ارزش می‌شوند.
  const ips = await q(
    `SELECT i.id, host(i.ip) AS ip, i.ping_ok, i.server_id, s.name AS server_name
       FROM ip_addresses i
       LEFT JOIN servers s ON s.id = i.server_id
      WHERE i.is_monitored
        AND i.status <> 'blocked'
        AND (s.id IS NULL OR (s.status <> 'down' AND s.status <> 'maintenance'))
      ORDER BY i.id`,
  );

  if (!ips.length) return;

  const results = await inBatches(ips, 20, async (row) => {
    const r = await ping(row.ip);
    return { row, ...r };
  });

  for (const { row, ok, ms } of results) {
    await q(
      `UPDATE ip_addresses SET ping_ok = $1, ping_ms = $2, last_ping_at = now() WHERE id = $3`,
      [ok, ms, row.id],
    ).catch((e) => logErr('به‌روزرسانی پینگ آی‌پی ناموفق:', e.message));

    if (!ok) {
      await openIncident({
        serverId: row.server_id,
        ipId: row.id,
        kind: 'ip_down',
        severity: 'warning',
        message: `آی‌پی ${row.ip}${row.server_name ? ` روی ${row.server_name}` : ''} به پینگ پاسخ نمی‌دهد.`,
      });
    } else {
      await resolveIncident({
        serverId: row.server_id,
        ipId: row.id,
        kind: 'ip_down',
        recoveryMessage: `پاسارگاد میزبان — آی‌پی ${row.ip} دوباره پاسخ می‌دهد.`,
      });
    }
  }
}

/**
 * سلامت دیدبان‌های اکسس.
 *
 * اگر دیدبان بمیرد، تشخیص آزادشدن آی‌پی‌ها بی‌صدا می‌ایستد — دقیقاً همان
 * الگوی شکست خاموشی که همه‌جای این پروژه با آن جنگیده‌ایم. دیدبانی که یک
 * ساعت خبری ازش نیست، رویداد و پیامک می‌سازد.
 */
export async function checkProbes() {
  const stale = await q(
    `SELECT name, location FROM probes
      WHERE is_active
        AND COALESCE(last_seen_at, created_at) < now() - interval '1 hour'
      ORDER BY name`,
  );

  if (stale.length) {
    const names = stale.map((p) => `${p.name} (${p.location === 'inside' ? 'داخل' : 'خارج'})`).join('، ');
    await openIncident({
      kind: 'probe_lost',
      severity: 'critical',
      message: `${stale.length} دیدبان اکسس بیش از یک ساعت است گزارش نداده: ${names}. تا برنگردد، آزادشدن آی‌پی‌ها تشخیص داده نمی‌شود.`,
    });
  } else {
    await resolveIncident({
      kind: 'probe_lost',
      recoveryMessage: 'پاسارگاد میزبان — همه دیدبان‌های اکسس دوباره گزارش می‌دهند.',
    });
  }
}
