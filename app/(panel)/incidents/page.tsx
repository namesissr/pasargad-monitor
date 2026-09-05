'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Mono, Notice, StatCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatDuration, formatJalaliTime, timeAgo, INCIDENT_KIND_LABEL } from '@/lib/format';

interface IncidentRow {
  id: number;
  server_id: number | null;
  server_name: string | null;
  server_ip: string | null;
  ip: string | null;
  kind: string;
  severity: string;
  message: string;
  value: number | null;
  started_at: string;
  resolved_at: string | null;
  notified_at: string | null;
  ack_at: string | null;
  duration_sec: number;
}

interface IncidentData {
  incidents: IncidentRow[];
  total: number;
  page: number;
  limit: number;
  summary: { open: number; today: number; week: number };
}

const KINDS = ['all', 'down', 'agent_lost', 'cpu', 'ram', 'disk', 'traffic', 'ip_down'];

export default function IncidentsPage() {
  const [openOnly, setOpenOnly] = useState(false);
  const [kind, setKind] = useState('all');
  const [serverId, setServerId] = useState('all');
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sid = sp.get('server_id');
    if (sid) setServerId(sid);
  }, []);

  const params = new URLSearchParams({ page: String(page), limit: '100', kind, server_id: serverId });
  if (openOnly) params.set('open', '1');

  const { data, loading, error, reload } = useLoad<IncidentData>(`/api/incidents?${params}`, 20_000);
  const servers = useLoad<{ servers: { id: number; name: string }[] }>('/api/servers');

  async function act(id: number, action: 'ack' | 'resolve') {
    setErr(null);
    try {
      await api.patch(`/api/incidents/${id}`, { action });
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'عملیات انجام نشد');
    }
  }

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 100)));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">رویدادها</h1>
        <p className="text-xs text-muted mt-0.5">قطعی‌ها و عبور از آستانه‌های هشدار</p>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard title="باز" value={faNum(data.summary.open)} tone={data.summary.open ? 'danger' : 'ok'} />
          <StatCard title="امروز" value={faNum(data.summary.today)} />
          <StatCard title="هفت روز اخیر" value={faNum(data.summary.week)} />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
          <input type="checkbox" checked={openOnly} onChange={(e) => { setOpenOnly(e.target.checked); setPage(1); }} />
          فقط رویدادهای باز
        </label>
        <select className="input max-w-[180px]" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{k === 'all' ? 'همه انواع' : INCIDENT_KIND_LABEL[k] ?? k}</option>
          ))}
        </select>
        <select className="input max-w-[200px]" value={serverId} onChange={(e) => { setServerId(e.target.value); setPage(1); }}>
          <option value="all">همه سرورها</option>
          {(servers.data?.servers ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {err && <Notice type="error">{err}</Notice>}

      <LoadState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!!data && data.incidents.length === 0}
        emptyText={openOnly ? 'هیچ رویداد بازی نیست. همه چیز عادی است.' : 'رویدادی ثبت نشده است.'}
      >
        <div className="card table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>نوع</th>
                <th>سرور</th>
                <th>شرح</th>
                <th className="col-sm">شروع</th>
                <th className="col-md">مدت</th>
                <th className="col-md">پیامک</th>
                <th>وضعیت</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data?.incidents ?? []).map((inc) => (
                <tr key={inc.id}>
                  <td className="sm:whitespace-nowrap">
                    <span className={`badge border ${inc.severity === 'critical' ? 'bg-danger/15 text-danger border-danger/30' : 'bg-amber/15 text-amber border-amber/30'}`}>
                      {INCIDENT_KIND_LABEL[inc.kind] ?? inc.kind}
                    </span>
                  </td>
                  <td className="text-xs">
                    {inc.server_id ? (
                      <Link href={`/servers/${inc.server_id}`} className="hover:text-cyan">
                        {inc.server_name}
                        <br />
                        <Mono className="text-muted">{inc.ip || inc.server_ip}</Mono>
                      </Link>
                    ) : (
                      <Mono className="text-muted">{inc.ip || '—'}</Mono>
                    )}
                  </td>
                  <td className="text-xs max-w-[280px] truncate" title={inc.message}>{inc.message}</td>
                  <td className="col-sm text-xs sm:whitespace-nowrap" title={formatJalaliTime(inc.started_at)}>
                    {timeAgo(inc.started_at)}
                  </td>
                  <td className="col-md text-xs sm:whitespace-nowrap">{formatDuration(inc.duration_sec)}</td>
                  <td className="col-md text-xs">
                    {inc.notified_at ? <span className="text-ok">ارسال شد</span> : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-xs sm:whitespace-nowrap">
                    {inc.resolved_at ? (
                      <span className="text-ok">برطرف شد</span>
                    ) : inc.ack_at ? (
                      <span className="text-amber">دیده شد</span>
                    ) : (
                      <span className="text-danger">باز</span>
                    )}
                  </td>
                  <td className="text-end sm:whitespace-nowrap">
                    {!inc.resolved_at && (
                      <>
                        {!inc.ack_at && (
                          <button type="button" className="text-xs text-muted hover:text-amber me-2" onClick={() => act(inc.id, 'ack')}>
                            دیدم
                          </button>
                        )}
                        <button type="button" className="text-xs text-muted hover:text-ok" onClick={() => act(inc.id, 'resolve')}>
                          بستن
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-3">
            <button type="button" className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
            <span className="text-xs text-muted">صفحه {faNum(page)} از {faNum(pages)}</span>
            <button type="button" className="btn-ghost text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>بعدی</button>
          </div>
        )}
      </LoadState>

      <p className="text-[11px] text-muted/70">
        «دیدم» جلوی تکرار پیامک را می‌گیرد ولی رویداد را باز نگه می‌دارد. «بستن» رویداد را دستی می‌بندد؛
        اگر مشکل هنوز پابرجا باشد ورکر دوباره بازش می‌کند.
      </p>
    </div>
  );
}
