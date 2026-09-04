import * as virtualizor from './virtualizor.mjs';
import * as solusvm2 from './solusvm2.mjs';

/**
 * انتخاب کلاینت بر اساس نوع نود.
 *
 * موتور کشف و تصمیم هیچ‌جا نمی‌داند با چه هایپروایزری کار می‌کند. همه
 * تفاوت‌ها در همین دو کلاینت است و هر دو یک قرارداد برمی‌گردانند:
 *
 *   listIps(node)    → { ok, items: [{ ipid, ip, vpsid, ippoolid, poolName,
 *                        gateway, netmask, locked, hostname?, customer? }] }
 *   listPools(node)  → { ok, items: [{ poolid, name, gateway, netmask }] }
 *   listVpses(node)  → { ok, items: [{ vpsid, hostname, uid }] }
 *   listUsers(node)  → { ok, items: [{ uid, email, name }] }
 *   writeVpsIps(node, vpsid, ips, opts)
 *
 * اگر کلاینتی چیزی را پشتیبانی نکند، فهرست خالی یا خطای صریح برمی‌گرداند
 * — نه رفتار نصفه.
 */
const CLIENTS = {
  virtualizor,
  solusvm2,
};

export function clientFor(node) {
  const client = CLIENTS[String(node?.kind || 'virtualizor')];
  if (!client) {
    throw new Error(`نوع هایپروایزر ناشناخته: ${node?.kind}`);
  }
  return client;
}

/** آیا این نوع نود نوشتن روی هایپروایزر را پشتیبانی می‌کند؟ */
export function canWrite(node) {
  return String(node?.kind || 'virtualizor') === 'virtualizor';
}
