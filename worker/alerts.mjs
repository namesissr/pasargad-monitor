import { q, settings, logErr } from './db.mjs';
import { openIncident, resolveIncident } from './incidents.mjs';
import { currentPeriod } from './period.mjs';
import { formatBytes, formatPercent } from './format.mjs';

/**
 * ارزیابی آستانه‌های منابع.
 *
 * دو محافظ در برابر هشدار کاذب:
 *  ۱. میانگین در بازه، نه مقدار لحظه‌ای. یک جهش دوثانیه‌ای پردازنده هشدار نیست.
 *  ۲. حداقل تعداد نمونه. اگر ایجنت تازه نصب شده و فقط سه نمونه دارد، میانگینش
 *     معنا ندارد و هشدار نمی‌سازیم.
 *
 * هشدار کاذب بدتر از نبود هشدار است، چون کاربر یاد می‌گیرد نادیده‌اش بگیرد.
 */

const KIND_LABEL = {
  cpu: 'پردازنده',
  ram: 'حافظه',
  disk: 'دیسک',
  load: 'بار سیستم',
};

/** قانون مؤثر برای هر سرور — قانون اختصاصی بر قانون عمومی می‌چربد */
function effectiveRules(rules, serverId) {
  const out = new Map();
  for (const r of rules) {
    if (r.server_id !== null && r.server_id !== serverId) continue;
    const prev = out.get(r.kind);
    // اختصاصی جایگزین عمومی می‌شود
    if (!prev || (prev.server_id === null && r.server_id !== null)) out.set(r.kind, r);
  }
  return out;
}

export async function evaluateThresholds() {
  const rules = await q(
    `SELECT id, server_id, kind, threshold, duration_sec, send_sms, enabled
       FROM alert_rules WHERE enabled AND kind <> 'down'`,
  );
  if (!rules.length) return;

  const servers = await q(
    `SELECT id, name, cpu_cores, traffic_quota_gb::float8 AS traffic_quota_gb, status
       FROM servers WHERE is_active AND status = 'up'`,
  );
  if (!servers.length) return;

  // برای هر مدت زمانی که در قوانین آمده، یک بار میانگین می‌گیریم
  const durations = Array.from(
    new Set(rules.filter((r) => r.kind !== 'traffic').map((r) => Math.max(60, r.duration_sec || 300))),
  );

  const aggByDuration = new Map();
  for (const d of durations) {
    const rows = await q(
      `SELECT server_id,
              AVG(cpu_percent)::float8 AS cpu,
              AVG(CASE WHEN ram_total_bytes > 0
                       THEN ram_used_bytes::float8 / ram_total_bytes * 100 END)::float8 AS ram,
              AVG(CASE WHEN disk_total_bytes > 0
                       THEN disk_used_bytes::float8 / disk_total_bytes * 100 END)::float8 AS disk,
              AVG(load1)::float8 AS load1,
              COUNT(*)::int AS n,
              EXTRACT(EPOCH FROM (now() - MIN(ts)))::int AS span
         FROM server_metrics
        WHERE ts >= now() - ($1::text || ' seconds')::interval
        GROUP BY server_id`,
      [String(d)],
    );
    aggByDuration.set(d, new Map(rows.map((r) => [r.server_id, r])));
  }

  // مصرف دوره جاری برای هشدار سهمیه
  const s = await settings();
  const period = currentPeriod(s.traffic_calendar || 'jalali');
  const usageRows = await q(
    `SELECT server_id, COALESCE(SUM(rx_bytes + tx_bytes), 0)::float8 AS used
       FROM server_metrics_daily WHERE day BETWEEN $1::date AND $2::date GROUP BY server_id`,
    [period.from, period.to],
  );
  const usage = new Map(usageRows.map((r) => [r.server_id, Number(r.used)]));

  for (const srv of servers) {
    const eff = effectiveRules(rules, srv.id);

    for (const [kind, rule] of eff) {
      try {
        if (kind === 'traffic') {
          await evalTraffic(srv, rule, usage.get(srv.id) ?? 0);
          continue;
        }

        const d = Math.max(60, rule.duration_sec || 300);
        const agg = aggByDuration.get(d)?.get(srv.id);

        // نمونه کافی نداریم — نه هشدار می‌دهیم نه هشدار قبلی را می‌بندیم
        if (!agg || agg.n < 3 || agg.span < d * 0.6) continue;

        let value = null;
        if (kind === 'cpu') value = agg.cpu;
        else if (kind === 'ram') value = agg.ram;
        else if (kind === 'disk') value = agg.disk;
        else if (kind === 'load') value = srv.cpu_cores > 0 ? agg.load1 / srv.cpu_cores : agg.load1;

        if (value === null || !Number.isFinite(value)) continue;

        if (value >= rule.threshold) {
          const shown = kind === 'load' ? value.toFixed(2) : formatPercent(value, 0);
          await openIncident({
            serverId: srv.id,
            kind,
            severity: 'warning',
            message: `${KIND_LABEL[kind]} در ${Math.round(d / 60)} دقیقه اخیر ${shown} بوده و از آستانه ${
              kind === 'load' ? rule.threshold : formatPercent(rule.threshold, 0)
            } گذشته است.`,
            value,
          });
        } else if (value < rule.threshold * 0.9) {
          // برای برگشت، حاشیه ۱۰ درصدی می‌گذاریم تا نوسان دور آستانه،
          // رویداد را مدام باز و بسته نکند
          await resolveIncident({
            serverId: srv.id,
            kind,
            recoveryMessage: `پاسارگاد میزبان — ${KIND_LABEL[kind]} سرور ${srv.name} به وضعیت عادی برگشت.`,
          });
        }
      } catch (err) {
        logErr(`ارزیابی هشدار ${kind} برای سرور ${srv.name} خطا داد:`, err.message);
      }
    }
  }
}

async function evalTraffic(srv, rule, usedBytes) {
  const quotaBytes = Number(srv.traffic_quota_gb || 0) * Math.pow(1024, 3);
  if (quotaBytes <= 0) return; // سهمیه تعریف نشده یعنی نامحدود

  const percent = (usedBytes / quotaBytes) * 100;

  if (percent >= rule.threshold) {
    await openIncident({
      serverId: srv.id,
      kind: 'traffic',
      severity: percent >= 100 ? 'critical' : 'warning',
      message: `مصرف ترافیک دوره جاری ${formatBytes(usedBytes)} است، یعنی ${formatPercent(percent, 0)} از سهمیه ${formatBytes(quotaBytes)}.`,
      value: percent,
    });
  } else if (percent < rule.threshold * 0.9) {
    // دوره تازه شروع شده یا سهمیه بالا رفته
    await resolveIncident({
      serverId: srv.id,
      kind: 'traffic',
      recoveryMessage: `پاسارگاد میزبان — مصرف ترافیک سرور ${srv.name} زیر آستانه برگشت.`,
    });
  }
}
