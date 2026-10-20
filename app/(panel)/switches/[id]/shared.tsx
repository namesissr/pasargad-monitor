'use client';

import { api } from '@/lib/api';
import { faNum, formatJalaliDay } from '@/lib/format';

/** نوع‌ها و تکه‌های مشترک صفحه سوییچ، پنجره پورت و پیکربندی */

export interface Transceiver {
  type: string | null;
  vendor: string | null;
  part: string | null;
  serial: string | null;
  temp_c: number | null;
  tx_dbm: number | null;
  rx_dbm: number | null;
  rx_warn_lo: number | null;
  rx_low: boolean;
}

export interface Neighbor {
  proto: 'lldp' | 'cdp';
  sys_name: string | null;
  port_id: string | null;
  port_desc?: string | null;
  platform?: string | null;
  mgmt_ip?: string | null;
  caps?: string[];
}

export interface PortMac {
  mac: string;
  vlan?: string | null;
}

export interface Port {
  id: number;
  name: string;
  kind: string;
  description: string | null;
  admin_up: boolean | null;
  oper_up: boolean | null;
  oper_reason: string | null;
  speed_mbps: number | null;
  mtu: number | null;
  mode: string | null;
  vlan: string | null;
  mac: string | null;
  member_of: string | null;
  hw_type: string | null;
  xcvr_type: string | null;
  last_flap: string | null;
  in_bps: number;
  out_bps: number;
  in_errors: number | null;
  out_errors: number | null;
  crc_errors: number | null;
  in_discards: number | null;
  out_discards: number | null;
  transceiver: Transceiver | null;
  server_id: number | null;
  server_name: string | null;
  server_ip: string | null;
  customer_name: string | null;
  count_traffic: boolean;
  count_since: string | null;
  is_protected: boolean;
  alert_down: boolean;
  alert_util: boolean;
  note: string | null;
  is_present: boolean;
  last_change_at: string | null;
  counters_at: string | null;
  neighbors: Neighbor[] | null;
  macs: PortMac[] | null;
  mac_count: number | null;
  discovered_at: string | null;
  suggested_server_id: number | null;
  suggested_server_name: string | null;
  suggest_reason: string | null;
  rate_limit_mbps: number | null;
  rate_limit_in: boolean;
  rate_limit_out: boolean;
  today_in: number;
  today_out: number;
  month_in: number;
  month_out: number;
  month_errors: number;
  has_incident: boolean;
  pending_action: string | null;
}

export interface EnvItem {
  name: string;
  status?: string | null;
  ok: boolean;
  absent?: boolean;
  current?: number | null;
  major?: number | null;
  model?: string | null;
  direction?: string | null;
  output_w?: number | null;
  capacity_w?: number | null;
}

export interface SwitchInfo {
  id: number;
  name: string;
  protocol: 'nxapi' | 'snmp';
  url: string | null;
  snmp_version: string | null;
  snmp_host: string | null;
  snmp_port: number;
  vendor: string | null;
  can_write: boolean;
  can_save: boolean;
  can_rate_limit: boolean;
  can_backup: boolean;
  os_family: string | null;
  config_transfer: 'none' | 'sftp' | 'tftp';
  datacenter_name: string | null;
  location: string | null;
  is_active: boolean;
  hostname: string | null;
  model: string | null;
  serial: string | null;
  os_version: string | null;
  uptime_sec: number | null;
  status: string;
  last_seen_at: string | null;
  last_poll_at: string | null;
  last_poll_ms: number | null;
  last_error: string | null;
  cpu_percent: number | null;
  mem_used_bytes: number | null;
  mem_total_bytes: number | null;
  load1: number | null;
  max_temp_c: number | null;
  env: { temps: EnvItem[]; fans: EnvItem[]; psus: EnvItem[]; problems: string[] } | null;
  env_ok: boolean | null;
  env_checked_at: string | null;
  config_checked_at: string | null;
  config_changed_at: string | null;
  config_error: string | null;
  config_count: number;
}

export interface ActionRow {
  id: number;
  port_id: number | null;
  port_name: string | null;
  action: string;
  value: string | null;
  save_config: boolean;
  reason: string | null;
  status: string;
  requested_by_name: string | null;
  requested_at: string;
  finished_at: string | null;
  result: string | null;
}

export const RANGES = [
  { key: '1h', label: '۱ ساعت' },
  { key: '6h', label: '۶ ساعت' },
  { key: '24h', label: '۲۴ ساعت' },
  { key: '7d', label: '۷ روز' },
  { key: '30d', label: '۳۰ روز' },
  { key: '90d', label: '۳ ماه' },
];

export const IN_COLOR = '#3ED6C5';
export const OUT_COLOR = '#F2B44C';

export const ACTION_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'در صف', cls: 'bg-line text-muted border-line' },
  running: { label: 'در حال اجرا', cls: 'bg-cyan/10 text-cyan border-cyan/30' },
  done: { label: 'انجام شد', cls: 'bg-ok/10 text-ok border-ok/30' },
  failed: { label: 'ناموفق', cls: 'bg-danger/10 text-danger border-danger/30' },
};

export function actionLabel(a: Pick<ActionRow, 'action' | 'value'>): string {
  switch (a.action) {
    case 'shutdown':
      return 'خاموش (shutdown)';
    case 'no_shutdown':
      return 'روشن (no shutdown)';
    case 'description':
      return a.value ? `توضیح: «${a.value}»` : 'پاک کردن توضیح';
    case 'rate_limit':
      return Number(a.value) > 0 ? `محدودیت ${speedLabel(Number(a.value))}` : 'برداشتن محدودیت سرعت';
    case 'backup':
      return 'پشتیبان پیکربندی';
    default:
      return a.action;
  }
}

// رشته زمان از سرور در منطقه زمانی گزارش آمده؛ از Date عبور نمی‌کند
export const timeLabel = (t: string) => {
  if (!t) return '';
  if (t.length <= 10) return formatJalaliDay(t);
  return faNum(t.slice(11, 16));
};

export const speedLabel = (mbps: number | null) => {
  if (!mbps) return '—';
  return mbps >= 1000 ? `${faNum(+(mbps / 1000).toFixed(1))}G` : `${faNum(mbps)}M`;
};

/** وضعیت خوانای پورت */
export function portState(p: Port): { label: string; cls: string } {
  if (!p.is_present) return { label: 'حذف‌شده', cls: 'bg-line text-muted border-line' };
  if (p.admin_up === false) return { label: 'خاموش (shut)', cls: 'bg-amber/15 text-amber border-amber/30' };
  if (p.oper_up) return { label: 'وصل', cls: 'bg-ok/15 text-ok border-ok/30' };
  if (p.oper_reason && /err/i.test(p.oper_reason)) {
    return { label: 'err-disabled', cls: 'bg-danger/20 text-danger border-danger/40' };
  }
  if (p.oper_up === false) return { label: 'قطع', cls: 'bg-danger/10 text-danger border-danger/30' };
  return { label: 'نامشخص', cls: 'bg-line text-muted border-line' };
}

/**
 * ترافیک لحظه‌ای سرورها از دید سوییچ: دانلود یعنی خروجی پورت به سرور و
 * آپلود یعنی ورودی از سرور. آپلینک‌ها (پورت محافظت‌شده، یا عضو پورت‌چنل
 * محافظت‌شده) کنار می‌روند: هر بایت یک بار از آپلینک و یک بار از پورت سرور
 * رد می‌شود و جمع همه پورت‌ها آن را دو بار می‌شمرد — دانلود سرورها روی
 * آپلینک «ورودی» است و آپلودشان «خروجی».
 */
export function edgeTraffic(ports: Port[]): { download: number; upload: number; uplinks: number } {
  const protectedLag = new Set(ports.filter((p) => p.kind === 'port-channel' && p.is_protected).map((p) => p.name));
  const eth = ports.filter((p) => p.kind === 'ethernet' && p.is_present);
  const edge = eth.filter((p) => !p.is_protected && !(p.member_of && protectedLag.has(p.member_of)));
  return {
    download: edge.reduce((s, p) => s + (Number(p.out_bps) || 0), 0),
    upload: edge.reduce((s, p) => s + (Number(p.in_bps) || 0), 0),
    uplinks: eth.length - edge.length,
  };
}

/** نام کوتاه همسایه برای جدول */
export function neighborLabel(n: Neighbor): string {
  return [n.sys_name, n.port_id].filter(Boolean).join(' / ') || '؟';
}

/**
 * فرمان را در صف می‌گذارد و تا نتیجه منتظر می‌ماند. ورکر هر سه ثانیه صف
 * را نگاه می‌کند؛ پشتیبان پیکربندی بزرگ ممکن است تا دو دقیقه طول بکشد.
 */
export async function runSwitchAction(
  body: Record<string, unknown>,
  timeoutSec = 60,
): Promise<{ ok: boolean; text: string }> {
  const res = await api.post<{ id: number }>('/api/switch-actions', body);
  const tries = Math.ceil(timeoutSec / 1.5);
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await api.get<{ action: ActionRow }>(`/api/switch-actions?id=${res.id}`);
    if (r.action.status === 'done' || r.action.status === 'failed') {
      return { ok: r.action.status === 'done', text: r.action.result ?? '' };
    }
  }
  return {
    ok: false,
    text: 'نتیجه به‌موقع نیامد. ورکر در حال اجراست؟ وضعیت در «تاریخچه فرمان‌ها» دیده می‌شود.',
  };
}

export function RangeButtons({
  range,
  setRange,
  loading,
  error,
}: {
  range: string;
  setRange: (r: string) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => setRange(r.key)}
          className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
            range === r.key ? 'bg-cyan/10 text-cyan border-cyan/30' : 'border-line text-muted hover:text-white'
          }`}
        >
          {r.label}
        </button>
      ))}
      {loading && <span className="text-[11px] text-muted">در حال بارگذاری…</span>}
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}

/** سربرگ‌ها؛ با شمارنده اختیاری کنار هر عنوان */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: K; label: string; count?: number; tone?: 'warn' | 'danger' }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-line overflow-x-auto" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px transition-colors ${
            value === t.key ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-white'
          }`}
        >
          {/* bdi: «همسایه‌ها و MAC» بدون جداسازی، شمارنده را میان دو کلمه می‌برد */}
          <bdi>{t.label}</bdi>
          {t.count ? (
            <span
              className={`ms-1.5 px-1.5 rounded-full text-[10px] ${
                t.tone === 'danger' ? 'bg-danger/20 text-danger' : t.tone === 'warn' ? 'bg-amber/20 text-amber' : 'bg-line text-muted'
              }`}
            >
              {faNum(t.count)}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** دو مقدار ورودی و خروجی، هرکدام در خط خودش؛ کنار هم در متن راست‌به‌چپ جابه‌جا می‌شدند */
export function InOut({ a, b }: { a: string; b: string }) {
  return (
    <span className="block leading-5">
      <span className="block whitespace-nowrap">
        <span className="text-cyan text-[10px] me-1">ورودی</span>
        {a}
      </span>
      <span className="block whitespace-nowrap">
        <span className="text-amber text-[10px] me-1">خروجی</span>
        {b}
      </span>
    </span>
  );
}

export function Info({ label, value, mono, warn }: { label: string; value: string; mono?: boolean; warn?: boolean }) {
  return (
    <div className="bg-panel2 rounded-lg px-3 py-2 min-w-0">
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`mt-0.5 truncate ${mono ? 'ltr font-mono' : ''} ${warn ? 'text-amber' : ''}`} title={value}>
        {value}
      </p>
    </div>
  );
}
