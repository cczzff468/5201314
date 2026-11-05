'use client';

/**
 * 全局悬浮工具（v72.3）：设置 › 悬浮工具 开关开启后，手机右下角出现可拖拽悬浮球
 * （iOS 辅助触控同款交互：黑白色磨砂玻璃球 + 同心圆环图标），点按弹出毛玻璃胶囊菜单：
 *
 * - 提示词查看器：选角色 → 打开即自动本地拼装（@/lib/ios/prompt-preview，
 *   与真实发送同一套库函数）下一轮完整 System Prompt + Context（人设/记忆/世界书/聊天记录），
 *   代码块展示。纯只读——不请求网络、不消耗 Token、不打断进行中的对话；
 *   v72.2 起「预览 Prompt」按钮移除，打开弹窗 / 切换角色即自动重拼，仅保留小刷新按钮；
 *   v72.3 起微信/QQ/信息 App 标签移除——渠道自动推导（resolvePreviewChannel：
 *   正在聊天的 App 优先，其次最近有消息的 App，兜底微信），打开时默认选中当前聊天角色；
 * - 快捷操作：API 预设一键切换（全局 apiConfig 立即生效）+ 世界书一键挂载到当前聊天
 *   （getActiveProactiveChats 探测正打开的会话；下次发送即生效）。
 *
 * 层级 z-[56]：高于 App 窗口（z-40）与迷你播放器（z-55），低于多任务切换器（z-60）/
 * 锁屏（z-65）——锁定/熄屏/多任务时隐藏。data-suppress-edge-gesture：防止拖球触发
 * 底部边缘多任务手势（PhoneShell L281 起手跳过带此标记的元素）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Check, ChevronDown, Code2, Copy, Eye, Loader2, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { useSettings, useUI } from '@/lib/ios/store';
import { buildChatPreview, listPreviewContacts, resolvePreviewChannel, type PreviewResult } from '@/lib/ios/prompt-preview';
import { getActiveProactiveChats } from '@/lib/ios/proactive-msg';
import { loadBooks, saveBooks, getBoundBookIds, setBoundBookIds, type WorldBook } from '@/lib/ios/worldbook';
import { listContacts } from '@/lib/ios/contacts-store';
import type { ContactRecord } from '@/lib/contacts';
import { getProactiveCfg } from '@/lib/ios/proactive-msg';
import { loadMeet } from '@/lib/offline-meet';
import type { ApiConfig, ApiPreset } from '@/lib/ios/store';

// ---------------- 常量 ----------------

/** 内置 API 预设（与 settings.tsx ApiPage 同一份清单；点击只换 baseUrl+model，保留已填的 Key） */
const BUILTIN_API_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
];

/** 悬浮球位置持久化（相对右下锚点的 x/y 偏移；localStorage） */
const BALL_POS_KEY = 'assist-ball-pos';

/** 球尺寸与右下偏移（与 className 同步：h/w-52 + right-14 / bottom-104） */
const BALL_SIZE = 52;
const BALL_RIGHT = 14;
const BALL_BOTTOM = 104;

/** 把悬浮球偏移钳回层内（球完全保持在手机框内，与 dragConstraints 同一约束盒） */
function clampBallPos(x: number, y: number, layerW: number, layerH: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, -(layerW - BALL_RIGHT - BALL_SIZE)), BALL_RIGHT),
    y: Math.min(Math.max(y, -(layerH - BALL_BOTTOM - BALL_SIZE)), BALL_BOTTOM),
  };
}

/** 当前 apiConfig 是否就是某份预设配置（baseUrl+model+key 三者一致才算「当前选中」） */
function sameConfig(a: ApiConfig, b: Partial<ApiConfig>): boolean {
  return a.baseUrl.trim() === (b.baseUrl ?? '').trim() && a.model.trim() === (b.model ?? '').trim() && a.apiKey === (b.apiKey ?? '');
}

// ---------------- 毛玻璃样式片段 ----------------

/** 弹窗主体：白色磨砂玻璃大圆角面板（浅色 72% 白 + 2xl 背景 blur + 白色描边） */
const GLASS_SHEET =
  'bg-white/72 backdrop-blur-2xl ring-1 ring-white/65 shadow-[0_-12px_56px_rgba(0,0,0,0.24)] dark:bg-[#1C1C1E]/82 dark:ring-white/10';
/** 弹窗内小容器（列表/代码块外框）：更透的白 + 细白描边 */
const GLASS_GROUP =
  'bg-white/50 backdrop-blur-xl ring-1 ring-white/60 dark:bg-white/[0.06] dark:ring-white/[0.09]';
/** 胶囊小按钮（复制/刷新等）：磨砂白胶囊 */
const GLASS_PILL_BTN =
  'bg-white/55 ring-1 ring-white/60 backdrop-blur-xl active:bg-white/80 dark:bg-white/10 dark:ring-white/10 dark:active:bg-white/20';
/** 代码块：深色玻璃终端风（磨砂深底 + 微白描边 + 浅色等宽字） */
const GLASS_CODE =
  'bg-[#10151C]/92 backdrop-blur-xl ring-1 ring-white/10 text-white/88';

// ---------------- 底部弹窗外壳 ----------------

function SheetShell({
  title,
  subtitle,
  icon,
  onClose,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <motion.div
      // 关键：外层 layer 是 pointer-events-none，这里必须显式恢复，否则整个弹窗点击穿透
      className="pointer-events-auto absolute inset-0 z-[90] flex flex-col justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      data-testid={testId}
    >
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[3px]" onClick={onClose} />
      <motion.div
        initial={{ y: 60, opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        className={`relative mx-2 mb-2 flex max-h-[76%] flex-col overflow-hidden rounded-[30px] ${GLASS_SHEET}`}
      >
        {/* iOS 抓手条 */}
        <span aria-hidden className="mx-auto mt-2 block h-[5px] w-9 shrink-0 rounded-full bg-black/[0.12] dark:bg-white/20" />
        {/* 标题栏（黑白风图标圆片：浅色模式黑底白图标，深色模式白底黑图标） */}
        <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-2">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-800 to-black text-white shadow-[0_4px_12px_rgba(0,0,0,0.32)] ring-2 ring-white/55 dark:from-white dark:to-neutral-300 dark:text-neutral-900 dark:ring-white/20" aria-hidden>
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16.5px] font-bold leading-tight text-foreground">{title}</span>
            {subtitle ? <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">{subtitle}</span> : null}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors ${GLASS_PILL_BTN}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}

// ---------------- 弹窗一：提示词查看器 ----------------

function PromptViewerSheet({ onClose }: { onClose: () => void }) {
  const [contacts, setContacts] = useState<ContactRecord[] | null>(null);
  const [contactId, setContactId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  // 拼装状态机：key 标记「这份数据属于哪次请求」（App|角色|刷新轮次），
  // 所有 setState 都在 Promise 回调里——effect 体内不同步 setState，避免级联渲染；
  // key 不匹配时渲染期直接派生为 loading（旧结果立刻隐藏，无闪现）
  const [state, setState] = useState<{ key: string; loading: boolean; error: string; result: PreviewResult | null }>({
    key: '',
    loading: false,
    error: '',
    result: null,
  });
  const [copied, setCopied] = useState(false);

  // 追发 / 线下 开关状态（同步 kv 读，随角色/App 变化重算——渲染期直接派生，不用 effect）
  const flags = (() => {
    if (!contactId) return { anxietyOn: false, offlineOn: false };
    try {
      return {
        anxietyOn: getProactiveCfg(channel, contactId).anxietyOn !== false,
        offlineOn: !!loadMeet(contactId),
      };
    } catch {
      return { anxietyOn: false, offlineOn: false };
    }
  })();

  // v72.3：App 标签移除——渠道渲染期自动推导（正在聊天的 App 优先，
  // 其次最近有消息的 App，兜底微信；同步内存读，无副作用），统计行里以小胶囊展示结果
  const channel = contactId ? resolvePreviewChannel(contactId) : 'wx';

  useEffect(() => {
    let alive = true;
    void listPreviewContacts()
      .then((list) => {
        if (!alive) return;
        setContacts(list);
        if (list.length > 0) {
          // 默认选中当前正打开的聊天角色（没打开聊天则第一个）
          const act = getActiveProactiveChats();
          const preferred = act.length > 0 && list.some((c) => c.id === act[act.length - 1].cid) ? act[act.length - 1].cid : '';
          setContactId((cur) => (cur && list.some((c) => c.id === cur) ? cur : preferred || list[0].id));
        }
      })
      .catch(() => alive && setContacts([]));
    return () => {
      alive = false;
    };
  }, []);

  // v72.2：打开弹窗 / 切角色即自动拼装（原「预览 Prompt」大按钮已删除）。
  // 快速连续切换时旧拼装结果丢弃（key 不匹配 / alive 已置 false），只保留最后一次。
  const curKey = `${channel}|${contactId}|${reloadKey}`;
  useEffect(() => {
    if (!contactId) return;
    let alive = true;
    const key = `${channel}|${contactId}|${reloadKey}`;
    const p = buildChatPreview(channel, contactId);
    // 置 loading 放微任务（不在 effect 体内同步 setState）
    void Promise.resolve().then(() => {
      if (!alive) return;
      setState((s) => (s.key === key ? s : { key, loading: true, error: '', result: null }));
    });
    p.then((r) => {
      if (alive) setState({ key, loading: false, error: '', result: r });
    }).catch((e: unknown) => {
      if (alive) setState({ key, loading: false, error: e instanceof Error ? e.message : '拼装失败', result: null });
    });
    return () => {
      alive = false;
    };
  }, [channel, contactId, reloadKey]);

  // 派生：key 还是旧的（刚切换、拼装还没开始/没回来）= 视为 loading，旧结果立刻隐藏
  const fresh = state.key === curKey;
  const loading = contactId ? !fresh || state.loading : false;
  const error = fresh ? state.error : '';
  const result = fresh ? state.result : null;

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const copySystem = useCallback(() => {
    if (!result) return;
    void navigator.clipboard?.writeText(result.systemFull).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [result]);

  return (
    <SheetShell
      title="提示词查看器"
      subtitle="只读预览 · 不消耗 Token"
      icon={<Eye className="h-[18px] w-[18px]" strokeWidth={2.2} />}
      onClose={onClose}
      testId="assist-viewer-sheet"
    >
      {/* 角色选择 + 追发/线下状态胶囊（v72.3：App 标签已移除，渠道自动跟随当前聊天/最近消息） */}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[128px] flex-1">
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            disabled={!contacts || contacts.length === 0}
            aria-label="选择角色"
            className={`h-10 w-full appearance-none rounded-full border-0 pl-4 pr-9 text-[13px] font-medium text-foreground focus-visible:ring-2 focus-visible:ring-foreground/35 ${GLASS_GROUP}`}
            data-testid="assist-viewer-contact"
          >
            {contacts == null && <option value="">加载角色…</option>}
            {contacts != null && contacts.length === 0 && <option value="">暂无角色联系人</option>}
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.kind === 'npc' ? '（配角）' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        </div>
        {/* v72.4 黑白化：状态胶囊 ON = 黑底白字（深色模式反白），不再用绿/珊瑚色底 */}
        <span className={`rounded-full px-3 py-[6px] text-[11px] font-semibold ring-1 backdrop-blur-xl ${flags.anxietyOn ? 'bg-neutral-900 text-white ring-black/20 dark:bg-white dark:text-neutral-900 dark:ring-white/25' : `${GLASS_PILL_BTN} text-muted-foreground`}`}>
          追发 {flags.anxietyOn ? 'ON' : 'OFF'}
        </span>
        <span className={`rounded-full px-3 py-[6px] text-[11px] font-semibold ring-1 backdrop-blur-xl ${flags.offlineOn ? 'bg-neutral-900 text-white ring-black/20 dark:bg-white dark:text-neutral-900 dark:ring-white/25' : `${GLASS_PILL_BTN} text-muted-foreground`}`}>
          线下 {flags.offlineOn ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* 拼装中 */}
      {loading && !result ? (
        <div className="mt-10 mb-6 flex flex-col items-center gap-2.5 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-500 dark:text-white/75" />
          <p className="text-[13px] font-medium">正在本地拼装 Prompt…</p>
          <p className="text-[11px]">角色人设 · 记忆 · 世界书 · 聊天记录</p>
        </div>
      ) : null}

      {/* 无角色 */}
      {contacts != null && contacts.length === 0 && !loading ? (
        <p className="mt-8 text-center text-[12.5px] leading-relaxed text-muted-foreground">
          暂无角色联系人——先在通讯录里创建一个角色
        </p>
      ) : null}

      {/* 结果区（自动拼装完成即展示） */}
      {error ? (
        <p className={`mt-3 rounded-full px-4 py-2.5 text-center text-[12.5px] font-medium text-red-500 ring-1 ring-red-400/25 backdrop-blur-xl ${GLASS_GROUP}`}>拼装失败：{error}</p>
      ) : null}
      {result ? (
        <div className="mt-3.5">
          {/* 统计行（含自动识别的 App 渠道胶囊）+ 刷新/复制小胶囊按钮 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5 text-[11px] text-muted-foreground">
            <span className={`rounded-full px-2.5 py-[3px] text-[10.5px] font-semibold text-foreground/75 ${GLASS_GROUP}`} data-testid="assist-viewer-channel">
              {result.channelLabel}
            </span>
            <span className="font-semibold text-foreground/85">{result.contactName}</span>
            <span>{result.messages.length} 条消息</span>
            <span>约 {Math.round(result.systemFull.length / 2)} tokens（估）</span>
            <span className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                aria-label="重新拼装"
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-foreground/75 disabled:opacity-50 ${GLASS_PILL_BTN}`}
                data-testid="assist-viewer-refresh"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                重新拼装
              </button>
              <button type="button" onClick={copySystem} className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-foreground/75 ${GLASS_PILL_BTN}`}>
                {copied ? <Check className="h-3 w-3 text-foreground" /> : <Copy className="h-3 w-3" />}
                {copied ? '已复制' : '复制 System'}
              </button>
            </span>
          </div>
          {/* 注入块统计（记忆/世界书有没有注入成功一目了然） */}
          {result.sections.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.sections.map((s) => (
                <span key={s.key} className={`rounded-full px-2.5 py-[4px] text-[10.5px] text-foreground/70 dark:text-white/70 ${GLASS_GROUP}`}>
                  {s.label} · {s.chars} 字
                </span>
              ))}
            </div>
          ) : null}

          {/* System Prompt（深色玻璃终端风代码块） */}
          <p className="mt-3.5 mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-muted-foreground">
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-neutral-500 dark:bg-white/60" aria-hidden />
            SYSTEM PROMPT
          </p>
          <pre className={`thin-scrollbar max-h-72 overflow-y-auto overscroll-contain rounded-[18px] px-3.5 py-3 font-mono text-[10.5px] leading-[1.65] break-words whitespace-pre-wrap ${GLASS_CODE}`} data-testid="assist-viewer-system">
            {result.systemFull}
          </pre>

          {/* Context 消息 */}
          <p className="mt-3.5 mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-muted-foreground">
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-neutral-500 dark:bg-white/60" aria-hidden />
            CONTEXT（最近对话）
          </p>
          <div className="flex flex-col gap-2">
            {result.messages.slice(1).map((m, i) => (
              <div key={i}>
                <p className={`mb-1 ml-1 text-[10px] font-bold ${m.role === 'user' ? 'text-foreground/85' : 'text-foreground/55'}`}>
                  {m.role === 'user' ? 'user（机主）' : 'assistant（TA）'}
                </p>
                <pre className={`thin-scrollbar max-h-40 overflow-y-auto overscroll-contain rounded-[16px] px-3.5 py-2.5 font-mono text-[10.5px] leading-[1.6] break-words whitespace-pre-wrap ${GLASS_CODE}`}>
                  {m.content}
                </pre>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-[16px] px-3.5 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground/80 dark:text-white/55" style={{ background: 'rgba(127,127,127,0.07)' }}>
            与真实发送同一套拼装函数（人设 → 记忆 → 世界书 → 动态块 → 历史）；App 自动跟随当前聊天（没打开聊天时取最近有消息的 App）。预览没有「本轮新消息」，记忆/世界书按最近历史扫描。待处理红包/转账动作规则按本轮卡片状态注入，预览中省略。
          </p>
        </div>
      ) : null}
    </SheetShell>
  );
}

// ---------------- 弹窗二：快捷操作 ----------------

/** 列表行（API / 世界书共用）：毛玻璃胶囊行，v72.4 黑白化——当前选中 = 中性深色对勾（无彩色） */
function QuickRow({ label, value, active, onClick, testId }: { label: string; value?: string; active: boolean; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex min-h-[46px] w-full items-center gap-2.5 rounded-full px-3.5 py-2 text-left transition-all ${
        active
          ? 'bg-black/[0.07] ring-1 ring-black/[0.10] dark:bg-white/[0.10] dark:ring-white/[0.14]'
          : 'active:bg-black/[0.05] dark:active:bg-white/[0.07]'
      }`}
    >
      <span className="min-w-0 flex-1 text-foreground">
        <span className="block truncate text-[14px] font-semibold leading-tight">{label}</span>
        {value ? <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">{value}</span> : null}
      </span>
      {active ? (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-neutral-900 shadow-[0_2px_8px_rgba(0,0,0,0.35)] dark:bg-white dark:shadow-[0_2px_8px_rgba(255,255,255,0.25)]">
          <Check className="h-[13px] w-[13px] text-white dark:text-neutral-900" strokeWidth={3} />
        </span>
      ) : (
        <span className="w-[22px]" />
      )}
    </button>
  );
}

function QuickOpsSheet({ onClose }: { onClose: () => void }) {
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiPresets = useSettings((s) => s.apiPresets);
  const updateApiConfig = useSettings((s) => s.updateApiConfig);

  // 书单/当前聊天都是同步 kv 读：懒初始化，不用 effect（打开弹窗时给首帧，无级联渲染）
  const [books, setBooks] = useState<WorldBook[] | null>(() => loadBooks());
  const [activeChat, setActiveChat] = useState<{ app: 'wx' | 'qq' | 'sms'; cid: string; name: string } | null>(() => {
    const act = getActiveProactiveChats();
    return act.length > 0 ? { app: act[act.length - 1].app, cid: act[act.length - 1].cid, name: act[act.length - 1].cid } : null;
  });
  const [boundIds, setBoundIds] = useState<string[]>(() => {
    const act = getActiveProactiveChats();
    return act.length > 0 ? getBoundBookIds(act[act.length - 1].cid) : [];
  });
  const [hint, setHint] = useState('');

  // 当前聊天角色名（异步补齐）
  useEffect(() => {
    if (!activeChat) return;
    let alive = true;
    void listContacts().then((all) => {
      if (!alive) return;
      const hit = all.find((c) => c.id === activeChat.cid);
      if (hit) setActiveChat((cur) => (cur && cur.cid === hit.id ? { ...cur, name: hit.name } : cur));
    });
    return () => {
      alive = false;
    };
  }, [activeChat?.cid]);

  /** 当前 apiConfig 是否匹配内置预设（baseUrl+model；Key 保留用户已填值，故不比对 key） */
  const builtinActive = (p: (typeof BUILTIN_API_PRESETS)[number]): boolean =>
    apiConfig.baseUrl.trim() === p.baseUrl && apiConfig.model.trim() === p.model;
  const userPresetActive = (p: ApiPreset): boolean => sameConfig(apiConfig, p.config);
  const anyPresetActive =
    BUILTIN_API_PRESETS.some(builtinActive) || apiPresets.some(userPresetActive);

  /** 世界书是否对当前聊天生效（局部/专属 = 已挂载且启用；全局 = 启用） */
  const bookActiveForChat = (b: WorldBook): boolean => {
    if (b.scope === 'global') return b.enabled;
    return activeChat != null && b.enabled && boundIds.includes(b.id);
  };

  const toggleBook = (b: WorldBook) => {
    if (!books) return;
    if (!activeChat) {
      setHint('先打开一个聊天（微信/QQ/信息），再点世界书即可应用到该聊天');
      window.setTimeout(() => setHint(''), 2600);
      return;
    }
    if (b.scope === 'global') {
      // 全局书：切换的是总开关（对所有聊天生效）
      const next = books.map((x) => (x.id === b.id ? { ...x, enabled: !x.enabled } : x));
      saveBooks(next);
      setBooks(next);
      setHint(b.enabled ? `已停用全局世界书「${b.name}」` : `已启用全局世界书「${b.name}」`);
    } else {
      // 局部/专属书：挂载到当前聊天（再点 = 取消挂载）
      const next = boundIds.includes(b.id) ? boundIds.filter((x) => x !== b.id) : [...boundIds, b.id];
      setBoundBookIds(activeChat.cid, next);
      setBoundIds(next);
      setHint(boundIds.includes(b.id) ? `已从当前聊天移除「${b.name}」` : `「${b.name}」已应用到当前聊天，下次发送即生效`);
    }
    window.setTimeout(() => setHint(''), 2600);
  };

  const clearBindings = () => {
    if (!activeChat) return;
    setBoundBookIds(activeChat.cid, []);
    setBoundIds([]);
    setHint('已清空当前聊天的世界书挂载');
    window.setTimeout(() => setHint(''), 2600);
  };

  const Row = QuickRow;

  return (
    <SheetShell
      title="快捷操作"
      subtitle="全局默认"
      icon={<SlidersHorizontal className="h-[17px] w-[17px]" strokeWidth={2.2} />}
      onClose={onClose}
      testId="assist-quickops-sheet"
    >
      {/* ---- API 区块 ---- */}
      <div className="flex items-center gap-2 px-1 pb-1.5 pt-0.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-neutral-800 to-black text-white shadow-[0_2px_8px_rgba(0,0,0,0.30)] dark:from-white dark:to-neutral-300 dark:text-neutral-900" aria-hidden>
          <Code2 className="h-3.5 w-3.5" strokeWidth={2.4} />
        </span>
        <span className="text-[13.5px] font-bold text-foreground">API</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground">{apiConfig.baseUrl ? apiConfig.model || apiConfig.baseUrl : '未设置'}</span>
      </div>
      <div className={`rounded-[24px] p-1.5 ${GLASS_GROUP}`} >
        {!anyPresetActive ? (
          <Row
            label="当前自定义配置"
            value={`${apiConfig.baseUrl || '未设置地址'} · ${apiConfig.model || '未设置模型'}`}
            active
            testId="assist-api-custom"
            onClick={() => {
              useUI.getState().setPendingSettingsPage('api');
              useUI.getState().switchToApp('settings');
            }}
          />
        ) : null}
        {BUILTIN_API_PRESETS.map((p) => (
          <Row
            key={p.name}
            label={p.name}
            value={p.model}
            active={builtinActive(p)}
            testId={`assist-api-builtin-${p.name}`}
            onClick={() => updateApiConfig({ baseUrl: p.baseUrl, model: p.model })}
          />
        ))}
        {apiPresets.map((p) => (
          <Row
            key={p.id}
            label={p.name}
            value={`${p.config.model} · ${p.config.baseUrl.includes('openai.com') ? 'OpenAI 兼容' : '自定义地址'}`}
            active={userPresetActive(p)}
            testId={`assist-api-preset-${p.id}`}
            onClick={() => updateApiConfig(p.config)}
          />
        ))}
      </div>
      <p className="mt-1.5 px-2 text-[10.5px] leading-relaxed text-muted-foreground/70">
        点击立即切换全局模型（保留已填的 Key；自定义 Key 在 设置 › 开发者 › API 配置 里填）。切换后下一次发送即生效。
      </p>

      {/* ---- 世界书区块 ---- */}
      <div className="mt-4 flex items-center gap-2 px-1 pb-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-neutral-700 to-neutral-900 text-white shadow-[0_2px_8px_rgba(0,0,0,0.30)] dark:from-white dark:to-neutral-300 dark:text-neutral-900" aria-hidden>
          <BookOpen className="h-3.5 w-3.5" strokeWidth={2.4} />
        </span>
        <span className="text-[13.5px] font-bold text-foreground">世界书</span>
        {activeChat ? (
          <span className="ml-auto flex min-w-0 items-center gap-2">
            <span className="truncate text-[11px] text-muted-foreground">
              当前聊天：{activeChat.app === 'wx' ? '微信' : activeChat.app === 'qq' ? 'QQ' : '信息'} · {activeChat.name}
            </span>
            <button type="button" onClick={clearBindings} className="shrink-0 rounded-full bg-black/[0.06] px-2.5 py-[3px] text-[11px] font-semibold text-foreground/75 ring-1 ring-black/[0.08] dark:bg-white/10 dark:text-white/80 dark:ring-white/[0.12]">
              清空
            </button>
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-muted-foreground">未打开聊天</span>
        )}
      </div>
      <div className={`rounded-[24px] p-1.5 ${GLASS_GROUP}`} data-testid="assist-wb-list">
        {books == null ? (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">正在读取…</p>
        ) : books.length === 0 ? (
          <p className="px-4 py-4 text-center text-[12.5px] text-muted-foreground">暂无世界书</p>
        ) : (
          books.map((b) => (
            <Row
              key={b.id}
              label={b.name}
              value={`${b.entries.length} 条 · ${b.scope === 'global' ? '全局' : b.scope === 'exclusive' ? '专属' : '挂载'}${b.enabled ? '' : ' · 已停用'}`}
              active={bookActiveForChat(b)}
              testId={`assist-wb-${b.id}`}
              onClick={() => toggleBook(b)}
            />
          ))
        )}
      </div>
      <p className="mt-1.5 px-2 text-[10.5px] leading-relaxed text-muted-foreground/70">
        {activeChat
          ? '点击世界书挂载到当前聊天（再点移除），下次发送即生效；全局书点击 = 启用/停用。'
          : '先在微信/QQ/信息里打开一个聊天，这里就能一键把世界书挂上去。'}
      </p>
      {hint ? (
        <p className={`mt-2.5 rounded-full px-4 py-2.5 text-center text-[12px] font-medium text-foreground/85 ring-1 ring-black/[0.08] backdrop-blur-xl dark:text-white/85 dark:ring-white/[0.12]`} style={{ background: 'rgba(127,127,127,0.1)' }} data-testid="assist-quickops-hint">
          {hint}
        </p>
      ) : null}
    </SheetShell>
  );
}

// ---------------- 悬浮球 + 菜单 ----------------

type ToolKind = 'viewer' | 'quickops';

/** 菜单几何（用于贴球弹出 + 边缘翻转） */
const MENU_W = 186;
const MENU_H = 120;

/** 菜单位置：相对 layer 的左偏移 + 上/下锚（二选一；跟随球被拖后的实际位置） */
interface MenuPos {
  left: number;
  bottom?: number;
  top?: number;
}

export default function AssistiveTools() {
  const viewerOn = useSettings((s) => s.assistViewer);
  const quickOpsOn = useSettings((s) => s.assistQuickOps);
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const switcherOpen = useUI((s) => s.switcherOpen);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const ballRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [sheet, setSheet] = useState<ToolKind | null>(null);
  // 拖拽位置（相对右下锚点的偏移；与 MusicGlobalMini 唱片同款模式）——
  // localStorage 恢复放懒初始化（组件 dynamic ssr:false，window 必然可用），无 effect
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = window.localStorage.getItem(BALL_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x?: number; y?: number };
        if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y };
      }
    } catch {
      /* 坏数据回默认位置 */
    }
    return null;
  });
  const dragMovedRef = useRef(false);

  // v72.3 一次性自愈：老版本（v72.2 及之前）存过越界偏移会让球停在手机框外
  // （被框体裁剪到不可见/点不到）——挂载后按层尺寸拉回框内并回写存储。
  // 拖拽落点已在上锁钳位，这里对正常 pos 是无操作，不会循环
  useEffect(() => {
    if (!pos) return;
    const lr = layerRef.current?.getBoundingClientRect();
    if (!lr || lr.width === 0 || lr.height === 0) return;
    const p = clampBallPos(pos.x, pos.y, lr.width, lr.height);
    if (p.x !== pos.x || p.y !== pos.y) {
      setPos(p);
      try {
        window.localStorage.setItem(BALL_POS_KEY, JSON.stringify(p));
      } catch {
        /* 存储不可用仅本次会话生效 */
      }
    }
  }, [pos]);

  const enabled = viewerOn || quickOpsOn;
  const visible = enabled && !locked && !screenOff && !switcherOpen;

  // 弹窗打开时收起菜单（在 openTool 里同步处理，不用 effect）；工具全关时弹窗派生为关闭
  const activeSheet = enabled ? sheet : null;

  const openTool = (k: ToolKind) => {
    setMenuOpen(false);
    setSheet(k);
  };

  /** 点按悬浮球：开菜单时按球的当前实际位置（含拖拽 transform）计算弹出点——
   *  默认菜单在球右上方（右缘对齐球心+34，底部距球顶 10px）；球被拖到顶部时翻到球下方，
   *  拖到左缘时钳在层内——菜单永远贴球且不出屏 */
  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const layer = layerRef.current;
    const ball = ballRef.current;
    if (layer && ball) {
      const lr = layer.getBoundingClientRect();
      const br = ball.getBoundingClientRect();
      const relLeft = br.left - lr.left;
      const relTop = br.top - lr.top;
      const left = Math.min(Math.max(relLeft + br.width / 2 + 34 - MENU_W, 10), Math.max(lr.width - MENU_W - 10, 10));
      const above = relTop > MENU_H + 30;
      setMenuPos(above ? { left, bottom: lr.height - relTop + 10 } : { left, top: relTop + br.height + 10 });
    }
    setMenuOpen(true);
  };

  // 不用延迟卸载模式（MusicGlobalMini 的 350ms 接 click）：点悬浮球/菜单/弹窗都不会让本层卸载
  // （菜单和弹窗都在层内），层只在锁定/熄屏/多任务/全关时隐藏——那些路径都不是本层自身点击触发，
  // 无点击穿透风险；隐藏用 CSS visibility（连同子元素的 pointer-events 一起失效，比 opacity 安全）
  if (!enabled) return null;

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-[56]"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
      data-testid="assist-tools-layer"
      data-suppress-edge-gesture
    >
      {/* 菜单打开时的透明背板：点菜单外任意处收起菜单（iOS 辅助触控同款消费型关闭） */}
      {menuOpen ? (
        <button
          type="button"
          aria-label="收起菜单"
          className="pointer-events-auto absolute inset-0 cursor-default"
          onClick={() => setMenuOpen(false)}
          data-testid="assist-menu-backdrop"
        />
      ) : null}

      {/* 悬浮球（v72.3 黑白色风格）：浅色模式 = 磨砂白玻璃球 + 炭黑同心圆环，
          深色模式 = 磨砂黑玻璃球 + 纯白圆环——iOS 辅助触控同款单色质感，中性阴影 */}
      <motion.button
        type="button"
        aria-label="悬浮工具"
        drag
        dragConstraints={layerRef}
        dragElastic={0.12}
        dragMomentum={false}
        whileTap={{ scale: 0.92 }}
        onPointerDown={() => {
          dragMovedRef.current = false;
        }}
        onPointerUp={() => {
          // 没怎么移动的松手 = 点按（拖动交给 framer-motion；位移阈值内视为 tap）
          if (!dragMovedRef.current) toggleMenu();
        }}
        onDrag={(_e, info) => {
          if (Math.abs(info.offset.x) > 6 || Math.abs(info.offset.y) > 6) {
            dragMovedRef.current = true;
            setMenuOpen(false);
          }
        }}
        onDragEnd={(_e, info) => {
          // v72.3 修复：不能用 info.offset 直接当位置（只是本次手势的位移，会丢掉
          // 拖前的历史偏移，松手后球会瞬移）——累加到上次保存的位置，再钳回层内
          // （与 dragConstraints 同一约束盒，弹性越界也一并修正），松手原地定格无跳变
          const lr = layerRef.current?.getBoundingClientRect();
          const base = pos ?? { x: 0, y: 0 };
          const raw = { x: base.x + info.offset.x, y: base.y + info.offset.y };
          const p = lr && lr.width > 0 ? clampBallPos(raw.x, raw.y, lr.width, lr.height) : raw;
          setPos(p);
          try {
            window.localStorage.setItem(BALL_POS_KEY, JSON.stringify(p));
          } catch {
            /* 存储不可用仅本次会话生效 */
          }
        }}
        animate={pos ? { x: pos.x, y: pos.y } : undefined}
        transition={{ duration: 0.16 }}
        className="pointer-events-auto absolute bottom-[104px] right-[14px] flex h-[52px] w-[52px] touch-none select-none items-center justify-center rounded-full bg-gradient-to-b from-white/95 to-white/70 shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.95),0_10px_26px_rgba(0,0,0,0.30)] ring-1 ring-black/[0.10] backdrop-blur-xl dark:from-[#2C2C2E]/92 dark:to-[#161618]/88 dark:shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.18),0_10px_26px_rgba(0,0,0,0.55)] dark:ring-white/[0.18]"
        data-testid="assist-ball"
        ref={ballRef}
      >
        {/* 玻璃高光（上半月牙） */}
        <span aria-hidden className="pointer-events-none absolute inset-[3px] rounded-full bg-gradient-to-b from-white/75 via-white/10 to-transparent dark:from-white/[0.16] dark:via-white/[0.02]" />
        {/* 同心圆环 + 中心亮点（黑白色：白球黑环 / 黑球白环） */}
        <span aria-hidden className="relative flex h-[26px] w-[26px] items-center justify-center rounded-full border-[2.5px] border-neutral-800 dark:border-white/95">
          <span className="h-[9px] w-[9px] rounded-full bg-neutral-900 shadow-[0_0_8px_rgba(0,0,0,0.35)] dark:bg-white dark:shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
        </span>
      </motion.button>

      {/* 工具菜单（贴着球当前位置弹出：毛玻璃胶囊 + 渐变图标圆片；menuPos 在开菜单时算好） */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 480, damping: 32 }}
            style={menuPos ? { left: menuPos.left, ...(menuPos.bottom != null ? { bottom: menuPos.bottom } : { top: menuPos.top ?? 10 }) } : { right: 12, bottom: 170 }}
            className="pointer-events-auto absolute flex w-[186px] flex-col gap-1 rounded-[27px] bg-white/62 p-1.5 shadow-[0_14px_44px_rgba(0,0,0,0.22)] ring-1 ring-white/65 backdrop-blur-2xl dark:bg-[#2C2C2E]/72 dark:ring-white/12"
            data-testid="assist-menu"
          >
            {viewerOn ? (
              <button
                type="button"
                onClick={() => openTool('viewer')}
                className="flex w-full items-center gap-2.5 rounded-full px-2 py-2 text-left transition-colors active:bg-black/[0.06] dark:active:bg-white/[0.08]"
                data-testid="assist-menu-viewer"
              >
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-800 to-black text-white shadow-[0_3px_10px_rgba(0,0,0,0.32)] ring-2 ring-white/60 dark:from-white dark:to-neutral-300 dark:text-neutral-900 dark:ring-white/25" aria-hidden>
                  <Eye className="h-[17px] w-[17px]" strokeWidth={2.3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold leading-tight text-foreground">提示词查看器</span>
                  <span className="block text-[10.5px] leading-tight text-muted-foreground">下一轮完整 Prompt</span>
                </span>
              </button>
            ) : null}
            {quickOpsOn ? (
              <button
                type="button"
                onClick={() => openTool('quickops')}
                className="flex w-full items-center gap-2.5 rounded-full px-2 py-2 text-left transition-colors active:bg-black/[0.06] dark:active:bg-white/[0.08]"
                data-testid="assist-menu-quickops"
              >
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-700 to-neutral-900 text-white shadow-[0_3px_10px_rgba(0,0,0,0.32)] ring-2 ring-white/60 dark:from-white dark:to-neutral-300 dark:text-neutral-900 dark:ring-white/25" aria-hidden>
                  <SlidersHorizontal className="h-[17px] w-[17px]" strokeWidth={2.3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold leading-tight text-foreground">快捷操作</span>
                  <span className="block text-[10.5px] leading-tight text-muted-foreground">切换 API · 世界书</span>
                </span>
              </button>
            ) : null}
            {!viewerOn && !quickOpsOn ? (
              <p className="px-3.5 py-3 text-[12px] text-muted-foreground">在 设置 › 悬浮工具 里开启</p>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 两个工具弹窗 */}
      <AnimatePresence>
        {activeSheet === 'viewer' ? <PromptViewerSheet key="viewer" onClose={() => setSheet(null)} /> : null}
        {activeSheet === 'quickops' ? <QuickOpsSheet key="quickops" onClose={() => setSheet(null)} /> : null}
      </AnimatePresence>
    </div>
  );
}
