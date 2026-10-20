import { randomInt } from 'node:crypto';
import snmp from 'net-snmp';
import {
  portKind,
  summarizeEnvironment,
  normalizeMac,
  cleanDescription,
  cleanConfig,
  fullPortName,
  isSafePortName,
  interfaceBlock,
  parseServicePolicies,
  rateFromPolicy,
  rateLimitSnippet,
} from './nxapi.mjs';
import { TransferError, expectFile, offerFile } from './transfer.mjs';
import { formatDuration } from './format.mjs';

/**
 * درایور SNMP v2c و v3 — هر برند سوییچی.
 *
 * پورت‌ها و شمارنده‌ها از IF-MIB می‌آیند که استاندارد است و همه دارند.
 * بقیه برای هر برند MIB خودش را دارد؛ هرکدام که سوییچ جواب بدهد خوانده
 * می‌شود و نبودنش خطا نیست:
 *
 *   پردازنده/حافظه  سیسکو: CISCO-PROCESS-MIB، CISCO-MEMORY-POOL-MIB
 *                   بقیه:  HOST-RESOURCES-MIB
 *   سخت‌افزار       سیسکو: CISCO-ENVMON-MIB، یا (نکسوس) CISCO-ENTITY-FRU-CONTROL
 *                          و CISCO-ENTITY-SENSOR
 *                   بقیه:  ENTITY-SENSOR-MIB، و دمای میکروتیک
 *   ویلن            سیسکو: CISCO-VLAN-MEMBERSHIP و VTP، بقیه: Q-BRIDGE-MIB
 *   پورت‌چنل        IEEE8023-LAG-MIB
 *   مدل و سریال     ENTITY-MIB
 *
 * نوشتن (shut/no shut) با ifAdminStatus است و ذخیره پیکربندی با
 * CISCO-CONFIG-COPY-MIB — دومی فقط روی سیسکو.
 *
 * SNMPv3 با کتابخانه net-snmp: USM (احراز هویت MD5/SHA تا SHA-512 و
 * رمزنگاری DES/AES) جایی نیست که پیاده‌سازی دستی‌اش ارزش ریسک داشته باشد.
 */

const O = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',

  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifType: '1.3.6.1.2.1.2.2.1.3',
  ifMtu: '1.3.6.1.2.1.2.2.1.4',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  ifPhysAddress: '1.3.6.1.2.1.2.2.1.6',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifLastChange: '1.3.6.1.2.1.2.2.1.9',
  ifInOctets: '1.3.6.1.2.1.2.2.1.10',
  ifInDiscards: '1.3.6.1.2.1.2.2.1.13',
  ifInErrors: '1.3.6.1.2.1.2.2.1.14',
  ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
  ifOutDiscards: '1.3.6.1.2.1.2.2.1.19',
  ifOutErrors: '1.3.6.1.2.1.2.2.1.20',

  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',

  lagAttachedAggId: '1.2.840.10006.300.43.1.2.1.1.13',
  vmVlan: '1.3.6.1.4.1.9.9.68.1.2.2.1.2',
  vlanTrunkPortDynamicStatus: '1.3.6.1.4.1.9.9.46.1.6.1.1.14',
  dot1dBasePortIfIndex: '1.3.6.1.2.1.17.1.4.1.2',
  dot1qPvid: '1.3.6.1.2.1.17.7.1.4.5.1.1',

  cpmCPUTotal1minRev: '1.3.6.1.4.1.9.9.109.1.1.1.1.7',
  cpmCPUTotal5secRev: '1.3.6.1.4.1.9.9.109.1.1.1.1.6',
  cpmCPUMemoryUsed: '1.3.6.1.4.1.9.9.109.1.1.1.1.12',
  cpmCPUMemoryFree: '1.3.6.1.4.1.9.9.109.1.1.1.1.13',
  ciscoMemoryPoolUsed: '1.3.6.1.4.1.9.9.48.1.1.1.5',
  ciscoMemoryPoolFree: '1.3.6.1.4.1.9.9.48.1.1.1.6',
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2',
  hrStorageType: '1.3.6.1.2.1.25.2.3.1.2',
  hrStorageUnits: '1.3.6.1.2.1.25.2.3.1.4',
  hrStorageSize: '1.3.6.1.2.1.25.2.3.1.5',
  hrStorageUsed: '1.3.6.1.2.1.25.2.3.1.6',
  hrStorageRam: '1.3.6.1.2.1.25.2.1.2',

  envTempDescr: '1.3.6.1.4.1.9.9.13.1.3.1.2',
  envTempValue: '1.3.6.1.4.1.9.9.13.1.3.1.3',
  envTempThreshold: '1.3.6.1.4.1.9.9.13.1.3.1.4',
  envTempState: '1.3.6.1.4.1.9.9.13.1.3.1.6',
  envFanDescr: '1.3.6.1.4.1.9.9.13.1.4.1.2',
  envFanState: '1.3.6.1.4.1.9.9.13.1.4.1.3',
  envSupplyDescr: '1.3.6.1.4.1.9.9.13.1.5.1.2',
  envSupplyState: '1.3.6.1.4.1.9.9.13.1.5.1.3',
  cefcFanTrayOperStatus: '1.3.6.1.4.1.9.9.117.1.4.1.1.1',
  cefcFRUPowerOperStatus: '1.3.6.1.4.1.9.9.117.1.1.2.1.2',
  entSensorType: '1.3.6.1.4.1.9.9.91.1.1.1.1.1',
  entSensorScale: '1.3.6.1.4.1.9.9.91.1.1.1.1.2',
  entSensorPrecision: '1.3.6.1.4.1.9.9.91.1.1.1.1.3',
  entSensorValue: '1.3.6.1.4.1.9.9.91.1.1.1.1.4',
  entSensorStatus: '1.3.6.1.4.1.9.9.91.1.1.1.1.5',
  entPhySensorType: '1.3.6.1.2.1.99.1.1.1.1',
  entPhySensorScale: '1.3.6.1.2.1.99.1.1.1.2',
  entPhySensorPrecision: '1.3.6.1.2.1.99.1.1.1.3',
  entPhySensorValue: '1.3.6.1.2.1.99.1.1.1.4',
  entPhySensorOperStatus: '1.3.6.1.2.1.99.1.1.1.5',
  mtxrHlTemperature: '1.3.6.1.4.1.14988.1.1.3.10.0',
  mtxrHlProcessorTemperature: '1.3.6.1.4.1.14988.1.1.3.11.0',

  entPhysicalClass: '1.3.6.1.2.1.47.1.1.1.1.5',
  entPhysicalName: '1.3.6.1.2.1.47.1.1.1.1.7',
  entPhysicalSoftwareRev: '1.3.6.1.2.1.47.1.1.1.1.10',
  entPhysicalSerialNum: '1.3.6.1.2.1.47.1.1.1.1.11',
  entPhysicalModelName: '1.3.6.1.2.1.47.1.1.1.1.13',

  // LLDP-MIB: اندیس lldpRemTable = timeMark.localPortNum.remIndex
  lldpLocPortId: '1.0.8802.1.1.2.1.3.7.1.3',
  lldpLocPortDesc: '1.0.8802.1.1.2.1.3.7.1.4',
  lldpRemChassisId: '1.0.8802.1.1.2.1.4.1.1.5',
  lldpRemPortId: '1.0.8802.1.1.2.1.4.1.1.7',
  lldpRemPortDesc: '1.0.8802.1.1.2.1.4.1.1.8',
  lldpRemSysName: '1.0.8802.1.1.2.1.4.1.1.9',
  lldpRemSysDesc: '1.0.8802.1.1.2.1.4.1.1.10',
  // CISCO-CDP-MIB: اندیس cdpCacheTable = ifIndex.deviceIndex
  cdpCacheAddress: '1.3.6.1.4.1.9.9.23.1.2.1.1.4',
  cdpCacheDeviceId: '1.3.6.1.4.1.9.9.23.1.2.1.1.6',
  cdpCacheDevicePort: '1.3.6.1.4.1.9.9.23.1.2.1.1.7',
  cdpCachePlatform: '1.3.6.1.4.1.9.9.23.1.2.1.1.8',
  // جدول MAC: Q-BRIDGE (fdbId.mac) و BRIDGE-MIB قدیمی (mac)
  dot1qTpFdbPort: '1.3.6.1.2.1.17.7.1.2.2.1.2',
  dot1dTpFdbPort: '1.3.6.1.2.1.17.4.3.1.2',
  // ARP: اندیس ipNetToMedia = ifIndex.a.b.c.d
  ipNetToMediaPhysAddress: '1.3.6.1.2.1.4.22.1.2',

  // CISCO-CONFIG-COPY-MIB ccCopyEntry
  ccCopyProtocol: '1.3.6.1.4.1.9.9.96.1.1.1.1.2',
  ccCopySourceFileType: '1.3.6.1.4.1.9.9.96.1.1.1.1.3',
  ccCopyDestFileType: '1.3.6.1.4.1.9.9.96.1.1.1.1.4',
  ccCopyServerAddress: '1.3.6.1.4.1.9.9.96.1.1.1.1.5',
  ccCopyFileName: '1.3.6.1.4.1.9.9.96.1.1.1.1.6',
  ccCopyUserName: '1.3.6.1.4.1.9.9.96.1.1.1.1.7',
  ccCopyUserPassword: '1.3.6.1.4.1.9.9.96.1.1.1.1.8',
  ccCopyState: '1.3.6.1.4.1.9.9.96.1.1.1.1.10',
  ccCopyFailCause: '1.3.6.1.4.1.9.9.96.1.1.1.1.13',
  ccCopyEntryRowStatus: '1.3.6.1.4.1.9.9.96.1.1.1.1.14',
  ccCopyServerAddressType: '1.3.6.1.4.1.9.9.96.1.1.1.1.15',
  ccCopyServerAddressRev1: '1.3.6.1.4.1.9.9.96.1.1.1.1.16',
};

// شماره سازمان در sysObjectID ← برند
const VENDORS = {
  9: 'cisco',
  2636: 'juniper',
  14988: 'mikrotik',
  2011: 'huawei',
  30065: 'arista',
  25506: 'h3c',
  11: 'hpe',
  47196: 'aruba',
  1916: 'extreme',
  674: 'dell',
  6027: 'dell',
  12356: 'fortinet',
  4526: 'netgear',
  171: 'dlink',
  890: 'zyxel',
  41112: 'ubiquiti',
  3902: 'zte',
  6486: 'alcatel',
  8072: 'net-snmp',
};

export function vendorOf(sysObjectId) {
  const m = /^\.?1\.3\.6\.1\.4\.1\.(\d+)/.exec(String(sysObjectId ?? ''));
  return m ? VENDORS[Number(m[1])] ?? `enterprise-${m[1]}` : null;
}

export class SnmpError extends Error {
  constructor(message, hint = null) {
    super(message);
    this.hint = hint ?? message;
  }
}

/** پیام قابل اقدام برای خطای SNMP */
export function explainSnmpError(err) {
  if (!err) return 'خطای ناشناخته';
  if (err instanceof SnmpError || err instanceof TransferError) return err.hint;
  const name = err.name || '';
  const msg = String(err.message || '');
  if (name === 'RequestTimedOutError' || /timed out/i.test(msg)) {
    // بسیاری از سوییچ‌ها به کامیونیتی اشتباه، و بعضی به گذرواژه اشتباه v3،
    // اصلا جواب نمی‌دهند؛ پس تایم‌اوت هر سه علت را دارد و نمی‌شود جدا کرد
    return (
      'پاسخی نیامد — کامیونیتی، یا کاربر و گذرواژه‌های SNMPv3 اشتباه است، یا SNMP روی سوییچ ' +
      'روشن نیست، یا سرور پنل به سوییچ راه ندارد (UDP 161 و ACL را بررسی کنید)'
    );
  }
  if (/Unknown User Name/i.test(msg)) return 'کاربر SNMPv3 روی سوییچ تعریف نشده است';
  if (/Wrong Digest/i.test(msg)) return 'گذرواژه احراز هویت یا نوع آن (MD5/SHA) با تنظیم سوییچ نمی‌خواند';
  if (/Decryption/i.test(msg) || err.code === snmp.ResponseInvalidCode?.ECouldNotDecrypt) {
    return 'گذرواژه رمزنگاری یا نوع آن (DES/AES) با تنظیم سوییچ نمی‌خواند';
  }
  if (/Unsupported Security Level/i.test(msg)) {
    return 'سطح امنیت (بدون رمز / فقط احراز هویت / با رمزنگاری) با تعریف کاربر روی سوییچ نمی‌خواند';
  }
  if (/Not In Time Window/i.test(msg)) return 'زمان موتور SNMPv3 ناهمخوان است؛ در خواندن بعدی دوباره تلاش می‌شود';
  if (name === 'RequestFailedError') {
    const st = Number(err.status);
    const E = snmp.ErrorStatus;
    if ([E.NotWritable, E.NoAccess, E.ReadOnly, E.AuthorizationError].includes(st)) {
      return 'سوییچ اجازه نوشتن نداد — کامیونیتی نوشتنی یا write-view کاربر v3 را روی سوییچ بررسی کنید';
    }
    if ([E.NoCreation, E.InconsistentValue, E.WrongValue].includes(st)) {
      return `سوییچ مقدار را نپذیرفت (${E[st] ?? st})`;
    }
    return `سوییچ خطا برگرداند: ${E[st] ?? msg}`;
  }
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'نام میزبان سوییچ پیدا نشد (DNS)';
  return msg || 'خطای ناشناخته';
}

// ── نشست و کمک‌تابع‌ها ───────────────────────────────────────

const AUTH = {
  none: null,
  md5: snmp.AuthProtocols.md5,
  sha: snmp.AuthProtocols.sha,
  sha224: snmp.AuthProtocols.sha224,
  sha256: snmp.AuthProtocols.sha256,
  sha384: snmp.AuthProtocols.sha384,
  sha512: snmp.AuthProtocols.sha512,
};
const PRIV = {
  none: null,
  des: snmp.PrivProtocols.des,
  aes: snmp.PrivProtocols.aes,
  aes256b: snmp.PrivProtocols.aes256b,
  aes256r: snmp.PrivProtocols.aes256r,
};

/**
 * سطح امنیت v3 از روی اینکه کدام گذرواژه داده شده. «authPriv» فقط وقتی
 * هر دو گذرواژه و پروتکل هست — بدون رمز ماندن نباید بی‌صدا رخ دهد، پس
 * پنل هنگام ذخیره همین را به ادمین نشان می‌دهد.
 */
export function v3User(sw) {
  const auth = AUTH[sw.snmp_auth_proto] ?? null;
  const priv = PRIV[sw.snmp_priv_proto] ?? null;
  const user = { name: String(sw.snmp_user || ''), level: snmp.SecurityLevel.noAuthNoPriv };
  if (auth && sw.snmp_auth_pass) {
    user.level = snmp.SecurityLevel.authNoPriv;
    user.authProtocol = auth;
    user.authKey = String(sw.snmp_auth_pass);
    if (priv && sw.snmp_priv_pass) {
      user.level = snmp.SecurityLevel.authPriv;
      user.privProtocol = priv;
      user.privKey = String(sw.snmp_priv_pass);
    }
  }
  return user;
}

function openSession(sw, { write = false } = {}) {
  const host = String(sw.snmp_host || '').trim();
  const options = {
    port: Number(sw.snmp_port) || 161,
    retries: 1,
    timeout: 4000,
    transport: host.includes(':') ? 'udp6' : 'udp4',
    backwardsGetNexts: false,
  };
  let session;
  if (sw.snmp_version === '3') {
    session = snmp.createV3Session(host, v3User(sw), { ...options, version: snmp.Version3 });
  } else {
    const community = write ? sw.snmp_write_community : sw.snmp_community;
    session = snmp.createSession(host, String(community || ''), { ...options, version: snmp.Version2c });
  }
  // بدون شنونده، خطای سوکت UDP رویداد error بی‌صاحب می‌شد و کل ورکر را می‌کشت
  session.on('error', () => {});
  return session;
}

function getOids(session, oids) {
  return new Promise((resolve, reject) => {
    session.get(oids, (err, varbinds) => {
      if (err) return reject(err);
      const out = new Map();
      for (const vb of varbinds) {
        if (!snmp.isVarbindError(vb)) out.set(vb.oid, vb.value);
      }
      resolve(out);
    });
  });
}

/** پیمایش یک ستون جدول. کلید، باقی OID پس از ستون است (شماره ردیف). */
function walk(session, base, maxRepetitions = 40) {
  return new Promise((resolve, reject) => {
    const out = new Map();
    const prefix = base + '.';
    session.subtree(
      base,
      maxRepetitions,
      (varbinds) => {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          if (vb.oid.startsWith(prefix)) out.set(vb.oid.slice(prefix.length), vb.value);
        }
      },
      (err) => (err ? reject(err) : resolve(out)),
    );
  });
}

function setOids(session, varbinds) {
  return new Promise((resolve, reject) => {
    session.set(varbinds, (err, res) => {
      if (err) return reject(err);
      for (const vb of res) {
        if (snmp.isVarbindError(vb)) return reject(new SnmpError(snmp.varbindError(vb), 'سوییچ مقدار را نپذیرفت: ' + snmp.varbindError(vb)));
      }
      resolve(res);
    });
  });
}

// ── تبدیل مقدار ────────────────────────────────────────────

/** عدد از هر نوع SNMP؛ Counter64 به شکل بافر می‌آید */
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (Buffer.isBuffer(v)) {
    if (!v.length) return 0;
    return Number(BigInt('0x' + v.toString('hex')));
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function str(v) {
  if (v === null || v === undefined) return null;
  const s = (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)).replace(/\0/g, '').trim();
  return s || null;
}

function mac(v) {
  if (!Buffer.isBuffer(v) || v.length !== 6) return null;
  return [...v].map((b) => b.toString(16).padStart(2, '0')).join(':');
}

const IF_TYPE_NAME = {
  6: 'ethernetCsmacd',
  24: 'softwareLoopback',
  53: 'propVirtual',
  117: 'gigabitEthernet',
  131: 'tunnel',
  135: 'l2vlan',
  136: 'l3ipvlan',
  161: 'ieee8023adLag',
  209: 'bridge',
};

/** نوع پورت از ifType، و اگر مبهم بود از نام */
export function snmpPortKind(name, ifType) {
  const n = String(name ?? '').toLowerCase();
  if (n.startsWith('mgmt') || n === 'management' || n.startsWith('me0') || n.startsWith('fxp0')) return 'mgmt';
  if (ifType === 161) return 'port-channel';
  if (ifType === 24) return 'loopback';
  // Vl10 در IOS، Vlan10 در NX-OS، vlanif10 در هوآوی
  if (ifType === 135 || ifType === 136 || /^(vlan|vl\d)/.test(n)) return 'vlan';
  if (/^(bond|ae\d|eth-trunk|trunk|lag|po\d|port-channel)/.test(n)) return 'port-channel';
  if (ifType === 6 || ifType === 62 || ifType === 69 || ifType === 117) {
    return 'ethernet';
  }
  const k = portKind(name);
  return k === 'other' && /^(ge|xe|et|te|gi|fa|10ge|25ge|40ge|100ge|ether|sfp|qsfp|swp)/.test(n) ? 'ethernet' : k;
}

const OPER_REASON = { 2: 'down', 5: 'dormant', 6: 'notPresent', 7: 'lowerLayerDown' };

/**
 * ستون‌های IF-MIB ← پورت‌ها به همان شکلی که درایور NX-API می‌دهد.
 * تابع خالص است تا بدون سوییچ آزموده شود.
 */
export function buildPorts(cols, uptimeTicks, extra = {}) {
  const get = (c, idx) => cols[c]?.get(idx);
  const indexes = new Set([...(cols.ifDescr?.keys() ?? []), ...(cols.ifName?.keys() ?? [])]);
  const nameOf = new Map();
  const seen = new Set();

  for (const idx of indexes) {
    let name = str(get('ifName', idx)) || str(get('ifDescr', idx)) || `if${idx}`;
    // نام تکراری (چند lo یا چند پورت مجازی هم‌نام) کلید یکتای پورت را
    // می‌شکست و کل درج آن خواندن شکست می‌خورد
    if (seen.has(name)) name = `${name} #${idx}`;
    seen.add(name);
    nameOf.set(idx, name);
  }

  const ports = [];
  for (const idx of indexes) {
    const name = nameOf.get(idx);
    const ifType = num(get('ifType', idx));
    const admin = num(get('ifAdminStatus', idx));
    const oper = num(get('ifOperStatus', idx));
    const adminUp = admin === 1 ? true : admin === 2 ? false : null;
    const operUp = oper === 1 ? true : OPER_REASON[oper] ? false : null;

    const hc = cols.ifHCInOctets?.has(idx) && cols.ifHCOutOctets?.has(idx);
    const highSpeed = num(get('ifHighSpeed', idx));
    const speed = num(get('ifSpeed', idx));

    let lastFlap = null;
    const lc = num(get('ifLastChange', idx));
    if (lc !== null && uptimeTicks !== null && uptimeTicks >= lc) {
      lastFlap = `${formatDuration(Math.round((uptimeTicks - lc) / 100))} پیش`;
    }

    const agg = num(extra.lag?.get(idx));
    const vlanInfo = extra.vlans?.get(idx) ?? null;

    ports.push({
      name,
      kind: snmpPortKind(name, ifType),
      description: str(get('ifAlias', idx)),
      admin_up: adminUp,
      oper_up: operUp,
      oper_reason: adminUp === false ? 'Administratively down' : operUp === false ? OPER_REASON[oper] : null,
      speed_mbps: highSpeed && highSpeed > 0 ? highSpeed : speed && speed > 0 ? Math.round(speed / 1e6) : null,
      mtu: num(get('ifMtu', idx)),
      mode: vlanInfo?.mode ?? null,
      vlan: vlanInfo?.vlan ?? null,
      mac: mac(get('ifPhysAddress', idx)),
      member_of: agg && agg > 0 && String(agg) !== idx ? nameOf.get(String(agg)) ?? null : null,
      hw_type: ifType === null ? null : IF_TYPE_NAME[ifType] ?? `ifType ${ifType}`,
      xcvr_type: null,
      last_flap: lastFlap,
      in_bytes: num(get(hc ? 'ifHCInOctets' : 'ifInOctets', idx)),
      out_bytes: num(get(hc ? 'ifHCOutOctets' : 'ifOutOctets', idx)),
      in_errors: num(get('ifInErrors', idx)),
      out_errors: num(get('ifOutErrors', idx)),
      in_discards: num(get('ifInDiscards', idx)),
      out_discards: num(get('ifOutDiscards', idx)),
      crc_errors: null,
      in_rate_bps: null,
      out_rate_bps: null,
      if_index: Number(idx),
      counter_bits: hc ? 64 : 32,
      // برای تشخیص قطع و وصلی که بین دو خواندن رخ داده و برگشته
      last_change_ticks: lc,
    });
  }
  return ports;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const nums = (m) => [...(m?.values() ?? [])].map(num).filter((x) => x !== null);

/** پردازنده و حافظه؛ هر MIB که جواب داد */
export function buildResources(c) {
  let cpu = avg(nums(c.cpm1min));
  if (cpu === null) cpu = avg(nums(c.cpm5sec));
  if (cpu === null) cpu = avg(nums(c.hrProcessorLoad));

  let used = null;
  let total = null;
  const cpmUsed = nums(c.cpmMemUsed);
  const cpmFree = nums(c.cpmMemFree);
  if (cpmUsed.length && cpmFree.length) {
    // CISCO-PROCESS-MIB به کیلوبایت
    used = cpmUsed.reduce((a, b) => a + b, 0) * 1024;
    total = used + cpmFree.reduce((a, b) => a + b, 0) * 1024;
  } else if (c.poolUsed?.size && c.poolFree?.size) {
    used = nums(c.poolUsed).reduce((a, b) => a + b, 0);
    total = used + nums(c.poolFree).reduce((a, b) => a + b, 0);
  } else if (c.hrStorageType?.size) {
    for (const [idx, type] of c.hrStorageType) {
      if (String(type) !== O.hrStorageRam) continue;
      const units = num(c.hrStorageUnits?.get(idx)) ?? 1;
      const size = num(c.hrStorageSize?.get(idx));
      const u = num(c.hrStorageUsed?.get(idx));
      if (size !== null && u !== null) {
        total = size * units;
        used = u * units;
        break;
      }
    }
  }

  if (cpu === null && total === null) return null;
  return {
    cpu_percent: cpu === null ? null : Math.max(0, Math.min(100, cpu)),
    mem_used_bytes: used,
    mem_total_bytes: total,
    load1: null,
  };
}

/** مقدار حسگر با مقیاس و دقت ENTITY-SENSOR (units=9 یعنی ضریب یک) */
export function sensorValue(raw, scale, precision) {
  const v = num(raw);
  if (v === null) return null;
  const s = num(scale) ?? 9;
  const p = num(precision) ?? 0;
  return (v * Math.pow(10, 3 * (s - 9))) / Math.pow(10, p);
}

const ENV_STATE = { 1: 'normal', 2: 'warning', 3: 'critical', 4: 'shutdown', 5: 'notPresent', 6: 'notFunctioning' };
const FAN_TRAY = { 1: 'unknown', 2: 'up', 3: 'down', 4: 'warning' };
const FRU_POWER = {
  1: 'offEnvOther', 2: 'on', 3: 'offAdmin', 4: 'offDenied', 5: 'offEnvPower', 6: 'offEnvTemp',
  7: 'offEnvFan', 8: 'failed', 9: 'onButFanFail', 10: 'offCooling', 11: 'offConnectorRating',
  12: 'onButInlinePowerFail',
};

/** سخت‌افزار از هر MIB که جواب داد، به شکل مشترک با NX-API */
export function buildEnvironment(c) {
  const temps = [];
  const fans = [];
  const psus = [];
  const entName = (idx) => str(c.entName?.get(idx)) || `#${idx}`;

  if (c.envTempValue?.size || c.envFanState?.size || c.envSupplyState?.size) {
    for (const [idx, val] of c.envTempValue ?? []) {
      const st = num(c.envTempState?.get(idx));
      const cur = num(val);
      const major = num(c.envTempThreshold?.get(idx));
      if (st === 5) continue;
      temps.push({
        name: str(c.envTempDescr?.get(idx)) || `#${idx}`,
        current: cur,
        minor: null,
        major,
        alarm: ENV_STATE[st] ?? null,
        ok: !(st >= 2 && st !== 5) && !(cur !== null && major && cur >= major),
      });
    }
    for (const [idx, sv] of c.envFanState ?? []) {
      const st = num(sv);
      fans.push({ name: str(c.envFanDescr?.get(idx)) || `#${idx}`, status: ENV_STATE[st] ?? String(st), ok: st === 1 || st === 5, absent: st === 5 });
    }
    for (const [idx, sv] of c.envSupplyState ?? []) {
      const st = num(sv);
      psus.push({ name: str(c.envSupplyDescr?.get(idx)) || `#${idx}`, status: ENV_STATE[st] ?? String(st), ok: st === 1 || st === 5, absent: st === 5 });
    }
  } else {
    for (const [idx, sv] of c.fanTray ?? []) {
      const st = num(sv);
      fans.push({ name: entName(idx), status: FAN_TRAY[st] ?? String(st), ok: st === 2 || st === 1, absent: false });
    }
    for (const [idx, sv] of c.fruPower ?? []) {
      const st = num(sv);
      // offAdmin عمدی است و مشکل حساب نمی‌شود
      psus.push({ name: entName(idx), status: FRU_POWER[st] ?? String(st), ok: st === 2 || st === 3, absent: false });
    }
    // CISCO-ENTITY-SENSOR، یا اگر نبود ENTITY-SENSOR استاندارد؛ نوع ۸ = سلسیوس
    const ciscoSensors = c.ciscoSensorType?.size;
    const typeMap = ciscoSensors ? c.ciscoSensorType : c.sensorType;
    const pre = ciscoSensors ? 'cisco' : '';
    for (const [idx, t] of typeMap ?? []) {
      if (num(t) !== 8) continue;
      const v = sensorValue(
        c[pre ? 'ciscoSensorValue' : 'sensorValue']?.get(idx),
        c[pre ? 'ciscoSensorScale' : 'sensorScale']?.get(idx),
        c[pre ? 'ciscoSensorPrecision' : 'sensorPrecision']?.get(idx),
      );
      const st = num(c[pre ? 'ciscoSensorStatus' : 'sensorStatus']?.get(idx));
      if (v === null || st === 2) continue; // unavailable
      temps.push({ name: entName(idx), current: Math.round(v * 10) / 10, minor: null, major: null, alarm: null, ok: st !== 3 });
    }
  }

  // میکروتیک: دمای برد و پردازنده، به دهم درجه
  for (const [label, key] of [['Board', 'mtxrTemp'], ['CPU', 'mtxrCpuTemp']]) {
    const v = num(c[key]);
    if (v !== null && v > 0) temps.push({ name: label, current: v / 10, minor: null, major: null, alarm: null, ok: true });
  }

  if (!temps.length && !fans.length && !psus.length) return null;
  return summarizeEnvironment(temps, fans, psus);
}

/** خانواده سیستم‌عامل سیسکو از sysDescr؛ نحو فرمان‌های پیکربندی به آن بستگی دارد */
export function osFamilyOf(descr) {
  const d = String(descr ?? '');
  if (/NX-OS/i.test(d)) return 'nxos';
  if (/IOS[ -]XE/i.test(d)) return 'iosxe';
  if (/Cisco IOS/i.test(d)) return 'ios';
  return null;
}

/** «Version 9.3(8)» از sysDescr سیسکو، و الگوهای رایج بقیه */
export function versionFromDescr(descr) {
  const s = String(descr ?? '');
  const m =
    /Version\s+([0-9][\w.()-]*)/i.exec(s) ||
    /RouterOS\s+([0-9][\w.]*)/i.exec(s) ||
    /JUNOS\s+([0-9][\w.-]*)/i.exec(s) ||
    /\bV(\d{3}R\d{3}\w*)/.exec(s);
  return m ? m[1].replace(/,$/, '') : null;
}

// ── کشف ────────────────────────────────────────────────────

/** شش عدد انتهای اندیس OID به MAC */
function macFromIndex(parts) {
  if (parts.length < 6) return null;
  const bytes = parts.slice(-6).map(Number);
  if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(':');
}

/**
 * ستون‌های کشف ← همسایه‌ها، MACها و ARP به همان شکلی که NX-API می‌دهد.
 * nameOf: ifIndex ← نام پورت، از همان خواندن.
 */
export function buildDiscovery(c, nameOf) {
  const portOf = (ifIndex) => nameOf.get(String(ifIndex)) ?? null;
  const portNames = new Set(nameOf.values());

  // LLDP: شماره پورت محلی گاهی همان ifIndex است و گاهی شماره جدا که نامش
  // در lldpLocPortId یا lldpLocPortDesc است
  const localPort = (num) => {
    for (const key of ['lldpLocPortId', 'lldpLocPortDesc']) {
      const v = str(c[key]?.get(String(num)));
      if (v && portNames.has(v)) return v;
    }
    return portOf(num);
  };

  const neighbors = [];
  for (const [idx, sysName] of c.lldpRemSysName ?? []) {
    const parts = idx.split('.');
    if (parts.length < 3) continue;
    const port = localPort(parts[1]);
    if (!port) continue;
    const pid = c.lldpRemPortId?.get(idx);
    neighbors.push({
      port,
      proto: 'lldp',
      sys_name: str(sysName),
      port_id: Buffer.isBuffer(pid) && pid.length === 6 ? normalizeMac(pid) : str(pid),
      port_desc: str(c.lldpRemPortDesc?.get(idx)),
      platform: str(c.lldpRemSysDesc?.get(idx))?.slice(0, 120) ?? null,
      mgmt_ip: null,
      chassis_id: Buffer.isBuffer(c.lldpRemChassisId?.get(idx)) && c.lldpRemChassisId.get(idx).length === 6
        ? normalizeMac(c.lldpRemChassisId.get(idx))
        : str(c.lldpRemChassisId?.get(idx)),
      caps: [],
    });
  }
  for (const [idx, devId] of c.cdpCacheDeviceId ?? []) {
    const [ifIndex] = idx.split('.');
    const port = portOf(ifIndex);
    if (!port) continue;
    const addr = c.cdpCacheAddress?.get(idx);
    neighbors.push({
      port,
      proto: 'cdp',
      sys_name: str(devId)?.replace(/\(.*\)$/, '').trim() ?? null,
      port_id: str(c.cdpCacheDevicePort?.get(idx)),
      port_desc: null,
      platform: str(c.cdpCachePlatform?.get(idx)),
      mgmt_ip: Buffer.isBuffer(addr) && addr.length === 4 ? [...addr].join('.') : null,
      chassis_id: null,
      caps: [],
    });
  }

  // MAC: Q-BRIDGE اگر بود، وگرنه BRIDGE-MIB. مقدار شماره پورت پل است، نه ifIndex.
  const bridgeToIf = new Map([...(c.basePortIfIndex ?? [])].map(([bp, ifi]) => [bp, String(num(ifi))]));
  const ifOfBridge = (bp) => bridgeToIf.get(String(bp)) ?? String(bp);
  const macs = [];
  const qb = c.qFdbPort?.size ? c.qFdbPort : null;
  for (const [idx, bp] of qb ?? c.dFdbPort ?? []) {
    const parts = idx.split('.');
    const mac = macFromIndex(parts);
    const port = portOf(ifOfBridge(num(bp)));
    if (!mac || !port || !num(bp)) continue;
    macs.push({ port, mac, vlan: qb && parts.length >= 7 ? parts[0] : null });
  }

  const arp = [];
  for (const [idx, phys] of c.arpPhys ?? []) {
    const parts = idx.split('.');
    if (parts.length < 5) continue;
    const ip = parts.slice(-4).join('.');
    const mac = normalizeMac(phys);
    if (!mac || mac === '00:00:00:00:00:00') continue;
    arp.push({ ip, mac, iface: portOf(parts[0]) });
  }

  return { neighbors, macs, arp };
}

// ── خواندن ─────────────────────────────────────────────────

async function readVlans(s, vendor, soft) {
  const out = new Map();
  if (vendor === 'cisco') {
    const vm = (await soft(walk(s, O.vmVlan))) ?? new Map();
    const trunk = (await soft(walk(s, O.vlanTrunkPortDynamicStatus))) ?? new Map();
    for (const [idx, v] of vm) out.set(idx, { vlan: String(num(v)), mode: 'access' });
    for (const [idx, v] of trunk) {
      if (num(v) === 1) out.set(idx, { vlan: 'trunk', mode: 'trunk' });
      else if (!out.has(idx)) out.set(idx, { vlan: null, mode: 'access' });
    }
    if (out.size) return out;
  }
  const basePort = (await soft(walk(s, O.dot1dBasePortIfIndex))) ?? new Map();
  if (!basePort.size) return out;
  const pvid = (await soft(walk(s, O.dot1qPvid))) ?? new Map();
  for (const [bp, ifIdx] of basePort) {
    const v = num(pvid.get(bp));
    if (v !== null) out.set(String(num(ifIdx)), { vlan: String(v), mode: null });
  }
  return out;
}

async function readResources(s, vendor, soft) {
  const c = {};
  if (vendor === 'cisco') {
    c.cpm1min = await soft(walk(s, O.cpmCPUTotal1minRev));
    if (!c.cpm1min?.size) c.cpm5sec = await soft(walk(s, O.cpmCPUTotal5secRev));
    c.cpmMemUsed = await soft(walk(s, O.cpmCPUMemoryUsed));
    c.cpmMemFree = await soft(walk(s, O.cpmCPUMemoryFree));
    if (!c.cpmMemUsed?.size) {
      c.poolUsed = await soft(walk(s, O.ciscoMemoryPoolUsed));
      c.poolFree = await soft(walk(s, O.ciscoMemoryPoolFree));
    }
  }
  if (!c.cpm1min?.size && !c.cpm5sec?.size) c.hrProcessorLoad = await soft(walk(s, O.hrProcessorLoad));
  if (!c.cpmMemUsed?.size && !c.poolUsed?.size) {
    c.hrStorageType = await soft(walk(s, O.hrStorageType));
    if (c.hrStorageType?.size) {
      c.hrStorageUnits = await soft(walk(s, O.hrStorageUnits));
      c.hrStorageSize = await soft(walk(s, O.hrStorageSize));
      c.hrStorageUsed = await soft(walk(s, O.hrStorageUsed));
    }
  }
  return buildResources(c);
}

async function readEnvironment(s, vendor, soft) {
  const c = {};
  const w = async (key, oid) => {
    c[key] = (await soft(walk(s, oid))) ?? new Map();
  };
  if (vendor === 'cisco') {
    await w('envTempValue', O.envTempValue);
    await w('envFanState', O.envFanState);
    await w('envSupplyState', O.envSupplyState);
    if (c.envTempValue.size || c.envFanState.size || c.envSupplyState.size) {
      await w('envTempDescr', O.envTempDescr);
      await w('envTempThreshold', O.envTempThreshold);
      await w('envTempState', O.envTempState);
      await w('envFanDescr', O.envFanDescr);
      await w('envSupplyDescr', O.envSupplyDescr);
      return buildEnvironment(c);
    }
    await w('fanTray', O.cefcFanTrayOperStatus);
    await w('fruPower', O.cefcFRUPowerOperStatus);
    await w('ciscoSensorType', O.entSensorType);
    if (c.ciscoSensorType.size) {
      await w('ciscoSensorScale', O.entSensorScale);
      await w('ciscoSensorPrecision', O.entSensorPrecision);
      await w('ciscoSensorValue', O.entSensorValue);
      await w('ciscoSensorStatus', O.entSensorStatus);
    }
  }
  if (!c.ciscoSensorType?.size) {
    await w('sensorType', O.entPhySensorType);
    if (c.sensorType.size) {
      await w('sensorScale', O.entPhySensorScale);
      await w('sensorPrecision', O.entPhySensorPrecision);
      await w('sensorValue', O.entPhySensorValue);
      await w('sensorStatus', O.entPhySensorOperStatus);
    }
  }
  if (c.fanTray?.size || c.fruPower?.size || c.ciscoSensorType?.size || c.sensorType?.size) {
    await w('entName', O.entPhysicalName);
  }
  if (vendor === 'mikrotik') {
    const r = (await soft(getOids(s, [O.mtxrHlTemperature, O.mtxrHlProcessorTemperature]))) ?? new Map();
    c.mtxrTemp = r.get(O.mtxrHlTemperature) ?? null;
    c.mtxrCpuTemp = r.get(O.mtxrHlProcessorTemperature) ?? null;
  }
  return buildEnvironment(c);
}

/** مدل، سریال و نسخه از ENTITY-MIB: ردیف اولین «شاسی» (کلاس ۳) */
async function readEntity(s, soft) {
  const cls = (await soft(walk(s, O.entPhysicalClass))) ?? new Map();
  const chassis = [...cls].find(([, v]) => num(v) === 3)?.[0];
  if (!chassis) return {};
  const r =
    (await soft(
      getOids(s, [
        `${O.entPhysicalModelName}.${chassis}`,
        `${O.entPhysicalSerialNum}.${chassis}`,
        `${O.entPhysicalSoftwareRev}.${chassis}`,
      ]),
    )) ?? new Map();
  return {
    model: str(r.get(`${O.entPhysicalModelName}.${chassis}`)),
    serial: str(r.get(`${O.entPhysicalSerialNum}.${chassis}`)),
    software: str(r.get(`${O.entPhysicalSoftwareRev}.${chassis}`)),
  };
}

async function readDiscovery(s, ports, soft) {
  const nameOf = new Map(ports.map((p) => [String(p.if_index), p.name]));
  const c = {};
  const w = async (key, oid, rep = 40) => {
    c[key] = (await soft(walk(s, oid, rep))) ?? new Map();
  };
  await w('lldpRemSysName', O.lldpRemSysName);
  if (c.lldpRemSysName.size) {
    await w('lldpRemPortId', O.lldpRemPortId);
    await w('lldpRemPortDesc', O.lldpRemPortDesc);
    await w('lldpRemSysDesc', O.lldpRemSysDesc);
    await w('lldpRemChassisId', O.lldpRemChassisId);
    await w('lldpLocPortId', O.lldpLocPortId);
    await w('lldpLocPortDesc', O.lldpLocPortDesc);
  }
  await w('cdpCacheDeviceId', O.cdpCacheDeviceId);
  if (c.cdpCacheDeviceId.size) {
    await w('cdpCacheDevicePort', O.cdpCacheDevicePort);
    await w('cdpCachePlatform', O.cdpCachePlatform);
    await w('cdpCacheAddress', O.cdpCacheAddress);
  }
  await w('qFdbPort', O.dot1qTpFdbPort, 60);
  if (!c.qFdbPort.size) await w('dFdbPort', O.dot1dTpFdbPort, 60);
  if (c.qFdbPort.size || c.dFdbPort?.size) await w('basePortIfIndex', O.dot1dBasePortIfIndex);
  await w('arpPhys', O.ipNetToMediaPhysAddress, 60);
  return buildDiscovery(c, nameOf);
}

/**
 * آیا ifIndex هنوز همان پورت است؟ روی سوییچی که پس از ریبوت شماره‌ها را
 * عوض کرده، بدون این بررسی فرمان روی پورت مشتری دیگری می‌نشست.
 */
async function assertIfName(s, idx, portName) {
  const r = await getOids(s, [`${O.ifName}.${idx}`, `${O.ifDescr}.${idx}`]);
  const names = [str(r.get(`${O.ifName}.${idx}`)), str(r.get(`${O.ifDescr}.${idx}`))].filter(Boolean);
  const expected = String(portName).replace(/ #\d+$/, '');
  if (!names.includes(expected)) {
    throw new SnmpError(
      'نام اینترفیس عوض شده',
      `شماره اینترفیس ${idx} حالا «${names[0] ?? 'ناموجود'}» است نه «${expected}» — شماره‌ها روی سوییچ عوض شده‌اند. ` +
        'فرمان اجرا نشد؛ پس از خواندن بعدی دوباره تلاش کنید.',
    );
  }
}

const IF_COLUMNS = [
  'ifDescr', 'ifType', 'ifMtu', 'ifSpeed', 'ifPhysAddress', 'ifAdminStatus', 'ifOperStatus',
  'ifLastChange', 'ifInOctets', 'ifInDiscards', 'ifInErrors', 'ifOutOctets', 'ifOutDiscards',
  'ifOutErrors', 'ifName', 'ifHCInOctets', 'ifHCOutOctets', 'ifHighSpeed', 'ifAlias',
];

/**
 * درایور SNMP؛ همان رابط درایور NX-API (worker/nxapi.mjs).
 *
 * همه درخواست‌های یک خواندن روی یک نشست UDP است و نشست در پایان بسته
 * می‌شود؛ هیچ سوکتی بین دو خواندن باز نمی‌ماند.
 */
// ── انتقال پیکربندی (CISCO-CONFIG-COPY-MIB) ─────────────────

const TRANSFERS = ['sftp', 'tftp'];
const PROTOCOL = { tftp: 1, sftp: 5 };
const FILE = { networkFile: 1, startupConfig: 3, runningConfig: 4 };
const FAIL_CAUSE = {
  1: 'علت نامعلوم',
  2: 'نام یا مسیر فایل پذیرفته نشد',
  3: 'اتصال سوییچ به سرور پنل تایم‌اوت شد — سوییچ به آدرس سرور پنل راه ندارد، یا پورت ۲۲ (SFTP) یا UDP ۶۹ (TFTP) بسته است',
  4: 'حافظه سوییچ کافی نبود',
  5: 'پیکربندی‌ای برای کپی نیست',
  6: 'سوییچ این روش انتقال را پشتیبانی نمی‌کند',
  7: 'بخشی از پیکربندی پذیرفته نشد',
  8: 'سوییچ آماده نیست',
  9: 'کپی لغو شد',
};

/** نام پورت به شکل پیکربندی نکسوس؛ ifName ممکن است کوتاه باشد (Eth1/1) */
function configPortName(port) {
  const name = fullPortName(port.name);
  if (!isSafePortName(name)) throw new SnmpError('پورت نامعتبر', `روی ${port.name} از پنل فرمان اجرا نمی‌شود`);
  return name;
}

function policiesOf(config, name) {
  const block = interfaceBlock(config, name);
  if (!block) throw new SnmpError('اینترفیس پیدا نشد', `بلوک «interface ${name}» در running-config نیست`);
  const raw = parseServicePolicies(block);
  return {
    raw,
    input: rateFromPolicy(raw.input),
    output: rateFromPolicy(raw.output),
    foreign: [raw.input, raw.output].filter((x) => x && rateFromPolicy(x) === null),
  };
}

/** تنظیمات انتقال: sw.transfer را ورکر از تنظیمات پنل می‌گذارد */
function transferOf(sw) {
  const protocol = sw.config_transfer;
  if (!TRANSFERS.includes(protocol)) {
    throw new SnmpError('روش انتقال ندارد', 'برای این سوییچ روش انتقال فایل (SFTP یا TFTP) در ویرایش سوییچ انتخاب نشده');
  }
  const t = sw.transfer ?? {};
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(t.host ?? ''))) {
    throw new SnmpError('آدرس سرور پنل نیست', 'در تنظیمات ← پایش «آدرس سرور پنل از دید سوییچ» (IPv4) را بدهید');
  }
  if (protocol === 'sftp' && (!t.user || !t.pass)) {
    throw new SnmpError('کاربر SFTP نیست', 'در تنظیمات ← پایش کاربر و گذرواژه SFTP سرور پنل را بدهید');
  }
  return { protocol, ...t };
}

async function pullRunning(sw) {
  const t = transferOf(sw);
  const slot = await expectFile(t.protocol, t);
  const s = openSession(sw, { write: true });
  try {
    await configCopy(
      s,
      { protocol: t.protocol, source: FILE.runningConfig, dest: FILE.networkFile, server: t.host, fileName: slot.fileName, user: t.user, pass: t.pass },
      { timeoutSec: 120, what: 'خواندن running-config' },
    );
    return await slot.read();
  } finally {
    s.close();
    await slot.cleanup();
  }
}

async function pushRunning(sw, text) {
  const t = transferOf(sw);
  const slot = await offerFile(t.protocol, t, text);
  const s = openSession(sw, { write: true });
  try {
    return await configCopy(
      s,
      { protocol: t.protocol, source: FILE.networkFile, dest: FILE.runningConfig, server: t.host, fileName: slot.fileName, user: t.user, pass: t.pass },
      { timeoutSec: 90, what: 'اعمال پیکربندی', allowPartial: true },
    );
  } finally {
    s.close();
    await slot.cleanup();
  }
}

/**
 * یک کپی با ccCopyTable. ردیف موقت با شماره تصادفی ساخته، تا پایان دنبال و
 * بعد پاک می‌شود.
 *
 * روش‌ها، به همین ترتیب تا یکی پذیرفته شود:
 *   ۱. روش مستند سیسکو: همه ستون‌ها و createAndGo در یک SET.
 *   ۲. روش استاندارد RFC 2579: createAndWait، ستون‌ها، active.
 * و برای آدرس سرور: ccCopyServerAddressRev1 (تازه)، وگرنه ccCopyServerAddress
 * (قدیمی، فقط IPv4) برای نسخه‌هایی که ستون تازه را ندارند.
 */
export function copyVarbinds(row, spec, addrStyle) {
  const int = (oid, value) => ({ oid: `${oid}.${row}`, type: snmp.ObjectType.Integer, value });
  const oct = (oid, value) => ({ oid: `${oid}.${row}`, type: snmp.ObjectType.OctetString, value });
  const vbs = [int(O.ccCopySourceFileType, spec.source), int(O.ccCopyDestFileType, spec.dest)];
  if (spec.protocol) {
    vbs.unshift(int(O.ccCopyProtocol, PROTOCOL[spec.protocol]));
    if (addrStyle === 'rev1') {
      vbs.push(int(O.ccCopyServerAddressType, 1), oct(O.ccCopyServerAddressRev1, Buffer.from(spec.server.split('.').map(Number))));
    } else {
      vbs.push({ oid: `${O.ccCopyServerAddress}.${row}`, type: snmp.ObjectType.IpAddress, value: spec.server });
    }
    vbs.push(oct(O.ccCopyFileName, spec.fileName));
    if (spec.protocol === 'sftp') vbs.push(oct(O.ccCopyUserName, spec.user), oct(O.ccCopyUserPassword, spec.pass));
  }
  return vbs;
}

async function configCopy(s, spec, { timeoutSec, what, allowPartial = false }) {
  const status = (row, value) => ({ oid: `${O.ccCopyEntryRowStatus}.${row}`, type: snmp.ObjectType.Integer, value });
  const styles = spec.protocol ? ['rev1', 'legacy'] : [null];
  const attempts = [];
  for (const mode of ['go', 'wait']) for (const a of styles) attempts.push([mode, a]);

  const rows = [];
  try {
    let row = null;
    let lastErr = null;
    for (const [mode, addr] of attempts) {
      row = randomInt(1, 2 ** 31 - 1);
      rows.push(row);
      try {
        if (mode === 'go') {
          await setOids(s, [...copyVarbinds(row, spec, addr), status(row, 4)]); // createAndGo
        } else {
          await setOids(s, [status(row, 5)]); // createAndWait
          await setOids(s, copyVarbinds(row, spec, addr));
          await setOids(s, [status(row, 1)]); // active
        }
        lastErr = null;
        break;
      } catch (err) {
        // تایم‌اوت یا نبود اجازه نوشتن با روش دیگر هم حل نمی‌شود
        if (err?.name === 'RequestTimedOutError' || /اجازه نوشتن/.test(explainSnmpError(err))) throw err;
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;

    for (let i = 0; i < timeoutSec; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const r = await getOids(s, [`${O.ccCopyState}.${row}`, `${O.ccCopyFailCause}.${row}`]);
      const state = num(r.get(`${O.ccCopyState}.${row}`));
      if (state === 3) return { partial: false };
      if (state === 4) {
        const cause = num(r.get(`${O.ccCopyFailCause}.${row}`));
        if (cause === 7 && allowPartial) return { partial: true };
        // سیسکو خطای ورود SFTP را «نامعلوم» گزارش می‌کند
        const why =
          cause === 1 && spec.protocol === 'sftp'
            ? 'علت نامعلوم — کاربر و گذرواژه SFTP در تنظیمات، دسترسی سوییچ به پورت ۲۲ سرور پنل، و پذیرش کلید میزبان (docs/switches.md) را بررسی کنید'
            : FAIL_CAUSE[cause] ?? `ccCopyFailCause=${cause ?? '?'}`;
        throw new SnmpError(`${what} ناموفق`, `${what} انجام نشد: ${why}`);
      }
    }
    throw new SnmpError(`${what} تمام نشد`, `${what} تا ${timeoutSec} ثانیه تمام نشد`);
  } finally {
    for (const row of rows) await setOids(s, [status(row, 6)]).catch(() => {}); // destroy
  }
}

export const snmpDriver = {
  canWrite: (sw) => (sw.snmp_version === '3' ? Boolean(sw.snmp_write) : Boolean(sw.snmp_write_community)),
  canSave: (sw) => sw.vendor === 'cisco',
  // توضیح پورت با ifAlias: هر جا نوشتن مجاز باشد
  canDescribe: (sw) => snmpDriver.canWrite(sw),
  // فقط سیسکو (CISCO-CONFIG-COPY-MIB)، با روش انتقال فایل و اجازه نوشتن
  canBackup: (sw) => sw.vendor === 'cisco' && TRANSFERS.includes(sw.config_transfer) && snmpDriver.canWrite(sw),
  // نحو policy-map همان نکسوس است؛ IOS نحو دیگری دارد
  canRateLimit: (sw) => snmpDriver.canBackup(sw) && sw.os_family === 'nxos',
  explain: explainSnmpError,

  async collect(sw, due) {
    const s = openSession(sw);
    try {
      // خواندن سیستم اولین درخواست است؛ اگر جواب نیامد سوییچ در دسترس نیست
      const sys = await getOids(s, [O.sysDescr, O.sysObjectID, O.sysUpTime, O.sysName]);
      const sysObjectId = str(sys.get(O.sysObjectID));
      const vendor = vendorOf(sysObjectId);
      const uptime = num(sys.get(O.sysUpTime));
      const descr = str(sys.get(O.sysDescr));

      const notes = [];
      const soft = (p) =>
        p.catch((e) => {
          notes.push(explainSnmpError(e));
          return null;
        });

      const cols = {};
      for (const c of IF_COLUMNS) {
        // ستون‌های پایه اجباری‌اند؛ نبودن جدول اینترفیس یعنی SNMP به‌درد نمی‌خورد
        const required = c === 'ifDescr' || c === 'ifOperStatus';
        cols[c] = required ? await walk(s, O[c]) : (await soft(walk(s, O[c]))) ?? new Map();
      }
      if (!cols.ifDescr.size) {
        throw new SnmpError('جدول اینترفیس خالی است', 'سوییچ جواب داد ولی جدول اینترفیس (IF-MIB) را نشان نمی‌دهد — view کاربر SNMP را بررسی کنید');
      }

      const lag = (await soft(walk(s, O.lagAttachedAggId))) ?? new Map();
      const vlans = await readVlans(s, vendor, soft);
      const ports = buildPorts(cols, uptime, { lag, vlans });

      const res = await readResources(s, vendor, soft);
      const env = due('env') ? await readEnvironment(s, vendor, soft) : null;
      const discovery = due('nbr') ? await readDiscovery(s, ports, soft) : null;

      let ver = {
        hostname: str(sys.get(O.sysName)),
        uptime_sec: uptime === null ? null : Math.round(uptime / 100),
        vendor,
        sys_object_id: sysObjectId,
        os_version: versionFromDescr(descr),
        os_family: vendor === 'cisco' ? osFamilyOf(descr) : null,
        model: null,
        serial: null,
      };
      if (!sw.model || due('version')) {
        const ent = await readEntity(s, soft);
        ver = {
          ...ver,
          model: ent.model ?? null,
          serial: ent.serial ?? null,
          os_version: ver.os_version ?? ent.software ?? null,
        };
      }
      // نبود یک MIB اختیاری خطا نیست؛ فقط خطاهای واقعی (تایم‌اوت وسط کار) می‌مانند
      return { ports, res, ver, env, xcvr: null, notes: [...new Set(notes)], discovery };
    } finally {
      s.close();
    }
  },

  /**
   * shut / no shut با ifAdminStatus.
   *
   * پیش از SET، نام همان ifIndex دوباره خوانده و با نام پورت مقایسه می‌شود.
   * روی سوییچی که پس از ریبوت شماره‌ها را عوض کرده، بدون این بررسی پورت
   * مشتری دیگری خاموش می‌شد.
   */
  async setAdmin(sw, port, up) {
    const idx = Number(port.if_index);
    if (!Number.isInteger(idx) || idx <= 0) {
      throw new SnmpError('شماره اینترفیس معلوم نیست', 'شماره اینترفیس این پورت هنوز خوانده نشده؛ پس از خواندن بعدی دوباره تلاش کنید');
    }
    const s = openSession(sw, { write: true });
    try {
      await assertIfName(s, idx, port.name);
      await setOids(s, [{ oid: `${O.ifAdminStatus}.${idx}`, type: snmp.ObjectType.Integer, value: up ? 1 : 2 }]);
    } finally {
      s.close();
    }
  },

  /**
   * ذخیره running-config در startup-config با CISCO-CONFIG-COPY-MIB.
   * ردیف موقت با شماره تصادفی ساخته، تا پایان دنبال و بعد پاک می‌شود.
   *
   * دو روش ساخت ردیف، به همین ترتیب:
   *   ۱. روش مستند سیسکو: مبدا، مقصد و createAndGo در یک SET.
   *   ۲. اگر سوییچ آن را نپذیرفت، روش استاندارد RFC 2579: createAndWait،
   *      بعد مبدا و مقصد، بعد active.
   */
  async save(sw) {
    if (sw.vendor !== 'cisco') {
      throw new SnmpError('پشتیبانی نمی‌شود', 'ذخیره پیکربندی با SNMP فقط روی سیسکو پشتیبانی می‌شود');
    }
    const s = openSession(sw, { write: true });
    try {
      await configCopy(s, { source: FILE.runningConfig, dest: FILE.startupConfig }, { timeoutSec: 60, what: 'ذخیره پیکربندی' });
    } finally {
      s.close();
    }
  },

  /** پشتیبان: running-config از راه انتقال فایل */
  async backup(sw) {
    return cleanConfig(await pullRunning(sw));
  },

  async readRateLimit(sw, port) {
    const name = configPortName(port);
    return policiesOf(await pullRunning(sw), name);
  },

  /**
   * محدودیت سرعت روی نکسوس با SNMP: همان policer مسیر NX-API، ولی به شکل
   * تکه پیکربندی که سوییچ از سرور پنل برمی‌دارد و در running-config ادغام
   * می‌کند. پیش و پس از آن running-config خوانده می‌شود: پیش از آن برای
   * اینکه policy بیگانه دست نخورد، پس از آن چون «کپی موفق» یعنی فایل
   * رسید، نه اینکه هر خطش پذیرفته شد.
   */
  async setRateLimit(sw, port, mbps) {
    if (!snmpDriver.canRateLimit(sw)) {
      throw new SnmpError('پشتیبانی نمی‌شود', 'محدودیت سرعت با SNMP فقط برای Cisco Nexus با روش انتقال فایل و اجازه نوشتن است');
    }
    if (!Number.isInteger(mbps) || mbps < 0) throw new SnmpError('سرعت نامعتبر', 'سرعت نامعتبر است');
    const name = configPortName(port);
    const before = policiesOf(await pullRunning(sw), name);
    for (const dir of ['input', 'output']) {
      if (before.raw[dir] && before[dir] === null) {
        const msg = `روی ${dir === 'input' ? 'ورودی' : 'خروجی'} این پورت policy دیگری (${before.raw[dir]}) هست که پنل نگذاشته؛ دست نخورد`;
        throw new SnmpError(msg, msg);
      }
    }
    const pushed = await pushRunning(sw, rateLimitSnippet(name, before.raw, mbps));
    const after = policiesOf(await pullRunning(sw), name);
    const outputOk = !mbps || after.output === mbps;
    return {
      input: mbps ? after.input === mbps : false,
      output: mbps ? outputOk : false,
      outputError: outputOk ? null : pushed.partial ? 'سوییچ بخشی از پیکربندی را نپذیرفت' : 'policer خروجی پذیرفته نشد',
      actual: after,
    };
  },

  /** توضیح پورت با ifAlias (حداکثر ۶۴ نویسه در IF-MIB). همان بررسی نام ifIndex. */
  async setDescription(sw, port, text) {
    const d = cleanDescription(text, 64);
    if (!d.ok) throw new SnmpError(d.error);
    const idx = Number(port.if_index);
    if (!Number.isInteger(idx) || idx <= 0) throw new SnmpError('شماره اینترفیس معلوم نیست', 'شماره اینترفیس این پورت هنوز خوانده نشده');
    const s = openSession(sw, { write: true });
    try {
      await assertIfName(s, idx, port.name);
      await setOids(s, [{ oid: `${O.ifAlias}.${idx}`, type: snmp.ObjectType.OctetString, value: d.value }]);
    } finally {
      s.close();
    }
  },

  async readPort(sw, port) {
    const idx = Number(port.if_index);
    if (!Number.isInteger(idx) || idx <= 0) return null;
    const s = openSession(sw);
    try {
      const r = await getOids(s, [`${O.ifAdminStatus}.${idx}`, `${O.ifOperStatus}.${idx}`]);
      const admin = num(r.get(`${O.ifAdminStatus}.${idx}`));
      const oper = num(r.get(`${O.ifOperStatus}.${idx}`));
      if (admin === null) return null;
      const adminUp = admin === 1 ? true : admin === 2 ? false : null;
      const operUp = oper === 1 ? true : OPER_REASON[oper] ? false : null;
      return {
        admin_up: adminUp,
        oper_up: operUp,
        oper_reason: adminUp === false ? 'Administratively down' : operUp === false ? OPER_REASON[oper] : null,
      };
    } finally {
      s.close();
    }
  },
};
