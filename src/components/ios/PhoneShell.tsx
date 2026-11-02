'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence } from 'framer-motion';
import { selectResolvedTheme, useSettings, useSystemDark, useUI, useWallpaperStyle } from '@/lib/ios/store';
import { useIslandNotify } from '@/lib/ios/island-notify';
import { useIncomingCall } from '@/lib/ios/incoming-call';
import { GLOBAL_CSS_SCOPE, scopeCss } from '@/lib/ios/custom-css';
import { isVoiceHoldActive } from '@/lib/ios/voice-hold-flag';
import { useLightForeground } from '@/lib/ios/foreground';
import { ensureAccountOwnerContacts, migrateFromServer } from '@/lib/ios/contacts-store';
import { startOwnerProfileSync } from '@/lib/ios/owner-profile-sync';
import { ensureAppFontApplied } from '@/lib/ios/fonts';
import { ensureKvReady } from '@/lib/ios/idb-kv';
import { migrateLegacyAccounts } from '@/lib/ios/accounts';
import { shellScale } from '@/lib/ios/shell-scale';
import StatusBar from './StatusBar';
import HomeScreen from './HomeScreen';
import { preloadHeavyApps } from '@/components/apps/registry';
import { CustomWallpaperLayers } from './WallpaperLayers';
import AppWindow from './AppWindow';
import AppSwitcher from './AppSwitcher';
import LockScreen from './LockScreen';
import IslandNotificationLayer from './IslandNotification';

// 通知权限友好申请卡（首次使用时应用内说明卡，代替裸浏览器授权框）：常驻挂载，不弹时不渲染内容
const NotifyPermissionCard = dynamic(() => import('./NotifyPermissionCard'), { ssr: false });

// 闹钟监听懒加载：避免为一个小组件把整个时钟 App 拖进首屏包
const AlarmWatcher = dynamic(() => import('@/components/apps/clock').then((m) => m.AlarmWatcher), { ssr: false });

// 提醒事项/日历到期全局监听：轮询 IndexedDB，到期弹横幅+系统通知+提示音（App 不打开也生效）
const ReminderWatcher = dynamic(() => import('./ReminderWatcher'), { ssr: false });

// 朋友圈/QQ动态全局调度（AI 互动结算 + 自动发布）：同样懒加载，挂载即后台运行
const MomentsScheduler = dynamic(() => import('./MomentsScheduler'), { ssr: false });

// v33【AI 真人社交】X论坛全局调度（角色主动发帖/互动/神回复的延迟任务结算）：同样懒加载，挂载即后台运行
const ForumScheduler = dynamic(() => import('./ForumScheduler'), { ssr: false });

// 退群挽留全局调度（退群后 1 分钟内 AI 主动私信 + 私聊里拉回群）：同样懒加载，挂载即后台运行
const QuitFlowScheduler = dynamic(() => import('./QuitFlowScheduler'), { ssr: false });

// AI 主动来电全局调度（根据人设/聊天/时间自主决策并真正拨打电话）：同样懒加载，挂载即后台运行
const ProactiveCallWatcher = dynamic(() => import('./ProactiveCallWatcher'), { ssr: false });

// AI 主动发消息全局调度（定时/事件/自主/自然语言提醒四类触发，App 不打开也生效）：同样懒加载，挂载即后台运行
const ProactiveMsgWatcher = dynamic(() => import('./ProactiveMsgWatcher'), { ssr: false });
const MeituanOrderWatcher = dynamic(() => import('./MeituanOrderWatcher'), { ssr: false });

// 恋人空间 AI 常驻调度（第十四轮：自主决策链开机即起，刷新自动续链，不用先打开恋人空间）
const CoupleResidentWatcher = dynamic(() => import('./CoupleResidentWatcher'), { ssr: false });

// Task 68 音乐 App × AI 深度互动：AI 邀请一起听全局卡（任何 App/主屏幕都能弹出）+ 全局调度器
const TogetherInviteLayer = dynamic(() => import('./TogetherInviteLayer'), { ssr: false });
const TogetherInviteWatcher = dynamic(() => import('./TogetherInviteWatcher'), { ssr: false });

// 全局迷你播放器（第十六轮反馈）：音乐在播时主屏幕/其他 App 的悬浮播放控件
// （底部迷你条 / 悬浮旋转唱片 / 隐藏 三形态，形态持久化）
const MusicGlobalMini = dynamic(() => import('./MusicGlobalMini'), { ssr: false });

// 音乐灵动岛（第十六轮反馈）：音乐在播时占据灵动岛锚位的常驻音乐弹窗，所有界面都显示
// （小弹窗常驻 / 大弹窗 5 秒 / 点小弹窗展开 / 点大弹窗跳听歌 / 点别处收回；消息通知展示期间隐身）
const MusicIsland = dynamic(() => import('./MusicIsland'), { ssr: false });

// 美团外卖灵动岛（用户本轮需求）：有进行中外卖单时常驻小窗（骑手形象+送货中+剩余分钟送达），
// 状态变化自动展开大窗 5 秒（商家图+预计送达+三节点进度），点小窗展开 / 点大窗进订单详情
const MeituanIsland = dynamic(() => import('./MeituanIsland'), { ssr: false });
const TaobaoIsland = dynamic(() => import('./TaobaoIsland'), { ssr: false });

// 全局语音通话层（全屏通话页 + 悬浮小窗）：懒加载，仅在通话会话存在时渲染内容
const GlobalCallLayer = dynamic(() => import('./GlobalCallLayer'), { ssr: false });

// 全局来电层（AI 来电弹窗胶囊/微信大窗 + iOS 全屏来电界面）：懒加载，仅在有来电时渲染内容
const IncomingCallLayer = dynamic(() => import('./IncomingCallLayer'), { ssr: false });

/** 底部边缘识别带高度：比 28px 可视横杠更高，按下点在屏幕最底部一段内即开始识别（真机好滑起见给了 72px） */
const EDGE_ZONE = 72;
/** 上滑超过该距离即打开多任务切换器（真机好滑：短距离即触发） */
const OPEN_DELTA = 18;
/** 桌面端机身逻辑尺寸（border-box，含 12px 边框；内部布局全部按此尺寸计算） */
const FRAME_W = 390;
const FRAME_H = 844;
/** 桌面端机身四周留白（sm:p-8 = 32px） */
const SHELL_PAD = 32;
/** 缩放下限：窗口再矮也不缩得没法看（拖拽/文字仍可用） */
const MIN_SCALE = 0.4;

/**
 * 手机壳：桌面端显示 iPhone 机身外框（含电源键），移动端全屏。
 * 内部依次为 壁纸层 → 主屏幕 → App 窗口 → 多任务切换器 → 锁屏 → 熄屏遮罩 → 状态栏 → 灵动岛。
 */
export default function PhoneShell() {
  const theme = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const load = useSettings((s) => s.load);
  const switcherOpen = useUI((s) => s.switcherOpen);
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const pressPower = useUI((s) => s.pressPower);
  const loaded = useSettings((s) => s.loaded);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const wallpaperStyle = useWallpaperStyle();
  // 全局字体大小倍率（Task 36 修订）：不再在 PhoneShell 缩放容器（旧 transform scale 会连界面一起缩小/放大），
  // 改由 globals.css 的 text-[Npx]/leading-[Npx] calc 规则只缩放文字；倍率存在 :root --app-font-scale，此处无需感知
  // 横杠颜色与状态栏同一套判定（但按壁纸底部区域实测，上亮下暗壁纸横杠可独立选色）：身后背景深→白杠、浅→黑杠
  const barLight = useLightForeground('bottom');
  // 状态栏显示开关（Task 36）：设置页可关闭顶部时间/信号/电量状态栏
  const statusBarVisible = useSettings((s) => s.statusBarVisible);
  // 灵动岛常驻开关（用户需求）：关闭后隐藏顶部黑色胶囊基础灵动岛，
  // 只显示 APP 灵动岛（音乐岛大/小窗、美团/淘宝配送岛、灵动岛通知卡、来电胶囊等均不受影响）
  const islandPersistent = useSettings((s) => s.islandPersistent);
  // 灵动岛通知展示中（含收起动画）：灵动岛隐藏，通知卡在同一几何位无缝形变，收起后灵动岛恢复
  const islandCovered = useIslandNotify((s) => s.current !== null);
  // 自定义 CSS（第六十五轮）：全局作用域 —— 作用于整个手机的所有界面（含线下模式）；
  // 选择器经 scopeCss 自动限定在 [data-phone-shell] 内，不会泄漏到手机外
  const globalCustomCss = useSettings((s) => s.customCss.global);
  const shellRef = useRef<HTMLDivElement | null>(null);
  /** 底部边缘上滑手势进行中状态（fired 防止同一次滑动重复触发） */
  const edgeGesture = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  /** 桌面端机身等比缩放（按当前视口把 390×844 机身缩到正好放得下；移动端恒 1/非 desktop）。
   *  矮窗口（预览面板/小笔记本）里固定 844px 高的机身底部会被裁掉——最下面一两行网格和
   *  Dock 看不见也摸不着，App 就「不能往下放了」；缩放后整个机身始终完整可见可达。
   *  壳 transform 后成为 fixed 后代的包含块，HomeScreen 渲染拖拽副本/飞入动画时用
   *  shellScale.value 把视口坐标换算回壳本地坐标（见 shell-scale.ts）。
   *  landscape（横屏全屏）：视口宽>高时机身旋转 90° 铺满视口（占位盒宽高互换），
   *  scale 按旋转后尺寸（844×390）适配；竖屏行为与原来完全一致。 */
  const [fit, setFit] = useState<{ desktop: boolean; scale: number; landscape: boolean }>({
    desktop: false,
    scale: 1,
    landscape: false,
  });
  useEffect(() => {
    const compute = () => {
      const landscape = window.innerWidth > window.innerHeight;
      const isDesktop = window.matchMedia('(min-width: 640px)').matches;
      if (landscape) {
        // 横屏全屏：机身横放（旋转 90° 后占位 844 宽 × 390 高），按可用空间等比缩放铺满
        const pad = isDesktop ? SHELL_PAD : 0;
        const availW = window.innerWidth - pad * 2;
        const availH = window.innerHeight - pad * 2;
        const s = Math.max(MIN_SCALE, Math.min(1, availW / FRAME_H, availH / FRAME_W));
        setFit({ desktop: isDesktop, scale: s, landscape: true });
        shellScale.value = s;
        shellScale.rotated = true;
        return;
      }
      shellScale.rotated = false;
      if (!isDesktop) {
        setFit({ desktop: false, scale: 1, landscape: false });
        shellScale.value = 1;
        return;
      }
      const availW = window.innerWidth - SHELL_PAD * 2;
      const availH = window.innerHeight - SHELL_PAD * 2;
      const s = Math.max(MIN_SCALE, Math.min(1, availW / FRAME_W, availH / FRAME_H));
      setFit({ desktop: true, scale: s, landscape: false });
      shellScale.value = s;
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // 启动时一次性迁移：旧版存服务端的联系人/微信背景图 → 本地 IndexedDB（先搬后删，详见 contacts-store.ts）
  useEffect(() => {
    void migrateFromServer();
  }, []);

  // 全局滚动条显隐（Task 40）：滚动时给滚动容器打 data-scrolling=true，停止 ~0.9s 后回 false；
  // 配合 globals.css 的滚动条规则实现「滚动时才显示滚动条」（此前一打开就常驻显丑）。
  // capture 捕获阶段监听 → 手机壳内任意嵌套滚动容器（各 App 页面/弹层）都能覆盖，组件无需各自接入。
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (el === document.documentElement || el === document.body) return;
      el.dataset.scrolling = 'true';
      const prev = timers.get(el);
      if (prev) window.clearTimeout(prev);
      timers.set(
        el,
        window.setTimeout(() => {
          el.dataset.scrolling = 'false';
        }, 900)
      );
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  // 主屏空闲预热（刷新后首次打开音乐 App 不再等 chunk 编译/下载数秒）：首帧稳定 ~2.5s 后
  // 后台预载音乐 App chunk + 提前音乐 boot/一起听恢复（preloadHeavyApps 幂等，失败静默）
  useEffect(() => {
    const t = window.setTimeout(() => preloadHeavyApps(), 2500);
    return () => window.clearTimeout(t);
  }, []);

  // 底部边缘上滑手势（全局）：从屏幕最底下往上滑 → 打开多任务切换器，主屏幕与所有 App 内均生效（含时钟）。
  // 用 window 捕获阶段原生 Pointer 监听而非组件 onTouch 事件：
  // ① 鼠标/触摸/触控笔统一支持（旧实现仅 touch 事件，桌面鼠标永远无法触发，时钟等界面看起来“不能多任务”）；
  // ② 捕获阶段先于一切子组件，不会被任何 stopPropagation 拦截；
  // ③ move/up 挂在 window，快速上滑滑出横杠也不丢事件，第一下就能触发；
  // ④ 只识别“按下点在底部边缘带内 + 上滑超阈值”，轻点（点 dock 图标/tab 按钮）完全不受影响。
  // 真机难点：App 内列表都可滚动，上滑会被浏览器认领为滚动并回 pointercancel 掐死手势——
  // 所以边缘带内起手且已明确竖直上滑意图时，touchmove preventDefault 阻止浏览器接管
  // （横向滑动第一个像素就方向不符、不拦，主屏翻页等不受影响）；同时放宽判定：
  // 识别带 72px / 触发仅需 18px / 允许略斜（竖直 > 水平×0.85），滑动轻松得多。
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = edgeGesture.current;
      if (!g || g.fired) return;
      // 语音「按住说话」进行中：本次边缘手势作废（按住胶囊就在边缘带内，
      // 录音上滑取消不能把多任务卡片拉起来）
      if (isVoiceHoldActive()) {
        finish();
        return;
      }
      // 横屏旋转（壳底边=屏左边）：前进方向为向右滑；竖屏为向上滑
      const rotated = shellScale.rotated;
      const forward = rotated ? e.clientX - g.x : g.y - e.clientY;
      const lateral = rotated ? Math.abs(e.clientY - g.y) : Math.abs(e.clientX - g.x);
      if (forward > OPEN_DELTA && forward > lateral * 0.85) {
        g.fired = true;
        const ui = useUI.getState();
        // 来电响铃中守卫（#1）：来电界面挂 z-94，比切换器 z-60 高得多。
        // 边缘上滑若不拦会「隐形打开切换器」——切换器在来电界面之下，挂断后才凭空出现。
        // 与 store.openSwitcher 内守卫成双保险：onMove 先短路手势，避免 openSwitcher 再走一遭。
        if (!ui.locked && !ui.screenOff && !ui.switcherOpen && !ui.alarmRinging && !ui.homeEdit && !ui.callActive && !useIncomingCall.getState().call) {
          try {
            navigator.vibrate?.(8);
          } catch {
            /* 震动不可用 */
          }
          ui.openSwitcher();
        }
      }
    };
    // 浏览器滚动接管防御：只在「边缘带内起手 + 已明确竖直上滑」时才拦截
    const onTouchMove = (e: TouchEvent) => {
      const g = edgeGesture.current;
      if (!g || g.fired) return;
      // 语音按住录音期间：不拦截也不认领（按住胶囊已 touch-none，浏览器不会接手滚动）
      if (isVoiceHoldActive()) return;
      const t = e.touches[0];
      if (!t) return;
      const forward = shellScale.rotated ? t.clientX - g.x : g.y - t.clientY;
      const lateral = shellScale.rotated ? Math.abs(t.clientY - g.y) : Math.abs(t.clientX - g.x);
      if (forward > 6 && forward > lateral) e.preventDefault();
    };
    const finish = () => {
      edgeGesture.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    const onDown = (e: PointerEvent) => {
      edgeGesture.current = null; // 上一次未正常收尾的手势作废
      const ui = useUI.getState();
      // 来电响铃中守卫（#1）：onDown 直接不认领手势，避免后续 onMove/finish 绑定 window。
      // ui.callActive=电话 App 通话全屏层显示中（接听后），同样不应被边缘手势打断。
      if (ui.locked || ui.screenOff || ui.switcherOpen || ui.alarmRinging || ui.callActive || useIncomingCall.getState().call) return;
      // 录音按住进行中（如另一根手指按下）：不启动边缘手势
      if (isVoiceHoldActive()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // 悬浮拖拽控件（全局迷你播放器等，data-suppress-edge-gesture 标记）起手：
      // 不认领边缘手势——否则拖动贴底悬浮的迷你条会误开多任务切换器
      const tgt = e.target as Element | null;
      if (tgt && typeof tgt.closest === 'function' && tgt.closest('[data-suppress-edge-gesture]')) return;
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (e.clientX < rect.left || e.clientX > rect.right) return;
      if (e.clientY < rect.top || e.clientY > rect.bottom) return;
      // 横屏旋转后壳底边在屏幕左侧：起手带 = 屏左边缘；竖屏仍为屏底边缘
      const inEdgeZone = shellScale.rotated ? e.clientX - rect.left <= EDGE_ZONE : rect.bottom - e.clientY <= EDGE_ZONE;
      if (!inEdgeZone) return; // 按下点不在底部边缘带内
      edgeGesture.current = { x: e.clientX, y: e.clientY, fired: false };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  // 从 IndexedDB 加载持久化配置（主题/壁纸/API/锁屏密码）。
  // 先完成 localStorage → IndexedDB 迁移与注水（聊天/记忆/表情包等模块的同步读写
  // 都依赖内存缓存就位），再读设置 —— 两者都完成后才结束开机门控。
  useEffect(() => {
    void (async () => {
      // 多账号（Task 40 v2）：v1 每账号独立库 → 单库+键作用域迁移（幂等，无旧库时零开销）；
      // 必须在 ensureKvReady 注水之前——迁移产生的后缀键要进同一份内存
      await migrateLegacyAccounts();
      await ensureKvReady();
      // 多账号（Task 40）：为缺档案联系人的小号/匿名号自动建 user 档案（altOf 关联）——
      // 只读写 contacts store 与 kv，与 load()（只读 settings store）无依赖，并行省黑屏时间
      await Promise.all([ensureAccountOwnerContacts(), load()]);
      // 机主身份双向同步（联系人↔设置›个人信息）：设置读出后再启动，
      // 名字/头像任一侧编辑全端即时同步（锁屏/通话/微信/QQ/信息等）
      startOwnerProfileSync();
      // 深链接：?open=<appId> 开机直达某 App（预览/E2E 便利入口，锁屏时不抢开）
      const openParam = new URLSearchParams(window.location.search).get('open');
      if (openParam && !useUI.getState().locked) {
        useUI.getState().openApp(openParam as never);
      }
      // 全局字体恢复（Task 33-d）：读持久化的 appFontId 写入 CSS 变量；内部全兜底，失败不阻塞开机。
      // 性能：不 await——默认系统字体是纯 CSS 零开销，自定义字体（FontFace 注册）极少数用户才有，
      // 少一拍黑屏；字体晚一瞬挂上只是首帧字体微闪，可接受
      void ensureAppFontApplied();
    })();
  }, [load]);

  const dark = selectResolvedTheme(theme, systemDark) === 'dark';

  // 同步到 html 根节点（第六十八轮）：body 的 bg-background 跟随翻转——
  // 修移动端浏览器视口比 100svh 高一截时，淘宝/美团底部 tab 下方露出 body 白底的问题
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    return () => document.documentElement.classList.remove('dark');
  }, [dark]);

  // 开机门控：设置从 IndexedDB 读出前只显示纯黑开机屏。
  // 若用户关闭了锁屏，locked 会在 load() 内同步纠正为 false——
  // 先等 loaded 再渲染锁屏/主屏，锁屏就不会“闪现一下再消失”。
  if (!loaded) {
    // 横屏全屏：占位盒宽高互换，机身由旋转层铺满；竖屏保持原布局
    const placeholderStyle = fit.landscape
      ? { width: FRAME_H * fit.scale, height: FRAME_W * fit.scale }
      : fit.desktop
        ? { width: FRAME_W * fit.scale, height: FRAME_H * fit.scale }
        : undefined;
    return (
      <div className="flex min-h-[100svh] w-full items-center justify-center bg-[#dcdce1] dark:bg-black sm:p-8">
        {/* 外层按缩放后尺寸占位（transform 不改变布局，需显式给包裹盒防溢出/滚动条） */}
        <div
          className="relative h-[100svh] w-full shrink-0 sm:h-auto sm:w-auto"
          style={placeholderStyle}
        >
          {fit.landscape ? (
            <div
              className="absolute left-1/2 top-1/2 h-[844px] w-[390px]"
              style={{ transform: `translate(-50%, -50%) rotate(90deg) scale(${fit.scale})` }}
            >
              <div
                data-phone-shell=""
                className="relative h-[844px] w-[390px] overflow-hidden rounded-[56px] border-[12px] border-[#151517] bg-black"
                style={{ width: FRAME_W, height: FRAME_H }}
              >
                {/* 灵动岛（开机阶段仅保留硬件开孔） */}
                <div
                  className="pointer-events-none absolute left-1/2 top-[11px] h-[33px] w-[118px] -translate-x-1/2 rounded-full bg-black"
                  aria-hidden="true"
                />
              </div>
            </div>
          ) : (
            <div
              data-phone-shell=""
              className={`relative h-[100svh] w-full overflow-hidden bg-black sm:h-[844px] sm:w-[390px] sm:rounded-[56px] sm:border-[12px] sm:border-[#151517] sm:shadow-[0_40px_90px_-20px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.08)] ${
                dark ? 'dark' : ''
              }`}
              style={{ transform: `scale(${fit.scale})`, transformOrigin: 'top left' }}
            >
              {/* 灵动岛（开机阶段仅保留硬件开孔） */}
              <div
                className="pointer-events-none absolute left-1/2 top-[11px] h-[33px] w-[118px] -translate-x-1/2 rounded-full bg-black"
                aria-hidden="true"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // 横屏全屏：占位盒宽高互换（旋转后机身 844 宽 × 390 高）；竖屏保持原布局
  const placeholderStyle = fit.landscape
    ? { width: FRAME_H * fit.scale, height: FRAME_W * fit.scale }
    : fit.desktop
      ? { width: FRAME_W * fit.scale, height: FRAME_H * fit.scale }
      : undefined;

  // 壳内内容（壁纸 → 主屏 → App → 全局层）：横竖屏共用同一份，只换外壳几何
  const shellInner = (
    <>
        {/* 自定义 CSS（全局作用域，基础优先级）：所有界面/面板/按钮都受它影响；选择器限定在
            [data-phone-shell] 内不泄漏到手机外，且 <style> 渲染在壳内容首位 → 源顺序上
            联系人聊天/线下的 CSS（更高优先级，前缀多一级属性）都能压制它（第七十轮） */}
        {globalCustomCss.trim() ? <style>{scopeCss(globalCustomCss, GLOBAL_CSS_SCOPE)}</style> : null}

        {/* 壁纸层：自定义壁纸绘制见 CustomWallpaperLayers（D6：四周「边缘色延伸带」——
            取原图最外一行/列像素拉伸铺出，无 blur、接缝逐像素同色，肉眼几乎看不出垫了东西；
            预设壁纸保持单层 cover，-inset-[2px] 超采样防边缘细缝） */}
        {customWallpaperUrl ? (
          <CustomWallpaperLayers url={customWallpaperUrl} />
        ) : (
          <div className="absolute -inset-[2px]" style={wallpaperStyle} aria-hidden="true" />
        )}

        {/* 主屏幕 */}
        <HomeScreen />

        {/* App 窗口 */}
        <AppWindow />

        {/* 全局语音通话层：全屏通话页（z-62）+ 悬浮小窗（z-64，可拖动/边缘吸附隐藏）——
            与 App 窗口平级，退出聊天页/切换 App 电话不断；点小窗回通话页，拖到边缘只露一条边 */}
        <GlobalCallLayer />

        {/* 全局迷你播放器（z-55：高于 App 窗口 z-40，低于切换器/锁屏；音乐 App 前台时不显示） */}
        <MusicGlobalMini />

        {/* 全局来电层：AI 来电弹窗（电话横幅/微信大窗 5s→胶囊，z-94，灵动岛原位弹出/收回、弹出期间盖住灵动岛）+
            iOS 全屏来电界面（z-84，仅电话来电自动显示、左上可退出，界面可见时不叠加弹窗；
            微信来电响铃期间不显示任何通话 UI，点弹窗非按钮区域才展开全屏来电页）——高于一切 App/锁屏，任何界面都显示 */}
        <IncomingCallLayer />

        {/* Home 指示条：所有界面常显，颜色由 useLightForeground 随身后背景明暗选黑/白
            （白底黑杠、黑底白杠；饱和色背景按明暗取色，不像 mix-blend-difference 那样变互补色）。
            上滑 = 打开多任务切换器：由 PhoneShell 顶部 window 捕获阶段全局边缘手势接管（鼠标/触摸均可，
            主屏幕与所有 App 内一致生效）；指示条本体 pointer-events-none——
            纯视觉元素不拦截点击（否则会挡住 App 内底部区域的按钮，如表情面板弹窗的完成按钮） */}
        {!screenOff && !switcherOpen && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[72] flex h-[28px] items-end justify-center pb-[7px] touch-none"
          >
            <div
              className={`ph-homebar h-[5px] w-[134px] rounded-full opacity-90 transition-colors duration-300 ${
                barLight ? 'bg-white' : 'bg-black'
              }`}
            />
          </div>
        )}

        {/* 多任务切换器（主屏幕或 App 内均可打开；锁定时被锁屏覆盖） */}
        <AppSwitcher />

        {/* 锁屏（含密码验证 / 手电筒 / 锁屏直达相机；解锁时播放退场动画） */}
        <AnimatePresence>{locked && <LockScreen key="lockscreen" />}</AnimatePresence>

        {/* 熄屏遮罩（电源键熄屏；轻点或再按电源键唤醒到锁屏） */}
        {screenOff && (
          <div
            role="button"
            aria-label="轻点唤醒屏幕"
            onClick={pressPower}
            className="absolute inset-0 z-[95] cursor-pointer bg-black"
          />
        )}

        {/* 状态栏 + 灵动岛 + 全局灵动岛通知（通知展开期间灵动岛隐藏，收起后恢复）。
            状态栏开关（Task 36，设置 › 显示与亮度组；Task 37 扩展）：关闭后隐藏时间/信号/电量状态栏，
            灵动岛一并隐藏（用户要求「灵动岛也消失」）；全局弹窗不受影响——
            灵动岛通知卡/来电胶囊/闹钟横幅等仍照常从原位弹出（IslandNotificationLayer 等独立于本开关）。
            灵动岛常驻开关（用户需求）：关闭后顶部黑色胶囊基础灵动岛不显示，但 APP 灵动岛
            （音乐岛大/小窗、美团/淘宝配送岛、灵动岛通知卡、来电胶囊）全部照常显示 */}
        {statusBarVisible && <StatusBar />}
        {statusBarVisible && islandPersistent && !islandCovered && (
          <div
            className="ph-island pointer-events-none absolute left-1/2 top-[11px] z-[80] h-[33px] w-[118px] -translate-x-1/2 rounded-full bg-black"
            aria-hidden="true"
          />
        )}
        <IslandNotificationLayer />

        {/* 音乐灵动岛（z-81：同位盖住静态灵动岛，低于聊天通知 z-93；消息通知展示期间整层隐身） */}
        <MusicIsland />

        {/* 美团外卖灵动岛（z-82：同锚位盖住音乐灵动岛 z-81，低于聊天通知 z-93；
            小窗常驻（骑手+送货中+剩余分钟），状态变化大窗 5 秒，点大窗进订单详情） */}
        <MeituanIsland />

        {/* 淘宝快递灵动岛（z-82：与美团岛同规格同锚位，两者都有进行中单时「最新事件方」展示；
            小窗常驻（快递员+状态+剩余分钟），状态变化大窗 5 秒，点大窗进淘宝订单详情） */}
        <TaobaoIsland />

        {/* 通知权限友好申请卡（首次使用时展示，应用内说明 → 用户手势内才弹浏览器授权框） */}
        <NotifyPermissionCard />

        {/* 全局闹钟监听（锁屏时也会响铃，铃声弹层 z-90 高于锁屏） */}
        <AlarmWatcher />

        {/* 全局提醒事项/日历到期监听：到点弹横幅 + 系统通知 + 短提示音（App 不打开也生效） */}
        <ReminderWatcher />

        {/* 朋友圈/QQ动态全局调度：AI 好友的点赞/评论/回复延迟队列结算 + 三种触发自动发动态（App 不打开也生效） */}
        <MomentsScheduler />
        <ForumScheduler />

        {/* 退群挽留全局调度：退群后 1 分钟内群成员按人设主动私信 + 私聊里拉回群（App 不打开也生效） */}
        <QuitFlowScheduler />

        {/* AI 主动来电全局调度：根据人设/聊天内容/时间自主决策并真正拨打（接听/拒接/超时走全局来电层） */}
        <ProactiveCallWatcher />

        {/* AI 主动发消息全局调度：定时/事件/自主/自然语言提醒四类触发，到点 AI 主动给用户发消息（App 不打开也生效） */}
        <ProactiveMsgWatcher />

        {/* 恋人空间 AI 常驻调度：自主决策链开机即起、刷新自动续链（不用先打开恋人空间，App 不打开也生效） */}
        <CoupleResidentWatcher />

        {/* 美团订单全局调度：订单状态机按时间戳推进（商家接单/骑手取餐/已送达），变化弹灵动岛通知（App 不打开也生效） */}
        <MeituanOrderWatcher />

        {/* AI 邀请一起听全局卡（仿网易云邀请弹窗：双头像+耳机线+歌名，✕/✓ 接受拒绝；
            触发源 = 聊天里 AI 的 [邀请一起听] 标记 + 全局调度器按人设/听歌数据主动邀约；
            接受后直接进音乐 App 一起听模式） */}
        <TogetherInviteLayer />
        <TogetherInviteWatcher />

        {/* 电源键（桌面端机身右侧：熄屏 ↔ 亮屏锁定） */}
        <button
          type="button"
          aria-label="电源键：熄屏或唤醒"
          title="电源键"
          onClick={pressPower}
          className="absolute -right-[17px] top-[196px] z-[10] hidden h-[64px] w-[6px] rounded-r-[3px] bg-[#3a3a3d] transition-colors hover:bg-[#5a5a5e] active:bg-[#6a6a6e] sm:block"
        />
    </>
  );

  // 手机壳：竖屏沿用原布局（移动全屏/桌面带边框缩放）；横屏铺满视口（旋转 90° 由外层旋转层承担）
  const shell = (
    <div
      ref={shellRef}
      data-phone-shell=""
      className={
        fit.landscape
          ? `relative overflow-hidden rounded-[56px] border-[12px] border-[#151517] bg-black text-foreground shadow-[0_40px_90px_-20px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.08)] ${dark ? 'dark' : ''}`
          : `relative h-[100svh] w-full overflow-hidden bg-black text-foreground sm:h-[844px] sm:w-[390px] sm:rounded-[56px] sm:border-[12px] sm:border-[#151517] sm:shadow-[0_40px_90px_-20px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.08)] ${dark ? 'dark' : ''}`
      }
      style={
        fit.landscape
          ? { width: FRAME_W, height: FRAME_H }
          : { transform: `scale(${fit.scale})`, transformOrigin: 'top left' }
      }
    >
      {shellInner}
    </div>
  );

  return (
    <div className="flex min-h-[100svh] w-full items-center justify-center bg-[#dcdce1] dark:bg-black sm:p-8">
      {/* 外层按缩放后尺寸占位（transform 不改变布局，需显式给包裹盒防溢出/滚动条）；
          移动端不缩放，保持全屏 */}
      <div
        className="relative h-[100svh] w-full shrink-0 sm:h-auto sm:w-auto"
        style={placeholderStyle}
      >
        {fit.landscape ? (
          /* 横屏：旋转层把竖屏机身转 90° 铺满视口（translate 居中 → rotate → scale，全部绕自身中心，天然居中） */
          <div
            className="absolute left-1/2 top-1/2 h-[844px] w-[390px]"
            style={{ transform: `translate(-50%, -50%) rotate(90deg) scale(${fit.scale})` }}
          >
            {shell}
          </div>
        ) : (
          shell
        )}
      </div>
    </div>
  );
}
