'use client';

/**
 * C6 应用内通知中心（下拉通知栏面板）：
 *
 * 入口（两条，互不打架）：
 * ① 顶部边缘下拖手势：window 捕获阶段 Pointer 监听（与 PhoneShell 底部边缘手势同一套套路），
 *    按下点在「手机顶部 44px 内」（横屏时手机顶=屏幕右缘）且明确下拉意图才认领——
 *    跟手拖动实时驱动 motion value，松手按位移/速度判定展开或回弹；
 * ② 状态栏空闲区点按：左右两条透明热区（左侧时间带 / 右侧电量带，各 118px 宽），
 *    中间留空给灵动岛/音乐岛/通知卡等既有交互；StatusBar 本身 pointer-events-none 且无点击
 *    处理，热区不破坏任何既有交互。
 *
 * 层级：z-[61] —— App 窗口（40）之上、多任务切换器（60）之上、全局通话层（62/64）与
 * 锁屏（65）之下；仅解锁后可拉出（锁屏/熄屏/响铃/通话/切换器打开时入口全部禁用）；
 * 任务执行中（Agent 进度条 z-60）也可用（面板盖在进度条之上，互不冲突）。
 *
 * 动画：framer-motion motion value（transform + opacity，~260ms）；拖动期间 progress 跟手
 * 实时 set，松手后 animate 到目标值——同一套数值源，无跳变。
 *
 * 点击条目：markRead + 导航（target 走 island-notify 导航总线 / 否则 location.href）+ 收面板；
 * 收面板经 store.closeCenter（原生 local-notify-open 回传同源），本组件只订阅 store.open。
 *
 * v1.9.4（用户需求）：① 列表改平铺——组头标签（「AI 助手」等）整行移除，每条通知自带
 * APP 图标/标题/时间/单条清除，信息不重复更简约；② 单条通知保留未读蓝点与全部已读/清空。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useUI, type AppId } from '@/lib/ios/store';
import { useIncomingCall } from '@/lib/ios/incoming-call';
import { shellScale } from '@/lib/ios/shell-scale';
import { appImage } from '@/components/apps/registry';
import {
  activateCenterItem,
  setNotifyDnd,
  unreadCountOf,
  useNotifyCenter,
  useNotifyDnd,
  type NotificationCenterItem,
} from '@/lib/ios/notification-center';

// ---------------- 常量 ----------------

/** 顶部下拉/点按识别带高度（状态栏 54px 内，避开 App 内容区） */
const TOP_ZONE = 44;
/** 下拉满面板所需位移（px） */
const OPEN_DIST = 240;
/** 松手展开的位移阈值（× OPEN_DIST ≈ 96px） */
const OPEN_RATIO = 0.4;
/** 松手展开的速度阈值（px/ms，快速轻甩即开） */
const OPEN_VELOCITY = 0.45;

/** 顶部拖动手势现场（lastD/lastT 同时是速度采样：上一次采样值保留在 prevD/prevT） */
interface TopDrag {
  startX: number;
  startY: number;
  startT: number;
  /** 已认领为下拉手势（防止误伤横向滑动/轻点） */
  claimed: boolean;
  lastD: number;
  lastT: number;
  prevD: number;
  prevT: number;
}

// ---------------- 工具 ----------------

/** 来源 App 元数据（v1.9.3 分组折叠 + 主屏同款 APP 图标共用一份推导） */
interface NcAppMeta {
  /** 分组键（同 key 聚拢一组；未知 tag 全部归入 system「系统」组） */
  key: string;
  /** 组头展示名 */
  name: string;
  /** 主屏同款 APP 图标（registry appImage 实体图；'agent' 为渐变+星光定制标） */
  appId?: AppId | 'agent';
  /** 行/组头图标（图片路径；调用方自带 item.icon 永远胜出） */
  src?: string;
  /** 行/组头图标（emoji 兜底，当无图片路径时） */
  emoji?: string;
}

/**
 * 按 tag 推导来源 App（调研结论：通知中心记录的唯一入口是 local-notify.notifyIfHidden →
 * recordCenterNotification，真实存在的 tag 形态只有四种——
 * 'agent'（shizuku-agent 任务结束）/ 'couple-home-notes'（CoupleHome 便签）/
 * 'ai-call-<id>'（proactive-call 来电提醒）/ 'ai-vm-<id>'（proactive-call 未接留言）；
 * pushChatNotification 聊天链路不入中心，故聊天 tag 当前实际不存在——下面的微信/QQ/信息
 * 分支是按 sessionKey 前缀约定做的防御性映射，兜住未来/测试注入（__ncTest）的形态，
 * 避免聊天条目错归「系统」组；未知/无 tag（含浏览器通道自动 local-*）归「系统」。
 * v1.9.3：图标升级为主屏同款 APP 实体图标（registry appImage 直连，与 HomeScreen 同源），
 * agent 组用渐变+星光定制标；解析顺序：item.icon > appId 实体图 > src > emoji。
 */
function appMetaOf(item: NotificationCenterItem): NcAppMeta {
  const tag = item.tag ?? '';
  let key = 'system';
  let name = '系统';
  let appId: NcAppMeta['appId'];
  let src: string | undefined = '/icons/pwa/icon-192.png'; // 缺省：AI Phone 应用图标
  let emoji: string | undefined;
  if (tag === 'agent' || tag.startsWith('agent-') || tag.startsWith('agent:')) {
    key = 'agent';
    name = 'AI 助手';
    appId = 'agent';
    src = undefined;
  } else if (tag.startsWith('ai-call-')) {
    key = 'phone';
    name = '电话';
    appId = 'phone';
    src = undefined;
  } else if (tag.startsWith('ai-vm-')) {
    key = 'voicemail';
    name = '语音留言';
    appId = 'recorder';
    src = undefined;
  } else if (tag.startsWith('couple')) {
    key = 'couple';
    name = '情侣小家';
    appId = 'cottage';
    src = undefined;
  } else if (/^wx([:-]|$)/.test(tag) || tag.startsWith('wx:group') || tag.startsWith('wx-group')) {
    key = 'wechat';
    name = '微信';
    appId = 'wechat';
    src = undefined;
  } else if (/^qq([:-]|$)/.test(tag) || tag.startsWith('qq:group') || tag.startsWith('qq-group')) {
    key = 'qq';
    name = 'QQ';
    appId = 'qq';
    src = undefined;
  } else if (/^(sms|chat)([:.-]|$)/.test(tag)) {
    key = 'chat';
    name = '信息';
    appId = 'chat';
    src = undefined;
  }
  // 调用方自带图标永远胜出（旧 iconForItem 首分支语义；带 src 时忽略 appId 映射）
  if (item.icon) return { key, name, src: item.icon };
  return {
    key,
    name,
    ...(appId ? { appId } : {}),
    ...(src ? { src } : {}),
    ...(emoji ? { emoji } : {}),
  };
}

/**
 * 通知行/组头 APP 图标（v1.9.3）：优先主屏同款实体 APP 图标（registry appImage，
 * 与 HomeScreen 同源）；agent 组=绿→青→紫渐变底+白色星光（AI 助手身份标识）；
 * 其余回退 src 图片 / emoji。容器自带圆角裁切，图片满铺（PNG 自带圆角与容器几乎重合）。
 */
function NcAppIcon({ meta, size }: { meta: NcAppMeta; size: number }) {
  if (meta.appId === 'agent') {
    return (
      <span
        className="flex h-full w-full items-center justify-center"
        style={{ background: 'linear-gradient(140deg, #34C759 0%, #32ADE6 55%, #A78BFA 100%)' }}
      >
        <Sparkles
          style={{ width: Math.round(size * 0.52), height: Math.round(size * 0.52) }}
          className="text-white"
          strokeWidth={2.2}
          aria-hidden="true"
        />
      </span>
    );
  }
  if (meta.appId) {
    const img = appImage(meta.appId as AppId);
    if (img) return <img src={img} alt="" draggable={false} className="block h-full w-full select-none object-cover" />;
  }
  if (meta.src) return <img src={meta.src} alt="" draggable={false} className="block h-full w-full object-contain" />;
  if (meta.emoji) return <span style={{ fontSize: Math.round(size * 0.58), lineHeight: 1 }}>{meta.emoji}</span>;
  return null;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / M月D日 */
function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (ts >= startOfToday - 86_400_000 && ts < startOfToday) return '昨天';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ---------------- 单条通知行 ----------------

function NotificationRow({ item, now }: { item: NotificationCenterItem; now: number }) {
  const icon = appMetaOf(item); // 行图标与分组共用同一推导（v1.9.3：主屏同款 APP 图标）
  return (
    <button
      type="button"
      data-testid="nc-item"
      onClick={() => activateCenterItem(item)}
      className="pointer-events-auto relative mb-2 flex w-full items-start gap-3 rounded-[20px] bg-white/[0.13] p-3 pr-9 text-left ring-1 ring-white/[0.09] shadow-[0_6px_20px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-colors active:bg-white/[0.22]"
    >
      {/* APP 图标（主屏同款实体图标 / agent 渐变星光） */}
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-white/10 ring-1 ring-white/20">
        <NcAppIcon meta={icon} size={38} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-white">{item.title}</span>
          <span className="shrink-0 text-[11px] text-white/50">{relativeTime(item.ts, now)}</span>
          {/* 未读蓝点 */}
          {!item.read && <span aria-label="未读" className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#0A84FF]" />}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-white/75">{item.body}</span>
      </span>
      {/* 单条「清除」（阻断条目点击） */}
      <span
        role="button"
        aria-label="清除这条通知"
        data-testid="nc-item-clear"
        onClick={(e) => {
          e.stopPropagation();
          useNotifyCenter.getState().remove(item.id);
        }}
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-[10px] leading-none text-white/70 active:bg-white/30"
      >
        ✕
      </span>
    </button>
  );
}

// ---------------- 主组件 ----------------

export default function NotificationCenter() {
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const switcherOpen = useUI((s) => s.switcherOpen);
  const alarmRinging = useUI((s) => s.alarmRinging);
  const callActive = useUI((s) => s.callActive);
  const incomingCall = useIncomingCall((s) => s.call);
  const open = useNotifyCenter((s) => s.open);
  const items = useNotifyCenter((s) => s.items);

  /** 面板展开进度（0 关 ↔ 1 开）：拖动跟手与开合动画共用同一数值源 */
  const progress = useMotionValue(0);
  const backdropOpacity = useTransform(progress, [0, 1], [0, 1]);
  const contentY = useTransform(progress, [0, 1], ['-105%', '0%']);
  const drag = useRef<TopDrag | null>(null);
  // 相对时间的基准：渲染时取当前时间（30s 心跳 tick 只负责触发重渲染刷新展示）
  const [, setTick] = useState(0);
  const now = Date.now();

  // v1.9.2 真 DND 快捷开关：订阅响应式镜像 store（setNotifyDnd 先落盘再同步镜像）——
  // 设置 › 通知页与面板两个入口天然联动，无需 useState 镜像 + effect 同步
  const dndOn = useNotifyDnd((s) => s.on);

  // v1.9.4 用户需求：组头标签（「AI 助手」等）整体移除，改 iOS 式平铺列表——
  // 每条通知自带 APP 图标/标题/时间，分组头属重复信息；条目本身 ts 倒序直达
  const flatItems = useMemo(() => [...items].sort((a, b) => b.ts - a.ts), [items]);

  // 入口 gate：仅解锁后可拉出；切换器/响铃/通话/来电层显示时禁用（它们的交互优先）
  const entryEnabled = !locked && !screenOff && !switcherOpen && !alarmRinging && !callActive && !incomingCall;

  // 面板开合动画（store.open 是唯一真相：点按入口/原生回传收面板/外部钩子都汇到这里）
  useEffect(() => {
    const controls = animate(progress, open ? 1 : 0, { duration: 0.26, ease: [0.32, 0.72, 0, 1] });
    return () => controls.stop();
  }, [open, progress]);

  // 多任务切换器打开时收起面板（面板 z 在切换器之上，避免叠着遮挡切换器操作）
  useEffect(() => {
    if (switcherOpen && useNotifyCenter.getState().open) useNotifyCenter.getState().closeCenter();
  }, [switcherOpen]);

  // 面板展开期间每 30s 心跳一次：触发重渲染刷新「N 分钟前」相对时间
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setTick((v) => v + 1), 30_000);
    return () => window.clearInterval(t);
  }, [open]);

  // ---------------- 顶部边缘下拉手势（window 捕获阶段；锁屏/熄屏/来电等在事件时实时复核） ----------------
  useEffect(() => {
    const shellEl = (): HTMLElement | null => document.querySelector('[data-phone-shell]');

    const gateBlocked = (): boolean => {
      const ui = useUI.getState();
      return (
        ui.locked ||
        ui.screenOff ||
        ui.switcherOpen ||
        ui.alarmRinging ||
        ui.callActive ||
        !!useIncomingCall.getState().call ||
        useNotifyCenter.getState().open // 面板已开：不再重复认领（收起走点按/按钮）
      );
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    const onUp = () => {
      const g = drag.current;
      drag.current = null;
      cleanup();
      if (!g || !g.claimed) return; // 未认领 = 轻点：交给原生 click（条带自身 onClick 开面板）
      const dt = Math.max(1, g.lastT - g.prevT);
      const vel = (g.lastD - g.prevD) / dt; // px/ms
      const shouldOpen = g.lastD > OPEN_DIST * OPEN_RATIO || vel > OPEN_VELOCITY;
      const st = useNotifyCenter.getState();
      if (shouldOpen) st.openCenter();
      else st.closeCenter(); // 回弹：animate 从当前 progress 过渡到 0，无跳变
    };

    const onMove = (e: PointerEvent) => {
      const g = drag.current;
      if (!g) return;
      // 横屏（壳旋转 90°）：手机顶部在屏幕右缘，「下拉」方向 = 向左
      const rotated = shellScale.rotated;
      const d = rotated ? g.startX - e.clientX : e.clientY - g.startY;
      const lat = rotated ? Math.abs(e.clientY - g.startY) : Math.abs(e.clientX - g.startX);
      if (!g.claimed) {
        if (d > 6 && d > lat * 0.85) {
          g.claimed = true; // 明确下拉意图：认领手势
        } else if (lat > 14 || d < -14) {
          // 明确不是下拉（横向滑动/上滑）：放弃认领，交还原交互
          drag.current = null;
          cleanup();
          return;
        } else {
          return; // 意图未明，继续观察
        }
      }
      // 已认领：跟手 + 速度采样
      g.prevD = g.lastD;
      g.prevT = g.lastT;
      g.lastD = d;
      g.lastT = e.timeStamp;
      progress.set(Math.max(0, Math.min(1, d / OPEN_DIST)));
    };

    const onDown = (e: PointerEvent) => {
      drag.current = null; // 上一次未正常收尾的手势作废
      if (gateBlocked()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // 可交互元素起手不认领（灵动岛卡/来电横幅/闹钟横幅等顶部元素照常点击）；
      // 本组件自己的点按条带（data-nc-strip）除外——它就是入口
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function') {
        const hit = t.closest('button,a,input,textarea,select,[role="button"],[data-no-top-pull]');
        if (hit && !(hit as Element).hasAttribute('data-nc-strip')) return;
      }
      const shell = shellEl();
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const rotated = shellScale.rotated;
      // 按下点须在壳内（另一轴）且距「手机顶部边缘」≤ TOP_ZONE（横屏时手机顶=屏幕右缘）
      const inCrossAxis = rotated
        ? e.clientY >= rect.top && e.clientY <= rect.bottom
        : e.clientX >= rect.left && e.clientX <= rect.right;
      if (!inCrossAxis) return;
      const depth = rotated ? rect.right - e.clientX : e.clientY - rect.top;
      if (depth < 0 || depth > TOP_ZONE) return;
      drag.current = {
        startX: e.clientX,
        startY: e.clientY,
        startT: e.timeStamp,
        claimed: false,
        lastD: 0,
        lastT: e.timeStamp,
        prevD: 0,
        prevT: e.timeStamp,
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

    // 浏览器滚动/下拉刷新接管防御：只在已认领下拉且竖直向下时拦截
    const onTouchMove = (e: TouchEvent) => {
      const g = drag.current;
      if (!g || !g.claimed) return;
      const t = e.touches[0];
      if (!t) return;
      const rotated = shellScale.rotated;
      const d = rotated ? g.startX - t.clientX : t.clientY - g.startY;
      const lat = rotated ? Math.abs(t.clientY - g.startY) : Math.abs(t.clientX - g.startX);
      if (d > 0 && d > lat) e.preventDefault();
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      cleanup();
      drag.current = null;
    };
    // 依赖说明：progress 为 motion value（稳定引用）；其余全部走 getState()/模块常量，仅挂载一次
  }, [progress]);

  const unread = unreadCountOf(items);

  return (
    <div className="pointer-events-none absolute inset-0 z-[61]" aria-hidden={!open}>
      {/* ① 顶部两侧点按热区（状态栏空闲区）：左=时间带，右=信号/电量带；中间留空给灵动岛系。
          仅解锁且无全屏层时挂载；已展开时轻点 = 收起（toggle） */}
      {entryEnabled && (
        <>
          <div
            data-nc-strip=""
            role="button"
            aria-label="打开通知中心"
            data-testid="nc-strip-left"
            onClick={() => useNotifyCenter.getState().toggleCenter()}
            className="pointer-events-auto absolute left-0 top-0 z-[71] h-[44px] w-[118px] cursor-pointer touch-none select-none"
          />
          <div
            data-nc-strip=""
            role="button"
            aria-label="打开通知中心"
            data-testid="nc-strip-right"
            onClick={() => useNotifyCenter.getState().toggleCenter()}
            className="pointer-events-auto absolute right-0 top-0 z-[71] h-[44px] w-[118px] cursor-pointer touch-none select-none"
          />
        </>
      )}

      {/* 毛玻璃背板：点空白处收起（展开后才可点，拖动期间 pointer-events 关闭） */}
      <motion.div
        style={{ opacity: backdropOpacity, pointerEvents: open ? 'auto' : 'none' }}
        onClick={() => useNotifyCenter.getState().closeCenter()}
        className="absolute inset-0 bg-black/50 backdrop-blur-xl"
      />

      {/* 内容层（跟手/动画共用 contentY） */}
      <motion.div
        style={{ y: contentY, pointerEvents: open ? 'auto' : 'none' }}
        className="absolute inset-x-0 top-0 flex h-[82%] flex-col px-3 pt-[56px]"
      >
        {/* 拉手（点按收起）；DND 生效时附小 🌙 标识（v1.9.2 可选细节，极简不加新区块） */}
        <button
          type="button"
          aria-label="收起通知中心"
          data-testid="nc-grabber"
          onClick={() => useNotifyCenter.getState().closeCenter()}
          className="pointer-events-auto mx-auto mb-1 flex h-6 min-w-16 shrink-0 items-center justify-center gap-1.5 px-1"
        >
          {dndOn && <span aria-label="免打扰开启中" className="text-[11px] leading-none">🌙</span>}
          <span className="h-[5px] w-[38px] rounded-full bg-white/40" />
        </button>

        {/* 列表 / 空态 */}
        {items.length === 0 ? (
          <div data-testid="nc-empty" className="flex flex-1 items-center justify-center text-[13px] text-white/60">
            暂无新通知
          </div>
        ) : (
          <div data-testid="nc-list" className="min-h-0 flex-1 overflow-y-auto">
            {/* 平铺列表（v1.9.4：组头标签已按需求移除）：每条自带 APP 图标/标题/相对时间/单条清除 */}
            {flatItems.map((it) => (
              <NotificationRow key={it.id} item={it} now={now} />
            ))}
          </div>
        )}

        {/* 底部操作（毛玻璃精修 v1.9.3）：全部已读 / 🌙免打扰（激活蓝色）/ 清空全部 */}
        <div className="flex shrink-0 gap-2 py-2.5">
          <button
            type="button"
            data-testid="nc-mark-all"
            disabled={unread === 0}
            onClick={() => useNotifyCenter.getState().markAllRead()}
            className="pointer-events-auto h-9 flex-1 rounded-full bg-white/[0.14] text-[13px] font-medium text-white ring-1 ring-white/[0.08] backdrop-blur-md transition-colors active:bg-white/[0.24] disabled:opacity-40"
          >
            全部已读
          </button>
          <button
            type="button"
            data-testid="nc-dnd-toggle"
            aria-pressed={dndOn}
            onClick={() => {
              setNotifyDnd(!dndOn); // 先落盘（唯一真相）再同步镜像，订阅处自动重渲染
            }}
            className={`pointer-events-auto h-9 flex-1 rounded-full text-[13px] font-medium text-white backdrop-blur-md transition-colors active:brightness-110 ${
              dndOn ? 'bg-[#0A84FF]' : 'bg-white/[0.14] ring-1 ring-white/[0.08]'
            }`}
          >
            🌙 免打扰
          </button>
          <button
            type="button"
            data-testid="nc-clear-all"
            disabled={items.length === 0}
            onClick={() => useNotifyCenter.getState().clearAll()}
            className="pointer-events-auto h-9 flex-1 rounded-full bg-white/[0.14] text-[13px] font-medium text-white ring-1 ring-white/[0.08] backdrop-blur-md transition-colors active:bg-white/[0.24] disabled:opacity-40"
          >
            清空全部
          </button>
        </div>
      </motion.div>
    </div>
  );
}
