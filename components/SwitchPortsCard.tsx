'use client';

import Link from 'next/link';
import { useLoad } from './useLoad';
import { Mono } from './ui';
import { faNum, formatBps, formatBytes } from '@/lib/format';

interface LinkedPort {
  id: number;
  name: string;
  description: string | null;
  admin_up: boolean | null;
  oper_up: boolean | null;
  oper_reason: string | null;
  speed_mbps: number | null;
  in_bps: number;
  out_bps: number;
  count_traffic: boolean;
  is_present: boolean;
  switch_id: number;
  switch_name: string;
  switch_status: string;
  today_in: number;
  today_out: number;
}

/**
 * پورت‌های سوییچ متصل به یک سرور، در صفحه همان سرور.
 *
 * جهت‌ها اینجا از دید سرور نوشته می‌شوند: خروجی سوییچ دانلود سرور است و
 * ورودی سوییچ آپلودش. در صفحه سوییچ همان پورت از دید سوییچ دیده می‌شود.
 *
 * اگر پورتی وصل نباشد چیزی نمایش داده نمی‌شود.
 */
export function SwitchPortsCard({ serverId }: { serverId: number }) {
  const { data } = useLoad<{ ports: LinkedPort[] }>(`/api/switch-ports?server_id=${serverId}`, 15_000);
  const ports = data?.ports ?? [];
  if (!ports.length) return null;

  const counted = ports.some((p) => p.count_traffic);

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-sm font-bold">پورت سوییچ</h2>
        {counted && (
          <span className="badge border bg-cyan/10 text-cyan border-cyan/30">
            ترافیک این سرور از سوییچ شمرده می‌شود
          </span>
        )}
      </div>
      <div className="space-y-2">
        {ports.map((p) => {
          const state = !p.is_present
            ? { t: 'حذف‌شده', c: 'text-muted' }
            : p.admin_up === false
              ? { t: 'خاموش (shut)', c: 'text-amber' }
              : p.oper_up
                ? { t: 'وصل', c: 'text-ok' }
                : { t: p.oper_reason || 'قطع', c: 'text-danger' };
          return (
            <div key={p.id} className="flex items-center gap-3 flex-wrap bg-panel2 rounded-lg px-3 py-2 text-xs">
              <Link href={`/switches/${p.switch_id}`} className="hover:text-cyan">
                {p.switch_name} / <Mono>{p.name}</Mono>
              </Link>
              {p.switch_status === 'down' && <span className="text-danger">سوییچ در دسترس نیست</span>}
              <span className={state.c}>{state.t}</span>
              {p.speed_mbps ? (
                <span className="text-muted ltr">
                  {p.speed_mbps >= 1000 ? `${faNum(p.speed_mbps / 1000)}G` : `${faNum(p.speed_mbps)}M`}
                </span>
              ) : null}
              <span className="ms-auto whitespace-nowrap">
                <span className="text-cyan text-[10px] me-1">دانلود</span>
                {formatBps(p.out_bps)}
                <span className="text-amber text-[10px] ms-3 me-1">آپلود</span>
                {formatBps(p.in_bps)}
              </span>
              <span className="text-muted w-full sm:w-auto">
                امروز: دانلود {formatBytes(p.today_out)} · آپلود {formatBytes(p.today_in)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
