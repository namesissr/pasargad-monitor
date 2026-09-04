'use client';

import { useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Mono, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, timeAgo } from '@/lib/format';

interface NodeRow {
  id: number;
  name: string;
  kind: string;
  url?: string;
  anchor_vpsid: string | null;
  max_per_run?: number;
  is_active: boolean;
  has_credentials?: boolean;
  bind_server_id: number | null;
  bind_server_name: string | null;
  auto_watch_free?: boolean;
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

interface ServerOption {
  id: number;
  name: string;
}

interface AnchorRow {
  id: number;
  node_id: number;
  name: string;
  anchor_vpsid: string;
  bind_server_id: number | null;
  bind_server_name: string | null;
  max_per_run: number;
  is_default: boolean;
  block_count: number;
  ip_count: number;
}

interface VzData {
  nodes: NodeRow[];
  runs: RunRow[];
  pending: number;
}

const KIND_LABEL: Record<string, string> = { discover: 'کشف', apply: 'اعمال' };

const NODE_KIND_LABEL: Record<string, string> = {
  virtualizor: 'ویژالیزور',
  solusvm2: 'سولوس‌وی‌ام ۲',
};

/** هر دو نوع نوشتن دارند؛ این برای نوع‌های آینده باقی می‌ماند */
const canWrite = (kind: string) => ['virtualizor', 'solusvm2'].includes(kind);

export default function VirtualizorPage() {
  const { data, loading, error, reload } = useLoad<VzData>('/api/virtualizor');
  const anchors = useLoad<{ anchors: AnchorRow[] }>('/api/vz-anchors');
  const [editing, setEditing] = useState<NodeRow | 'new' | null>(null);
  const [anchorEdit, setAnchorEdit] = useState<{ node: NodeRow; anchor: AnchorRow | null } | null>(null);
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
          <h1 className="text-lg font-bold">هایپروایزرها</h1>
          <p className="text-xs text-muted mt-1">
            ویژالیزور و سولوس‌وی‌ام ۲، کنار هم. هر نود جدا تعریف می‌شود و کشف خودکار هر سه ساعت
            آی‌پی‌ها، بلوک‌ها و مشتری هر آدرس را به‌روز می‌کند.
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
                  <span className="badge bg-line text-muted ms-2">
                    {NODE_KIND_LABEL[node.kind] || node.kind}
                  </span>
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
                {canWrite(node.kind) && (
                  <>
                    <button type="button" className="btn-ghost text-xs" onClick={() => queue(node.id, 'apply', false)} disabled={busy}>
                      پیش‌نمایش اعمال
                    </button>
                    <button type="button" className="btn-ghost text-xs" onClick={() => queue(node.id, 'apply', true)} disabled={busy}>
                      اعمال واقعی
                    </button>
                  </>
                )}
                <button type="button" className="text-xs text-muted hover:text-cyan" onClick={() => setEditing(node)}>
                  ویرایش
                </button>
                <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => remove(node)}>
                  حذف
                </button>
              </div>
            </div>

            {node.last_error && <Notice type="error">{node.last_error}</Notice>}

            {/* لنگرها. یک هایپروایزر با نودهای چند دیتاسنتری به چند لنگر
                نیاز دارد؛ آدرس یک دیتاسنتر روی لنگر دیتاسنتر دیگر روت
                نمی‌شود. */}
            <div className="border-t border-line pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold">لنگرها</span>
                <button
                  type="button"
                  className="text-xs text-muted hover:text-cyan"
                  onClick={() => setAnchorEdit({ node, anchor: null })}
                >
                  افزودن لنگر
                </button>
              </div>
              {(() => {
                const list = (anchors.data?.anchors ?? []).filter((a) => a.node_id === node.id);
                if (!list.length) {
                  return (
                    <Notice type="warn">
                      لنگری تعریف نشده. تا لنگری نباشد هیچ آدرسی به وی‌پی‌اس نگهدارنده تخصیص
                      نمی‌یابد و همه در حالت «روت نشده» می‌مانند.
                    </Notice>
                  );
                }
                return (
                  <div className="space-y-1.5">
                    {list.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 text-xs flex-wrap">
                        <span className="font-bold">{a.name}</span>
                        {a.is_default && <span className="badge bg-cyan/10 text-cyan">پیش‌فرض</span>}
                        <Mono className="text-muted">vps {a.anchor_vpsid}</Mono>
                        <span className="text-muted">
                          {faNum(a.block_count)} بلوک · {faNum(a.ip_count)} آدرس
                        </span>
                        {!a.bind_server_id && (
                          <span className="badge bg-amber/15 text-amber">سرور لنگر ندارد</span>
                        )}
                        <button
                          type="button"
                          className="text-muted hover:text-cyan ms-auto"
                          onClick={() => setAnchorEdit({ node, anchor: a })}
                        >
                          ویرایش
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            {canWrite(node.kind) && !node.anchor_vpsid && (
              <p className="text-xs text-muted">
                شناسه وی‌پی‌اس لنگر تعیین نشده — فقط کشف انجام می‌شود و هیچ چیزی روی این نود
                نوشته نمی‌شود.
              </p>
            )}
            {node.anchor_vpsid && !node.bind_server_id && (
              <Notice type="warn">
                سرور لنگر در پنل انتخاب نشده. تخصیص در ویژالیزور به‌تنهایی کافی نیست: آدرس باید
                داخل خود وی‌پی‌اس هم روی کارت شبکه بنشیند تا جواب بدهد. بدون این، همه آی‌پی‌ها
                برای همیشه «روت نشده» می‌مانند.
              </Notice>
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
                  <th className="text-start py-1">شرح</th>
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
                    <td className="py-1.5 whitespace-nowrap">
                      {r.ok ? (
                        <span className="text-ok">موفق</span>
                      ) : (
                        <span className="text-danger">ناموفق</span>
                      )}
                    </td>
                    {/* شرح تا حالا فقط در تولتیپ بود. مهم‌ترین اطلاعات هر
                        اجرا — از جمله اینکه دیسک در بدنه هست یا نه — آنجا
                        پنهان می‌ماند و کسی که نمی‌داند باید موس نگه دارد،
                        هرگز نمی‌بیندش. */}
                    <td className={`py-1.5 ${r.ok ? 'text-muted' : 'text-danger'}`}>
                      {r.detail || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {anchorEdit && (
        <AnchorForm
          node={anchorEdit.node}
          anchor={anchorEdit.anchor}
          onClose={() => setAnchorEdit(null)}
          onDone={() => {
            setAnchorEdit(null);
            anchors.reload();
            reload();
          }}
        />
      )}

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
    kind: node?.kind ?? 'virtualizor',
    anchor_vpsid: node?.anchor_vpsid ?? '',
    max_per_run: String(node?.max_per_run ?? 200),
    is_active: node?.is_active ?? true,
    bind_server_id: node?.bind_server_id ? String(node.bind_server_id) : '',
    auto_watch_free: node?.auto_watch_free ?? true,
  });
  const servers = useLoad<{ servers: ServerOption[] }>('/api/servers?anchors=1');
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
      const payload = {
        ...form,
        max_per_run: Number(form.max_per_run) || 200,
        bind_server_id: form.bind_server_id ? Number(form.bind_server_id) : null,
      };
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
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="نوع" hint="بعد از ساخت هم قابل تغییر است">
            <select
              className="input"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            >
              <option value="virtualizor">ویژالیزور</option>
              <option value="solusvm2">سولوس‌وی‌ام ۲</option>
            </select>
          </Field>
          <Field label="نام نود" hint="فقط برای شناسایی در پنل">
            <input className="input" value={form.name} onChange={set('name')} placeholder="نود ۱ — تهران" />
          </Field>
          <Field
            label="آدرس"
            hint={form.kind === 'solusvm2' ? 'آدرس مستر سولوس، بدون مسیر' : 'پنل ادمین، معمولاً پورت ۴۰۸۵'}
          >
            <input
              className="input ltr"
              value={form.url}
              onChange={set('url')}
              placeholder={form.kind === 'solusvm2' ? 'https://master.example.com' : 'https://185.x.x.x:4085'}
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label={form.kind === 'solusvm2' ? 'توکن ای‌پی‌آی' : 'کلید ای‌پی‌آی'}
            hint={
              node
                ? 'خالی یعنی همان مقدار قبلی بماند'
                : form.kind === 'solusvm2'
                  ? 'از Account ← API Tokens'
                  : 'از Configuration ← Server Info، نه API Credentials'
            }
          >
            <input className="input ltr" type="password" value={form.api_key} onChange={set('api_key')} autoComplete="off" />
          </Field>
          {form.kind === 'virtualizor' && (
            <Field label="رمز ای‌پی‌آی" hint={node ? 'خالی یعنی همان رمز قبلی بماند' : ''}>
              <input className="input ltr" type="password" value={form.api_pass} onChange={set('api_pass')} autoComplete="off" />
            </Field>
          )}
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

        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="سرور لنگر در پنل"
            hint="همان وی‌پی‌اس لنگر که در بخش سرورها ثبت شده و ایجنت pasargad-bind رویش نصب است"
          >
            <select
              className="input"
              value={form.bind_server_id}
              onChange={(e) => setForm((f) => ({ ...f, bind_server_id: e.target.value }))}
            >
              <option value="">— انتخاب نشده —</option>
              {(servers.data?.servers ?? []).map((sv) => (
                <option key={sv.id} value={sv.id}>{sv.name}</option>
              ))}
            </select>
          </Field>
          <Field
            label="پایش خودکار آی‌پی آزاد"
            hint="آدرس آزاد تازه‌کشف‌شده خودکار تحت پایش اکسس برود"
          >
            <select
              className="input"
              value={form.auto_watch_free ? 'true' : 'false'}
              onChange={(e) => setForm((f) => ({ ...f, auto_watch_free: e.target.value === 'true' }))}
            >
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
        </div>

        <Notice type="warn">
          کلید و رمز را از <Mono>Configuration ← Server Info</Mono> پنل ادمین بردارید، نه از
          بخش <Mono>API Credentials</Mono>. آن یکی برای این کار نیست و همه درخواست‌ها را با
          ریدایرکت به صفحه ورود برمی‌گرداند. آدرس هم باید پورت ۴۰۸۵ باشد، بدون
          <Mono>/index.php</Mono> در انتها.
        </Notice>

        <Notice type="warn">
          تخصیص در ویژالیزور به‌تنهایی کافی نیست — آدرس باید داخل خود وی‌پی‌اس هم روی کارت شبکه
          بنشیند. برای همین «سرور لنگر در پنل» لازم است: ایجنت pasargad-bind روی همان وی‌پی‌اس
          فهرستش را از آنجا می‌گیرد.
        </Notice>

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

/**
 * فرم لنگر.
 *
 * هر لنگر دو شناسه دارد و هر دو لازم‌اند:
 *   • شناسه وی‌پی‌اس در خود هایپروایزر — برای تخصیص آی‌پی
 *   • رکورد همان وی‌پی‌اس در بخش سرورها — تا ایجنت بایند فهرستش را بگیرد
 *
 * بدون دومی، آدرس تخصیص می‌یابد ولی داخل مهمان روی کارت نمی‌نشیند و
 * هیچ‌وقت جواب نمی‌دهد.
 */
function AnchorForm({
  node,
  anchor,
  onClose,
  onDone,
}: {
  node: NodeRow;
  anchor: AnchorRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: anchor?.name ?? '',
    anchor_vpsid: anchor?.anchor_vpsid ?? '',
    bind_server_id: anchor?.bind_server_id ? String(anchor.bind_server_id) : '',
    max_per_run: String(anchor?.max_per_run ?? 200),
    is_default: anchor?.is_default ?? false,
  });
  const servers = useLoad<{ servers: ServerOption[] }>('/api/servers?anchors=1');
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
      const payload = {
        node_id: node.id,
        name: form.name,
        anchor_vpsid: form.anchor_vpsid,
        bind_server_id: form.bind_server_id ? Number(form.bind_server_id) : null,
        max_per_run: Number(form.max_per_run) || 200,
        is_default: form.is_default,
      };
      if (anchor) await api.patch('/api/vz-anchors', { id: anchor.id, ...payload });
      else await api.post('/api/vz-anchors', payload);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ذخیره لنگر ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!anchor) return;
    if (!confirm(`لنگر «${anchor.name}» حذف شود؟ بلوک‌هایش به لنگر پیش‌فرض برمی‌گردند.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/vz-anchors?id=${anchor.id}`);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'حذف لنگر ناموفق بود');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={anchor ? `ویرایش لنگر ${anchor.name}` : `لنگر تازه برای ${node.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام لنگر" hint="مثلاً نام دیتاسنتری که پوشش می‌دهد">
            <input className="input" value={form.name} onChange={set('name')} placeholder="تهران — رسپینا" />
          </Field>
          <Field label="شناسه وی‌پی‌اس لنگر" hint="عدد در خود هایپروایزر">
            <input className="input ltr" value={form.anchor_vpsid} onChange={set('anchor_vpsid')} placeholder="2023" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="سرور لنگر در پنل" hint="همان وی‌پی‌اس، ثبت‌شده در بخش سرورها">
            <select
              className="input"
              value={form.bind_server_id}
              onChange={(e) => setForm((f) => ({ ...f, bind_server_id: e.target.value }))}
            >
              <option value="">— انتخاب نشده —</option>
              {(servers.data?.servers ?? []).map((sv) => (
                <option key={sv.id} value={sv.id}>{sv.name}</option>
              ))}
            </select>
          </Field>
          <Field label="سقف هر اجرا">
            <input className="input ltr" value={form.max_per_run} onChange={set('max_per_run')} />
          </Field>
          <Field label="لنگر پیش‌فرض" hint="بلوکی که لنگر تعیین‌شده ندارد به اینجا می‌رود">
            <select
              className="input"
              value={form.is_default ? 'true' : 'false'}
              onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.value === 'true' }))}
            >
              <option value="false">نه</option>
              <option value="true">بله</option>
            </select>
          </Field>
        </div>

        <Notice type="warn">
          این وی‌پی‌اس تنها چیزی است که پنل روی آن تغییر می‌دهد. باید خالی و بدون مشتری باشد، و
          روی همان نودی ساخته شود که بلوک‌های این لنگر به آن روت می‌شوند.
        </Notice>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-end">
          {anchor && (
            <button type="button" className="text-xs text-muted hover:text-danger me-auto" onClick={remove}>
              حذف لنگر
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
