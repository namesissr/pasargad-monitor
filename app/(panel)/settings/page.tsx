'use client';

import { useEffect, useState } from 'react';
import { useLoad, LoadState } from '@/components/useLoad';
import { Field, Mono, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { faNum, formatJalaliTime, timeAgo, INCIDENT_KIND_LABEL } from '@/lib/format';

interface SettingsData {
  settings: Record<string, string>;
  users: {
    id: number;
    username: string;
    full_name: string | null;
    phone: string | null;
    role: string;
    is_active: boolean;
    last_login_at: string | null;
  }[];
  smsConfigured: boolean;
  telegramConfigured: boolean;
  recentSms: { id: number; recipient: string; body: string; ok: boolean; error: string | null; created_at: string }[];
}

interface ProbeRow {
  id: number;
  name: string;
  location: string;
  token: string;
  last_seen_at: string | null;
  is_active: boolean;
}

interface RuleRow {
  id: number;
  server_id: number | null;
  server_name: string | null;
  kind: string;
  threshold: number;
  duration_sec: number;
  send_sms: boolean;
  enabled: boolean;
}

const KIND_UNIT: Record<string, string> = {
  cpu: 'درصد',
  ram: 'درصد',
  disk: 'درصد',
  traffic: 'درصد سهمیه',
  load: 'بار به‌ازای هسته',
  down: '—',
};

export default function SettingsPage() {
  const { data, loading, error, reload } = useLoad<SettingsData>('/api/settings');
  const rules = useLoad<{ rules: RuleRow[] }>('/api/alerts');
  const probes = useLoad<{ probes: ProbeRow[] }>('/api/probes');

  const [probeName, setProbeName] = useState('');
  const [probeLocation, setProbeLocation] = useState('outside');
  const [probeBusy, setProbeBusy] = useState(false);

  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [testChat, setTestChat] = useState('');
  const [tgTesting, setTgTesting] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data]);

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      await api.patch('/api/settings', form);
      setMsg({ type: 'success', text: 'تنظیمات ذخیره شد. تغییرات بلافاصله اعمال می‌شود و نیازی به بیلد نیست.' });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ذخیره انجام نشد' });
    } finally {
      setSaving(false);
    }
  }

  async function sendTelegramTest() {
    setMsg(null);
    setTgTesting(true);
    try {
      await api.post('/api/settings', { chatId: testChat });
      setMsg({ type: 'success', text: 'پیام آزمایشی تلگرام فرستاده شد.' });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ارسال تلگرام ناموفق بود' });
    } finally {
      setTgTesting(false);
    }
  }

  async function sendTest() {
    setMsg(null);
    setTesting(true);
    try {
      await api.post('/api/settings', { phone: testPhone });
      setMsg({ type: 'success', text: 'پیامک آزمایشی فرستاده شد.' });
      reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ارسال پیامک ناموفق بود' });
    } finally {
      setTesting(false);
    }
  }

  async function toggleRule(rule: RuleRow, patch: Partial<RuleRow>) {
    try {
      await api.patch('/api/alerts', { id: rule.id, ...patch });
      rules.reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'تغییر قانون انجام نشد' });
    }
  }

  async function addProbe() {
    if (!probeName.trim()) return;
    setMsg(null);
    setProbeBusy(true);
    try {
      await api.post('/api/probes', { name: probeName.trim(), location: probeLocation });
      setProbeName('');
      probes.reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'ساخت دیدبان انجام نشد' });
    } finally {
      setProbeBusy(false);
    }
  }

  async function removeProbe(probe: ProbeRow) {
    if (!confirm(`دیدبان «${probe.name}» حذف شود؟ نتیجه‌های قبلی‌اش هم پاک می‌شوند.`)) return;
    try {
      await api.del(`/api/probes?id=${probe.id}`);
      probes.reload();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof ApiError ? e.message : 'حذف انجام نشد' });
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-lg font-bold">تنظیمات</h1>
        <p className="text-xs text-muted mt-0.5">
          این مقادیر در جدول settings ذخیره می‌شوند و در زمان اجرا خوانده می‌شوند. مقادیر فایل .env اینجا نمی‌آیند.
        </p>
      </div>

      {msg && <Notice type={msg.type}>{msg.text}</Notice>}

      {/* هشدار و پیامک */}
      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-bold">هشدار پیامکی</h2>

        {!data.smsConfigured && (
          <Notice type="error">
            کلید کاوه‌نگار در فایل .env تنظیم نشده است (KAVENEGAR_API_KEY). تا وقتی تنظیم نشود هیچ پیامکی ارسال نمی‌شود.
          </Notice>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="ارسال پیامک">
            <select className="input" value={form.sms_enabled ?? 'true'} onChange={set('sms_enabled')}>
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
          <Field label="فاصله تکرار پیامک (دقیقه)" hint="تا وقتی مشکل باز است، هر چند دقیقه یادآوری شود">
            <input className="input ltr" value={form.alert_repeat_min ?? ''} onChange={set('alert_repeat_min')} />
          </Field>
        </div>

        <Field
          label="شماره‌های گیرنده"
          hint="با کاما جدا کنید. شماره کاربران پنل هم خودکار اضافه می‌شود."
        >
          <input className="input ltr" value={form.sms_recipients ?? ''} onChange={set('sms_recipients')} placeholder="09121234567,09351234567" />
        </Field>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="ارسال پیامک آزمایشی">
              <input className="input ltr" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="09121234567" />
            </Field>
          </div>
          <button type="button" className="btn-ghost" onClick={sendTest} disabled={testing || !testPhone}>
            {testing ? 'در حال ارسال…' : 'ارسال'}
          </button>
        </div>
      </section>

      {/* هشدار تلگرام */}
      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-bold">هشدار تلگرام</h2>

        {!data.telegramConfigured && (
          <Notice type="error">
            توکن ربات در فایل .env تنظیم نشده است (TELEGRAM_BOT_TOKEN). تا وقتی تنظیم نشود هیچ پیامی ارسال نمی‌شود.
          </Notice>
        )}

        <Notice type="warn">
          اگر سرور پنل داخل ایران است، <Mono>api.telegram.org</Mono> مستقیم در دسترس نیست. متغیر{' '}
          <Mono>TELEGRAM_API_BASE</Mono> را روی یک واسط یا پروکسی بگذارید، وگرنه هر ارسال با خطای
          اتصال شکست می‌خورد.
        </Notice>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="ارسال تلگرام">
            <select className="input" value={form.telegram_enabled ?? 'false'} onChange={set('telegram_enabled')}>
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
        </div>

        <Field
          label="شناسه گفتگوها"
          hint="با کاما جدا کنید. برای گروه، عدد منفی است. شناسه را از ربات @userinfobot بگیرید."
        >
          <input
            className="input ltr"
            value={form.telegram_chat_ids ?? ''}
            onChange={set('telegram_chat_ids')}
            placeholder="123456789,-1001234567890"
          />
        </Field>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="ارسال پیام آزمایشی">
              <input
                className="input ltr"
                value={testChat}
                onChange={(e) => setTestChat(e.target.value)}
                placeholder="123456789"
              />
            </Field>
          </div>
          <button type="button" className="btn-ghost" onClick={sendTelegramTest} disabled={tgTesting || !testChat}>
            {tgTesting ? 'در حال ارسال…' : 'ارسال'}
          </button>
        </div>
      </section>

      {/* ویژالیزور */}
      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-bold">ویژالیزور</h2>
        <p className="text-xs text-muted">
          نودها و کلیدهایشان در صفحه <Mono>ویژالیزور</Mono> تعریف می‌شوند. اینجا فقط تناوب کشف
          خودکار تعیین می‌شود.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="فاصله کشف خودکار (ساعت)"
            hint="هر چند ساعت فهرست آی‌پی‌ها، بلوک‌ها و مشتری هر آدرس از همه نودها به‌روز شود"
          >
            <input className="input ltr" value={form.vz_discover_hours ?? ''} onChange={set('vz_discover_hours')} placeholder="1" />
          </Field>
        </div>
      </section>

      {/* پایش */}
      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-bold">پایش</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="مهلت اعلام قطعی (ثانیه)" hint="بعد از چند ثانیه بی‌خبری از ایجنت، سرور قطع اعلام شود">
            <input className="input ltr" value={form.down_after_sec ?? ''} onChange={set('down_after_sec')} />
          </Field>
          <Field label="فاصله بررسی (ثانیه)" hint="هر چند ثانیه ورکر سرورها و آی‌پی‌ها را بررسی کند">
            <input className="input ltr" value={form.check_interval_sec ?? ''} onChange={set('check_interval_sec')} />
          </Field>
          <Field label="نگهداری نمونه خام (روز)" hint="تجمیع روزانه همیشه می‌ماند؛ فقط نمونه‌های ثانیه‌ای پاک می‌شوند">
            <input className="input ltr" value={form.raw_retention_days ?? ''} onChange={set('raw_retention_days')} />
          </Field>
          <Field label="مبنای دوره ماهانه" hint="گروه‌بندی گزارش ماهانه و محاسبه سهمیه">
            <select className="input" value={form.traffic_calendar ?? 'jalali'} onChange={set('traffic_calendar')}>
              <option value="jalali">تقویم شمسی</option>
              <option value="gregorian">تقویم میلادی</option>
            </select>
          </Field>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
          </button>
        </div>
      </section>

      {/* دیدبان‌های اکسس ایران */}
      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold">دیدبان‌های اکسس ایران</h2>
          <p className="text-[11px] text-muted mt-0.5">
            آی‌پی اکسس‌شده از داخل ایران پینگ می‌دهد ولی از خارج نه. <strong>هر دو دیدبان لازم‌اند:</strong>
            خارج برای تشخیص آزادشدن، و داخل برای اثبات زنده‌بودن آی‌پی. بدون دیدبان داخل،
            «در اکسس» از «روت نشده» قابل تشخیص نیست و هیچ‌وقت خبر آزادشدن نمی‌گیرید.
          </p>
        </div>

        {(probes.data?.probes ?? []).length > 0 && (
          <ul className="divide-y divide-line/60 border border-line rounded-lg">
            {(probes.data?.probes ?? []).map((probe) => {
              const stale =
                !probe.last_seen_at ||
                Date.now() - new Date(probe.last_seen_at).getTime() > 3600_000;
              return (
                <li key={probe.id} className="px-3 py-2.5 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-danger' : 'bg-ok animate-pulse'}`} />
                    <span className="font-bold">{probe.name}</span>
                    <span className="badge bg-line text-muted">
                      {probe.location === 'inside' ? 'داخل ایران' : 'خارج ایران'}
                    </span>
                    <span className="text-muted">
                      {probe.last_seen_at ? `آخرین گزارش ${timeAgo(probe.last_seen_at)}` : 'هنوز گزارشی نداده'}
                    </span>
                    <button
                      type="button"
                      className="ms-auto text-muted hover:text-danger"
                      onClick={() => removeProbe(probe)}
                    >
                      حذف
                    </button>
                  </div>
                  <div className="bg-rack border border-line rounded-md p-2 ltr font-mono text-[10px] break-all text-muted">
                    curl -fsSL {typeof window !== 'undefined' ? window.location.origin : ''}/agent/watch-install.sh | bash -s -- {typeof window !== 'undefined' ? window.location.origin : ''} {probe.token} probe
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <Field label="نام دیدبان تازه">
              <input
                className="input"
                value={probeName}
                onChange={(e) => setProbeName(e.target.value)}
                placeholder="مثلا: تهران — مخابرات"
              />
            </Field>
          </div>
          <div className="min-w-[140px]">
            <Field label="موقعیت">
              <select className="input" value={probeLocation} onChange={(e) => setProbeLocation(e.target.value)}>
                <option value="outside">خارج ایران</option>
                <option value="inside">داخل ایران</option>
              </select>
            </Field>
          </div>
          <button type="button" className="btn-primary" onClick={addProbe} disabled={probeBusy || !probeName.trim()}>
            {probeBusy ? 'در حال ساخت…' : 'ساخت دیدبان'}
          </button>
        </div>

        <p className="text-[11px] text-muted/70">
          بعد از ساخت، دستور نصب هر دیدبان همین‌جا نمایش داده می‌شود — روی همان سرور اجرایش کنید.
          اگر دیدبانی بیش از یک ساعت گزارش ندهد، رویداد و پیامک هشدار می‌آید.
        </p>
      </section>

      {/* قوانین هشدار */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">آستانه‌های هشدار</h2>
          <p className="text-[11px] text-muted mt-0.5">قانون بدون سرور یعنی روی همه سرورها اعمال می‌شود.</p>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>نوع</th>
                <th>دامنه</th>
                <th>آستانه</th>
                <th>مدت پیوسته</th>
                <th>پیامک</th>
                <th>فعال</th>
              </tr>
            </thead>
            <tbody>
              {(rules.data?.rules ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="text-xs">{INCIDENT_KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="text-xs">{r.server_name || 'همه سرورها'}</td>
                  <td className="text-xs">
                    {r.kind === 'down' ? (
                      '—'
                    ) : (
                      <input
                        className="input w-24 ltr py-1"
                        defaultValue={String(r.threshold)}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v !== r.threshold) toggleRule(r, { threshold: v });
                        }}
                      />
                    )}
                    <span className="text-muted ms-1">{KIND_UNIT[r.kind]}</span>
                  </td>
                  <td className="text-xs">
                    <input
                      className="input w-24 ltr py-1"
                      defaultValue={String(r.duration_sec)}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== r.duration_sec) toggleRule(r, { duration_sec: v });
                      }}
                    />
                    <span className="text-muted ms-1">ثانیه</span>
                  </td>
                  <td>
                    <input type="checkbox" checked={r.send_sms} onChange={(e) => toggleRule(r, { send_sms: e.target.checked })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={r.enabled} onChange={(e) => toggleRule(r, { enabled: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* کاربران */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">کاربران پنل</h2>
          <p className="text-[11px] text-muted mt-0.5">
            شماره هر کاربر فعال، خودکار گیرنده هشدار می‌شود. افزودن کاربر با اسکریپت
            <Mono className="mx-1">node worker/create-user.mjs</Mono>
            روی سرور انجام می‌شود.
          </p>
        </div>
        <div className="table-wrap">
          <table className="tbl min-w-[560px]">
            <thead>
              <tr>
                <th>نام کاربری</th>
                <th>نام</th>
                <th>شماره</th>
                <th>نقش</th>
                <th>آخرین ورود</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="text-xs"><Mono>{u.username}</Mono></td>
                  <td className="text-xs">{u.full_name || '—'}</td>
                  <td className="text-xs"><Mono>{u.phone || '—'}</Mono></td>
                  <td className="text-xs">{u.role}</td>
                  <td className="text-xs text-muted">{u.last_login_at ? timeAgo(u.last_login_at) : 'هرگز'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* پیامک‌های اخیر */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-line">
          <h2 className="text-sm font-bold">پیامک‌های اخیر</h2>
        </div>
        {data.recentSms.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted">پیامکی ارسال نشده است.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {data.recentSms.map((n) => (
              <li key={n.id} className="px-5 py-2.5 text-xs flex items-start gap-3">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.ok ? 'bg-ok' : 'bg-danger'}`} />
                <div className="min-w-0 flex-1">
                  <Mono className="text-muted">{n.recipient}</Mono>
                  <p className="truncate">{n.body}</p>
                  {n.error && <p className="text-danger text-[11px]">{n.error}</p>}
                </div>
                <span className="text-muted shrink-0" title={formatJalaliTime(n.created_at)}>{timeAgo(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-muted/70">
        نسخه پنل {faNum('1.0')} · تعداد کاربران {faNum(data.users.length)}
      </p>
    </div>
  );
}
