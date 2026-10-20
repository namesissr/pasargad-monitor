'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useLoad } from '@/components/useLoad';
import { Chart } from '@/components/Chart';
import { Field, Modal, Mono, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatBps, formatBytes, formatJalaliDay, formatJalaliTime, timeAgo } from '@/lib/format';
import {
  IN_COLOR,
  OUT_COLOR,
  Info,
  RangeButtons,
  Tabs,
  portState,
  runSwitchAction,
  speedLabel,
  timeLabel,
  type Port,
  type SwitchInfo,
} from './shared';

type PortTab = 'traffic' | 'details' | 'neighbors' | 'control' | 'settings';

interface ServerOption {
  id: number;
  name: string;
  main_ip: string;
}

interface LocatedMac {
  mac: string;
  vlan: string | null;
  ip: string | null;
  ip_seen_at: string | null;
  server_id: number | null;
  server_name: string | null;
}

export function PortModal({
  sw,
  port,
  onClose,
  onChanged,
}: {
  sw: SwitchInfo;
  port: Port;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<PortTab>('traffic');
  const st = portState(port);
  const neighbors = port.neighbors ?? [];

  return (
    <Modal open wide title={`${sw.name} / ${port.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge border ${st.cls}`}>{st.label}</span>
          {port.description && <span className="text-sm">{port.description}</span>}
          {port.is_protected && <span className="badge border bg-amber/10 text-amber border-amber/30">محافظت‌شده</span>}
          {port.rate_limit_mbps ? (
            <span className="badge border bg-cyan/10 text-cyan border-cyan/30">
              محدود به {speedLabel(port.rate_limit_mbps)}
              {port.rate_limit_in && !port.rate_limit_out ? ' (فقط ورودی)' : ''}
            </span>
          ) : null}
          {port.server_id && (
            <Link href={`/servers/${port.server_id}`} className="text-xs text-muted hover:text-cyan">
              سرور: {port.server_name}
            </Link>
          )}
        </div>

        {!port.server_id && port.suggested_server_id && (
          <SuggestionBox port={port} onChanged={onChanged} />
        )}

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'traffic', label: 'ترافیک' },
            { key: 'details', label: 'جزئیات و رویدادها' },
            { key: 'neighbors', label: 'همسایه و MAC', count: neighbors.length + (port.mac_count ?? 0) },
            { key: 'control', label: 'فرمان روی سوییچ' },
            { key: 'settings', label: 'تنظیمات پنل' },
          ]}
        />

        {tab === 'traffic' && <TrafficTab switchId={sw.id} port={port} />}
        {tab === 'details' && <DetailsTab switchId={sw.id} port={port} />}
        {tab === 'neighbors' && <NeighborsTab port={port} />}
        {tab === 'control' && <ControlTab sw={sw} port={port} onChanged={onChanged} />}
        {tab === 'settings' && <PortSettings port={port} onSaved={onChanged} />}
      </div>
    </Modal>
  );
}

/** پیشنهاد اتصال پورت به سرور: تأیید یا رد */
export function SuggestionBox({ port, onChanged }: { port: Port; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setErr(null);
    try {
      // بقیه تنظیمات پورت دست نمی‌خورد؛ پورتی که تازه به سرور وصل می‌شود
      // مثل فرم دستی هشدار قطعی می‌گیرد
      await api.patch('/api/switch-ports', {
        id: port.id,
        server_id: port.suggested_server_id,
        count_traffic: false,
        alert_down: true,
        is_protected: port.is_protected,
        note: port.note ?? '',
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setErr(null);
    try {
      await api.patch('/api/switch-ports', { id: port.id, op: 'dismiss_suggestion' });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-cyan/30 bg-cyan/5 rounded-lg px-3 py-2.5 text-xs space-y-2">
      <p>
        پیشنهاد: این پورت به سرور <b>{port.suggested_server_name}</b> وصل است.
        <span className="block text-muted mt-0.5">{port.suggest_reason}</span>
      </p>
      {err && <p className="text-danger">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-ghost text-xs" onClick={dismiss} disabled={busy}>
          درست نیست
        </button>
        <button type="button" className="btn-primary text-xs" onClick={accept} disabled={busy}>
          تأیید و اتصال
        </button>
      </div>
    </div>
  );
}

function TrafficTab({ switchId, port }: { switchId: number; port: Port }) {
  const [range, setRange] = useState('24h');
  const series = useLoad<{ points: Record<string, unknown>[] }>(
    `/api/switches/${switchId}/metrics?port_id=${port.id}&range=${range}`,
    30_000,
  );
  const daily = useLoad<{ days: Record<string, number | string>[] }>(
    `/api/switches/${switchId}/metrics?port_id=${port.id}&view=daily&days=31`,
  );
  const points = series.data?.points ?? [];
  const peak = points.reduce((m, pt) => Math.max(m, Number(pt.in_bps) || 0, Number(pt.out_bps) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <RangeButtons range={range} setRange={setRange} loading={series.loading} error={series.error} />
        <Chart
          points={points}
          height={200}
          series={[
            { key: 'in_bps', label: 'ورودی به سوییچ', color: IN_COLOR },
            { key: 'out_bps', label: 'خروجی از سوییچ', color: OUT_COLOR },
          ]}
          maxValue={peak > 0 ? peak * 1.15 : undefined}
          format={(v) => formatBps(v, 0)}
          formatTime={timeLabel}
        />
      </div>

      <div>
        <p className="text-xs text-muted mb-2">مصرف روزانه (۳۱ روز اخیر)</p>
        <div className="table-wrap max-h-[260px] overflow-y-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>روز</th>
                <th>ورودی</th>
                <th>خروجی</th>
                <th className="col-sm">اوج</th>
                <th className="col-sm">خطا</th>
              </tr>
            </thead>
            <tbody>
              {(daily.data?.days ?? []).map((r) => (
                <tr key={String(r.day)}>
                  <td className="text-xs">{formatJalaliDay(String(r.day))}</td>
                  <td className="text-xs ltr">{formatBytes(Number(r.in_bytes))}</td>
                  <td className="text-xs ltr">{formatBytes(Number(r.out_bytes))}</td>
                  <td className="col-sm text-xs ltr">{formatBps(Math.max(Number(r.in_peak), Number(r.out_peak)))}</td>
                  <td className="col-sm text-xs">{faNum(Number(r.errors))}</td>
                </tr>
              ))}
              {!daily.loading && (daily.data?.days ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted text-xs py-4">
                    {daily.error ?? 'هنوز مصرف روزانه‌ای ثبت نشده (تجمیع هر پنج دقیقه)'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DetailsTab({ switchId, port }: { switchId: number; port: Port }) {
  const x = port.transceiver;
  const events = useLoad<{
    events: { ts: string; oper_up: boolean | null; detail: string | null }[];
    counts: { last_hour: number; last_day: number; last_week: number } | null;
  }>(`/api/switches/${switchId}/metrics?port_id=${port.id}&view=events`, 30_000);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Info label="سرعت لینک" value={speedLabel(port.speed_mbps)} />
        <Info label="حالت / ویلن" value={[port.mode, port.vlan].filter(Boolean).join(' / ') || '—'} />
        <Info label="MTU" value={port.mtu ? faNum(port.mtu) : '—'} />
        <Info label="MAC" value={port.mac ?? '—'} mono />
        <Info label="عضو" value={port.member_of ?? '—'} mono />
        <Info label="آخرین تغییر لینک" value={port.last_flap ?? (port.last_change_at ? timeAgo(port.last_change_at) : '—')} />
        <Info label="علت قطعی" value={port.oper_up ? '—' : port.oper_reason ?? '—'} />
        <Info label="ماژول" value={port.xcvr_type ?? x?.type ?? '—'} />
        <Info
          label="خطای ورودی / خروجی / CRC"
          value={`${faNum(port.in_errors ?? 0)} / ${faNum(port.out_errors ?? 0)} / ${faNum(port.crc_errors ?? 0)}`}
        />
        <Info label="دور ریخته (discard)" value={`${faNum(port.in_discards ?? 0)} / ${faNum(port.out_discards ?? 0)}`} />
        {x && (
          <>
            <Info
              label="توان نوری Rx / Tx (dBm)"
              value={`${x.rx_dbm !== null ? x.rx_dbm.toFixed(2) : '—'} / ${x.tx_dbm !== null ? x.tx_dbm.toFixed(2) : '—'}`}
              warn={x.rx_low}
              mono
            />
            <Info label="دمای ماژول" value={x.temp_c !== null ? `${faNum(x.temp_c.toFixed(1))}°C` : '—'} />
            {(x.vendor || x.part) && <Info label="سازنده ماژول" value={[x.vendor, x.part].filter(Boolean).join(' ')} mono />}
            {x.serial && <Info label="سریال ماژول" value={x.serial} mono />}
          </>
        )}
      </div>
      {x?.rx_low && (
        <Notice type="warn">
          توان دریافتی نوری کمتر از آستانه هشدار ماژول است — فیبر، کانکتور یا ماژول طرف مقابل را بررسی کنید.
        </Notice>
      )}

      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <p className="text-xs text-muted">قطع و وصل‌های لینک</p>
          {events.data?.counts && (
            <p className="text-[11px] text-muted">
              ساعت اخیر {faNum(events.data.counts.last_hour)} · ۲۴ ساعت {faNum(events.data.counts.last_day)} · هفته{' '}
              {faNum(events.data.counts.last_week)}
            </p>
          )}
        </div>
        <div className="table-wrap max-h-[220px] overflow-y-auto">
          <table className="tbl">
            <tbody>
              {(events.data?.events ?? []).map((e, i) => (
                <tr key={`${e.ts}-${i}`}>
                  <td className="text-xs whitespace-nowrap" title={formatJalaliTime(e.ts)}>
                    {formatJalaliTime(e.ts)}
                  </td>
                  <td className="text-xs">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full me-1.5 ${
                        e.oper_up === true ? 'bg-ok' : e.oper_up === false ? 'bg-danger' : 'bg-amber'
                      }`}
                    />
                    {e.detail ?? (e.oper_up ? 'وصل شد' : 'قطع شد')}
                  </td>
                </tr>
              ))}
              {!events.loading && (events.data?.events ?? []).length === 0 && (
                <tr>
                  <td className="text-center text-muted text-xs py-4">
                    {events.error ?? 'قطع و وصلی ثبت نشده'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function NeighborsTab({ port }: { port: Port }) {
  const neighbors = port.neighbors ?? [];
  const located = useLoad<{ rows: (LocatedMac & { port_id: number })[] }>(`/api/switches/locate?port_id=${port.id}`);
  const macs: LocatedMac[] =
    located.data?.rows ??
    (port.macs ?? []).map((m) => ({ mac: m.mac, vlan: m.vlan ?? null, ip: null, ip_seen_at: null, server_id: null, server_name: null }));

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted">
        هر پنج دقیقه از LLDP/CDP، جدول MAC و جدول ARP سوییچ خوانده می‌شود
        {port.discovered_at ? ` — آخرین بار ${timeAgo(port.discovered_at)}` : ''}. آی‌پی هر MAC از جدول ARP همه
        سوییچ‌های پنل پیدا می‌شود.
      </p>

      <div>
        <p className="text-xs text-muted mb-2">همسایه‌ها (LLDP / CDP)</p>
        {neighbors.length === 0 ? (
          <p className="text-xs text-muted bg-panel2 rounded-lg px-3 py-2">
            همسایه‌ای اعلام نشده. سرور لینوکسی با بسته lldpd خودش را معرفی می‌کند و پیشنهاد اتصال دقیق‌تر می‌شود.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>پروتکل</th>
                  <th>دستگاه</th>
                  <th>پورت آن طرف</th>
                  <th className="col-sm">آی‌پی مدیریت</th>
                  <th className="col-md">مدل / سیستم</th>
                </tr>
              </thead>
              <tbody>
                {neighbors.map((n, i) => (
                  <tr key={i}>
                    <td className="text-xs uppercase">{n.proto}</td>
                    <td className="text-xs ltr">{n.sys_name ?? '—'}</td>
                    <td className="text-xs ltr">
                      {n.port_id ?? '—'}
                      {n.port_desc && n.port_desc !== n.port_id && <span className="block text-muted">{n.port_desc}</span>}
                    </td>
                    <td className="col-sm text-xs ltr">{n.mgmt_ip ?? '—'}</td>
                    <td className="col-md text-xs ltr text-muted max-w-[260px] truncate" title={n.platform ?? ''}>
                      {n.platform ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="text-xs text-muted mb-2">
          MACهای دیده‌شده {port.mac_count ? `(${faNum(port.mac_count)})` : ''}
          {(port.mac_count ?? 0) > 50 && ' — فقط پنجاه مورد اول نگه داشته می‌شود؛ احتمالا آپلینک است'}
        </p>
        {macs.length === 0 ? (
          <p className="text-xs text-muted bg-panel2 rounded-lg px-3 py-2">
            {located.loading ? 'در حال بارگذاری…' : located.error ?? 'MACی روی این پورت دیده نشده'}
          </p>
        ) : (
          <div className="table-wrap max-h-[260px] overflow-y-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>MAC</th>
                  <th className="col-sm">ویلن</th>
                  <th>آی‌پی</th>
                  <th>سرور</th>
                </tr>
              </thead>
              <tbody>
                {macs.map((m) => (
                  <tr key={`${m.mac}-${m.vlan}`}>
                    <td className="text-xs ltr font-mono">{m.mac}</td>
                    <td className="col-sm text-xs">{m.vlan ?? '—'}</td>
                    <td className="text-xs ltr">{m.ip ?? '—'}</td>
                    <td className="text-xs">
                      {m.server_id ? (
                        <Link href={`/servers/${m.server_id}`} className="hover:text-cyan">
                          {m.server_name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type Dialog =
  | { kind: 'shutdown' | 'no_shutdown' }
  | { kind: 'description' }
  | { kind: 'rate_limit' };

function ControlTab({ sw, port, onChanged }: { sw: SwitchInfo; port: Port; onChanged: () => void }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const canAct = port.is_present && ['ethernet', 'port-channel'].includes(port.kind);

  if (!canAct) {
    return (
      <Notice type="info">
        از پنل فقط روی پورت اترنت و پورت‌چنل فرمان اجرا می‌شود؛ خاموش کردن پورت مدیریت یا ویلن دسترسی خود پنل را می‌بُرد.
      </Notice>
    );
  }
  if (!sw.can_write) {
    return (
      <Notice type="info">
        این سوییچ فقط پایش می‌شود. برای فرمان، در ویرایش سوییچ کامیونیتی نوشتنی (v2c) یا «اجازه نوشتن» (v3) بدهید.
      </Notice>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        هر فرمان در صف می‌رود، ورکر ظرف چند ثانیه روی سوییچ اجرایش می‌کند و وضعیت واقعی را دوباره می‌خواند. فقط حساب
        مدیر.
      </p>

      <ControlRow
        title="خاموش / روشن"
        text={
          port.admin_up === false
            ? 'پورت خاموش (shutdown) است.'
            : port.is_protected
              ? 'پورت محافظت‌شده است و از پنل خاموش نمی‌شود.'
              : 'پورت روشن است.'
        }
      >
        {port.admin_up === false ? (
          <button type="button" className="btn-primary" onClick={() => setDialog({ kind: 'no_shutdown' })}>
            روشن کردن (no shutdown)
          </button>
        ) : (
          <button
            type="button"
            className="btn-danger"
            onClick={() => setDialog({ kind: 'shutdown' })}
            disabled={port.is_protected}
            title={port.is_protected ? 'پورت محافظت‌شده است' : undefined}
          >
            خاموش کردن (shutdown)
          </button>
        )}
      </ControlRow>

      <ControlRow
        title="توضیح پورت (description)"
        text={port.description ? `فعلی: «${port.description}»` : 'توضیحی ندارد.'}
      >
        <button type="button" className="btn-ghost" onClick={() => setDialog({ kind: 'description' })}>
          ویرایش توضیح
        </button>
      </ControlRow>

      <ControlRow
        title="محدودیت سرعت"
        text={
          !sw.can_rate_limit
            ? sw.protocol === 'snmp'
              ? 'با SNMP فقط روی Cisco Nexus، با «انتقال فایل پیکربندی» (SFTP/TFTP) و اجازه نوشتن در ویرایش سوییچ.'
              : 'این سوییچ محدودیت سرعت از پنل ندارد.'
            : port.is_protected
              ? 'پورت محافظت‌شده (آپلینک) محدودیت نمی‌گیرد.'
              : port.rate_limit_mbps
                ? `فعلی: ${speedLabel(port.rate_limit_mbps)}${port.rate_limit_in && port.rate_limit_out ? ' در هر دو جهت' : port.rate_limit_in ? ' فقط ورودی (آپلود سرور)' : ' فقط خروجی'}`
                : 'بدون محدودیت — با سرعت کامل لینک.'
        }
      >
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setDialog({ kind: 'rate_limit' })}
          disabled={!sw.can_rate_limit || port.is_protected}
        >
          تنظیم محدودیت
        </button>
      </ControlRow>

      {dialog && (
        <ActionDialog sw={sw} port={port} dialog={dialog} onClose={() => setDialog(null)} onDone={onChanged} />
      )}
    </div>
  );
}

function ControlRow({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="bg-panel2 rounded-lg px-3 py-2.5 flex items-center gap-3 flex-wrap">
      <div className="me-auto min-w-0">
        <p className="text-sm">{title}</p>
        <p className="text-[11px] text-muted mt-0.5">{text}</p>
      </div>
      {children}
    </div>
  );
}

const RATE_PRESETS = [10, 50, 100, 200, 500, 1000, 2000, 5000];

function ActionDialog({
  sw,
  port,
  dialog,
  onClose,
  onDone,
}: {
  sw: SwitchInfo;
  port: Port;
  dialog: Dialog;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [save, setSave] = useState(false);
  const [typed, setTyped] = useState('');
  const [desc, setDesc] = useState(port.description ?? '');
  const [mbps, setMbps] = useState(port.rate_limit_mbps ? String(port.rate_limit_mbps) : '');
  const [phase, setPhase] = useState<'form' | 'running' | 'done'>('form');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const canSave = sw.can_save;

  const isShut = dialog.kind === 'shutdown';
  // برای خاموش کردن پورتی که به سرور وصل است، نام پورت باید تایپ شود؛
  // یک کلیک اشتباه نباید سرویس مشتری را قطع کند. محدودیت سرعت روی پورت
  // سرور هم همین‌طور: سرعت مشتری را پایین می‌آورد.
  const needTyping =
    Boolean(port.server_id) && (isShut || (dialog.kind === 'rate_limit' && Number(mbps) > 0));
  const typedOk = !needTyping || typed.trim().toLowerCase() === port.name.toLowerCase();

  const descMax = sw.protocol === 'snmp' ? 64 : 254;
  const descError = /[;\r\n\t]/.test(desc)
    ? 'توضیح نباید «;» داشته باشد'
    : desc.trim().length > descMax
      ? `حداکثر ${faNum(descMax)} نویسه`
      : null;
  const mbpsNum = Number(mbps);
  const mbpsError =
    mbps.trim() === ''
      ? 'سرعت را وارد کنید'
      : !Number.isInteger(mbpsNum) || mbpsNum < 0
        ? 'عدد صحیح مگابیت'
        : mbpsNum > 0 && port.speed_mbps && mbpsNum >= port.speed_mbps
          ? `باید کمتر از سرعت پورت (${speedLabel(port.speed_mbps)}) باشد`
          : null;

  const valid =
    typedOk &&
    (dialog.kind !== 'description' || !descError) &&
    (dialog.kind !== 'rate_limit' || !mbpsError);

  const title =
    dialog.kind === 'shutdown'
      ? `خاموش کردن ${port.name}`
      : dialog.kind === 'no_shutdown'
        ? `روشن کردن ${port.name}`
        : dialog.kind === 'description'
          ? `توضیح ${port.name}`
          : `محدودیت سرعت ${port.name}`;

  async function run() {
    setPhase('running');
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        port_id: port.id,
        action: dialog.kind,
        reason,
        save_config: save && canSave,
      };
      if (dialog.kind === 'description') body.value = desc.trim();
      if (dialog.kind === 'rate_limit') body.value = mbpsNum;
      // با SNMP محدودیت سرعت سه کپی پیکربندی است (خواندن، اعمال، خواندن)
      const r = await runSwitchAction(body, dialog.kind === 'rate_limit' && sw.protocol === 'snmp' ? 360 : 60);
      setResult(r);
    } catch (e) {
      setResult({ ok: false, text: e instanceof ApiError ? e.message : 'ثبت درخواست ناموفق بود' });
    }
    setPhase('done');
    onDone();
  }

  return (
    <Modal open title={title} onClose={phase === 'running' ? () => {} : onClose}>
      <div className="space-y-4">
        {phase === 'form' && (
          <>
            {(dialog.kind === 'shutdown' || dialog.kind === 'no_shutdown') && (
              <>
                <p className="text-sm">
                  روی سوییچ <b>{sw.name}</b>، پورت <Mono>{port.name}</Mono>
                  {port.description ? ` (${port.description})` : ''} {isShut ? 'خاموش (shutdown)' : 'روشن (no shutdown)'}{' '}
                  شود؟
                </p>
                {isShut && port.server_id && (
                  <Notice type="error">
                    این پورت به سرور <b>{port.server_name}</b>
                    {port.customer_name ? ` مشتری ${port.customer_name}` : ''} وصل است و سرور قطع می‌شود. هشدار قطعی برای
                    این سرور تا روشن شدن دوباره پورت ساکت می‌ماند.
                  </Notice>
                )}
                {isShut && port.member_of && (
                  <Notice type="warn">این پورت عضو {port.member_of} است؛ پورت‌چنل با یک عضو کمتر کار می‌کند.</Notice>
                )}
              </>
            )}

            {dialog.kind === 'description' && (
              <Field
                label="توضیح روی خود سوییچ"
                hint={`خالی یعنی پاک شود. حداکثر ${faNum(descMax)} نویسه، بدون «;»${sw.protocol === 'snmp' ? ' (ifAlias)' : ''}`}
              >
                <input className="input ltr" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={descMax + 10} />
                {descError && <p className="text-[11px] text-danger mt-1">{descError}</p>}
              </Field>
            )}

            {dialog.kind === 'rate_limit' && (
              <>
                <Field
                  label="سقف سرعت (مگابیت بر ثانیه)"
                  hint="صفر یعنی برداشتن محدودیت. با policer روی سوییچ؛ ترافیک بیش از سقف دور ریخته می‌شود."
                >
                  <input className="input ltr" inputMode="numeric" value={mbps} onChange={(e) => setMbps(e.target.value.trim())} />
                  {mbps !== '' && mbpsError && <p className="text-[11px] text-danger mt-1">{mbpsError}</p>}
                </Field>
                <div className="flex gap-1.5 flex-wrap">
                  {RATE_PRESETS.filter((v) => !port.speed_mbps || v < port.speed_mbps).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMbps(String(v))}
                      className={`px-2 py-0.5 rounded-md text-xs border ${
                        mbps === String(v) ? 'bg-cyan/10 text-cyan border-cyan/30' : 'border-line text-muted hover:text-white'
                      }`}
                    >
                      {speedLabel(v)}
                    </button>
                  ))}
                  {port.rate_limit_mbps ? (
                    <button
                      type="button"
                      onClick={() => setMbps('0')}
                      className="px-2 py-0.5 rounded-md text-xs border border-line text-muted hover:text-white"
                    >
                      برداشتن محدودیت
                    </button>
                  ) : null}
                </div>
                <p className="text-[11px] text-muted">
                  ورودی پورت یعنی آپلود سرور و خروجی یعنی دانلودش. برخی مدل‌های نکسوس policer خروجی را نمی‌پذیرند؛ در آن
                  صورت فقط ورودی محدود می‌شود و نتیجه همین را می‌گوید. policy دیگری که روی پورت باشد دست نمی‌خورد و فرمان
                  رد می‌شود.
                </p>
                {port.server_id && Number(mbps) > 0 && (
                  <Notice type="warn">
                    این پورت به سرور <b>{port.server_name}</b> وصل است و سرعت آن پایین می‌آید.
                  </Notice>
                )}
              </>
            )}

            <Field label="دلیل" hint="در تاریخچه می‌ماند">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلا: عدم پرداخت فاکتور" />
            </Field>
            {needTyping && (
              <Field label={`برای تأیید، نام پورت را بنویسید: ${port.name}`}>
                <input className="input ltr" value={typed} onChange={(e) => setTyped(e.target.value)} />
              </Field>
            )}
            <label className={`flex items-start gap-2 text-xs ${canSave ? 'cursor-pointer' : 'opacity-60'}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={save && canSave}
                disabled={!canSave}
                onChange={(e) => setSave(e.target.checked)}
              />
              <span>
                ماندگار پس از ریبوت (copy running-config startup-config)
                <span className="block text-muted mt-0.5">
                  {canSave
                    ? 'بدون این، تغییر با ریبوت سوییچ برمی‌گردد. توجه: هر تغییر ذخیره‌نشده دیگری روی سوییچ هم با آن ذخیره می‌شود.'
                    : 'ذخیره پیکربندی از پنل فقط برای NX-API و سیسکو با SNMP ممکن است. روی این سوییچ، ذخیره را خودتان انجام دهید وگرنه با ریبوت برمی‌گردد.'}
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                انصراف
              </button>
              <button type="button" className={isShut ? 'btn-danger' : 'btn-primary'} onClick={run} disabled={!valid}>
                {isShut ? 'خاموش شود' : dialog.kind === 'no_shutdown' ? 'روشن شود' : 'اجرا روی سوییچ'}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <div className="flex items-center gap-3 py-6 justify-center text-sm text-muted">
            <span className="w-4 h-4 border-2 border-cyan/30 border-t-cyan rounded-full animate-spin" />
            در حال اجرا روی سوییچ…
          </div>
        )}

        {phase === 'done' && result && (
          <>
            <Notice type={result.ok ? 'success' : 'error'}>{result.text}</Notice>
            <div className="flex justify-end">
              <button type="button" className="btn-ghost" onClick={onClose}>
                بستن
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function PortSettings({ port, onSaved }: { port: Port; onSaved: () => void }) {
  const servers = useLoad<{ servers: ServerOption[] }>('/api/servers');
  const [form, setForm] = useState({
    server_id: port.server_id ? String(port.server_id) : '',
    count_traffic: port.count_traffic,
    alert_down: port.alert_down,
    alert_util: port.alert_util,
    is_protected: port.is_protected,
    note: port.note ?? '',
  });
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const countable = ['ethernet', 'port-channel'].includes(port.kind);

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      await api.patch('/api/switch-ports', {
        id: port.id,
        server_id: form.server_id || null,
        count_traffic: form.server_id ? form.count_traffic : false,
        alert_down: form.alert_down,
        alert_util: form.alert_util,
        is_protected: form.is_protected,
        note: form.note,
      });
      setMsg({ type: 'success', text: 'ذخیره شد' });
      onSaved();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ذخیره انجام نشد' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="سرور متصل" hint="مصرف این پورت در صفحه همان سرور هم دیده می‌شود">
          <select
            className="input"
            value={form.server_id}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                server_id: e.target.value,
                // پورتی که تازه به سرور وصل می‌شود پیش‌فرض هشدار قطعی می‌گیرد
                alert_down: e.target.value && !f.server_id ? true : f.alert_down,
              }))
            }
          >
            <option value="">— هیچ‌کدام</option>
            {(servers.data?.servers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.main_ip})
              </option>
            ))}
          </select>
        </Field>
        <Field label="یادداشت">
          <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>

      <div className="space-y-2 text-xs">
        {countable && (
          <label className={`flex items-start gap-2 ${form.server_id ? 'cursor-pointer' : 'opacity-50'}`}>
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={!form.server_id}
              checked={form.count_traffic && Boolean(form.server_id)}
              onChange={(e) => setForm((f) => ({ ...f, count_traffic: e.target.checked }))}
            />
            <span>
              مصرف این پورت مبنای ترافیک سرور باشد
              <span className="block text-muted mt-0.5">
                به‌جای عدد ایجنت، در سهمیه، حسابداری، گزارش و پرتال مشتری. خروجی سوییچ دانلود سرور است و
                ورودی سوییچ آپلودش. از همین لحظه اعمال می‌شود؛ روزهای گذشته دست نمی‌خورند.
              </span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.alert_down}
            onChange={(e) => setForm((f) => ({ ...f, alert_down: e.target.checked }))}
          />
          <span>
            هشدار قطعی لینک
            <span className="block text-muted mt-0.5">
              اگر لینک بیش از یک دقیقه قطع بماند پیامک و رویداد می‌سازد. خاموش کردن عمدی از پنل هشدار ندارد.
            </span>
          </span>
        </label>
        {countable && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.alert_util}
              onChange={(e) => setForm((f) => ({ ...f, alert_util: e.target.checked }))}
            />
            <span>
              هشدار اشباع
              <span className="block text-muted mt-0.5">
                وقتی میانگین پنج دقیقه از آستانه تنظیمات (پیش‌فرض ۹۰٪ ظرفیت) بگذرد. برای آپلینک‌ها؛ پورت سروری که با
                تمام ظرفیت کار می‌کند معمولا مشکل نیست.
              </span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.is_protected}
            onChange={(e) => setForm((f) => ({ ...f, is_protected: e.target.checked }))}
          />
          <span>
            محافظت‌شده
            <span className="block text-muted mt-0.5">
              آپلینک، پورت‌چنل هسته، یا هر پورتی که نباید از پنل خاموش یا محدود شود. پیشنهاد اتصال به سرور هم نمی‌گیرد.
            </span>
          </span>
        </label>
      </div>
      <p className="text-[11px] text-muted">
        هشدار خطا و قطع و وصل مکرر برای پورت‌هایی است که به سرور وصل‌اند، محافظت‌شده‌اند یا یکی از هشدارهای بالا را
        دارند.
      </p>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'در حال ذخیره…' : 'ذخیره تنظیمات پورت'}
        </button>
      </div>
    </div>
  );
}

