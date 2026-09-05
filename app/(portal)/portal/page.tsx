'use client';

import { useLoad, LoadState } from '@/components/useLoad';
import { Notice } from '@/components/ui';
import {
  faNum,
  formatBytes,
  formatBps,
  formatFromGb,
  formatJalaliDay,
  formatPercent,
  timeAgo,
} from '@/lib/format';

interface PortalServer {
  id: number;
  name: string;
  hostname: string | null;
  main_ip: string | null;
  status: string;
  port_mbps: number | null;
  traffic_purchased_gb: number;
  traffic_used_gb: number;
  traffic_balance_gb: number;
  location: string | null;
  last_seen_at: string | null;
  renews_at: string | null;
  cpu_percent: number | null;
  mem_used_bytes: number | null;
  mem_total_bytes: number | null;
  disk_used_bytes: number | null;
  disk_total_bytes: number | null;
  rx_bps: number | null;
  tx_bps: number | null;
  uptime_sec: number | null;
  period_rx: number;
  period_tx: number;
  ip_count: number;
}

interface PortalData {
  customer: { name: string; company: string | null };
  period: { label: string; from: string; to: string };
  servers: PortalServer[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  up: { label: 'در دسترس', cls: 'bg-ok/15 text-ok' },
  down: { label: 'قطع', cls: 'bg-danger/15 text-danger' },
  maintenance: { label: 'تعمیرات', cls: 'bg-amber/15 text-amber' },
  unknown: { label: 'نامشخص', cls: 'bg-line text-muted' },
};

/** مدت روشن بودن، به شکل خوانا */
function uptime(sec: number | null) {
  if (!sec || sec < 60) return '—';
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  if (days) return `${faNum(days)} روز و ${faNum(hours)} ساعت`;
  return `${faNum(hours)} ساعت`;
}

export default function PortalPage() {
  const { data, loading, error, reload } = useLoad<PortalData>('/api/portal', 30_000);

  if (loading || error || !data) {
    return <LoadState loading={loading} error={error} onRetry={reload}>{null}</LoadState>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">{data.customer.name}</h1>
        <p className="text-xs text-muted mt-0.5">
          {data.customer.company && `${data.customer.company} · `}
          مصرف دوره {data.period.label}
        </p>
      </div>

      {!data.servers.length ? (
        <Notice type="warn">
          هنوز سروری به حساب شما تخصیص نیافته است. اگر فکر می‌کنید اشتباهی رخ داده، با پشتیبانی
          تماس بگیرید.
        </Notice>
      ) : (
        <div className="space-y-4">
          {data.servers.map((s) => {
            const st = STATUS[s.status] || STATUS.unknown;
            // ترافیک پیش‌خرید: انقضا ندارد و از تاریخ شروع شمارش کم
            // می‌شود. دیتاسنتر ترافیک دانلود را حساب می‌کند، پس همان
            // مبنای نمایش است.
            const purchased = s.traffic_purchased_gb;
            const pct = purchased > 0
              ? Math.min(100, (s.traffic_used_gb / purchased) * 100)
              : null;
            const remaining = Math.max(0, s.traffic_balance_gb);

            return (
              <section key={s.id} className="card p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-sm font-bold">
                      {s.name}
                      <span className={`badge ms-2 ${st.cls}`}>{st.label}</span>
                    </h2>
                    <p className="text-xs text-muted mt-0.5 ltr">
                      {s.main_ip}
                      {s.hostname && ` · ${s.hostname}`}
                    </p>
                  </div>
                  <div className="text-xs text-muted text-end">
                    {s.status === 'up' ? (
                      <>روشن از {uptime(s.uptime_sec)}</>
                    ) : (
                      s.last_seen_at && <>آخرین ارتباط {timeAgo(s.last_seen_at)}</>
                    )}
                    {s.renews_at && (
                      <div className="mt-0.5">تمدید: {formatJalaliDay(s.renews_at)}</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <Stat label="پردازنده" value={s.cpu_percent === null ? '—' : formatPercent(s.cpu_percent)} />
                  <Stat
                    label="حافظه"
                    value={
                      s.mem_total_bytes
                        ? `${formatBytes(s.mem_used_bytes ?? 0)} از ${formatBytes(s.mem_total_bytes)}`
                        : '—'
                    }
                  />
                  <Stat
                    label="دیسک"
                    value={
                      s.disk_total_bytes
                        ? `${formatBytes(s.disk_used_bytes ?? 0)} از ${formatBytes(s.disk_total_bytes)}`
                        : '—'
                    }
                  />
                  <Stat label="آی‌پی" value={faNum(s.ip_count)} />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <Stat label="دانلود لحظه‌ای" value={formatBps(s.rx_bps ?? 0)} />
                  <Stat label="آپلود لحظه‌ای" value={formatBps(s.tx_bps ?? 0)} />
                  <Stat label="دانلود این دوره" value={formatBytes(s.period_rx)} />
                  <Stat label="آپلود این دوره" value={formatBytes(s.period_tx)} />
                </div>

                {pct !== null && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted">ترافیک باقی‌مانده</span>
                      <span className={pct >= 90 ? 'text-danger' : pct >= 75 ? 'text-amber' : 'text-muted'}>
                        {formatFromGb(remaining)} از {formatFromGb(purchased)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-line overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-amber' : 'bg-cyan'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {/* مبنا دانلود است چون دیتاسنتر همان را حساب می‌کند.
                        بدون این توضیح، عدد با انتظار کاربر نمی‌خواند و
                        به‌نظر اشتباه می‌آید. */}
                    <p className="text-[11px] text-muted mt-1">
                      محاسبه بر اساس ترافیک دانلود است. ترافیک خریداری‌شده انقضا ندارد و تا
                      مصرف کامل باقی می‌ماند.
                    </p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
