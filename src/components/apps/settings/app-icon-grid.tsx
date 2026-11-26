'use client';

/**
 * App 图标四选一网格（第三十八轮：一键无感换图标 Activity Alias）。
 *
 * 共享组件：设置›显示与亮度（外观）内联网格 + 设置主页「App 图标」弹窗复用同一份。
 * 选点行为按运行端自动分流：
 * - APK 原生壳（AIPhoneNative.switchAppIcon 存在 = v2.4.21+ 壳）：
 *   先本地+服务器持久化偏好（开屏/设置预览/favicon/manifest 即时跟随），
 *   再全屏提示层「正在为您更换图标，App 即将退回桌面…」→ 550ms 后调原生桥
 *   switchAppIcon（先启目标 alias 再关其余 setComponentEnabledSetting +
 *   HOME Intent + System.exit(0) 强退——旧图标消失、新图标上桌面，免重装）；
 * - 浏览器/PWA：仅更新偏好——manifest 是动态接口（no-store），Chrome/Edge
 *   安装的 PWA 下次打开时自动检查并换掉桌面图标（无需重新下载安装）。
 *
 * APK 端选中态对齐：覆盖安装新 APK 后各别名启用态重置回默认 1 号，与网页偏好
 * 可能漂移——网格挂载时先读原生 getCurrentIcon 对齐一次（以原生为准）。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { useSettings, type AppIconId } from '@/lib/ios/store';
import { getNativeIconBridge, getNativeCurrentIcon } from '@/lib/ios/native-shell';

/** 四变体清单（名称与描述：设置网格 + 弹窗 + 设置主页入口副标题共用） */
export const APP_ICON_VARIANTS: { id: AppIconId; name: string; desc: string }[] = [
  { id: '1', name: '云朵 C', desc: '原版 · 月牙环抱云朵笑脸' },
  { id: '2', name: '弧 C 微笑', desc: '极简弧线 · 圆点小脸' },
  { id: '3', name: '暗黑版', desc: '星夜金月 · 星尘光带' },
  { id: '4', name: '二次元版', desc: '樱花萌云 · 闪闪大眼' },
];

/** 破缓存版本号（本轮 PNG 全套换新后旧图可能还在浏览器缓存里） */
export const APP_ICON_V = 'v=36';

/** APK 原生切换提示层：新图标大图 + iOS 菊花转 + 机主规格文案
 *  （原生侧 HOME + System.exit 前唯一可见画面，~1.2s） */
function SwitchingOverlay({ next }: { next: AppIconId }) {
  const variant = APP_ICON_VARIANTS.find((v) => v.id === next);
  return createPortal(
    <div
      role="alertdialog"
      aria-label="正在更换 App 图标"
      data-testid="app-icon-switching-overlay"
      className="fixed inset-0 z-[400] flex flex-col items-center justify-center gap-[22px] bg-black/62 backdrop-blur-[6px]"
      style={{ animation: 'cove-icon-fade 220ms ease both' }}
    >
      <img
        src={`/icons/app/icon-${next}-192.png?${APP_ICON_V}`}
        alt={variant?.name ?? '新图标'}
        className="h-[86px] w-[86px] rounded-[21px] shadow-[0_10px_34px_rgba(0,0,0,0.45)] ring-[0.5px] ring-white/25"
        style={{ animation: 'cove-icon-pop 420ms cubic-bezier(0.32,0.72,0,1.26) both' }}
      />
      {/* iOS 菊花转（与 AppSplash 同款 12 棒） */}
      <span className="relative block h-[26px] w-[26px]" aria-hidden="true">
        <span className="block h-full w-full" style={{ animation: 'app-splash-spin 0.85s linear infinite' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className="absolute left-1/2 top-0 h-[8px] w-[2.4px] origin-[50%_13px] rounded-full bg-white"
              style={{ transform: `translateX(-50%) rotate(${i * 30}deg)`, opacity: Math.max(0.12, 1 - i / 11) }}
            />
          ))}
        </span>
      </span>
      <div className="flex flex-col items-center gap-[5px]">
        <p className="text-[16px] font-semibold text-white">正在为您更换图标</p>
        <p className="text-[13px] text-white/70">App 即将退回桌面…</p>
      </div>
    </div>,
    document.body
  );
}

export function AppIconGrid({
  current,
  /** 浏览器/PWA 端选点后回调（弹窗用：关弹窗） */
  onAfterPick,
  /** 弹窗模式：格子更紧凑（64px 大图）/ 页面模式：行式格子（52px 图） */
  size = 'page',
}: {
  current: AppIconId;
  onAfterPick?: () => void;
  size?: 'page' | 'dialog';
}) {
  const setAppIcon = useSettings((s) => s.setAppIcon);
  const [switching, setSwitching] = useState<AppIconId | null>(null);
  const [tip, setTip] = useState(false);
  // APK 端挂载对齐只做一次（用 ref 防电流速器重渲染期间反复触发）
  const aligned = useRef(false);

  // APK 原生壳：以原生当前启用图标为准对齐网页偏好（覆盖安装重置回 1 号后防漂移）
  useEffect(() => {
    if (aligned.current) return;
    aligned.current = true;
    const nat = getNativeIconBridge();
    if (!nat) return;
    const nativeIcon = getNativeCurrentIcon();
    if (nativeIcon && nativeIcon !== current) setAppIcon(nativeIcon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (id: AppIconId) => {
    if (switching || id === current) return;
    // ① 先持久化偏好（本地 IndexedDB + favicon 即时换 + 服务器 manifest 动态图标）
    setAppIcon(id);
    // ② APK 原生壳：提示层 → 550ms 后原生切换（HOME + 强退在原生侧 650ms 内完成）
    const nat = getNativeIconBridge();
    if (nat) {
      setSwitching(id);
      window.setTimeout(() => {
        try {
          nat.switchAppIcon(id);
        } catch {
          /* 原生异常：提示层不撤——App 即将退出/或退不出则停留，均无害 */
        }
      }, 550);
      return;
    }
    // ③ 浏览器/PWA：即时反馈轻提示（弹窗脚注已有完整说明）
    setTip(true);
    window.setTimeout(() => setTip(false), 2400);
    onAfterPick?.();
  };

  const iconPx = size === 'dialog' ? 64 : 54;

  return (
    <>
      <div
        role="radiogroup"
        aria-label="App 图标"
        data-testid="app-icon-grid"
        className={`grid ${size === 'dialog' ? 'grid-cols-2 gap-2 px-4 py-4' : 'grid-cols-2 gap-2.5 px-3.5 py-3.5'}`}
      >
        {APP_ICON_VARIANTS.map((o) => {
          const sel = current === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={sel}
              aria-label={`${o.name}（${o.desc}）`}
              data-testid={`app-icon-option-${o.id}`}
              disabled={switching !== null}
              onClick={() => pick(o.id)}
              className={`relative flex flex-col items-center gap-2 rounded-[16px] px-1 transition-all active:scale-[0.97] disabled:opacity-60 ${
                size === 'dialog' ? 'py-3' : 'py-2.5'
              } ${
                sel
                  ? 'bg-[#007AFF]/[0.08] ring-[1.5px] ring-[#007AFF]/60'
                  : 'ring-[1.5px] ring-transparent'
              }`}
            >
              <span className="relative">
                <img
                  src={`/icons/app/icon-${o.id}-192.png?${APP_ICON_V}`}
                  alt={o.name}
                  className={`rounded-[13px] object-cover shadow-[0_5px_14px_rgba(0,0,0,0.13)] ${
                    sel ? '' : 'opacity-95'
                  }`}
                  style={{ height: iconPx, width: iconPx }}
                />
                {sel && (
                  <span className="absolute -right-[6px] -top-[6px] grid h-[18px] w-[18px] place-items-center rounded-full bg-[#007AFF] shadow-[0_2px_6px_rgba(0,122,255,0.5)] ring-2 ring-white">
                    <Check className="h-[12px] w-[12px] text-white" strokeWidth={3.2} />
                  </span>
                )}
              </span>
              <span className="text-center leading-tight">
                <span className={`block text-[12.5px] ${sel ? 'font-semibold text-[#007AFF]' : 'text-black/85 dark:text-white/85'}`}>
                  {o.name}
                </span>
                <span className="mt-0.5 block text-[9.5px] text-muted-foreground">{o.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      {/* 浏览器/PWA 端即时反馈（APK 端走全屏提示层，无需此条） */}
      {tip && (
        <p
          data-testid="app-icon-tip"
          className="px-6 pb-1.5 text-center text-[10.5px] leading-relaxed text-[#34C759]"
          style={{ animation: 'cove-icon-fade 260ms ease both' }}
        >
          已更换 ✓ 桌面图标自动跟随（Chrome/Edge 装的 PWA 下次打开时生效，无需重新下载）
        </p>
      )}
      {/* APK 原生切换全屏提示层（HOME + System.exit 前的可见画面） */}
      {switching && <SwitchingOverlay next={switching} />}
    </>
  );
}
