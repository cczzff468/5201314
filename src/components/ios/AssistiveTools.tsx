'use client';

/**
 * 全局悬浮工具（v72）：设置 › 悬浮工具 开关开启后，手机右下角出现可拖拽悬浮球
 * （iOS 辅助触控同款交互），点按弹出工具菜单：
 *
 * - 提示词查看器：选 App（微信/QQ/信息）+ 角色 → 「预览 Prompt」→ 本地拼装
 *   （@/lib/ios/prompt-preview，与真实发送同一套库函数）下一轮完整 System Prompt +
 *   Context（人设/记忆/世界书/聊天记录），代码块展示。纯只读——不请求网络、
 *   不消耗 Token、不打断进行中的对话；
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
import { buildChatPreview, listPreviewContacts, CHANNEL_LABELS, type PreviewChannel, type PreviewResult } from '@/lib/ios/prompt-preview';
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

const CHANNELS: PreviewChannel[] = ['wx', 'qq', 'sms'];

/** 悬浮球位置持久化（相对右下锚点的 x/y 偏移；localStorage） */
const BALL_POS_KEY = 'assist-ball-pos';

/** 当前 apiConfig 是否就是某份预设配置（baseUrl+model+key 三者一致才算「当前选中」） */
function sameConfig(a: ApiConfig, b: Partial<ApiConfig>): boolean {
  return a.baseUrl.trim() === (b.baseUrl ?? '').trim() && a.model.trim() === (b.model ?? '').trim() && a.apiKey === (b.apiKey ?? '');
}

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
      className="absolute inset-0 z-[90] flex flex-col justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      data-testid={testId}
    >
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default bg-black/35" onClick={onClose} />
      <motion.div
        initial={{ y: 60, opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        className="relative mx-1 mb-1 flex max-h-[76%] flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.18)] dark:bg-[#1C1C1E]"
      >
        {/* 标题栏 */}
        <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-3">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#5AC8FA] to-[#34C759] text-white shadow-sm" aria-hidden>
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-foreground/70 transition-colors active:bg-black/[0.12] dark:bg-white/10 dark:text-white/70"
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
  const [channel, setChannel] = useState<PreviewChannel>('wx');
  const [contacts, setContacts] = useState<ContactRecord[] | null>(null);
  const [contactId, setContactId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [copied, setCopied] = useState(false);
  // 追发 / 线下 开关状态（同步 kv 读，随角色/App 变化重算——不用 effect，渲染期直接派生）
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

  useEffect(() => {
    let alive = true;
    void listPreviewContacts()
      .then((list) => {
        if (!alive) return;
        setContacts(list);
        if (list.length > 0) setContactId((cur) => (cur && list.some((c) => c.id === cur) ? cur : list[0].id));
      })
      .catch(() => alive && setContacts([]));
    return () => {
      alive = false;
    };
  }, []);

  // 角色切换后清空旧预览（新角色的人设/记忆尚未拼装）——渲染期 adjust-state 模式，避免 effect 内 setState
  const [prevContact, setPrevContact] = useState(contactId);
  const [prevChannel, setPrevChannel] = useState(channel);
  if (contactId !== prevContact || channel !== prevChannel) {
    setPrevContact(contactId);
    setPrevChannel(channel);
    setResult(null);
    setError('');
  }

  const runPreview = useCallback(() => {
    if (!contactId || loading) return;
    setLoading(true);
    setError('');
    // buildChatPreview 含 await（联系人/相册/跨 App 上下文），微任务排队后执行——
    // 重入保护用 loading 态（无副作用，重复点击也只是重复拼装）
    void buildChatPreview(channel, contactId)
      .then((r) => setResult(r))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '拼装失败'))
      .finally(() => setLoading(false));
  }, [channel, contactId, loading]);

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
      {/* App 标签（横向排列） */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="选择 App">
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={channel === c}
            onClick={() => setChannel(c)}
            className={`rounded-full px-3.5 py-[6px] text-[12.5px] font-medium transition-colors ${
              channel === c
                ? 'bg-[#007AFF] text-white'
                : 'bg-black/[0.05] text-foreground/70 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/70'
            }`}
            data-testid={`assist-viewer-tab-${c}`}
          >
            {CHANNEL_LABELS[c]}
          </button>
        ))}
      </div>

      {/* 角色选择 + 状态 + 预览按钮 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[128px] flex-1">
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            disabled={!contacts || contacts.length === 0}
            aria-label="选择角色"
            className="h-9 w-full appearance-none rounded-[10px] border-0 bg-black/[0.045] pl-3 pr-8 text-[13px] font-medium text-foreground ring-1 ring-black/[0.06] focus-visible:ring-2 focus-visible:ring-[#007AFF]/50 dark:bg-white/[0.08] dark:ring-white/10"
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
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        </div>
        <span className={`rounded-full px-2.5 py-[5px] text-[11px] font-semibold ring-1 ${flags.anxietyOn ? 'bg-[#34C759]/10 text-[#248A3D] ring-[#34C759]/30' : 'bg-black/[0.04] text-muted-foreground ring-black/[0.06] dark:bg-white/[0.07] dark:ring-white/10'}`}>
          追发 {flags.anxietyOn ? 'ON' : 'OFF'}
        </span>
        <span className={`rounded-full px-2.5 py-[5px] text-[11px] font-semibold ring-1 ${flags.offlineOn ? 'bg-[#FF9500]/10 text-[#C93400] ring-[#FF9500]/30' : 'bg-black/[0.04] text-muted-foreground ring-black/[0.06] dark:bg-white/[0.07] dark:ring-white/10'}`}>
          线下 {flags.offlineOn ? 'ON' : 'OFF'}
        </span>
      </div>
      <button
        type="button"
        onClick={runPreview}
        disabled={!contactId || loading}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#007AFF] text-[14.5px] font-semibold text-white transition-colors active:bg-[#0066D6] disabled:opacity-40"
        data-testid="assist-viewer-run"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {loading ? '正在拼装…' : '预览 Prompt'}
      </button>

      {/* 结果区 */}
      {error ? <p className="mt-3 text-[12.5px] text-red-500">拼装失败：{error}</p> : null}
      {!result && !error && !loading ? (
        <p className="mt-6 text-center text-[12.5px] leading-relaxed text-muted-foreground">
          点击「预览 Prompt」查看下一轮会发送的真实提示词
          <br />
          （角色人设 · 记忆 · 世界书 · 聊天记录，全部本地拼装）
        </p>
      ) : null}

      {result ? (
        <div className="mt-3.5">
          {/* 统计行 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground/80">{result.contactName}</span>
            <span>{result.messages.length} 条消息</span>
            <span>约 {Math.round(result.systemFull.length / 2)} tokens（估）</span>
            <button type="button" onClick={copySystem} className="ml-auto flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-1 font-medium text-foreground/70 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/70">
              {copied ? <Check className="h-3 w-3 text-[#34C759]" /> : <Copy className="h-3 w-3" />}
              {copied ? '已复制' : '复制 System'}
            </button>
          </div>
          {/* 注入块统计（记忆/世界书有没有注入成功一目了然） */}
          {result.sections.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.sections.map((s) => (
                <span key={s.key} className="rounded-full bg-black/[0.04] px-2 py-[3px] text-[10.5px] text-foreground/65 dark:bg-white/[0.07] dark:text-white/65">
                  {s.label} · {s.chars} 字
                </span>
              ))}
            </div>
          ) : null}

          {/* System Prompt */}
          <p className="mt-3 mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">SYSTEM PROMPT</p>
          <pre className="thin-scrollbar max-h-72 overflow-y-auto overscroll-contain rounded-[12px] bg-[#F2F2F7] px-3 py-2.5 font-mono text-[10.5px] leading-[1.65] break-words whitespace-pre-wrap text-foreground/90 dark:bg-black/40 dark:text-white/85" data-testid="assist-viewer-system">
            {result.systemFull}
          </pre>

          {/* Context 消息 */}
          <p className="mt-3.5 mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">CONTEXT（最近对话）</p>
          <div className="flex flex-col gap-1.5">
            {result.messages.slice(1).map((m, i) => (
              <div key={i}>
                <p className={`mb-0.5 text-[10px] font-semibold ${m.role === 'user' ? 'text-[#007AFF]' : 'text-[#34C759]'}`}>
                  {m.role === 'user' ? 'user（机主）' : 'assistant（TA）'}
                </p>
                <pre className="thin-scrollbar max-h-40 overflow-y-auto overscroll-contain rounded-[12px] bg-[#F2F2F7] px-3 py-2 font-mono text-[10.5px] leading-[1.6] break-words whitespace-pre-wrap text-foreground/85 dark:bg-black/40 dark:text-white/80">
                  {m.content}
                </pre>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground/70">
            与真实发送同一套拼装函数（人设 → 记忆 → 世界书 → 动态块 → 历史）；预览没有「本轮新消息」，记忆/世界书按最近历史扫描。待处理红包/转账动作规则按本轮卡片状态注入，预览中省略。
          </p>
        </div>
      ) : null}
    </SheetShell>
  );
}

// ---------------- 弹窗二：快捷操作 ----------------

/** 列表行（API / 世界书共用）：当前选中 = 浅绿胶囊底 + 绿色对勾（参考图同款） */
function QuickRow({ label, value, active, onClick, testId }: { label: string; value?: string; active: boolean; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex min-h-[44px] w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left transition-colors ${
        active ? 'bg-[#34C759]/[0.12]' : 'active:bg-black/[0.04] dark:active:bg-white/[0.06]'
      }`}
    >
      <span className={`min-w-0 flex-1 ${active ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-foreground'}`}>
        <span className="block truncate text-[14px] font-medium leading-tight">{label}</span>
        {value ? <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">{value}</span> : null}
      </span>
      {active ? <Check className="h-[18px] w-[18px] shrink-0 text-[#248A3D] dark:text-[#30D158]" strokeWidth={2.6} /> : <span className="w-[18px]" />}
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
      <div className="flex items-center gap-2 px-0.5 pb-1.5 pt-0.5">
        <Code2 className="h-4 w-4 text-foreground/70" />
        <span className="text-[13.5px] font-bold text-foreground">API</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground">{apiConfig.baseUrl ? apiConfig.model || apiConfig.baseUrl : '未设置'}</span>
      </div>
      <div className="overflow-hidden rounded-[14px] bg-black/[0.025] px-1 py-1 dark:bg-white/[0.05]">
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
      <p className="mt-1.5 px-1 text-[10.5px] leading-relaxed text-muted-foreground/70">
        点击立即切换全局模型（保留已填的 Key；自定义 Key 在 设置 › 开发者 › API 配置 里填）。切换后下一次发送即生效。
      </p>

      {/* ---- 世界书区块 ---- */}
      <div className="mt-4 flex items-center gap-2 px-0.5 pb-1.5">
        <BookOpen className="h-4 w-4 text-foreground/70" />
        <span className="text-[13.5px] font-bold text-foreground">世界书</span>
        {activeChat ? (
          <span className="ml-auto flex min-w-0 items-center gap-2">
            <span className="truncate text-[11px] text-muted-foreground">
              当前聊天：{activeChat.app === 'wx' ? '微信' : activeChat.app === 'qq' ? 'QQ' : '信息'} · {activeChat.name}
            </span>
            <button type="button" onClick={clearBindings} className="shrink-0 text-[11.5px] font-medium text-[#248A3D] dark:text-[#30D158]">
              清空
            </button>
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-muted-foreground">未打开聊天</span>
        )}
      </div>
      <div className="overflow-hidden rounded-[14px] bg-black/[0.025] px-1 py-1 dark:bg-white/[0.05]" data-testid="assist-wb-list">
        {books == null ? (
          <p className="px-3 py-3 text-[12.5px] text-muted-foreground">正在读取…</p>
        ) : books.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12.5px] text-muted-foreground">暂无世界书</p>
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
      <p className="mt-1.5 px-1 text-[10.5px] leading-relaxed text-muted-foreground/70">
        {activeChat
          ? '点击世界书挂载到当前聊天（再点移除），下次发送即生效；全局书点击 = 启用/停用。'
          : '先在微信/QQ/信息里打开一个聊天，这里就能一键把世界书挂上去。'}
      </p>
      {hint ? (
        <p className="mt-2 rounded-[10px] bg-[#34C759]/10 px-3 py-2 text-[12px] font-medium text-[#248A3D] dark:text-[#30D158]" data-testid="assist-quickops-hint">
          {hint}
        </p>
      ) : null}
    </SheetShell>
  );
}

// ---------------- 悬浮球 + 菜单 ----------------

type ToolKind = 'viewer' | 'quickops';

export default function AssistiveTools() {
  const viewerOn = useSettings((s) => s.assistViewer);
  const quickOpsOn = useSettings((s) => s.assistQuickOps);
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const switcherOpen = useUI((s) => s.switcherOpen);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const enabled = viewerOn || quickOpsOn;
  const visible = enabled && !locked && !screenOff && !switcherOpen;

  // 弹窗打开时收起菜单（在 openTool 里同步处理，不用 effect）；工具全关时弹窗派生为关闭
  const activeSheet = enabled ? sheet : null;

  const openTool = (k: ToolKind) => {
    setMenuOpen(false);
    setSheet(k);
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
      {/* 悬浮球（渐变圆 + 滑杆图标，参考图同款） */}
      <motion.button
        type="button"
        aria-label="悬浮工具"
        drag
        dragConstraints={layerRef}
        dragElastic={0.12}
        dragMomentum={false}
        onPointerDown={() => {
          dragMovedRef.current = false;
        }}
        onPointerUp={() => {
          // 没怎么移动的松手 = 点按（拖动交给 framer-motion；位移阈值内视为 tap）
          if (!dragMovedRef.current) setMenuOpen((v) => !v);
        }}
        onDrag={(_e, info) => {
          if (Math.abs(info.offset.x) > 6 || Math.abs(info.offset.y) > 6) {
            dragMovedRef.current = true;
            setMenuOpen(false);
          }
        }}
        onDragEnd={(_e, info) => {
          const p = { x: info.offset.x, y: info.offset.y };
          setPos(p);
          try {
            window.localStorage.setItem(BALL_POS_KEY, JSON.stringify(p));
          } catch {
            /* 存储不可用仅本次会话生效 */
          }
        }}
        animate={pos ? { x: pos.x, y: pos.y } : undefined}
        transition={{ duration: 0.16 }}
        className="pointer-events-auto absolute bottom-[104px] right-[14px] flex h-[52px] w-[52px] touch-none select-none items-center justify-center rounded-full bg-gradient-to-br from-[#5AC8FA] to-[#34C759] shadow-[0_6px_20px_rgba(0,0,0,0.25)] ring-[3px] ring-white/50 active:scale-95"
        data-testid="assist-ball"
      >
        <SlidersHorizontal className="h-[22px] w-[22px] text-white" strokeWidth={2.4} />
      </motion.button>

      {/* 工具菜单（球上方弹出） */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-auto absolute bottom-[168px] right-[12px] w-[176px] overflow-hidden rounded-[16px] bg-white/90 py-1 shadow-[0_8px_30px_rgba(0,0,0,0.16)] ring-1 ring-black/[0.06] backdrop-blur-xl dark:bg-[#2C2C2E]/90 dark:ring-white/10"
            data-testid="assist-menu"
          >
            {viewerOn ? (
              <button
                type="button"
                onClick={() => openTool('viewer')}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors active:bg-black/[0.05] dark:active:bg-white/[0.08]"
                data-testid="assist-menu-viewer"
              >
                <Eye className="h-[17px] w-[17px] shrink-0 text-[#007AFF]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-tight text-foreground">提示词查看器</span>
                  <span className="block text-[10.5px] leading-tight text-muted-foreground">下一轮完整 Prompt</span>
                </span>
              </button>
            ) : null}
            {quickOpsOn ? (
              <button
                type="button"
                onClick={() => openTool('quickops')}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors active:bg-black/[0.05] dark:active:bg-white/[0.08]"
                data-testid="assist-menu-quickops"
              >
                <SlidersHorizontal className="h-[17px] w-[17px] shrink-0 text-[#34C759]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-tight text-foreground">快捷操作</span>
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
