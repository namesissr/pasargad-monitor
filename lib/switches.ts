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

/** ستون‌های قابل نمایش؛ هیچ رازی در آن نیست، فقط «تنظیم شده یا نه» */
export const SWITCH_PUBLIC_COLUMNS = `
  w.id, w.name, w.protocol, w.url, w.username, w.insecure_tls,
  w.snmp_version, w.snmp_host, w.snmp_port, w.snmp_user, w.snmp_auth_proto, w.snmp_priv_proto,
  w.snmp_write, w.vendor,
  (COALESCE(w.password, '') <> '')             AS has_password,
  (COALESCE(w.snmp_community, '') <> '')       AS has_community,
  (COALESCE(w.snmp_write_community, '') <> '') AS has_write_community,
  (COALESCE(w.snmp_auth_pass, '') <> '')       AS has_auth_pass,
  (COALESCE(w.snmp_priv_pass, '') <> '')       AS has_priv_pass,
  ${SWITCH_CAN_WRITE} AS can_write,
  ${SWITCH_CAN_SAVE}  AS can_save`;
