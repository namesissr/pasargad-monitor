'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Modal, Notice, StatCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { DIRECTION_LABEL, type BillingDirection } from '@/lib/billing';
import { faNum, formatBytes, formatToman } from '@/lib/format';

interface Stats {
  servers: number;
  up: number;
  down: number;
  ips: number;
  billable_bytes: number;
  traffic_cost: number;
  ip_cost: number;
  rent: number;
  total: number;
}

interface Datacenter {
  id: number;
  name: string;
  country: string | null;
  city: string | null;
  website: string | null;
  contact: string | null;
  price_per_tb: number;
  price_per_ip: number;
  included_tb: number;
  included_ips: number;
  billing_direction: BillingDirection;
  tb_base: number;
  notes: string | null;
  is_active: boolean;
  stats: Stats;
}

interface Data {
  datacenters: Datacenter[];
  unassigned: Stats;
  period: { label: string; from: string; to: string };
}

const BLANK = {
  name: '',
  country: '',
  city: '',
  website: '',
  contact: '',
  price_per_tb: '0',
  price_per_ip: '0',
  included_tb: '0',
  included_ips: '1',
  billing_direction: 'total',
  tb_base: '1000',
  notes: '',
};

export default function DatacentersPage() {
  const { data, loading, error, reload } = useLoad<Data>('/api/datacenters');
  const [editing, setEditing] = useState<Datacenter | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">دیتاسنترها</h1>
          <p className="text-xs text-muted mt-0.5">
            قیمت هر ترابایت و هر آی‌پی اینجا یک بار وارد می‌شود و همه سرورهای آن دیتاسنتر از آن ارث می‌برند.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          + افزودن دیتاسنتر
        </button>
      </div>

      <LoadState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!!data && data.datacenters.length === 0}
        emptyText="هنوز دیتاسنتری ثبت نکرده‌اید. اول دیتاسنتر را بسازید، بعد سرورهایش را اضافه کنید."
      >
        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard title="دیتاسنترها" value={faNum(data.datacenters.length)} />
              <StatCard
                title="سرورها"
                value={faNum(data.datacenters.reduce((a, d) => a + d.stats.servers, 0) + data.unassigned.servers)}
              />
              <StatCard
                title={`هزینه ${data.period.label}`}
                value={formatToman(
                  data.datacenters.reduce((a, d) => a + d.stats.total, 0) + data.unassigned.total,
                )}
                sub="اجاره + ترافیک + آی‌پی"
                tone="cyan"
              />
              <StatCard
                title="آی‌پی‌های تخصیص‌یافته"
                value={faNum(data.datacenters.reduce((a, d) => a + d.stats.ips, 0) + data.unassigned.ips)}
              />
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              {data.datacenters.map((d) => (
                <article key={d.id} className={`card p-4 ${d.is_active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <h2 className="font-bold text-sm flex items-center gap-2">
                        {d.name}
                        {!d.is_active && <span className="badge bg-line text-muted">غیرفعال</span>}
                      </h2>
                      <p className="text-[11px] text-muted mt-0.5">
                        {[d.city, d.country].filter(Boolean).join('، ') || 'موقعیت ثبت نشده'}
                        {d.contact && <> · {d.contact}</>}
                      </p>
                    </div>
                    <button type="button" className="text-xs text-muted hover:text-cyan shrink-0" onClick={() => setEditing(d)}>
                      ویرایش
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
                    <Cell label="هر ترابایت" value={formatToman(d.price_per_tb)} />
                    <Cell label="هر آی‌پی در ماه" value={formatToman(d.price_per_ip)} />
                    <Cell
                      label="ترافیک رایگان هر سرور"
                      value={d.included_tb > 0 ? `${faNum(d.included_tb)} ترابایت` : 'ندارد'}
                    />
                    <Cell label="آی‌پی رایگان هر سرور" value={faNum(d.included_ips)} />
                    <Cell label="مبنای صورتحساب" value={DIRECTION_LABEL[d.billing_direction]} />
                    <Cell label="مبنای ترابایت" value={faNum(d.tb_base)} />
                  </div>

                  <div className="border-t border-line/60 pt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] text-muted">سرور</p>
                      <p className="text-sm font-bold">
                        {faNum(d.stats.servers)}
                        {d.stats.down > 0 && <span className="text-danger text-xs"> ({faNum(d.stats.down)} قطع)</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted">ترافیک دوره</p>
                      <p className="text-sm font-bold">{formatBytes(d.stats.billable_bytes, 1)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted">هزینه دوره</p>
                      <p className="text-sm font-bold text-cyan">{formatToman(d.stats.total)}</p>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-3 text-[11px]">
                    <Link href={`/servers?datacenter_id=${d.id}`} className="text-muted hover:text-cyan">
                      سرورها ←
                    </Link>
                    <Link href={`/billing?datacenter_id=${d.id}`} className="text-muted hover:text-cyan">
                      حسابداری ←
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            {data.unassigned.servers > 0 && (
              <Notice type="info">
                {faNum(data.unassigned.servers)} سرور به هیچ دیتاسنتری وصل نیست، پس هزینه ترافیک و آی‌پی برایشان
                محاسبه نمی‌شود. از صفحه هر سرور، بخش ویرایش، دیتاسنترش را مشخص کنید.{' '}
                <Link href="/servers" className="underline">فهرست سرورها</Link>
              </Notice>
            )}
          </>
        )}
      </LoadState>

      <DatacenterModal
        open={adding}
        initial={null}
        onClose={() => setAdding(false)}
        onDone={reload}
      />
      <DatacenterModal
        open={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onDone={reload}
      />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel2 rounded-md px-2.5 py-1.5">
      <p className="text-muted">{label}</p>
      <p className="text-white mt-0.5">{value}</p>
    </div>
  );
}

function DatacenterModal({
  open,
  initial,
  onClose,
  onDone,
}: {
  open: boolean;
  initial: Datacenter | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // فرم با باز شدن مودال از روی رکورد انتخاب‌شده پر می‌شود؛
  // در حالت افزودن، خالی برمی‌گردد
  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (!initial) {
      setForm(BLANK);
      return;
    }
    setForm({
      name: initial.name,
      country: initial.country ?? '',
      city: initial.city ?? '',
      website: initial.website ?? '',
      contact: initial.contact ?? '',
      price_per_tb: String(initial.price_per_tb ?? 0),
      price_per_ip: String(initial.price_per_ip ?? 0),
      included_tb: String(initial.included_tb ?? 0),
      included_ips: String(initial.included_ips ?? 1),
      billing_direction: initial.billing_direction,
      tb_base: String(initial.tb_base ?? 1000),
      notes: initial.notes ?? '',
    });
  }, [open, initial]);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const payload = {
      ...form,
      price_per_tb: Number(form.price_per_tb) || 0,
      price_per_ip: Number(form.price_per_ip) || 0,
      included_tb: Number(form.included_tb) || 0,
      included_ips: Number(form.included_ips) || 0,
      tb_base: Number(form.tb_base),
    };
    try {
      if (initial) await api.patch(`/api/datacenters/${initial.id}`, payload);
      else await api.post('/api/datacenters', payload);
      onDone();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'ذخیره انجام نشد');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial) return;
    if (!confirm(`دیتاسنتر «${initial.name}» حذف شود؟ سرورهایش پاک نمی‌شوند ولی بدون دیتاسنتر می‌مانند و قیمت‌گذاری‌شان را از دست می‌دهند.`)) return;
    try {
      const r = await api.del<{ detachedServers: number }>(`/api/datacenters/${initial.id}`);
      if (r.detachedServers > 0) {
        alert(`${r.detachedServers} سرور بدون دیتاسنتر ماند. دیتاسنتر تازه‌شان را مشخص کنید.`);
      }
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'حذف انجام نشد');
    }
  }

  return (
    <Modal open={open} title={initial ? `ویرایش ${initial.name}` : 'افزودن دیتاسنتر'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="نام دیتاسنتر *">
            <input className="input" value={form.name} onChange={set('name')} placeholder="مثلا: آسیاتک تهران" />
          </Field>
          <Field label="شهر">
            <input className="input" value={form.city} onChange={set('city')} />
          </Field>
          <Field label="کشور">
            <input className="input" value={form.country} onChange={set('country')} />
          </Field>
          <Field label="شماره قرارداد یا شناسه پنل">
            <input className="input" value={form.contact} onChange={set('contact')} />
          </Field>
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-bold mb-3">قیمت‌گذاری</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="هزینه هر ترابایت ترافیک (تومان) *">
              <input className="input ltr" value={form.price_per_tb} onChange={set('price_per_tb')} />
            </Field>
            <Field label="هزینه ماهانه هر آی‌پی (تومان) *">
              <input className="input ltr" value={form.price_per_ip} onChange={set('price_per_ip')} />
            </Field>
            <Field label="ترافیک رایگان هر سرور (ترابایت)" hint="صفر یعنی از اولین بایت پول می‌گیرند">
              <input className="input ltr" value={form.included_tb} onChange={set('included_tb')} />
            </Field>
            <Field label="آی‌پی رایگان هر سرور" hint="معمولاً یک آی‌پی همراه خود سرور است">
              <input className="input ltr" value={form.included_ips} onChange={set('included_ips')} />
            </Field>

            <Field
              label="کدام ترافیک محاسبه می‌شود *"
              hint="اختلاف «مجموع» با «فقط ارسالی» می‌تواند دو برابر باشد — از قرارداد دیتاسنتر مطمئن شوید"
            >
              <select className="input" value={form.billing_direction} onChange={set('billing_direction')}>
                {(Object.keys(DIRECTION_LABEL) as BillingDirection[]).map((k) => (
                  <option key={k} value={k}>{DIRECTION_LABEL[k]}</option>
                ))}
              </select>
            </Field>

            <Field
              label="مبنای ترابایت"
              hint="بیشتر دیتاسنترها ۱۰۰۰ حساب می‌کنند. انتخاب اشتباه حدود ده درصد اختلاف با فاکتور می‌سازد."
            >
              <select className="input" value={form.tb_base} onChange={set('tb_base')}>
                <option value="1000">۱۰۰۰ — اعشاری، رایج در دیتاسنترها</option>
                <option value="1024">۱۰۲۴ — دودویی</option>
              </select>
            </Field>
          </div>
        </div>

        <Field label="یادداشت">
          <textarea className="input h-16 resize-none" value={form.notes} onChange={set('notes')} />
        </Field>

        {err && <Notice type="error">{err}</Notice>}

        <div className="flex gap-2 justify-between">
          {initial ? (
            <button type="button" className="btn-danger" onClick={remove}>حذف دیتاسنتر</button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>انصراف</button>
            <button type="submit" className="btn-primary" disabled={busy || !form.name.trim()}>
              {busy ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
