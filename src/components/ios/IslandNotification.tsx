'use client';

/**
 * 全局灵动岛通知层（PhoneShell 挂载，覆盖所有 App / 主屏 / 锁屏）。
 *
 * 动画（模拟 iOS 灵动岛通知）：
 * - 展开：从灵动岛胶囊几何（118×33 圆角 17）弹性展开为通知卡（宽高自适应内容，最高不超出屏宽），
 *   内容在卡片基本展开后淡入，形变过程无重排闪烁；
 * - 收起：内容先淡出，卡片缩回胶囊几何，动画完成后由 finishExit 恢复灵动岛 / 展示队列下一条
 *   （收起期间灵动岛保持隐藏，缩回终点与静态灵动岛同位同色，交接无缝）；
 * - 3 秒自动收起（计时在页面不可见/熄屏时冻结）；点击立即收起并跳转对应聊天。
 *
 * 层级 z-[93]：高于锁屏/切换器/闹钟/状态栏，仅低于熄屏黑遮罩（熄屏=屏幕关了，不看）。
 *
 * 来电互斥暂缓（C-3）：电话来电响铃全程（全屏来电界面 z-84 / 退出后的顶部横幅 z-94 都占住
 * 通知锚位或整屏）与微信/QQ 语音来电响铃阶段（来电弹窗 z-94 / 展开的来电页）展示期间，本层整体
 * 隐身（visibility:hidden，不卸载——卸载会让收起动画的 onAnimationComplete 永不回调、
 * exiting 卡死）且自动收起计时冻结：当前通知原位保留、队列不推进，来电层消失后恢复展示。
 * 只读引用 incoming-call / global-call 的 store 做互斥判断，不改层级数值、不改通知队列语义。
 */

import { useEffect } from 'react';
import { motion, type Transition } from 'framer-motion';
import {
  activateCurrentNotification,
  armAutoDismiss,
  clearAutoDismiss,
  finishExit,
  useIslandNotify,
  NOTIFY_APP_ICON,
  type NotifyApp,
} from '@/lib/ios/island-notify';
import { useGlobalCall } from '@/lib/ios/global-call';
import { useIncomingCall } from '@/lib/ios/incoming-call';
import { selectResolvedTheme, useSettings, useSystemDark, useUI } from '@/lib/ios/store';

const APP_NAME: Record<NotifyApp, string> = { wechat: '微信', qq: 'QQ', chat: '信息', meituan: '美团', taobao: '淘宝' };

/** 展开姿态：宽高自适应内容（framer 会测 auto 尺寸做补间） */
const EXPANDED = { width: 'auto', height: 'auto', borderRadius: 24 } as const;
/** 收起姿态：回到灵动岛胶囊几何（与 PhoneShell 静态灵动岛完全一致） */
const PILL = { width: 118, height: 33, borderRadius: 17 } as const;
/** 深色卡片 = 灵动岛同色纯黑；浅色卡片 = iOS 浅色磨砂材质 */
const CARD_BG_DARK = '#000000';
const CARD_BG_LIGHT = 'rgba(246, 246, 248, 0.94)';
const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };
const TWEEN_OUT: Transition = { duration: 0.24, ease: [0.4, 0, 0.2, 1] };
/** 展开时背景色用短补间（弹性只给尺寸）；收起时随 TWEEN_OUT 一同缩回纯黑，与灵动岛同色无缝交接 */
const SPRING_WITH_BG: Transition = { ...SPRING, backgroundColor: { duration: 0.2, ease: 'easeOut' } };

/**
 * 来电展示中（互斥暂缓判断，只读引用两个通话 store）：
 * - 电话来电（source='phone'）：响铃全程视为展示中——全屏来电界面（!screenHidden，z-84）
 *   或退出界面后的顶部横幅（screenHidden，z-94）二者必居其一，都占住通知锚位/整屏；
 * - 微信来电（source='wx'）与 QQ 来电（source 运行时值 'qq'，快照类型联合未列，见 qq.tsx 触发处）：
 *   页内引擎响铃阶段（enginePhase==='incoming'）——顶部大窗/胶囊弹窗（z-94，view!=='full'）
 *   或点弹窗展开的来电页（view==='full'，QQ 响铃直接展开）都算；
 *   接通后（enginePhase 变 active）不再暂缓，通知卡按既有设计正常展示在通话页（z-62）之上；
 * - QQ 通话/微信接通后的通话页不在此列（通知 z-93 高于 z-62 是既定设计，正常展示）；
 * - 锁屏/熄屏本身不触发暂缓（通知 z-93 高于锁屏 z-65 是既定设计，本守卫只看来电层可见性）。
 */
function useIncomingCallPresenting(): boolean {
  const call = useIncomingCall((s) => s.call);
  const enginePhase = useGlobalCall((s) => s.enginePhase);
  if (call?.source === 'phone') return true;
  // 微信/QQ 来电同口径：页内引擎响铃阶段暂缓通知展示（L10 补 'qq'——快照类型联合未列该值，
  // 运行时由 qq.tsx 触发处写入，字符串宽化比对与 IncomingCallLayer 同口径）
  const source = (call?.source ?? '') as string;
  if (source === 'wx' || source === 'qq') return enginePhase === 'incoming';
  return false;
}

function NotifyCard({ held }: { held: boolean }) {
  const current = useIslandNotify((s) => s.current)!;
  const exiting = useIslandNotify((s) => s.exiting);
  // 跟随手机主题（浅色=浅色磨砂卡片深色文字；深色=纯黑卡片白字），auto 跟随系统
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  // 熄屏/来电暂缓期间冻结自动收起，唤醒（熄屏）/来电层消失（暂缓解除）后续期（与页面不可见冻结同策略）
  const screenOff = useUI((s) => s.screenOff);
  useEffect(() => {
    if (screenOff || held || exiting) {
      clearAutoDismiss();
    } else {
      armAutoDismiss();
    }
    return clearAutoDismiss;
  }, [screenOff, held, exiting, current]);

  return (
    <motion.div
      key={current.id}
      data-testid="island-notification"
      role="button"
      aria-label={`${APP_NAME[current.app]}通知：${current.title} ${current.body}`}
      initial={{ ...PILL, backgroundColor: CARD_BG_DARK }}
      animate={{
        ...(exiting ? PILL : EXPANDED),
        backgroundColor: exiting || dark ? CARD_BG_DARK : CARD_BG_LIGHT,
      }}
      transition={exiting ? TWEEN_OUT : SPRING_WITH_BG}
      onAnimationComplete={() => {
        if (exiting) finishExit();
      }}
      onClick={activateCurrentNotification}
      className={`pointer-events-auto relative max-w-[calc(100%-16px)] cursor-pointer overflow-hidden shadow-[0_12px_32px_-10px_rgba(0,0,0,0.45)] outline-none backdrop-blur-xl ${
        dark ? 'text-white' : 'text-black'
      }`}
    >
      {/* 内容：展开基本完成后淡入，收起立即淡出（避免形变过程内容重排可见） */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: exiting ? 0 : 1 }}
        transition={exiting ? { duration: 0.08 } : { duration: 0.16, delay: 0.14 }}
        className="flex w-[336px] max-w-full items-center gap-2.5 px-2 py-2.5"
      >
        {/* 角色头像 + App 图标角标（微信消息带微信角标、QQ 消息带 QQ 角标、信息带信息角标） */}
        <div className="relative h-[38px] w-[38px] shrink-0">
          {current.avatar ? (
            <img
              src={current.avatar}
              alt=""
              className="h-full w-full rounded-full bg-muted object-cover"
              draggable={false}
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center rounded-full text-[16px] font-medium ${
                dark ? 'bg-white/15 text-white' : 'bg-black/10 text-black/60'
              }`}
            >
              {current.title.slice(0, 1)}
            </div>
          )}
          <img
            src={NOTIFY_APP_ICON[current.app]}
            alt=""
            className={`absolute -bottom-[3px] -right-[3px] h-[16px] w-[16px] rounded-[4px] ring-1 ${
              dark ? 'ring-black/30' : 'ring-white/80'
            }`}
            draggable={false}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[13px] font-semibold leading-[17px]">{current.title}</span>
            {current.subtitle ? (
              <span className={`truncate text-[11px] leading-[17px] ${dark ? 'text-white/50' : 'text-black/45'}`}>
                {current.subtitle}
              </span>
            ) : null}
            {current.count > 1 ? (
              <span
                data-testid="island-notification-count"
                className={`ml-auto shrink-0 rounded-full px-1.5 text-[10px] leading-[16px] ${
                  dark ? 'bg-white/15 text-white/80' : 'bg-black/10 text-black/70'
                }`}
              >
                {current.count} 条
              </span>
            ) : null}
          </div>
          <div className={`mt-0.5 line-clamp-2 text-[12px] leading-[16px] ${dark ? 'text-white/85' : 'text-black/75'}`}>
            {current.body}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function IslandNotificationLayer() {
  const current = useIslandNotify((s) => s.current);
  const presenting = useIncomingCallPresenting();

  // 暂缓期间的补冻结：切走标签页再切回时 island-notify 的 visibilitychange 监听会给
  // 幸存通知重新续期（armAutoDismiss），本监听在其之后注册（组件挂载晚于其模块初始化，
  // 同名事件按注册顺序回调）→ 再冻结一次，保证暂缓期间计时永不走动
  useEffect(() => {
    if (!presenting) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') clearAutoDismiss();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [presenting]);

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-[11px] z-[93] flex flex-col items-center ${
        presenting ? 'invisible' : ''
      }`}
      role="status"
      aria-live="polite"
    >
      {current ? <NotifyCard key={current.id} held={presenting} /> : null}
    </div>
  );
}
