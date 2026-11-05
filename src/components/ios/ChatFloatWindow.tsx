'use client';

/**
 * v73 AI 聊天悬浮小窗（PhoneShell 壳层全局组件，z-58）
 *
 * 结构：pointer-events-none 根层（不挡底层 App 的点击滑动）+ pointer-events-auto 小窗本体。
 * 小窗内容 = 微信 ChatPage（float 变体）：发送/流式回复/语音/加号面板/红包转账礼物等功能
 * 与全屏聊天完全同一套管线；消息实时互通靠 wechat.tsx 的会话消息共享源（wxSessionMsgs）。
 *
 * 交互（需求三）：
 *  · 标题条拖拽移动（setPointerCapture，实时位置进 state）；
 *  · 松手自动吸附左/右边缘（transition 平滑滑入）；
 *  · 拖到屏幕底部出现「松手关闭」提示，松手即销毁；
 *  · 最小化成胶囊（ChatPage 卸载释放渲染压力，未读角标恢复累计），点胶囊恢复；
 *  · 最大化 = 跳转全屏聊天（通知同款导航协议）并关闭小窗。
 *
 * 性能：拖拽期间位置 state 每帧更新 → 本组件重渲染，但聊天子树经 chatEl useMemo（冻结 props）
 * + ChatPageMemo（memo 包装）双重拦截整棵跳过，拖动帧只重排浮层外壳。
 *
 * 可见性：锁定/熄屏/多任务切换器时隐藏（同悬浮工具）；微信切账号时自动关闭。
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Maximize2, MessageCircle, Minus, Trash2, X } from 'lucide-react';
import { useChatFloat, loadChatFloatPos, saveChatFloatPos, type ChatFloatPos } from '@/lib/ios/chat-float-store';
import { useUI } from '@/lib/ios/store';
import { displayNameOf, withDisplayNames } from '@/lib/contacts';
import { listContactsFor, updateContact, type ContactRecord } from '@/lib/ios/contacts-store';
import { ChatPage, type WxUser } from '@/components/apps/wechat';
import { navigateToChatSession } from '@/lib/ios/island-notify';
import { ACCOUNT_CHANGED_EVENT, MAIN_ACCOUNT_ID, getActiveAccountFor } from '@/lib/ios/accounts';
import { useUnreadMap, wxUnreads } from '@/lib/unread-store';
import { useChatStream } from '@/lib/chat-stream-store';

/** ChatPage 的 memo 包装（模块级单例）：配合下方 chatEl 的 props 冻结，拖动重渲染不穿透聊天子树 */
const ChatPageMemo = memo(ChatPage);

/** 小窗内容缩放（zoom：真实重排缩放——小窗容器窄，缩放后文字/气泡按比例排布不裁切；v73.3 整体变小降至 0.82） */
const ZOOM = 0.82;
/** 标题条高度（px，内容区像素尺寸计算配套） */
const HEADER_H = 34;
/** 小窗尺寸（相对手机屏幕层）：v73.3 用户要求「整体变小」——宽 88%→70%，高 48%→40%（紧凑形） */
const WIN_W_RATIO = 0.7;
const WIN_H_RATIO = 0.4;
/** 吸附/边界留白 */
const EDGE = 6;
const TOP_MIN = 54;
const BOTTOM_MARGIN = 14;
/** 底部「松手关闭」热区高度 */
const CLOSE_ZONE = 104;

interface DragState {
  px: number;
  py: number;
  baseX: number;
  baseY: number;
  moved: boolean;
}

const clampNum = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export default function ChatFloatWindow() {
  const contactId = useChatFloat((s) => s.contactId);
  const minimized = useChatFloat((s) => s.minimized);
  const storePos = useChatFloat((s) => s.pos);
  const close = useChatFloat((s) => s.close);
  const minimize = useChatFloat((s) => s.minimize);
  const restore = useChatFloat((s) => s.restore);
  const setPos = useChatFloat((s) => s.setPos);

  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const switcherOpen = useUI((s) => s.switcherOpen);

  const layerRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  /** 拖动后的松手抑制 click（胶囊拖动后不触发「点按恢复」） */
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [closeZone, setCloseZone] = useState(false);
  /** 拖动中的实时位置（state；松手提交进 store 后清空） */
  const [livePos, setLivePos] = useState<ChatFloatPos | null>(null);
  const [layerSize, setLayerSize] = useState<{ w: number; h: number } | null>(null);

  // ---------------- 联系人 / 我（与微信全屏同一套投影：wx 槽位头像 + 社交展示名） ----------------
  /** 已加载的联系人快照（cid 标记归属会话——换会话重开小窗时旧快照不误判「会话不存在」） */
  const [contactsFor, setContactsFor] = useState<{ cid: string; list: ContactRecord[] } | null>(null);

  useEffect(() => {
    if (!contactId) return;
    let alive = true;
    const load = () => {
      listContactsFor('wx')
        .then((raw) => {
          if (alive) setContactsFor({ cid: contactId, list: withDisplayNames(raw, { social: true, app: 'wx' }) });
        })
        .catch(() => {
          if (alive) setContactsFor({ cid: contactId, list: [] });
        });
    };
    load();
    // 资料变更（备注/头像/人设）→ 刷新小窗联系人快照（顶栏名字、转发目标列表等随之更新）
    window.addEventListener('contact-updated', load);
    window.addEventListener('contact-avatar-changed', load);
    return () => {
      alive = false;
      window.removeEventListener('contact-updated', load);
      window.removeEventListener('contact-avatar-changed', load);
    };
  }, [contactId]);

  const contactsReady = contactsFor?.cid === contactId;
  const contacts = contactsReady ? contactsFor.list : null;
  const peer = useMemo(() => contacts?.find((c) => c.id === contactId) ?? null, [contacts, contactId]);

  const me = useMemo<WxUser | null>(() => {
    if (!contacts) return null;
    const acc = getActiveAccountFor('wx');
    const mine =
      contacts.find((c) => c.kind === 'user' && (acc.id === MAIN_ACCOUNT_ID ? !c.altOf : c.altOf === acc.id)) ??
      contacts.find((c) => c.kind === 'user' && !c.altOf);
    if (!mine) return null;
    return {
      id: mine.id,
      name: displayNameOf(mine),
      realName: mine.realName ?? mine.name,
      nickname: mine.nickname ?? null,
      avatar: mine.avatar,
      wechatId: mine.wechatId,
      phone: mine.phone,
      qqId: mine.qqId,
      altOf: mine.altOf ?? null,
    };
  }, [contacts]);

  /** NPC 归属者名字（与 MainScreen 同规则，传给 ChatPage 的人设拼装） */
  const ownerNameOf = useMemo(() => {
    const byId = new Map((contacts ?? []).map((c) => [c.id, c.name]));
    return (c: ContactRecord): string | null => (c.kind === 'npc' && c.ownerId ? byId.get(c.ownerId) ?? null : null);
  }, [contacts]);

  // 会话不存在（联系人被删 / 账号数据变化）→ 自动关窗
  useEffect(() => {
    if (contactsReady && contactId && !peer) close();
  }, [contactsReady, contactId, peer, close]);

  // 微信切账号：关闭小窗（会话键随账号隔离，旧会话不应残留悬浮）
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string }>).detail;
      if (!d || d.app === 'wx') useChatFloat.getState().close();
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, []);

  // ---------------- 布局测量 + 位置持久化 ----------------
  useLayoutEffect(() => {
    const measure = () => {
      const r = layerRef.current?.getBoundingClientRect();
      if (r && r.width > 0) setLayerSize((prev) => (prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [contactId]);

  const winW = layerSize ? Math.round(layerSize.w * WIN_W_RATIO) : 0;
  const winH = layerSize ? Math.round(layerSize.h * WIN_H_RATIO) : 0;

  const clampPos = useCallback(
    (p: ChatFloatPos): ChatFloatPos => {
      if (!layerSize || winW <= 0) return p;
      return {
        x: clampNum(p.x, EDGE, layerSize.w - winW - EDGE),
        y: clampNum(p.y, TOP_MIN, layerSize.h - winH - BOTTOM_MARGIN),
      };
    },
    [layerSize, winW, winH],
  );

  // 挂载首帧：恢复持久化位置（钳回层内自愈越界老数据）
  const posInitRef = useRef(false);
  useEffect(() => {
    if (!layerSize || posInitRef.current) return;
    posInitRef.current = true;
    if (useChatFloat.getState().pos == null) {
      const saved = loadChatFloatPos();
      if (saved) setPos(clampPos(saved));
    }
  }, [layerSize, clampPos, setPos]);

  /** 渲染位置：拖动实时值 > store 值 > 默认右上角 */
  const renderPos: ChatFloatPos =
    livePos ?? storePos ?? (layerSize ? { x: layerSize.w - winW - EDGE - 4, y: TOP_MIN + 10 } : { x: 0, y: 0 });

  // ---------------- 拖拽（标题条 / 胶囊共用；实时位置进 state，聊天子树 memo 跳过） ----------------
  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 控制按钮（X / — / □）不作为拖拽把手
    if ((e.target as HTMLElement).closest('button')) return;
    const layer = layerRef.current;
    const el = winRef.current;
    if (!layer || !el) return;
    const lr = layer.getBoundingClientRect();
    const wr = el.getBoundingClientRect();
    dragRef.current = { px: e.clientX, py: e.clientY, baseX: wr.left - lr.left, baseY: wr.top - lr.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      d.moved = true;
    }
    const layer = layerRef.current;
    const el = winRef.current;
    if (!layer || !el) return;
    const lr = layer.getBoundingClientRect();
    const wr = el.getBoundingClientRect();
    setLivePos({
      x: clampNum(d.baseX + dx, EDGE, lr.width - wr.width - EDGE),
      y: clampNum(d.baseY + dy, TOP_MIN, lr.height - wr.height - BOTTOM_MARGIN),
    });
    const inZone = e.clientY - lr.top > lr.height - CLOSE_ZONE;
    setCloseZone((prev) => (prev === inZone ? prev : inZone));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setCloseZone(false);
    if (!d) return;
    suppressClickRef.current = d.moved;
    if (!d.moved) return;
    const layer = layerRef.current;
    const el = winRef.current;
    if (!layer || !el) {
      setLivePos(null);
      return;
    }
    const lr = layer.getBoundingClientRect();
    // 底部热区松手 → 销毁小窗（需求三-3）
    if (e.clientY - lr.top > lr.height - CLOSE_ZONE) {
      setLivePos(null);
      close();
      return;
    }
    // 左右边缘吸附（需求三-2）：按窗口中心判定吸附方向，y 原地钳回
    const wr = el.getBoundingClientRect();
    const cur = { x: wr.left - lr.left, y: wr.top - lr.top };
    const p = {
      x: cur.x + wr.width / 2 < lr.width / 2 ? EDGE : lr.width - wr.width - EDGE,
      y: clampNum(cur.y, TOP_MIN, lr.height - wr.height - BOTTOM_MARGIN),
    };
    setLivePos(null);
    setPos(p);
    saveChatFloatPos(p);
  };

  // ---------------- 最大化（通知同款导航协议：切到微信并打开该会话） ----------------
  const maximize = useCallback(() => {
    if (!contactId) return;
    navigateToChatSession('wechat', contactId);
    useChatFloat.getState().close();
  }, [contactId]);

  // ---------------- ChatPage（float 变体；useMemo 冻结 props → 拖拽重渲染整棵跳过） ----------------
  const chatEl = useMemo(() => {
    if (!peer || !me || !contactId || !contacts) return null;
    return (
      <ChatPageMemo
        key={contactId}
        float
        me={me}
        peer={peer}
        contacts={contacts}
        ownerName={ownerNameOf(peer)}
        otherUnread={0}
        onBack={() => useChatFloat.getState().close()}
        onOpenFriendDetail={() => maximize()}
        onSaveRemark={async (v) => {
          try {
            await updateContact(contactId, { remarks: { wx: v || null } });
          } catch {
            /* 失败静默：全屏内有完整提示 */
          }
        }}
        onSaveVoiceId={async (vid) => {
          try {
            await updateContact(contactId, { voiceId: vid || null });
          } catch {
            /* 同上 */
          }
        }}
        onContactsChanged={async () => contacts}
        onSwitchChat={(c) => useChatFloat.getState().open(c.id)}
      />
    );
  }, [peer, me, contacts, ownerNameOf, contactId, maximize]);

  // ---------------- 渲染 ----------------
  if (!contactId) return null;
  const visible = !locked && !screenOff && !switcherOpen;

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-[58]"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
      data-testid="chat-float-layer"
      data-suppress-edge-gesture
    >
      {/* 底部「松手关闭」热区提示（拖动中且进入热区才出现） */}
      {dragging && closeZone && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 flex justify-center"
          style={{ bottom: 96 }}
          data-testid="chat-float-closezone"
        >
          <span className="flex items-center gap-1.5 rounded-full bg-black/78 px-3.5 py-1.5 text-[12.5px] font-medium text-white shadow-lg backdrop-blur-sm dark:bg-white/85 dark:text-black">
            <Trash2 className="h-[14px] w-[14px]" strokeWidth={2.2} />
            松手关闭小窗
          </span>
        </div>
      )}

      {minimized ? (
        /* ---------------- 最小化胶囊：头像 + 名字 + 未读/正在输入，点按恢复 ---------------- */
        <div
          ref={winRef}
          role="button"
          aria-label={`恢复与 ${peer?.name ?? 'TA'} 的聊天小窗`}
          data-testid="chat-float-capsule"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            restore();
          }}
          style={{ left: renderPos.x, top: renderPos.y, touchAction: 'none' }}
          className={`pointer-events-auto absolute flex h-[46px] max-w-[168px] items-center gap-2 rounded-full bg-white/80 py-1 pl-1.5 pr-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.28)] ring-1 ring-black/10 backdrop-blur-2xl select-none active:scale-[0.97] dark:bg-[#232326]/85 dark:ring-white/15 ${
            dragging ? 'transition-none' : 'transition-[left,top] duration-200 ease-out'
          }`}
        >
          <CapsuleAvatar peer={peer} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="max-w-[110px] truncate text-[12.5px] font-semibold text-black/85 dark:text-white/90">
              {peer?.name ?? '聊天'}
            </span>
            <CapsuleStatus contactId={contactId} />
          </span>
          <CapsuleUnread contactId={contactId} />
        </div>
      ) : (
        /* ---------------- 小窗本体：标题条（拖拽把手 + 三控）+ ChatPage（zoom 缩放） ---------------- */
        <div
          ref={winRef}
          data-testid="chat-float-win"
          style={{
            left: renderPos.x,
            top: renderPos.y,
            width: winW || undefined,
            height: winH || undefined,
          }}
          className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-[20px] bg-[#EDEDED] shadow-[0_18px_50px_rgba(0,0,0,0.35)] ring-1 ring-black/12 select-none dark:bg-[#111111] dark:ring-white/15 ${
            dragging ? 'transition-none' : 'transition-[left,top] duration-200 ease-out'
          }`}
        >
          {/* 标题条：关闭 / 最小化 / 最大化（需求一-4）+ 名字（拖拽把手） */}
          <div
            className="flex h-[34px] shrink-0 items-center gap-1 bg-white/72 pl-2.5 pr-1.5 backdrop-blur-xl dark:bg-[#1C1C1E]/78"
            data-testid="chat-float-header"
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
          >
            {peer ? (
              <CapsuleAvatar peer={peer} size={20} />
            ) : (
              <Loader2 className="h-[14px] w-[14px] animate-spin text-black/40 dark:text-white/40" />
            )}
            <span className="ml-0.5 min-w-0 flex-1 truncate text-[12.5px] font-semibold text-black/80 dark:text-white/85">
              {peer?.name ?? '加载中…'}
            </span>
            <button
              type="button"
              aria-label="最小化小窗"
              data-testid="chat-float-minimize"
              onClick={minimize}
              className="flex h-[24px] w-[24px] items-center justify-center rounded-full text-black/55 active:bg-black/10 dark:text-white/60 dark:active:bg-white/10"
            >
              <Minus className="h-[14px] w-[14px]" strokeWidth={2.4} />
            </button>
            <button
              type="button"
              aria-label="最大化（全屏打开聊天）"
              data-testid="chat-float-maximize"
              onClick={maximize}
              className="flex h-[24px] w-[24px] items-center justify-center rounded-full text-black/55 active:bg-black/10 dark:text-white/60 dark:active:bg-white/10"
            >
              <Maximize2 className="h-[13px] w-[13px]" strokeWidth={2.4} />
            </button>
            <button
              type="button"
              aria-label="关闭小窗"
              data-testid="chat-float-close"
              onClick={close}
              className="flex h-[24px] w-[24px] items-center justify-center rounded-full text-black/55 active:bg-black/10 dark:text-white/60 dark:active:bg-white/10"
            >
              <X className="h-[15px] w-[15px]" strokeWidth={2.4} />
            </button>
          </div>

          {/* 聊天主体：ChatPage（float 变体）——zoom 真实重排缩放适配窄窗。
              尺寸必须用显式像素（winW/ZOOM）：Chrome 对 zoom 元素的百分比按视觉单位解析
              （118% 视觉上就是 118%，zoom 无法抵消），百分比方案会把输入栏/加号面板裁出窗外；
              像素布局尺寸 × zoom 视觉缩放 = 刚好填满窗口。zoom 同时创建 containing block，
              fixed 弹层（红包/文字卡等模态）也收在小窗内 */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className="absolute left-0 top-0"
              style={{
                zoom: ZOOM,
                width: winW ? Math.round(winW / ZOOM) : undefined,
                height: winH ? Math.round((winH - HEADER_H) / ZOOM) : undefined,
              }}
            >
              {chatEl ?? (
                <div className="flex h-full w-full items-center justify-center bg-[#EDEDED] dark:bg-[#111111]">
                  <Loader2 className="h-6 w-6 animate-spin text-black/30 dark:text-white/30" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 胶囊/标题条头像：联系人头像或首字母回退（黑白色系） */
function CapsuleAvatar({ peer, size = 26 }: { peer: ContactRecord | null; size?: number }) {
  if (peer?.avatar) {
    return (
      <img
        src={peer.avatar}
        alt=""
        className="shrink-0 rounded-full object-cover ring-1 ring-black/8 dark:ring-white/12"
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  const name = peer?.name?.trim() ?? '';
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-black/8 font-semibold text-black/55 ring-1 ring-black/8 dark:bg-white/12 dark:text-white/70 dark:ring-white/12"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name ? name.slice(0, 1).toUpperCase() : <MessageCircle className="h-3 w-3" />}
    </span>
  );
}

/** 胶囊状态行：AI 正在回复 → 动态省略号；平时不显示（v73.4 应用户要求删除「小窗聊天」静态标签） */
function CapsuleStatus({ contactId }: { contactId: string }) {
  const stream = useChatStream(`wx:${contactId}`);
  if (stream?.status === 'streaming') {
    return (
      <span className="flex items-center gap-[3px] text-[10px] text-black/45 dark:text-white/50" data-testid="chat-float-capsule-typing">
        正在回复
        <span className="flex gap-[2px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-[3px] w-[3px] animate-bounce rounded-full bg-black/45 dark:bg-white/55"
              style={{ animationDelay: `${i * 140}ms` }}
            />
          ))}
        </span>
      </span>
    );
  }
  return null;
}

/** 胶囊未读角标：最小化期间 AI 回复累计（ChatPage 已卸载，角标恢复正常计数） */
function CapsuleUnread({ contactId }: { contactId: string }) {
  const unreads = useUnreadMap(wxUnreads);
  const n = unreads[contactId] ?? 0;
  if (n <= 0) return null;
  return (
    <span className="ml-auto flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-[#FA5151] px-1 text-[10px] font-bold text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}
