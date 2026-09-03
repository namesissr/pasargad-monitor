import { q, q1, settingNum, log, logErr } from './db.mjs';
import { notify } from './notify.mjs';
import { clock, formatDuration } from './format.mjs';

/**
 * باز و بسته کردن رویدادها و ارسال پیامک.
 *
 * سه قاعده:
 *  ۱. هر ترکیب «سرور + نوع» فقط یک رویداد باز دارد. وگرنه یک قطعی نیم‌ساعته
 *     صدها ردیف و صدها پیامک می‌سازد.
 *  ۲. پیامک بازیابی فقط وقتی می‌رود که پیامک قطعی رفته باشد. اگر هشدار اولیه
 *     نرفته، «برطرف شد» بی‌معنی و گیج‌کننده است.
 *  ۳. رویدادی که ادمین «دیدم» زده، دیگر پیامک تکراری نمی‌گیرد.
 */

/** باز کردن رویداد اگر از قبل باز نبود. شناسه رویداد را برمی‌گرداند. */
export async function openIncident({ serverId = null, ipId = null, kind, severity = 'critical', message, value = null }) {
  const existing = await q1(
    `SELECT id, notified_at, ack_at FROM incidents
      WHERE resolved_at IS NULL AND kind = $1
        AND server_id IS NOT DISTINCT FROM $2
        AND ip_id IS NOT DISTINCT FROM $3
      ORDER BY started_at DESC LIMIT 1`,
    [kind, serverId, ipId],
  );

  if (existing) return existing;

  const row = await q1(
    `INSERT INTO incidents (server_id, ip_id, kind, severity, message, value)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, notified_at, ack_at`,
    [serverId, ipId, kind, severity, message, value],
  );

  log(`رویداد باز شد: ${kind} — ${message}`);
  return row;
}

/** بستن رویداد باز از این نوع، و در صورت لزوم پیامک بازیابی */
export async function resolveIncident({ serverId = null, ipId = null, kind, recoveryMessage = null }) {
  const row = await q1(
    `UPDATE incidents SET resolved_at = now()
      WHERE id = (
        SELECT id FROM incidents
         WHERE resolved_at IS NULL AND kind = $1
           AND server_id IS NOT DISTINCT FROM $2
           AND ip_id IS NOT DISTINCT FROM $3
         ORDER BY started_at DESC LIMIT 1
      )
      RETURNING id, notified_at, started_at`,
    [kind, serverId, ipId],
  );

  if (!row) return null;

  const durationSec = Math.max(0, Math.round((Date.now() - new Date(row.started_at).getTime()) / 1000));
  log(`رویداد بسته شد: ${kind} پس از ${durationSec} ثانیه`);

  // پیامک بازیابی فقط اگر هشدار اولیه رفته باشد
  if (row.notified_at && recoveryMessage) {
    const text = `${recoveryMessage}\nمدت قطعی: ${formatDuration(durationSec)}\nساعت ${clock()}`;
    await notify(text, row.id).catch((e) => logErr('پیامک بازیابی ارسال نشد:', e.message));
  }

  return row;
}

/**
 * ارسال پیامک برای رویدادهای باز که هنوز اطلاع داده نشده‌اند
 * یا از آخرین اطلاع‌رسانی‌شان زمان تکرار گذشته است.
 */
export async function dispatchNotifications() {
  const repeatMin = await settingNum('alert_repeat_min', 60);

  const pending = await q(
    `SELECT i.id, i.kind, i.severity, i.message, i.notified_at, i.started_at,
            s.name AS server_name, host(s.main_ip) AS server_ip,
            host(a.ip) AS ip_addr,
            COALESCE(r.send_sms, TRUE) AS send_sms
       FROM incidents i
       LEFT JOIN servers s      ON s.id = i.server_id
       LEFT JOIN ip_addresses a ON a.id = i.ip_id
       LEFT JOIN LATERAL (
         SELECT send_sms FROM alert_rules
          WHERE enabled AND kind = i.kind
            AND (server_id = i.server_id OR server_id IS NULL)
          ORDER BY server_id NULLS LAST LIMIT 1
       ) r ON TRUE
      WHERE i.resolved_at IS NULL
        AND i.ack_at IS NULL
        AND (i.notified_at IS NULL OR i.notified_at < now() - ($1::text || ' minutes')::interval)
      ORDER BY i.started_at
      LIMIT 20`,
    [String(repeatMin)],
  );

  for (const inc of pending) {
    if (!inc.send_sms) {
      // قانون پیامک را خاموش کرده؛ فقط علامت می‌زنیم تا دوباره بررسی نشود
      await q('UPDATE incidents SET notified_at = now() WHERE id = $1', [inc.id]);
      continue;
    }

    const target = inc.server_name ? `${inc.server_name} (${inc.server_ip})` : inc.ip_addr || 'نامشخص';
    const repeat = inc.notified_at ? '\n[یادآوری — مشکل هنوز باز است]' : '';
    const text = `پاسارگاد میزبان — هشدار\n${target}\n${inc.message}\nساعت ${clock()}${repeat}`;

    const res = await notify(text, inc.id);
    if (res.sent > 0 || res.failed > 0) {
      await q('UPDATE incidents SET notified_at = now() WHERE id = $1', [inc.id]);
    }
  }
}
