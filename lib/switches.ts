/**
 * قطعه‌های SQL مشترک سوییچ — جدول switches باید با نام «w» صدا زده شده باشد.
 *
 * «می‌شود از پنل shut کرد؟» یک جا تعریف می‌شود و همان در فهرست، جزئیات و
 * مسیر فرمان استفاده می‌شود؛ ورکر هم همین قاعده را در worker/snmp.mjs دارد.
 *   NX-API         همیشه (اجازه را خود نقش کاربر سوییچ تعیین می‌کند)
 *   SNMP v2c       فقط با کامیونیتی نوشتنی جدا
 *   SNMP v3        فقط وقتی «اجازه نوشتن» روشن شده
 */
export const SWITCH_CAN_WRITE = `(CASE
  WHEN w.protocol = 'nxapi' THEN TRUE
  WHEN w.snmp_version = '3' THEN w.snmp_write
  ELSE COALESCE(w.snmp_write_community, '') <> ''
END)`;

/** ذخیره در startup-config: NX-API، یا SNMP روی سیسکو (CISCO-CONFIG-COPY-MIB) */
export const SWITCH_CAN_SAVE = `(w.protocol = 'nxapi' OR COALESCE(w.vendor = 'cisco', FALSE))`;

/**
 * پشتیبان پیکربندی و محدودیت سرعت:
 *   NX-API         همیشه
 *   SNMP           فقط سیسکو (CISCO-CONFIG-COPY-MIB)، با روش انتقال فایل
 *                  (SFTP/TFTP) و اجازه نوشتن — سوییچ فایل را از سرور پنل
 *                  برمی‌دارد یا به آن می‌فرستد. محدودیت سرعت فقط نکسوس، چون
 *                  نحو policy-map همان نکسوس است.
 * همان قاعده worker/snmp.mjs (canBackup، canRateLimit).
 */
export const SWITCH_CAN_BACKUP = `(w.protocol = 'nxapi' OR (
  w.protocol = 'snmp' AND COALESCE(w.vendor = 'cisco', FALSE)
  AND w.config_transfer IN ('sftp', 'tftp') AND ${SWITCH_CAN_WRITE}
))`;
export const SWITCH_CAN_RATE_LIMIT = `(w.protocol = 'nxapi' OR (
  ${SWITCH_CAN_BACKUP} AND COALESCE(w.os_family = 'nxos', FALSE)
))`;

/** ستون‌های قابل نمایش؛ هیچ رازی در آن نیست، فقط «تنظیم شده یا نه» */
export const SWITCH_PUBLIC_COLUMNS = `
  w.id, w.name, w.protocol, w.url, w.username, w.insecure_tls,
  w.snmp_version, w.snmp_host, w.snmp_port, w.snmp_user, w.snmp_auth_proto, w.snmp_priv_proto,
  w.snmp_write, w.vendor, w.os_family, w.config_transfer,
  (COALESCE(w.password, '') <> '')             AS has_password,
  (COALESCE(w.snmp_community, '') <> '')       AS has_community,
  (COALESCE(w.snmp_write_community, '') <> '') AS has_write_community,
  (COALESCE(w.snmp_auth_pass, '') <> '')       AS has_auth_pass,
  (COALESCE(w.snmp_priv_pass, '') <> '')       AS has_priv_pass,
  ${SWITCH_CAN_WRITE} AS can_write,
  ${SWITCH_CAN_SAVE}  AS can_save,
  ${SWITCH_CAN_RATE_LIMIT} AS can_rate_limit,
  ${SWITCH_CAN_BACKUP} AS can_backup`;
