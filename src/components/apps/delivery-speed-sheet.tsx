'use client';

/**
 * 送达速度毛玻璃弹窗（第四十二轮：美团 / 淘宝各自独立设置）：
 * - iOS 毛玻璃风（backdrop-blur-2xl + 半透明白 + 高光描边），底部上滑弹层；
 * - 美团（分钟级）：快 5-15 分钟 / 正常 15-30 分钟 / 慢 30-60 分钟；
 * - 淘宝（小时级）：快 30 分钟-1 小时 / 正常 1-2 小时 / 慢 3-4 小时；
 * - 自定义：展开「最快 X 分钟 / 最慢 Y 分钟」输入（1-480，min ≤ max），应用后即时生效；
 * - 设置按 App 分键存储（delivery-speed.ts），只影响当前 App 的订单 ETA / 状态机 / 时间轴；
 * - accent 随宿主 App：淘宝橙 #FF5000 / 美团黄 #FFC300。
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { DS_CUSTOM_MAX, DS_CUSTOM_MIN, DS_LABEL, DS_RANGES, dsDescShort, dsGet, dsSet, type DsPreset, type DsScope } from '@/lib/ios/delivery-speed';

const PRESETS: Exclude<DsPreset, 'custom'>[] = ['fast', 'normal', 'slow'];

const SCOPE_HINT: Record<DsScope, string> = {
  meituan: '美团订单按此速度送达（真实时钟），改后新订单立即生效',
  taobao: '淘宝订单按此速度发货送达（真实时钟），改后新订单立即生效',
};

/** 三档固定速度选项行（选中态：accent 描边 + 实心勾选圈） */
function SpeedPresetRow({
  scope,
  preset,
  active,
  accent,
  onPick,
}: {
  scope: DsScope;
  preset: Exclude<DsPreset, 'custom'>;
  active: boolean;
  accent: string;
  onPick: () => void;
}) {
  const r = DS_RANGES[scope][preset];
  return (
    <button
      type="button"
      data-testid={`speed-opt-${preset}`}
      aria-pressed={active}
      onClick={onPick}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all active:scale-[0.985] ${
        active ? 'border-transparent bg-white/85' : 'border-white/50 bg-white/35'
      }`}
      style={active ? { boxShadow: `inset 0 0 0 2px ${accent}, 0 4px 18px rgba(0,0,0,0.08)` } : undefined}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-bold"
        style={{ backgroundColor: `${accent}26`, color: accent === '#FFC300' ? '#8a6100' : accent }}
      >
        {DS_LABEL[preset]}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[14.5px] font-semibold ${active ? 'text-black/90' : 'text-black/70'}`}>{DS_LABEL[preset]}速送达</span>
        <span className="mt-0.5 block text-[11.5px] text-black/40">{dsDescShort(scope, { preset, min: r.min, max: r.max })}</span>
      </span>
      {active ? (
        <span className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full" style={{ backgroundColor: accent }}>
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </span>
      ) : (
        <span className="h-[20px] w-[20px] shrink-0 rounded-full border-2 border-black/15" />
      )}
    </button>
  );
}

export function DeliverySpeedSheet({
  scope,
  accent = '#FF5000',
  onClose,
  onToast,
}: {
  /** 宿主 App：美团（分钟级三档）/ 淘宝（小时级三档），各自独立存储 */
  scope: DsScope;
  /** 强调色（淘宝橙 / 美团黄） */
  accent?: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [setting, setSetting] = useState(() => dsGet(scope));
  // 自定义输入（展开时显示；切换到自定义档即展开）
  const [customOpen, setCustomOpen] = useState(() => dsGet(scope).preset === 'custom');
  const [cMin, setCMin] = useState(() => String(dsGet(scope).preset === 'custom' ? dsGet(scope).min : 10));
  const [cMax, setCMax] = useState(() => String(dsGet(scope).preset === 'custom' ? dsGet(scope).max : 25));
  const [cErr, setCErr] = useState('');

  // 其他入口改速度后本弹窗跟随（全局事件）
  useEffect(() => {
    const on = () => setSetting(dsGet(scope));
    window.addEventListener('delivery-speed-changed', on);
    return () => window.removeEventListener('delivery-speed-changed', on);
  }, [scope]);

  const applyPreset = (p: DsPreset): void => {
    if (p === 'custom') {
      // 首次点自定义：先记住意图并展开输入区（不落库，等应用自定义速度时再写入）
      if (setting.preset !== 'custom') {
        setSetting({ preset: 'custom', min: setting.min, max: setting.max });
      }
      setCustomOpen(true);
      return;
    }
    const r = DS_RANGES[scope][p];
    dsSet(scope, { preset: p, min: r.min, max: r.max });
    setSetting({ preset: p, min: r.min, max: r.max });
    setCErr('');
    setCustomOpen(false);
    onToast(`已切换为「${DS_LABEL[p]}」速：${dsDescShort(scope, { preset: p, min: r.min, max: r.max })}送达`);
  };

  const applyCustom = (): void => {
    const min = Math.round(Number(cMin));
    const max = Math.round(Number(cMax));
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < DS_CUSTOM_MIN || max < DS_CUSTOM_MIN || min > DS_CUSTOM_MAX || max > DS_CUSTOM_MAX) {
      setCErr(`请输入 ${DS_CUSTOM_MIN}-${DS_CUSTOM_MAX} 之间的分钟数`);
      return;
    }
    if (min > max) {
      setCErr('最快分钟数不能大于最慢分钟数');
      return;
    }
    setCErr('');
    dsSet(scope, { preset: 'custom', min, max });
    setSetting({ preset: 'custom', min, max });
    onToast(`已自定义送达速度：${dsDescShort(scope, { preset: 'custom', min, max })}送达`);
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        data-testid="delivery-speed-sheet"
        role="dialog"
        aria-label="送达速度"
        onClick={(e) => e.stopPropagation()}
        className="overflow-hidden rounded-t-[24px] border-t border-white/70 bg-white/70 shadow-[0_-10px_44px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 [animation:quick-in-up_.26s_cubic-bezier(0.32,0.72,0,1)_both]"
      >
        {/* 把手条 */}
        <div className="flex justify-center pt-2.5">
          <span className="h-[4px] w-9 rounded-full bg-black/15" />
        </div>
        <div className="relative flex items-center justify-center pb-1 pt-2">
          <span className="text-[17px] font-bold text-black/90">送达速度</span>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-4 top-2 grid h-7 w-7 place-items-center active:opacity-60">
            <span className="relative block h-[20px] w-[20px]">
              <span className="absolute left-1/2 top-1/2 h-[20px] w-[2px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-black/55" />
              <span className="absolute left-1/2 top-1/2 h-[20px] w-[2px] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-black/55" />
            </span>
          </button>
        </div>
        <p className="px-5 pb-2 text-[11.5px] leading-relaxed text-black/40">{SCOPE_HINT[scope]}</p>

        {/* 三档固定速度 */}
        <div className="space-y-2 px-4 pt-1">
          {PRESETS.map((p) => (
            <SpeedPresetRow
              key={p}
              scope={scope}
              preset={p}
              active={setting.preset === p}
              accent={accent}
              onPick={() => applyPreset(p)}
            />
          ))}

          {/* 自定义 */}
          <button
            type="button"
            data-testid="speed-opt-custom"
            aria-pressed={setting.preset === 'custom'}
            onClick={() => applyPreset('custom')}
            className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all active:scale-[0.985] ${
              setting.preset === 'custom' ? 'border-transparent bg-white/85' : 'border-white/50 bg-white/35'
            }`}
            style={setting.preset === 'custom' ? { boxShadow: `inset 0 0 0 2px ${accent}, 0 4px 18px rgba(0,0,0,0.08)` } : undefined}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-bold" style={{ backgroundColor: `${accent}26`, color: accent === '#FFC300' ? '#8a6100' : accent }}>
              ✎
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[14.5px] font-semibold ${setting.preset === 'custom' ? 'text-black/90' : 'text-black/70'}`}>自定义</span>
              <span className="mt-0.5 block text-[11.5px] text-black/40">
                {setting.preset === 'custom' ? `${dsDescShort(scope, setting)}（最快/最慢可再调）` : '自己定最快/最慢分钟数'}
              </span>
            </span>
            {setting.preset === 'custom' ? (
              <span className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full" style={{ backgroundColor: accent }}>
                <Check className="h-3 w-3 text-white" strokeWidth={3} />
              </span>
            ) : (
              <span className="h-[20px] w-[20px] shrink-0 rounded-full border-2 border-black/15" />
            )}
          </button>

          {/* 自定义输入区（选中自定义时展开） */}
          {setting.preset === 'custom' && customOpen ? (
            <div className="rounded-2xl border border-white/50 bg-white/45 px-4 py-3" data-testid="speed-custom-editor">
              <div className="flex items-center gap-2">
                <input
                  data-testid="speed-custom-min"
                  type="number"
                  inputMode="numeric"
                  min={DS_CUSTOM_MIN}
                  max={DS_CUSTOM_MAX}
                  value={cMin}
                  onChange={(e) => setCMin(e.target.value)}
                  aria-label="最快送达分钟数"
                  className="h-9 w-full min-w-0 flex-1 rounded-xl border border-black/10 bg-white/80 px-3 text-center text-[14px] font-semibold text-black/85 outline-none focus:border-black/25"
                />
                <span className="shrink-0 text-[12px] text-black/45">最快(分钟)</span>
                <input
                  data-testid="speed-custom-max"
                  type="number"
                  inputMode="numeric"
                  min={DS_CUSTOM_MIN}
                  max={DS_CUSTOM_MAX}
                  value={cMax}
                  onChange={(e) => setCMax(e.target.value)}
                  aria-label="最慢送达分钟数"
                  className="h-9 w-full min-w-0 flex-1 rounded-xl border border-black/10 bg-white/80 px-3 text-center text-[14px] font-semibold text-black/85 outline-none focus:border-black/25"
                />
                <span className="shrink-0 text-[12px] text-black/45">最慢(分钟)</span>
              </div>
              {cErr ? <p className="mt-2 text-[11.5px] text-red-500">{cErr}</p> : null}
              <button
                type="button"
                data-testid="speed-custom-apply"
                onClick={applyCustom}
                className="mt-2.5 w-full rounded-full py-2 text-[13.5px] font-semibold text-white active:opacity-85"
                style={{ backgroundColor: accent }}
              >
                应用自定义速度
              </button>
            </div>
          ) : null}
        </div>

        {/* 当前生效提示 + 完成 */}
        <p className="px-5 pt-3 text-center text-[11.5px] text-black/45">
          当前：<span className="font-semibold text-black/70" data-testid="speed-current-desc">{dsDescShort(scope, setting)}</span>送达
        </p>
        <div className="flex justify-center px-4 pb-6 pt-2">
          <button
            type="button"
            data-testid="speed-done"
            onClick={onClose}
            className="w-full rounded-full py-2.5 text-[14px] font-semibold text-white active:opacity-85"
            style={{ backgroundColor: accent }}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
