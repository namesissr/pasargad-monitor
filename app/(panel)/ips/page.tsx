'use client';

import { useEffect, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, IpBadge, Modal, Mono, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalali, formatPercent, timeAgo, IP_STATUS_LABEL, IRAN_ACCESS_LABEL } from '@/lib/format';

interface IpRow {
  id: number;
  ip: string;
  version: number;
  status: string;
  customer: string | null;
  ptr: string | null;
  mac: string | null;
  is_monitored: boolean;
  ping_ok: boolean | null;
  ping_ms: number | null;
  last_ping_at: string | null;
  notes: string | null;
  access_watch: boolean;
  iran_access_status: string;
  access_blocked_since: string | null;
  access_released_at: string | null;
  bind_server_id: number | null;
  bind_ok: boolean | null;
  bind_error: string | null;
  bind_same_subnet: boolean | null;
  server_id: number | null;
  server_name: string | null;
  subnet_id: number | null;
  subnet: string | null;
  subnet_prefix: number | null;
  gateway: string | null;
  bind_prefix: number;
}

interface IpData {
  ips: IpRow[];
  total: number;
  page: number;
  limit: number;
  stats: { status: string; cnt: number }[];
  accessStats: { watch: number; blocked: number; released7: number; unreachable: number } | null;
}

interface SubnetRow {
  id: number;
  cidr: string;
  version: number;
  gateway: string | null;
  provider: string | null;
  location: string | null;
  label: string | null;
  total: number;
  assigned: number;
  free: number;
  blocked: number;
}

const STATUSES = ['assigned', 'free', 'reserved', 'blocked', 'abuse'];

export default function IpsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [serverId, setServerId] = useState('');
  const [version, setVersion] = useState('');
  const [access, setAccess] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<IpRow | null>(null);

  // پارامتر server_id از آدرس خوانده می‌شود (مثلا از صفحه سرور آمده باشیم)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sid = sp.get('server_id');
    if (sid) setServerId(sid);
  }, []);

  const params = new URLSearchParams({ page: String(page), limit: '100' });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (serverId) params.set('server_id', serverId);
  if (version) params.set('version', version);
  if (access) params.set('access', access);

  const { data, loading, error, reload } = useLoad<IpData>(`/api/ips?${params}`);
  const subnets = useLoad<{ subnets: SubnetRow[] }>('/api/subnets');
  const servers = useLoad<{ servers: { id: number; name: string }[] }>('/api/servers');

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.limit ?? 100)));
  const statTotal = (data?.stats ?? []).reduce((a, s) => a + s.cnt, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">آی‌پی‌ها</h1>
          <p className="text-xs text-muted mt-0.5">{faNum(total)} آدرس با فیلتر فعلی</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => setImporting(true)}>
            وارد کردن بلوک
          </button>
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            + افزودن آی‌پی
          </button>
        </div>
      </div>

      {/* خلاصه وضعیت */}
      {statTotal > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {STATUSES.map((st) => {
            const cnt = data?.stats.find((s) => s.status === st)?.cnt ?? 0;
            const active = status === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setStatus(active ? '' : st);
                  setPage(1);
                }}
                className={`card p-3 text-start transition-colors ${active ? 'border-cyan/50' : 'hover:border-line'}`}
              >
                <p className="text-[11px] text-muted mb-1">{IP_STATUS_LABEL[st]}</p>
                <p className="text-lg font-bold">{faNum(cnt)}</p>
                <p className="text-[10px] text-muted/70">{formatPercent(statTotal ? (cnt / statTotal) * 100 : 0, 0)}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* اکسس ایران */}
      {(data?.accessStats?.watch ?? 0) > 0 && (
        <div className="card p-3 flex items-center gap-2 flex-wrap text-xs">
          <span className="font-bold">اکسس ایران:</span>
          {([
            ['blocked', `${faNum(data?.accessStats?.blocked ?? 0)} در اکسس`],
            ['released', 'آزادشده‌ها'],
            ['unreachable', `${faNum(data?.accessStats?.unreachable ?? 0)} روت نشده`],
            ['watch', `همه تحت پایش (${faNum(data?.accessStats?.watch ?? 0)})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setAccess(access === key ? '' : key); setPage(1); }}
              className={`px-2.5 py-1 rounded-md border transition-colors ${
                access === key ? 'bg-cyan/10 text-cyan border-cyan/30' : 'border-line text-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
          {(data?.accessStats?.released7 ?? 0) > 0 && (
            <span className="badge bg-ok/15 text-ok ms-auto">
              {faNum(data?.accessStats?.released7 ?? 0)} آی‌پی در ۷ روز اخیر آزاد شد
            </span>
          )}
        </div>
      )}

      {/* فیلترها */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="input max-w-xs"
          placeholder="جستجو: آی‌پی، رکورد معکوس، مشتری"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select className="input max-w-[180px]" value={serverId} onChange={(e) => { setServerId(e.target.value); setPage(1); }}>
          <option value="">همه سرورها</option>
          <option value="none">بدون سرور</option>
          {(servers.data?.servers ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select className="input max-w-[130px]" value={version} onChange={(e) => { setVersion(e.target.value); setPage(1); }}>
          <option value="">هر نسخه</option>
          <option value="4">نسخه ۴</option>
          <option value="6">نسخه ۶</option>
        </select>
        {(q || status || serverId || version || access) && (
          <button
            type="button"
            className="text-xs text-muted hover:text-cyan"
            onClick={() => { setQ(''); setStatus(''); setServerId(''); setVersion(''); setAccess(''); setPage(1); }}
          >
            پاک‌کردن فیلترها
          </button>
        )}
      </div>

      <LoadState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!!data && data.ips.length === 0}
        emptyText="آی‌پی‌ای با این فیلتر پیدا نشد"
      >
        <div className="card table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>آی‌پی</th>
                <th>وضعیت</th>
                <th>سرور</th>
                <th>مشتری</th>
                <th>رکورد معکوس</th>
                <th>بلوک</th>
                <th>ماسک و گیت‌وی</th>
                <th>اکسس ایران</th>
                <th>پینگ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data?.ips ?? []).map((ip) => (
                <tr key={ip.id}>
                  <td>
                    <Mono className={ip.version === 6 ? 'text-[11px]' : ''}>{ip.ip}</Mono>
                  </td>
                  <td><IpBadge status={ip.status} /></td>
                  <td className="text-xs">{ip.server_name || <span className="text-muted">—</span>}</td>
                  <td className="text-xs truncate max-w-[140px]">{ip.customer || <span className="text-muted">—</span>}</td>
                  <td className="text-xs text-muted truncate max-w-[180px]">{ip.ptr || '—'}</td>
                  <td><Mono className="text-muted">{ip.subnet || '—'}</Mono></td>
                  <td className="text-xs whitespace-nowrap">
                    {ip.subnet_prefix ? (
                      <Mono className="text-muted">/{ip.subnet_prefix}</Mono>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {ip.gateway && (
                      <>
                        <br />
                        <Mono className="text-muted">{ip.gateway}</Mono>
                      </>
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {!ip.access_watch ? (
                      <span className="text-muted/60">—</span>
                    ) : ip.iran_access_status === 'released' ? (
                      <span className="badge bg-ok/15 text-ok" title={formatJalali(ip.access_released_at)}>
                        {IRAN_ACCESS_LABEL.released} · {timeAgo(ip.access_released_at)}
                      </span>
                    ) : ip.iran_access_status === 'blocked' ? (
                      <span className="badge bg-danger/15 text-danger" title={formatJalali(ip.access_blocked_since)}>
                        {IRAN_ACCESS_LABEL.blocked} · {timeAgo(ip.access_blocked_since)}
                      </span>
                    ) : ip.iran_access_status === 'unreachable' ? (
                      <span
                        className="badge bg-amber/15 text-amber"
                        title={
                          ip.bind_same_subnet === false
                            ? 'این آی‌پی از رنج سرور لنگر نیست. دیتاسنتر باید بلوک را به آن سرور روت کند.'
                            : 'از هیچ دیدباتی در دسترس نیست. اگر دیدبان داخل ایران ندارید، اکسس‌بودن قابل تشخیص نیست.'
                        }
                      >
                        {IRAN_ACCESS_LABEL.unreachable}
                        {ip.bind_same_subnet === false && ' · رنج متفاوت'}
                      </span>
                    ) : (
                      <span
                        className="badge bg-line text-muted"
                        title={ip.bind_error || 'هنوز دیدبان یا لنگر تأییدش نکرده'}
                      >
                        {IRAN_ACCESS_LABEL.unknown}
                        {ip.bind_server_id && ip.bind_ok === false && ' · لنگر ناموفق'}
                      </span>
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {!ip.is_monitored ? (
                      <span className="text-muted/60">خاموش</span>
                    ) : ip.ping_ok === null ? (
                      <span className="text-muted">—</span>
                    ) : ip.ping_ok ? (
                      <span className="text-ok">{faNum((ip.ping_ms ?? 0).toFixed(0))} م‌ث</span>
                    ) : (
                      <span className="text-danger" title={timeAgo(ip.last_ping_at)}>بی‌پاسخ</span>
                    )}
                  </td>
                  <td className="text-end">
                    <button type="button" className="text-xs text-muted hover:text-cyan" onClick={() => setEditing(ip)}>
                      ویرایش
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-3">
            <button type="button" className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              قبلی
            </button>
            <span className="text-xs text-muted">صفحه {faNum(page)} از {faNum(pages)}</span>
            <button type="button" className="btn-ghost text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              بعدی
            </button>
          </div>
        )}
      </LoadState>

      {/* بلوک‌ها */}
      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-bold">بلوک‌های آی‌پی</h2>
        </div>
        {(subnets.data?.subnets ?? []).length === 0 ? (
          <p className="p-6 text-center text-xs text-muted">بلوکی ثبت نشده است.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl min-w-[620px]">
              <thead>
                <tr>
                  <th>بلوک</th>
                  <th>گیت‌وی</th>
                  <th>ارائه‌دهنده</th>
                  <th>ثبت‌شده</th>
                  <th>تخصیص‌یافته</th>
                  <th>آزاد</th>
                  <th>مسدود</th>
                </tr>
              </thead>
              <tbody>
                {(subnets.data?.subnets ?? []).map((n) => (
                  <tr key={n.id}>
                    <td><Mono className="text-cyan">{n.cidr}</Mono></td>
                    <td><Mono className="text-muted">{n.gateway || '—'}</Mono></td>
                    <td className="text-xs">{n.provider || '—'}</td>
                    <td className="text-xs">{faNum(n.total)}</td>
                    <td className="text-xs text-cyan">{faNum(n.assigned)}</td>
                    <td className="text-xs text-ok">{faNum(n.free)}</td>
                    <td className="text-xs text-danger">{faNum(n.blocked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AddIpModal
        open={adding}
        onClose={() => setAdding(false)}
        onDone={() => { reload(); subnets.reload(); }}
        servers={servers.data?.servers ?? []}
      />
      <ImportBlockModal
        open={importing}
        onClose={() => setImporting(false)}
        onDone={() => { reload(); subnets.reload(); }}
      />
      <EditIpModal
        ip={editing}
        onClose={() => setEditing(null)}
        onDone={reload}
        servers={servers.data?.servers ?? []}
      />
    </div>
  );
}

function AddIpModal({
  open,
  onClose,
  onDone,
  servers,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  servers: { id: number; name: string }[];
}) {
  const [ips, setIps] = useState('');
  const [status, setStatus] = useState('free');
  const [serverId, setServerId] = useState('');
  const [customer, setCustomer] = useState('');
  const [monitored, setMonitored] = useState(true);
  const [accessWatch, setAccessWatch] = useState(false);
  const [bindServerId, setBindServerId] = useState('');
  const [gateway, setGateway] = useState('');
  const [bindPrefix, setBindPrefix] = useState('32');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; failed: { ip: string; reason: string }[] } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post<{ added: number; failed: { ip: string; reason: string }[] }>('/api/ips', {
        ips,
        status,
        server_id: serverId || null,
        customer,
        is_monitored: monitored,
        access_watch: accessWatch,
        bind_server_id: accessWatch && bindServerId ? Number(bindServerId) : null,
        gateway,
        bind_prefix: Number(bindPrefix) || 32,
      });
      setResult(res);
      onDone();
      if (!res.failed.length) setIps('');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'ثبت آی‌پی انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="افزودن آی‌پی" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="آی‌پی‌ها" hint="هر خط یک آدرس، یا با کاما جدا کنید. نسخه ۴ و ۶ هر دو پذیرفته می‌شود.">
          <textarea
            className="input h-28 ltr font-mono text-xs resize-none"
            value={ips}
            onChange={(e) => setIps(e.target.value)}
            placeholder={'185.1.2.10\n185.1.2.11\n2a01:4f8::1'}
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="وضعیت">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{IP_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="سرور">
            <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
              <option value="">بدون سرور</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="مشتری">
            <input className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </Field>
          <Field
            label="گیت‌وی"
            hint="برای مستندسازی و تحویل به مشتری. خالی یعنی گیت‌وی بلوک استفاده شود."
          >
            <input className="input ltr" value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="185.1.2.1" />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer pb-2">
              <input type="checkbox" checked={monitored} onChange={(e) => setMonitored(e.target.checked)} />
              پینگ دوره‌ای انجام شود
            </label>
          </div>
        </div>

        <div className="border-t border-line pt-3 space-y-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={accessWatch} onChange={(e) => setAccessWatch(e.target.checked)} />
            <span className="font-bold">پایش اکسس ایران</span>
            <span className="text-muted">— این آی‌پی‌ها الان اکسس‌اند؛ آزاد که شدند خبر بده</span>
          </label>

          {accessWatch && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field
                label="سرور لنگر"
                hint="آی‌پی بیکار به پینگ جواب نمی‌دهد. روی این سرور خودکار بایند می‌شود تا قابل سنجش شود. فقط سروری که ایجنت لنگر رویش نصب است."
              >
                <select className="input" value={bindServerId} onChange={(e) => setBindServerId(e.target.value)}>
                  <option value="">بدون لنگر — فقط اگر آی‌پی از قبل به ماشینی وصل است</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="پرفیکس بایند"
                hint="۳۲ را عوض نکنید مگر دیتاسنتر صریح چیز دیگری بخواهد. ماسک واقعی یک مسیر متصل تکراری می‌سازد و می‌تواند با آی‌پی اصلی سرور تداخل کند."
              >
                <select className="input" value={bindPrefix} onChange={(e) => setBindPrefix(e.target.value)}>
                  <option value="32">۳۲ — پیشنهادی</option>
                  <option value="30">۳۰</option>
                  <option value="29">۲۹</option>
                  <option value="24">۲۴</option>
                </select>
              </Field>
            </div>
          )}
        </div>

        {err && <Notice type="error">{err}</Notice>}
        {result && (
          <Notice type={result.failed.length ? 'error' : 'success'}>
            {faNum(result.added)} آدرس ثبت شد.
            {result.failed.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {result.failed.slice(0, 5).map((f) => (
                  <li key={f.ip} className="ltr font-mono text-[11px]">{f.ip} — {f.reason}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>بستن</button>
          <button type="submit" className="btn-primary" disabled={busy || !ips.trim()}>
            {busy ? 'در حال ثبت…' : 'ثبت'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportBlockModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ cidr: '', gateway: '', provider: '', location: '', label: '' });
  const [status, setStatus] = useState('free');
  const [skipEdges, setSkipEdges] = useState(true);
  const [monitored, setMonitored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ added: number; capacity: number; skipped_existing: number } | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setRes(null);
    setBusy(true);
    try {
      const r = await api.post<{ added: number; capacity: number; skipped_existing: number }>('/api/ips/import', {
        ...form,
        status,
        skip_edges: skipEdges,
        is_monitored: monitored,
      });
      setRes(r);
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'وارد کردن بلوک انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="وارد کردن بلوک آی‌پی" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="بلوک *" hint="حداکثر /۲۰ یعنی ۴۰۹۶ آدرس. بلوک نسخه ۶ باز نمی‌شود.">
          <input className="input ltr font-mono" value={form.cidr} onChange={set('cidr')} placeholder="185.1.2.0/24" />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="گیت‌وی"><input className="input ltr" value={form.gateway} onChange={set('gateway')} placeholder="185.1.2.1" /></Field>
          <Field label="ارائه‌دهنده"><input className="input" value={form.provider} onChange={set('provider')} /></Field>
          <Field label="موقعیت"><input className="input" value={form.location} onChange={set('location')} /></Field>
          <Field label="برچسب"><input className="input" value={form.label} onChange={set('label')} /></Field>
          <Field label="وضعیت اولیه آدرس‌ها">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{IP_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={skipEdges} onChange={(e) => setSkipEdges(e.target.checked)} />
            آدرس شبکه و برادکست رد شوند
          </label>
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={monitored} onChange={(e) => setMonitored(e.target.checked)} />
            همه آدرس‌ها پینگ دوره‌ای شوند (برای بلوک بزرگ توصیه نمی‌شود)
          </label>
        </div>

        {err && <Notice type="error">{err}</Notice>}
        {res && (
          <Notice type="success">
            {faNum(res.added)} آدرس تازه ثبت شد از ظرفیت {faNum(res.capacity)}.
            {res.skipped_existing > 0 && <> {faNum(res.skipped_existing)} آدرس از قبل وجود داشت.</>}
          </Notice>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>بستن</button>
          <button type="submit" className="btn-primary" disabled={busy || !form.cidr.trim()}>
            {busy ? 'در حال وارد کردن…' : 'وارد کردن'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditIpModal({
  ip,
  onClose,
  onDone,
  servers,
}: {
  ip: IpRow | null;
  onClose: () => void;
  onDone: () => void;
  servers: { id: number; name: string }[];
}) {
  const [form, setForm] = useState({
    status: 'free',
    server_id: '',
    customer: '',
    ptr: '',
    mac: '',
    notes: '',
    is_monitored: false,
    access_watch: false,
    bind_server_id: '',
    gateway: '',
    bind_prefix: '32',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ip) return;
    setForm({
      status: ip.status,
      server_id: ip.server_id ? String(ip.server_id) : '',
      customer: ip.customer ?? '',
      ptr: ip.ptr ?? '',
      mac: ip.mac ?? '',
      notes: ip.notes ?? '',
      is_monitored: ip.is_monitored,
      access_watch: ip.access_watch,
      bind_server_id: ip.bind_server_id ? String(ip.bind_server_id) : '',
      gateway: ip.gateway ?? '',
      bind_prefix: String(ip.bind_prefix ?? 32),
    });
    setErr(null);
  }, [ip]);

  if (!ip) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ip) return;
    setErr(null);
    setBusy(true);
    try {
      await api.patch(`/api/ips/${ip.id}`, {
        ...form,
        server_id: form.server_id || null,
        bind_server_id: form.bind_server_id || null,
        bind_prefix: Number(form.bind_prefix) || 32,
      });
      onDone();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'ذخیره انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!ip) return;
    if (!confirm(`آی‌پی ${ip.ip} از فهرست حذف شود؟`)) return;
    try {
      await api.del(`/api/ips/${ip.id}`);
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'حذف انجام نشد');
    }
  }

  return (
    <Modal open={!!ip} title={`ویرایش ${ip.ip}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="وضعیت">
            <select className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{IP_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="سرور">
            <select className="input" value={form.server_id} onChange={(e) => setForm((f) => ({ ...f, server_id: e.target.value }))}>
              <option value="">بدون سرور</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="مشتری">
            <input className="input" value={form.customer} onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))} />
          </Field>
          <Field label="رکورد معکوس (PTR)">
            <input className="input ltr" value={form.ptr} onChange={(e) => setForm((f) => ({ ...f, ptr: e.target.value }))} />
          </Field>
          <Field label="مک آدرس">
            <input className="input ltr" value={form.mac} onChange={(e) => setForm((f) => ({ ...f, mac: e.target.value }))} />
          </Field>
          <Field label="گیت‌وی" hint="خالی یعنی گیت‌وی بلوک استفاده شود">
            <input
              className="input ltr"
              value={form.gateway}
              onChange={(e) => setForm((f) => ({ ...f, gateway: e.target.value }))}
            />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={form.is_monitored}
                onChange={(e) => setForm((f) => ({ ...f, is_monitored: e.target.checked }))}
              />
              پینگ دوره‌ای
            </label>
          </div>
        </div>

        <div className="border-t border-line pt-3 space-y-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.access_watch}
              onChange={(e) => setForm((f) => ({ ...f, access_watch: e.target.checked }))}
            />
            <span className="font-bold">پایش اکسس ایران</span>
          </label>
          {form.access_watch && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="سرور لنگر" hint="خالی یعنی بدون بایند خودکار">
                <select
                  className="input"
                  value={form.bind_server_id}
                  onChange={(e) => setForm((f) => ({ ...f, bind_server_id: e.target.value }))}
                >
                  <option value="">بدون لنگر</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="پرفیکس بایند" hint="۳۲ پیشنهادی است">
                <select
                  className="input"
                  value={form.bind_prefix}
                  onChange={(e) => setForm((f) => ({ ...f, bind_prefix: e.target.value }))}
                >
                  <option value="32">۳۲ — پیشنهادی</option>
                  <option value="30">۳۰</option>
                  <option value="29">۲۹</option>
                  <option value="24">۲۴</option>
                </select>
              </Field>
            </div>
          )}
        </div>

        <Field label="یادداشت">
          <textarea className="input h-16 resize-none" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-between">
          <button type="button" className="btn-danger" onClick={remove}>حذف</button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
