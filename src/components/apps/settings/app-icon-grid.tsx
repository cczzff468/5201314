'use client';

/**
 * App 图标五选一网格（第三十八轮新增；第四十轮四变体 → 第四十一轮：3 号情书字标换
 *  机主原图 + 新增 5 号元气气泡，五变体且第 3 号为默认）。
 *
 * 共享组件：设置›显示与亮度（外观）内联网格 + 设置主页「App 图标」弹窗复用同一份。
 * 选点行为按运行端自动分流：
 * - APK 原生壳（AIPhoneNative.switchAppIcon 存在 = v2.4.21+ 壳）：
 *   先本地+服务器持久化偏好（开屏/设置预览/favicon/manifest 即时跟随），
 *   再全屏提示层「正在为您更换图标，App 即将退回桌面…」→ 550ms 后调原生桥
 *   switchAppIcon（先启目标 alias 再关其余 setComponentEnabledSetting +
 *   HOME Intent + System.exit(0) 强退——旧图标消失、新图标上桌面，免重装）。
 *   【第四十一轮卡死根治】旧壳（v2.4.23 及更早）不认识新选的别名时会静默无动作
 *   → 提示层永远不撤（机主实凂「点击情书字标/小词灵一直卡在正在为您更换图标」）。
 *   现三层防护：① v2.4.24+ 原生 switchAppIcon 返回状态串（'ok' 受理/'bad_alias'
 *   不支持）——非 'ok' 立即撤提示层恢复；② 返回 'ok' 但 4s 内 App 未退（原生异步
 *   异常等）看门狗兑底恢复；③ 恢复时把网页选中态对齐回原生当前启用图标（与
 *   挂载对齐同口径，防「网页选 A 桌面是 B」漂移）并给出可操作提示。
 * - 浏览器/PWA：仅更新偏好——manifest 是动态接口（no-store），Chrome/Edge
 *   安装的 PWA 下次打开时自动检查并换掉桌面图标（无需重新下载安装）。
 *
 * APK 端选中态对齐：覆盖安装新 APK 后各别名启用态重置回 Manifest 默认（v2.4.24 起
 * 3 号），与网页偏好可能漂移——网格挂载时先读原生 getCurrentIcon 对齐一次（以原生为准）。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download } from 'lucide-react';
import { useSettings, type AppIconId } from '@/lib/ios/store';
import { getNativeIconBridge, getNativeCurrentIcon } from '@/lib/ios/native-shell';
import { readShellInfo } from '@/lib/ios/shell-info';
import { useAppUpdate } from '@/lib/ios/app-update';

/** 五变体清单（名称与描述：设置网格 + 弹窗 + 设置主页入口副标题共用；
 *  第四十一轮：3 号换机主原图设为默认 + 新增 5 号元气气泡） */
export const APP_ICON_VARIANTS: { id: AppIconId; name: string; desc: string }[] = [
  { id: '1', name: '云朵 C', desc: '原版 · 月牙环抱云朵笑脸' },
  { id: '2', name: '弧 C 微笑', desc: '极简弧线 · 圆点小脸' },
  { id: '3', name: '情书字标', desc: '机主设计稿 · Cove 字标（默认）' },
  { id: '4', name: '小词灵', desc: 'cove 化身小生物 · 冒泡说话' },
  { id: '5', name: '元气气泡', desc: '机主提供 · 萌系对话气泡' },
];

/** 破缓存版本号（第四十一轮 3/5 号换机主原图后旧图可能还在浏览器缓存里） */
export const APP_ICON_V = 'v=41';

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
  /** 切换中标记的 ref 镜像（看门狗/失败恢复判据：恢复时校验仍是同一次切换，防旧定时器串扰） */
  const switchingRef = useRef<AppIconId | null>(null);
  const [tip, setTip] = useState(false);
  /** 切换失败提示（第四十一轮：旧壳不支持/原生异常/未退看门狗） */
  const [failTip, setFailTip] = useState<'bad_alias' | 'error' | 'watchdog' | 'legacy' | null>(null);
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
      switchingRef.current = id;
      // 【第四十二轮·机主实况】旧壳（v2.4.23-）switchAppIcon 返 void 且不认识新图标号时
      // 静默无动作——第四十一轮的立即恢复会误报「失败」（即使切换其实会成功）。本轮分层：
      // ① v2.4.24+ 壳：状态串回传（'ok' 受理/'bad_alias' 不支持）——非 'ok' 立即恢复；
      // ② 旧壳（无状态回传）：无法即时判定成败——用 2.8s 看门狗：支持的图标切换会在
      //    ~1.5s 内退回桌面（无假警报）；不支持的图标静默无动作 → 2.8s 后恢复 + 引导更新；
      // ③ 恢复时对齐回原生当前图标 + 出可操作提示（含「立即更新」按钮直拉更新弹窗）。
      const recover = (reason: 'bad_alias' | 'error' | 'watchdog' | 'legacy') => {
        if (switchingRef.current !== id) return; // 已恢复/已切换别的
        switchingRef.current = null;
        setSwitching(null);
        // 网页选中态对齐回原生当前启用图标（挂载对齐同口径，防「网页选 A 桌面是 B」）
        const nativeNow = getNativeCurrentIcon();
        if (nativeNow && nativeNow !== id) setAppIcon(nativeNow);
        setFailTip(reason);
        window.setTimeout(() => setFailTip(null), 7000);
      };
      // 壳代际：v2.4.24+ 有状态串；更早的壳只能靠看门狗判「没退出去」
      const shellVer = readShellInfo()?.versionCode ?? 0;
      const legacyShell = shellVer < 88;
      window.setTimeout(() => {
        let status: string | undefined;
        try {
          status = nat.switchAppIcon(id) as string | undefined;
        } catch {
          status = undefined;
        }
        if (legacyShell) {
          // 旧壳无状态回传：等待看门狗（成功切换会在 ~1.5s 退桌面；没退 = 壳不认识此图标）
          window.setTimeout(() => recover('legacy'), 2800);
          return;
        }
        if (status !== 'ok') {
          // v2.4.24+ 壳明确拒绝（bad_alias）或原生同步异常——立即恢复
          recover(status === 'bad_alias' ? 'bad_alias' : 'error');
          return;
        }
        // 受理 'ok'：App 应在 ~1.2s 内退回桌面；4s 看门狗兜底（原生异步异常等）
        window.setTimeout(() => recover('watchdog'), 4000);
      }, 550);
      return;
    }
    // ③ 浏览器/PWA：即时反馈轻提示
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
                <span className={`block text-[12.5px] ${sel ? 'font-semibold text-[#007AFF]' : 'text-zinc-800'}`}>
                  {o.name}
                </span>
                <span className="mt-0.5 block text-[9.5px] text-zinc-500">{o.desc}</span>
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
      {/* APK 原生切换失败提示（第四十二轮：旧壳不支持该图标/未退出——恢复 + 一键拉起更新弹窗） */}
      {failTip && (
        <div
          data-testid="app-icon-fail-tip"
          className="flex flex-col items-center gap-1.5 px-6 pb-2 pt-1 text-center"
          style={{ animation: 'cove-icon-fade 260ms ease both' }}
        >
          <p className="text-[10.5px] leading-relaxed text-[#FF453A]">
            {failTip === 'bad_alias' || failTip === 'legacy'
              ? '当前 App 版本暂不支持更换这款桌面图标（应用内图标已切换）——安装最新版 App 后即可同步桌面图标'
              : failTip === 'watchdog'
                ? '桌面图标更换未完成，已为您恢复——可稍后重试或更新 App'
                : '桌面图标更换失败，已为您恢复——可稍后重试'}
          </p>
          {(failTip === 'bad_alias' || failTip === 'legacy' || failTip === 'watchdog') && (
            <button
              type="button"
              data-testid="app-icon-fail-update-btn"
              onClick={() => {
                setFailTip(null);
                // 直拉全局更新弹窗（AppUpdateDialog：检查→发现新版→立即更新→APP 内下载安装）
                void useAppUpdate.getState().check(true);
              }}
              className="flex items-center gap-1 rounded-full bg-[#34C759]/12 px-3.5 py-1.5 text-[11.5px] font-medium text-[#248A3D] transition active:scale-95"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              立即更新 App（覆盖安装 · 数据不丢）
            </button>
          )}
        </div>
      )}
      {/* APK 原生切换全屏提示层（HOME + System.exit 前的可见画面） */}
      {switching && <SwitchingOverlay next={switching} />}
    </>
  );
}
