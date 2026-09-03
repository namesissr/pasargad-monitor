'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, timeAgo } from '@/lib/format';

interface NodeRow {
  id: number;
  name: string;
  url?: string;
  anchor_vpsid: string | null;
  max_per_run?: number;
  is_active: boolean;
  has_credentials?: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  ip_count: number;
  assigned_count: number;
  watched_count: number;
}

interface RunRow {
  id: number;
  node_name: string | null;
  started_at: string;
  kind: string;
  dry_run: boolean;
  discovered: number;
  attached: number;
  detached: number;
  ok: boolean;
  detail: string | null;
}

interface VzData {
  nodes: NodeRow[];
  runs: RunRow[];
  pending: number;
}

const KIND_LABEL: Record<string, string> = { discover: 'کشف', apply: 'اعمال' };

export default function VirtualizorPage() {
  const { data, loading, error, reload } = useLoad<VzData>('/api/virtualizor');
  const [editing, setEditing] = useState<NodeRow | 'new' | null>(null);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function queue(nodeId: number, kind: 'discover' | 'apply', apply = false) {
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.post<{ queued: boolean; reason?: string }>('/api/virtualizor', {
        nodeId,
        kind,
        apply,
      });
      setMsg({
        type: 'success',
        text: res.queued
          ? 'درخواست ثبت شد. ورکر ظرف حدود بیست ثانیه اجرایش می‌کند؛ نتیجه در جدول پایین می‌آید.'
          : res.reason || 'درخواست از قبل در صف بود.',
      });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ثبت درخواست ناموفق بود' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(node: NodeRow) {
    if (!confirm(`نود «${node.name}» حذف شود؟ آی‌پی‌ها می‌مانند و فقط پیوندشان پاک می‌شود.`)) return;
    try {
      await api.del(`/api/vz-nodes?id=${node.id}`);
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'حذف نود ناموفق بود' });
    }
  }

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const totals = data.nodes.reduce(
    (acc, n) => ({
      ips: acc.ips + n.ip_count,
      assigned: acc.assigned + n.assigned_count,
      watched: acc.watched + n.watched_count,
    }),
    { ips: 0, assigned: 0, watched: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">ویژالیزور</h1>
          <p className="text-xs text-muted mt-1">
            هر نود جدا تعریف می‌شود. کشف خودکار هر ساعت آی‌پی‌ها، بلوک‌ها و مشتری هر آدرس را
            به‌روز می‌کند.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          افزودن نود
        </button>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {data.pending > 0 && (
        <Notice type="warn">{faNum(data.pending)} درخواست در صف اجرا است.</Notice>
      )}

      {!data.nodes.length ? (
        <Notice type="warn">
          هنوز نودی اضافه نشده. با دکمه «افزودن نود» شروع کنید — برای هر سرور ویژالیزور یکی.
        </Notice>
      ) : (
        <div className="grid sm:grid-cols-3 gap-3">
          {([
            ['کل آی‌پی‌های کشف‌شده', totals.ips, 'text-white'],
            ['تخصیص‌یافته به مشتری', totals.assigned, 'text-muted'],
            ['تحت پایش اکسس', totals.watched, 'text-amber'],
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="card p-4">
              <div className="text-xs text-muted">{label}</div>
              <div className={`text-2xl font-bold mt-1 ${tone}`}>{faNum(value)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {data.nodes.map((node) => (
          <section key={node.id} className="card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-bold">
                  {node.name}
                  {!node.is_active && <span className="badge bg-line text-muted ms-2">غیرفعال</span>}
                </h2>
                <p className="text-xs text-muted mt-0.5">
                  {faNum(node.ip_count)} آدرس · {faNum(node.assigned_count)} تخصیص‌یافته ·{' '}
                  {faNum(node.watched_count)} تحت پایش
                  {node.last_sync_at && ` · آخرین کشف ${timeAgo(node.last_sync_at)}`}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button type="button" className="btn-ghost text-xs" onClick={() => queue(node.id, 'discover')} disabled={busy}>
                  کشف حالا
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => queue(node.id, 'apply', false)} disabled={busy || !node.anchor_vpsid}>
                  پیش‌نمایش اعمال
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => queue(node.id, 'apply', true)} disabled={busy || !node.anchor_vpsid}>
                  اعمال واقعی
                </button>
                <button type="button" className="text-xs text-muted hover:text-cyan" onClick={() => setEditing(node)}>
                  ویرایش
                </button>
                <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => remove(node)}>
                  حذف
                </button>
              </div>
            </div>

            {node.last_error && <Notice type="error">{node.last_error}</Notice>}
            {!node.anchor_vpsid && (
              <p className="text-xs text-muted">
                شناسه وی‌پی‌اس لنگر تعیین نشده — فقط کشف انجام می‌شود و هیچ چیزی روی این نود
                نوشته نمی‌شود.
              </p>
            )}
          </section>
        ))}
      </div>

      <section className="card p-5">
        <h2 className="text-sm font-bold mb-3">اجراهای اخیر</h2>
        {!data.runs.length ? (
          <p className="text-xs text-muted">هنوز اجرایی ثبت نشده.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="text-start py-1">زمان</th>
                  <th className="text-start py-1">نود</th>
                  <th className="text-start py-1">کار</th>
                  <th className="text-start py-1">کشف</th>
                  <th className="text-start py-1">چسبید</th>
                  <th className="text-start py-1">جدا شد</th>
                  <th className="text-start py-1">نتیجه</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-1.5 whitespace-nowrap">{timeAgo(r.started_at)}</td>
                    <td className="py-1.5">{r.node_name || '—'}</td>
                    <td className="py-1.5 whitespace-nowrap">
                      {KIND_LABEL[r.kind] || r.kind}
                      {r.kind === 'apply' && r.dry_run && ' (آزمایشی)'}
                    </td>
                    <td className="py-1.5">{faNum(r.discovered)}</td>
                    <td className="py-1.5">{faNum(r.attached)}</td>
                    <td className="py-1.5">{faNum(r.detached)}</td>
                    <td className="py-1.5">
                      {r.ok ? (
                        <span className="text-ok" title={r.detail || undefined}>موفق</span>
                      ) : (
                        <span className="text-danger" title={r.detail || undefined}>ناموفق</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <NodeForm
          node={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function NodeForm({
  node,
  onClose,
  onDone,
}: {
  node: NodeRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: node?.name ?? '',
    url: node?.url ?? '',
    api_key: '',
    api_pass: '',
    anchor_vpsid: node?.anchor_vpsid ?? '',
    max_per_run: String(node?.max_per_run ?? 200),
    is_active: node?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const payload = { ...form, max_per_run: Number(form.max_per_run) || 200 };
      if (node) await api.patch('/api/vz-nodes', { id: node.id, ...payload });
      else await api.post('/api/vz-nodes', payload);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره نود ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={node ? `ویرایش ${node.name}` : "افزودن نود ویژالیزور"} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام نود" hint="فقط برای شناسایی در پنل">
            <input className="input" value={form.name} onChange={set('name')} placeholder="نود ۱ — تهران" />
          </Field>
          <Field label="آدرس پنل" hint="معمولاً پورت ۴۰۸۵">
            <input className="input ltr" value={form.url} onChange={set('url')} placeholder="https://185.x.x.x:4085" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="کلید ای‌پی‌آی" hint={node ? 'خالی یعنی همان کلید قبلی بماند' : 'از Configuration ← API Credentials'}>
            <input className="input ltr" type="password" value={form.api_key} onChange={set('api_key')} autoComplete="off" />
          </Field>
          <Field label="رمز ای‌پی‌آی" hint={node ? 'خالی یعنی همان رمز قبلی بماند' : ''}>
            <input className="input ltr" type="password" value={form.api_pass} onChange={set('api_pass')} autoComplete="off" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field
            label="شناسه وی‌پی‌اس لنگر"
            hint="یک وی‌پی‌اس خالی روی همین نود. خالی یعنی فقط کشف، بدون هیچ نوشتنی."
          >
            <input className="input ltr" value={form.anchor_vpsid} onChange={set('anchor_vpsid')} placeholder="1234" />
          </Field>
          <Field label="سقف هر اجرا">
            <input className="input ltr" value={form.max_per_run} onChange={set('max_per_run')} />
          </Field>
          <Field label="وضعیت">
            <select
              className="input"
              value={form.is_active ? 'true' : 'false'}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'true' }))}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
        </div>

        <Notice type="warn">
          وی‌پی‌اس لنگر تنها چیزی است که پنل روی این نود تغییرش می‌دهد. اگر شناسه یک وی‌پی‌اس
          مشتری را وارد کنید، آی‌پی‌هایش عوض می‌شود. کلید و رمز پس از ذخیره دیگر نمایش داده
          نمی‌شوند — فقط قابل جایگزینی‌اند.
        </Notice>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
