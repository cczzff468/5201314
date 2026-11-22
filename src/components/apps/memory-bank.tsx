'use client';

/**
 * 记忆库 App（跨应用记忆互通管理）——「简约水墨 · 档案卡」视觉主题：
 * 全灰白单色（无任何彩色/渐变）+ hairline 与虚线档案分隔 + 克制毛玻璃（顶栏 / 底部悬浮胶囊 Dock）。
 * 记忆卡：头部时钟时间（碎片）/ 浅灰徽章（核心）+ 右上角常驻操作图标（回忆/编辑/删除）+ 虚线分隔 +
 * 底部来源徽章行（权重/来源 App/淡化状态/相对时间/来源消息 ID）；
 * 列表页：圆角搜索条 + 统计总览 + 联系人档案卡。
 *
 * 功能结构（逻辑与 src/lib/memory.ts 保持一致，本文件只负责呈现）：
 * - 联系人列表（统计总览条 + 每联系人一张档案卡；user=机主本人不显示也不记记忆）→ 记忆详情页（四个 Tab）
 * - Tab1 记忆碎片：每 N 轮对话自动提取（内容/来源时间/所属会话），支持查看/编辑/删除；
 *   右上角「立即总结」仅提取碎片；权重（重要/普通/临时）可调、淡化状态徽标（淡化中→已归档沉底）、
 *   过期可「回忆一下」救回
 * - Tab2 核心记忆：M 条碎片自动总结（内容/来源碎片数量/生成时间），支持查看/编辑/删除；
 *   右上角「立即总结」仅把待总结碎片凝结为核心记忆（不等阈值）；
 *   被长期记忆收编的核心标记「已入长期」沉底（不再参与总结与召回）
 * - Tab3 长期记忆：K 条核心记忆自动总结出的最稳定画像（层级顶层），支持查看/编辑/删除；
 *   右上角「立即总结」仅把待总结核心凝结为长期记忆（不等阈值）
 * - Tab4 设置：提取频率（10/20/30/40/50 条消息，互通开时四端合并计数）、核心记忆总结频率（5/10/15/20/30 条）、
 *   长期记忆总结频率（3/5/7/10/20 条）、失忆程度（快/中/慢/从不）、
 *   跨 App 互通开关（默认开）、「立即总结」按所选粒度手动执行（碎片/碎片→核心/核心→长期/全部）、
 *   「修复旧记忆视角」（旧版「对方/用户」代称→真实名字）、「整理重复记忆」（相似记忆去重合并）、
 *   「召回预览」（长期→核心→碎片注入顺序预览）；本页全部按钮为长方形（圆角矩形）
 * - Tab5 画像图谱（Task 14-b B1，用户画像事实层）：从最近对话自动归纳的稳定画像事实
 *   （喜好/忌讳/习惯/身份/重要日子五类，同 topic 更新覆盖而非堆叠）；顶部「立即提取画像」手动触发；
 *   按五类分组的卡片列表（条数徽章），支持行内编辑与删除；长列表 max-h + 细滚动条
 * - 数据按联系人 ID 隔离（localStorage 持久化，重启保留）；
 *   互通开 = QQ/微信/信息/电话四端共享该联系人记忆；关 = 各端只用自己来源的记忆
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Combine,
  Fingerprint,
  Gem,
  Info,
  Landmark,
  Layers,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from 'lucide-react';
import { IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { DefaultAvatar } from './default-avatar';
import WheelDatePicker from './wheel-date-picker';
import { LocalToast, useLocalToast } from './page-toast';
import { listContacts, ownerRealNameFor } from '@/lib/ios/contacts-store';
import { isPersonGoneEverywhere } from '@/lib/ios/friend-state';
import { getGroup } from '@/lib/ios/groups';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { useSettings, type ApiConfig } from '@/lib/ios/store';
import {
  DEFAULT_MEM_SETTINGS,
  MEM_APP_LABEL,
  MEM_FORGET_LABEL,
  MEM_FORGET_OPTIONS,
  MEM_INTERVAL_OPTIONS,
  MEM_LONG_OPTIONS,
  MEM_PROFILE_CATEGORIES,
  MEM_PROFILE_CATEGORY_LABEL,
  MEM_THRESHOLD_OPTIONS,
  archivedFragmentCount,
  deleteCore,
  deleteFragment,
  deleteLongTerm,
  deleteProfileFact,
  expiredFragmentCount,
  fadeState,
  getMemSettings,
  isMemExpired,
  listCores,
  listFragments,
  listLongTerm,
  listProfileFacts,
  memProfileExtractNow,
  memSweepExpiry,
  memTimeLabel,
  memDedupeNow,
  memExtractNow,
  memMostRecentApp,
  memRecallPreview,
  memRepairPerspectiveNow,
  memSummarizeCoreNow,
  memSummarizeLongNow,
  memSummarizeNow,
  setMemScopeDefaultView,
  pendingCoreCount,
  pendingFragmentCount,
  reinforceFragment,
  saveMemSettings,
  supersededFragmentCount,
  updateCore,
  updateCoreTime,
  updateFragment,
  updateFragmentTime,
  updateLongTerm,
  updateLongTermTime,
  updateProfileFact,
  type FadeState,
  type MemApp,
  type MemCore,
  type MemForget,
  type MemFragment,
  type MemLongTerm,
  type MemNames,
  type MemProfileFact,
  type MemSettings,
  type MemTimePatch,
  type MemWeight,
} from '@/lib/memory';

/** 时间戳 → 「9月16日 14:30」 */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 时间戳 → 相对时间标签「刚刚 / N 分钟前 / N 小时前 / N 天前 / N 个月前」 */
function relTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return `${Math.floor(diff / (30 * DAY))} 个月前`;
}

/** 时间戳 → datetime-local 输入框值（北京时间 UTC+8，与注入标签/提取锚点一致，设备时区无关） */
function toInputValue(ts: number): string {
  const d = new Date(ts + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** datetime-local 字符串（北京墙上时间）→ 时间戳；与 toInputValue 互逆 */
function fromInputValue(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - 8 * 3_600_000;
}

/** 编辑保存用：对比原时间与编辑后的时间，只返回变化了的字段（无变化返回 null） */
function diffTimePatch(
  orig: { eventTime?: number; expiresAt?: number },
  next: { eventTime: number | null; expiresAt: number | null }
): MemTimePatch | null {
  const patch: MemTimePatch = {};
  if (next.eventTime !== (orig.eventTime ?? null)) patch.eventTime = next.eventTime;
  if (next.expiresAt !== (orig.expiresAt ?? null)) patch.expiresAt = next.expiresAt;
  return Object.keys(patch).length > 0 ? patch : null;
}

// ---------------- 主题常量（简约水墨：黑白灰 + hairline） ----------------

/** 页面底色（微暖中性灰，非冷 iOS 灰） */
const PAGE_BG = 'bg-[#f4f3f1] dark:bg-[#141312]';
/** 毛玻璃顶栏（亮色纯白玻璃，标签背后不泛灰；暗色同源深色） */
const TOP_GLASS = 'bg-white/80 backdrop-blur-xl dark:bg-[#141312]/75';
/** 底部悬浮 Dock 玻璃（与页面底色同源，衬托选中白胶囊） */
const DOCK_GLASS = 'bg-[#f4f3f1]/80 backdrop-blur-xl dark:bg-[#141312]/75';

/** 白玻璃卡片：毛玻璃 + 柔和投影（水墨单色系上浮起） */
const CARD_CLS =
  'bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]';

/** 选中/强调态：浅灰（暗色中灰反转）——全页无纯黑纯白实心块 */
const INK =
  'bg-neutral-200 text-neutral-800 ring-1 ring-black/[0.06] dark:bg-neutral-600 dark:text-neutral-50 dark:ring-white/[0.08]';

/** 每联系人记忆详情（五 Tab） */
type MemTab = 'frag' | 'ltm' | 'long' | 'profile' | 'set';

/** 记忆库只管理「别人」的记忆：user 是机主本人，不需要给自己记记忆（列表/统计一并排除）。
 *  删好友可见性门控：被删好友（微信/QQ 两端都不再是好友且有过删除）的记忆条目隐藏——
 *  记忆数据本体保留，重新加回好友后自动恢复（isPersonGoneEverywhere 见 friend-state.ts） */
function visibleMemContacts(list: ContactRecord[]): ContactRecord[] {
  return list.filter((c) => c.kind !== 'user');
}

export default function MemoryBankApp() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [toast, showToast] = useLocalToast();
  /** 机主真实名字（联系人 App 中 kind='user' 卡片的 name）：记忆视角统一用它指代用户 */
  const [ownerName, setOwnerName] = useState('');

  // 加载联系人（排除 user=机主本人，不给自己记记忆；另取机主卡片真实名字供视角统一用；
  // 被删好友——微信/QQ 两端都不是好友且有过删除——的记忆条目隐藏，数据保留，加回好友恢复）
  const reload = useCallback(() => {
    return listContacts()
      .then(async (list) => {
        const kept: ContactRecord[] = [];
        for (const c of visibleMemContacts(list)) {
          if (await isPersonGoneEverywhere(c.id)) continue;
          kept.push(c);
        }
        setContacts(kept);
        // 机主名与记忆视角同源（v2 多账号：信息 App 当前账号的「我」，与 setMemScopeDefaultView 一致；
        // 小号视角下 = 其档案联系人名，非恒机主）
        void ownerRealNameFor('sms')
          .then((n) => {
            setOwnerName(n);
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // 多账号 v2：记忆键按账号隔离——管理视图统一「信息 App 当前账号」视角（显式定视角，
    // 不沿用聊天页最近一次设置的记忆作用域）；机主名与记忆同视角解析
    setMemScopeDefaultView();
    reload().finally(() => setLoaded(true));
  }, [reload]);

  const active = useMemo(() => contacts.find((c) => c.id === activeId) ?? null, [contacts, activeId]);

  // 搜索过滤（按显示名，前端即时过滤，不改数据层）
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => (displayNameOf(c) || c.name).toLowerCase().includes(q));
  }, [contacts, query]);

  const handleDeleteContactGone = useCallback(() => {
    // 联系人被删（其它端删除联系人会级联清记忆）：详情页自动退回列表
    setActiveId(null);
    void reload();
  }, [reload]);

  return (
    <IOSScreen className={`${PAGE_BG}! text-neutral-900 dark:text-neutral-100`}>
      {active ? (
        <MemoryDetail
          contact={active}
          ownerName={ownerName}
          onBack={() => {
            setActiveId(null);
            void reload();
          }}
          onContactGone={handleDeleteContactGone}
          showToast={showToast}
        />
      ) : (
        <div className="relative flex-1 overflow-hidden">
          {/* 毛玻璃顶栏：内容从其下穿过 */}
          <header className={`absolute inset-x-0 top-0 z-20 pt-[54px] ${TOP_GLASS}`}>
            <div className="flex h-11 items-center justify-between px-4">
              <BackToHome className="static!" />
              <span className="text-[17px] font-semibold leading-none tracking-tight">记忆库</span>
              <span aria-hidden className="w-11 shrink-0" />
            </div>
          </header>
          <div className="h-full overflow-y-auto overscroll-contain px-4 pb-8 pt-[112px]">
            {/* 圆角搜索条 */}
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-black/30 dark:text-white/30"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="mem-search"
                aria-label="搜索联系人"
                placeholder="搜索联系人"
                className="h-10 w-full rounded-full bg-white/60 pl-10 pr-4 text-[15px] shadow-sm outline-none ring-1 ring-white/70 backdrop-blur-xl transition placeholder:text-black/30 focus:bg-white/80 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:ring-white/[0.1] dark:placeholder:text-white/30 dark:focus:bg-white/[0.12] dark:focus:ring-white/[0.14]"
              />
            </div>

            <div className="mt-2.5">
              <HeroCard contacts={contacts} loaded={loaded} />
            </div>
            {!loaded ? (
              <div className="grid place-items-center py-14 text-black/35 dark:text-white/35">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="grid place-items-center gap-3 py-14 text-center text-black/40 dark:text-white/40">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-black/[0.05] dark:bg-white/[0.07]">
                  <BrainCircuit className="h-8 w-8" strokeWidth={1.5} />
                </span>
                <p className="text-[14px]">还没有联系人，先去添加一个吧</p>
              </div>
            ) : shown.length === 0 ? (
              <div className="grid place-items-center gap-3 py-14 text-center text-black/40 dark:text-white/40">
                <Search className="h-7 w-7" strokeWidth={1.5} />
                <p className="text-[14px]">没有找到「{query.trim()}」相关的联系人</p>
              </div>
            ) : (
              <div className="mt-2.5 space-y-2.5" role="list" aria-label="联系人记忆档案">
                {shown.map((c) => (
                  <ContactCard key={c.id} contact={c} onOpen={() => setActiveId(c.id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <LocalToast msg={toast} />
    </IOSScreen>
  );
}

// ---------------- 列表页：统计总览条 ----------------

function HeroCard({ contacts, loaded }: { contacts: ContactRecord[]; loaded: boolean }) {
  let fragTotal = 0;
  let coreTotal = 0;
  let longTotal = 0;
  if (loaded) {
    for (const c of contacts) {
      fragTotal += listFragments(c.id).length;
      coreTotal += listCores(c.id).length;
      longTotal += listLongTerm(c.id).length;
    }
  }
  const stats: [string, number][] = [
    ['联系人', contacts.length],
    ['记忆碎片', fragTotal],
    ['核心记忆', coreTotal],
    ['长期记忆', longTotal],
  ];
  return (
    <section data-testid="mem-hero" className={`flex items-stretch divide-x divide-black/[0.06] rounded-[18px] p-4 dark:divide-white/[0.08] ${CARD_CLS}`}>
      {stats.map(([label, n]) => (
        <div key={label} className="flex-1 px-1 text-center">
          <p className="text-[22px] font-bold leading-none tracking-tight tabular-nums">{loaded ? n : '–'}</p>
          <p className="mt-1.5 text-[11.5px] text-black/40 dark:text-white/40">{label}</p>
        </div>
      ))}
    </section>
  );
}

// ---------------- 列表页：联系人档案卡 ----------------

/** 头像（细描边，无彩色环） */
function Avatar({ src, name, size }: { src?: string | null; name: string; size: number }) {
  return (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-black/[0.08] dark:ring-white/[0.12]"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full rounded-full object-cover" />
      ) : (
        <DefaultAvatar size={size} />
      )}
    </span>
  );
}

function ContactCard({ contact, onOpen }: { contact: ContactRecord; onOpen: () => void }) {
  // 读取记忆计数（渲染时同步读 localStorage；数据量小无性能问题）
  const fragCount = listFragments(contact.id).length;
  const coreCount = listCores(contact.id).length;
  const longCount = listLongTerm(contact.id).length;
  const name = displayNameOf(contact) || contact.name;
  return (
    <button
      type="button"
      role="listitem"
      data-testid={`mem-contact-${contact.id}`}
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-[20px] p-3.5 text-left transition-transform active:scale-[0.985] ${CARD_CLS}`}
    >
      <Avatar src={contact.avatar} name={name} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-snug">{name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {fragCount > 0 || coreCount > 0 || longCount > 0 ? (
            <>
              <span className="rounded-full bg-black/[0.05] px-2 py-[2px] text-[11px] font-medium text-black/50 dark:bg-white/[0.08] dark:text-white/50">
                {fragCount} 碎片
              </span>
              {coreCount > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-medium ${INK}`}>
                  <Gem className="h-3 w-3" /> {coreCount} 核心
                </span>
              )}
              {longCount > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-medium ${INK}`}>
                  <Landmark className="h-3 w-3" /> {longCount} 长期
                </span>
              )}
            </>
          ) : (
            <span className="rounded-full bg-black/[0.05] px-2 py-[2px] text-[11px] text-black/35 dark:bg-white/[0.08] dark:text-white/35">
              暂无记忆
            </span>
          )}
        </span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/20 dark:text-white/25" />
    </button>
  );
}

// ---------------- 记忆详情页（毛玻璃顶栏 + 底部悬浮胶囊 Dock） ----------------

function MemoryDetail({
  contact,
  ownerName,
  onBack,
  onContactGone,
  showToast,
}: {
  contact: ContactRecord;
  ownerName: string;
  onBack: () => void;
  onContactGone: () => void;
  showToast: (m: string) => void;
}) {
  const [tab, setTab] = useState<MemTab>('frag');
  // 快照号：每次读 localStorage 前自增，保证操作后重读；详情页打开期间定时轻刷（后台自动提取落库后列表自己更新）
  const [rev, setRev] = useState(0);
  const refresh = useCallback(() => setRev((x) => x + 1), []);
  useEffect(() => {
    const t = window.setInterval(() => setRev((x) => x + 1), 5000);
    return () => window.clearInterval(t);
  }, []);

  // 联系人被删除（记忆级联清理）→ 退回列表
  useEffect(() => {
    void listContacts().then((list) => {
      if (!list.some((c) => c.id === contact.id)) onContactGone();
    });
  }, [contact.id, onContactGone]);

  // 时间感知：进入档案页/刷新时清扫已过期碎片（标记 expiredAt；有变化则刷新展示）
  useEffect(() => {
    if (memSweepExpiry(contact.id) > 0) refresh();
  }, [contact.id, refresh]);

  const frags = useMemo(() => (rev >= 0 ? listFragments(contact.id) : []), [contact.id, rev]);
  const cores = useMemo(() => (rev >= 0 ? listCores(contact.id) : []), [contact.id, rev]);
  const longs = useMemo(() => (rev >= 0 ? listLongTerm(contact.id) : []), [contact.id, rev]);
  // 画像图谱（Task 14-b B1）：与三层记忆同款 rev 快照刷新（后台自动提取落库后列表自己更新）
  const facts = useMemo(() => (rev >= 0 ? listProfileFacts(contact.id) : []), [contact.id, rev]);
  const settings = useMemo(
    () => (rev >= 0 ? getMemSettings(contact.id) : DEFAULT_MEM_SETTINGS),
    [contact.id, rev]
  );
  const name = displayNameOf(contact) || contact.name;
  /** 联系人真实名字（name 字段，非昵称）：记忆视角统一用它指代 AI，展示层昵称不进记忆 */
  const realName = contact.name?.trim() || name;
  const apiConfig = useSettings((s) => s.apiConfig);
  /** 机主名字：优先联系人 App「机主(user)」卡片真实名字，无卡片时回退 Apple 账户名 */
  const profileName = useSettings((s) => s.profile.name);
  const owner = ownerName || profileName;
  /** 双方名字（视角统一）：碎片/总结一律用「机主真实名字 + 联系人真实名字」指代（均非昵称），禁「对方/用户/我」 */
  const memNames = useMemo(() => ({ user: owner, peer: realName }), [owner, realName]);
  // 右上角「立即总结」忙态：碎片页 / 核心页 / 长期页各自独立（互不干扰，同一时间只跑一个）
  const [sumBusy, setSumBusy] = useState<'frag' | 'ltm' | 'long' | null>(null);

  /** 碎片页右上角「立即总结」：只把最近对话提取为记忆碎片入库（不碰核心/长期） */
  const summarizeFragNow = async () => {
    if (sumBusy) return;
    setSumBusy('frag');
    try {
      // 【fix3-a 2e】最近对话来自群聊时把群元信息传入：提取按实际发言人归因、碎片带群来源标记
      const meta = memMostRecentApp(contact.id);
      const res = await memExtractNow(
        contact.id,
        apiConfig,
        memNames,
        meta?.group
          ? { participants: meta.group.memberNames, group: { id: meta.group.id, members: [contact.id] } }
          : undefined
      );
      const parts = [`新增 ${res.added} 条碎片`];
      if (res.merged > 0) parts.push(`合并/加强 ${res.merged} 条相似记忆`);
      showToast(`总结完成：${parts.join('，')}`);
      refresh();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : '总结失败，请稍后再试');
    } finally {
      setSumBusy(null);
    }
  };

  /** 核心页右上角「立即总结」：不等阈值，把待总结碎片立即凝结为核心记忆 */
  const summarizeCoreNow = async () => {
    if (sumBusy) return;
    setSumBusy('ltm');
    try {
      const res = await memSummarizeCoreNow(contact.id, apiConfig, memNames);
      showToast(`总结完成：${res.consumed} 条碎片凝结为 1 条核心记忆`);
      refresh();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : '总结失败，请稍后再试');
    } finally {
      setSumBusy(null);
    }
  };

  /** 长期页右上角「立即总结」：不等阈值，把待总结核心立即凝结为长期记忆 */
  const summarizeLongNow = async () => {
    if (sumBusy) return;
    setSumBusy('long');
    try {
      const res = await memSummarizeLongNow(contact.id, apiConfig, memNames);
      showToast(`总结完成：${res.consumed} 条核心记忆凝结为 1 条长期记忆`);
      refresh();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : '总结失败，请稍后再试');
    } finally {
      setSumBusy(null);
    }
  };

  const tabs: [MemTab, typeof Layers, string][] = [
    ['frag', Layers, '记忆碎片'],
    ['ltm', Gem, '核心记忆'],
    ['long', Landmark, '长期记忆'],
    ['profile', Fingerprint, '画像图谱'],
    ['set', Settings2, '设置'],
  ];

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* 毛玻璃顶栏：返回 + 联系人名 */}
      <header className={`absolute inset-x-0 top-0 z-20 pt-[54px] ${TOP_GLASS}`}>
        <div className="relative flex h-11 items-center px-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回记忆库"
            className="-ml-1 flex items-center text-[16px] font-medium active:opacity-50"
          >
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
            记忆库
          </button>
          <span className="pointer-events-none absolute left-1/2 top-1/2 max-w-[45%] -translate-x-1/2 -translate-y-1/2 truncate text-[17px] font-semibold tracking-tight">
            {name}
          </span>
        </div>
      </header>

      <div className="h-full overflow-y-auto overscroll-contain px-4 pb-[108px] pt-[108px]">
        {/* 档案头部：头像 + 统计胶囊 */}
        <div className="flex items-center gap-3">
          <Avatar src={contact.avatar} name={name} size={54} />
          <div className="min-w-0">
            <p className="truncate text-[20px] font-bold leading-tight tracking-tight">{name}</p>
            <p className="mt-0.5 text-[12px] text-black/40 dark:text-white/40">记忆档案 · 按联系人独立保存</p>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="记忆统计">
          <span className="rounded-full bg-white/60 px-2.5 py-[3px] text-[12px] font-medium text-black/55 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:text-white/55 dark:ring-white/[0.1]">
            {frags.length} 条碎片
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-[3px] text-[12px] font-medium text-black/55 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:text-white/55 dark:ring-white/[0.1]">
            <Gem className="h-3 w-3" /> {cores.length} 条核心
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-[3px] text-[12px] font-medium text-black/55 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:text-white/55 dark:ring-white/[0.1]">
            <Landmark className="h-3 w-3" /> {longs.length} 条长期
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-[3px] text-[12px] font-medium text-black/55 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:text-white/55 dark:ring-white/[0.1]">
            <Fingerprint className="h-3 w-3" /> {facts.length} 条画像
          </span>
          <span
            data-testid="mem-share-state"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[12px] font-medium ${
              settings.share
                ? INK
                : 'bg-black/[0.05] text-black/40 dark:bg-white/[0.08] dark:text-white/40'
            }`}
          >
            <Share2 className="h-3 w-3" /> 互通 · {settings.share ? '开' : '关'}
          </span>
        </div>

        {/* 碎片/核心/长期页右上角「立即总结」：各页独立触发，设置页另保留按粒度手动执行入口 */}
        {(tab === 'frag' || tab === 'ltm' || tab === 'long') && (
          <div className="flex items-center justify-end pt-3">
            <button
              type="button"
              data-testid={`mem-${tab}-summarize`}
              onClick={() =>
                void (tab === 'frag' ? summarizeFragNow() : tab === 'ltm' ? summarizeCoreNow() : summarizeLongNow())
              }
              disabled={sumBusy !== null}
              className="flex h-8 items-center gap-1.5 rounded-full bg-white/60 px-3 text-[12.5px] font-medium text-neutral-700 shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.96] disabled:opacity-50 dark:bg-white/[0.08] dark:text-neutral-200 dark:ring-white/[0.1]"
            >
              {sumBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />}
              {sumBusy === tab ? '正在总结…' : '立即总结'}
            </button>
          </div>
        )}

        <div className="pt-2">
          {tab === 'frag' && (
            <FragTab
              contactId={contact.id}
              frags={frags}
              forget={settings.forget}
              refresh={refresh}
              showToast={showToast}
            />
          )}
          {tab === 'ltm' && <CoreTab contactId={contact.id} cores={cores} refresh={refresh} showToast={showToast} />}
          {tab === 'long' && <LongTab contactId={contact.id} longs={longs} refresh={refresh} showToast={showToast} />}
          {tab === 'profile' && (
            <ProfileTab
              contactId={contact.id}
              facts={facts}
              apiConfig={apiConfig}
              memNames={memNames}
              refresh={refresh}
              showToast={showToast}
            />
          )}
          {tab === 'set' && (
            <SetTab
              contactId={contact.id}
              contactName={realName}
              ownerName={ownerName}
              refresh={refresh}
              showToast={showToast}
            />
          )}
        </div>
      </div>

      {/* 底部悬浮胶囊 Dock：毛玻璃 + 选中白底浮起；仅图标 + 文字，无数字 */}
      <nav
        className={`absolute inset-x-5 bottom-[calc(12px+env(safe-area-inset-bottom))] z-20 grid grid-cols-5 gap-1 rounded-[26px] p-1.5 shadow-[0_10px_30px_-10px_rgba(20,18,14,0.3)] ring-1 ring-black/[0.05] ${DOCK_GLASS} dark:ring-white/[0.08]`}
        role="tablist"
        aria-label="记忆分类"
      >
        {tabs.map(([id, Icon, label]) => {
          const sel = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={sel}
              data-testid={`mem-tab-${id}`}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-[3px] rounded-[20px] py-1.5 transition-colors ${
                sel
                  ? 'bg-white text-neutral-900 shadow-[0_1px_5px_rgba(20,18,14,0.1)] dark:bg-white/[0.14] dark:text-white'
                  : 'text-black/35 active:text-black/60 dark:text-white/35 dark:active:text-white/60'
              }`}
            >
              <Icon className="h-[20px] w-[20px]" strokeWidth={sel ? 2.1 : 1.8} />
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ---------------- Tab 1：记忆碎片 ----------------

/** 来源 App 徽标：小圆点 + 名称 */
function AppBadge({ app }: { app: MemApp }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.045] px-1.5 py-[1px] text-[10.5px] font-medium text-black/50 dark:bg-white/[0.07] dark:text-white/50">
      <i aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-neutral-400 dark:bg-neutral-500" />
      {MEM_APP_LABEL[app]}
    </span>
  );
}

/** 群聊来源徽标：群聊·群名（群已解散时只显示「群聊」） */
function GroupSourceBadge({ groupId }: { groupId: string }) {
  let name: string | null = null;
  try {
    name = getGroup(groupId)?.name ?? null;
  } catch {
    name = null;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.045] px-1.5 py-[1px] text-[10.5px] font-medium text-black/50 dark:bg-white/[0.07] dark:text-white/50">
      <Users className="h-3 w-3" strokeWidth={2.2} />
      {name ? `群聊·${name}` : '群聊'}
    </span>
  );
}

/** 「已入核心」徽标：该碎片已被长期记忆总结消费 */
function ConsumedBadge({ label = '已入核心' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium text-black/45 dark:bg-white/[0.08] dark:text-white/45">
      <Check className="h-3 w-3" strokeWidth={2.5} />
      {label}
    </span>
  );
}

/** 权重徽标：重要（浅灰）/ 临时（灰）；普通不显示，减少噪音 */
function WeightBadge({ weight }: { weight: MemWeight }) {
  if (weight === 'normal') return null;
  if (weight === 'high') {
    return (
      <span className={`rounded-full px-1.5 py-[1px] text-[10.5px] font-semibold ${INK}`}>重要</span>
    );
  }
  return (
    <span className="rounded-full bg-black/[0.04] px-1.5 py-[1px] text-[10.5px] font-medium text-black/40 dark:bg-white/[0.07] dark:text-white/40">
      临时
    </span>
  );
}

/** 淡化状态徽标：淡化中（召回降权）/ 已归档（不参与召回） */
function FadeBadge({ st }: { st: FadeState }) {
  if (st === 'fresh') return null;
  return (
    <span className="rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium text-black/45 dark:bg-white/[0.08] dark:text-white/45">
      {st === 'fading' ? '淡化中' : '已归档'}
    </span>
  );
}

/** 事件时间徽标（时间感知：内容所指的时间，与当前时间联动） */
function EventTimeBadge({ ts }: { ts: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium tabular-nums text-black/45 dark:bg-white/[0.08] dark:text-white/45">
      <Clock className="h-3 w-3" strokeWidth={2} />
      事件 {memTimeLabel(ts)}
    </span>
  );
}

/** 已过期徽标（时间感知：expiresAt 到期自动归档，不再召回） */
function ExpiredBadge() {
  return (
    <span className="rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium text-black/40 dark:bg-white/[0.07] dark:text-white/40">
      已过期
    </span>
  );
}

/** 手动时间徽标（时间感知：用户手动设置过事件/过期时间，自动提取不再改写） */
function ManualTimeBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium text-black/45 dark:bg-white/[0.08] dark:text-white/45">
      <Clock className="h-3 w-3" strokeWidth={2} />
      手动
    </span>
  );
}

/** 已更新徽标（时间感知冲突处理：被矛盾的新记忆替代，不再召回） */
function SupersededBadge() {
  return (
    <span className="rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium text-black/40 dark:bg-white/[0.07] dark:text-white/40">
      已更新
    </span>
  );
}

function FragTab({
  contactId,
  frags,
  forget,
  refresh,
  showToast,
}: {
  contactId: string;
  frags: MemFragment[];
  forget: MemForget;
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const now = Date.now();
  const withState = useMemo(
    () =>
      frags.map((f) => ({
        f,
        st: fadeState(f, forget, now),
        expired: f.supersededAt == null && isMemExpired(f, now),
        updated: f.supersededAt != null,
      })),
    [frags, forget, now]
  );
  // 已更新/已过期/已归档沉底，其余保持创建时间倒序
  const ordered = useMemo(
    () =>
      [...withState].sort(
        (a, b) =>
          (a.updated ? 3 : a.expired ? 2 : a.st === 'faded' ? 1 : 0) -
          (b.updated ? 3 : b.expired ? 2 : b.st === 'faded' ? 1 : 0)
      ),
    [withState]
  );
  if (frags.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="h-8 w-8" strokeWidth={1.5} />}
        text="还没有记忆碎片。和TA聊满 N 轮（设置里可调），或点右上角「立即总结」立刻提取。"
      />
    );
  }
  return (
    <div className="space-y-2.5">
      {ordered.map(({ f, st, expired, updated }) => (
        <MemoryCard
          key={f.id}
          testid={`mem-frag-${f.id}`}
          variant="frag"
          consumed={Boolean(f.consumedAt)}
          fade={st}
          dim={expired || updated}
          weight={f.weight ?? 'normal'}
          showWeight
          content={f.content}
          header={
            <span className="flex items-center gap-1.5 text-[12px] font-medium tabular-nums text-black/40 dark:text-white/40">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
              {fmtTime(f.sourceTime)}
            </span>
          }
          meta={
            <span className="flex flex-wrap items-center gap-1.5">
              {f.eventTime != null && <EventTimeBadge ts={f.eventTime} />}
              {f.timeEditedAt != null && <ManualTimeBadge />}
              <WeightBadge weight={f.weight ?? 'normal'} />
              <AppBadge app={f.app} />
              {f.source === 'group' && f.sourceGroupId && <GroupSourceBadge groupId={f.sourceGroupId} />}
              <FadeBadge st={st} />
              {f.consumedAt && <ConsumedBadge />}
              {expired && <ExpiredBadge />}
              {updated && <SupersededBadge />}
              {f.expiresAt != null && (
                <span className="tabular-nums text-black/40 dark:text-white/40">· {memTimeLabel(f.expiresAt)} 过期</span>
              )}
              <span aria-hidden="true">·</span>
              <span>{relTime(f.reinforcedAt ?? f.sourceTime)}</span>
              {f.sourceMsgId && (
                <span className="tabular-nums">· 来源 #{f.sourceMsgId.slice(-6)}</span>
              )}
            </span>
          }
          time={{ eventTime: f.eventTime, expiresAt: f.expiresAt, timeEdited: f.timeEditedAt != null }}
          onSave={(text, w, t) => {
            const tp = diffTimePatch(f, t);
            const ok = updateFragment(contactId, f.id, text, w);
            if (tp) updateFragmentTime(contactId, f.id, tp);
            if (ok || tp) {
              refresh();
              showToast(ok ? '碎片已更新' : '时间已更新（以手动设置为准）');
            }
          }}
          onReinforce={() => {
            if (reinforceFragment(contactId, f.id)) {
              refresh();
              showToast('已回忆，淡化时间已重置');
            }
          }}
          onDelete={() => {
            deleteFragment(contactId, f.id);
            refresh();
            showToast('碎片已删除');
          }}
        />
      ))}
    </div>
  );
}

// ---------------- Tab 2：核心记忆 ----------------

function CoreTab({
  contactId,
  cores,
  refresh,
  showToast,
}: {
  contactId: string;
  cores: MemCore[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  // 已入长期（被收编）沉底，其次手动设置过期的沉底，其余保持创建时间倒序
  const now = Date.now();
  const ordered = useMemo(
    () =>
      [...cores].sort(
        (a, b) =>
          (a.archivedAt ? 2 : isMemExpired(a, now) ? 1 : 0) - (b.archivedAt ? 2 : isMemExpired(b, now) ? 1 : 0)
      ),
    [cores]
  );
  if (cores.length === 0) {
    return (
      <EmptyState
        icon={<Gem className="h-8 w-8" strokeWidth={1.5} />}
        text="还没有核心记忆。积累 M 条记忆碎片后会自动总结（设置里可调），也可点右上角「立即总结」手动凝结。"
      />
    );
  }
  return (
    <div className="space-y-2.5">
      {ordered.map((m) => {
        const expired = m.archivedAt == null && isMemExpired(m, now);
        return (
          <MemoryCard
            key={m.id}
            testid={`mem-ltm-${m.id}`}
            variant="ltm"
            consumed={Boolean(m.archivedAt)}
            dim={expired}
            content={m.content}
            header={
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-semibold ${INK}`}>
                <Gem aria-hidden="true" className="h-3 w-3" />
                核心记忆
              </span>
            }
            meta={
              <span className="flex flex-wrap items-center gap-1.5">
                {m.eventTime != null && <EventTimeBadge ts={m.eventTime} />}
                {m.timeEditedAt != null && <ManualTimeBadge />}
                <span>来自 {m.fragmentCount} 条碎片</span>
                <span>·</span>
                <span>{m.apps.map((a) => MEM_APP_LABEL[a]).join('、') || MEM_APP_LABEL.wx}</span>
                <span>·</span>
                <span className="tabular-nums">{fmtTime(m.createdAt)} 生成</span>
                {m.expiresAt != null && (
                  <span className="tabular-nums text-black/40 dark:text-white/40">· {memTimeLabel(m.expiresAt)} 过期</span>
                )}
                {expired && <ExpiredBadge />}
                {m.archivedAt && <ConsumedBadge label="已入长期" />}
              </span>
            }
            time={{ eventTime: m.eventTime, expiresAt: m.expiresAt, timeEdited: m.timeEditedAt != null }}
            onSave={(text, _w, t) => {
              const tp = diffTimePatch(m, t);
              const ok = updateCore(contactId, m.id, text);
              if (tp) updateCoreTime(contactId, m.id, tp);
              if (ok || tp) {
                refresh();
                showToast(ok ? '核心记忆已更新' : '时间已更新（以手动设置为准）');
              }
            }}
            onDelete={() => {
              deleteCore(contactId, m.id);
              refresh();
              showToast('核心记忆已删除');
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------- Tab 3：长期记忆 ----------------

function LongTab({
  contactId,
  longs,
  refresh,
  showToast,
}: {
  contactId: string;
  longs: MemLongTerm[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  // 手动设置过期的沉底，其余保持创建时间倒序
  const now = Date.now();
  const ordered = useMemo(
    () =>
      [...longs].sort(
        (a, b) => (isMemExpired(a, now) ? 1 : 0) - (isMemExpired(b, now) ? 1 : 0)
      ),
    [longs]
  );
  if (longs.length === 0) {
    return (
      <EmptyState
        icon={<Landmark className="h-8 w-8" strokeWidth={1.5} />}
        text="还没有长期记忆。积累 K 条核心记忆后会自动总结（设置里可调），也可点右上角「立即总结」手动凝结。"
      />
    );
  }
  return (
    <div className="space-y-2.5">
      {ordered.map((m) => {
        const expired = isMemExpired(m, now);
        return (
          <MemoryCard
            key={m.id}
            testid={`mem-long-${m.id}`}
            variant="long"
            dim={expired}
            content={m.content}
            header={
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-semibold ${INK}`}>
                <Landmark aria-hidden="true" className="h-3 w-3" />
                长期记忆
              </span>
            }
            meta={
              <span className="flex flex-wrap items-center gap-1.5">
                {m.eventTime != null && <EventTimeBadge ts={m.eventTime} />}
                {m.timeEditedAt != null && <ManualTimeBadge />}
                <span>来自 {m.coreCount} 条核心记忆</span>
                <span>·</span>
                <span>{m.apps.map((a) => MEM_APP_LABEL[a]).join('、') || MEM_APP_LABEL.wx}</span>
                <span>·</span>
                <span className="tabular-nums">{fmtTime(m.createdAt)} 生成</span>
                {m.expiresAt != null && (
                  <span className="tabular-nums text-black/40 dark:text-white/40">· {memTimeLabel(m.expiresAt)} 过期</span>
                )}
                {expired && <ExpiredBadge />}
              </span>
            }
            time={{ eventTime: m.eventTime, expiresAt: m.expiresAt, timeEdited: m.timeEditedAt != null }}
            onSave={(text, _w, t) => {
              const tp = diffTimePatch(m, t);
              const ok = updateLongTerm(contactId, m.id, text);
              if (tp) updateLongTermTime(contactId, m.id, tp);
              if (ok || tp) {
                refresh();
                showToast(ok ? '长期记忆已更新' : '时间已更新（以手动设置为准）');
              }
            }}
            onDelete={() => {
              deleteLongTerm(contactId, m.id);
              refresh();
              showToast('长期记忆已删除');
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------- Tab 5：画像图谱（用户画像事实层，Task 14-b B1） ----------------

/**
 * 画像事实行（档案风小卡）：topic 标题 + 一句话陈述 + 更新时间/来源徽章，
 * 行内编辑（内容）与两步删除确认；手动编辑过的条目带「手动」徽标（自动提取不再覆盖）。
 */
function ProfileFactRow({
  contactId,
  fact,
  refresh,
  showToast,
}: {
  contactId: string;
  fact: MemProfileFact;
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.content);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div
      data-testid={`mem-profile-${fact.id}`}
      className="rounded-[16px] bg-white/50 p-3 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.06] dark:ring-white/[0.09]"
    >
      {editing ? (
        <>
          <p className="text-[13px] font-semibold">{fact.topic}</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={80}
            aria-label="编辑画像事实内容"
            className="mt-1.5 w-full resize-none rounded-xl bg-black/[0.04] p-2.5 text-[13.5px] leading-relaxed outline-none ring-1 ring-black/[0.08] focus:ring-neutral-900/35 dark:bg-white/[0.06] dark:ring-white/[0.12] dark:focus:ring-white/40"
          />
          <p className="mt-1 text-[10.5px] text-black/35 dark:text-white/35">
            手动编辑后，自动提取不再覆盖这条画像
          </p>
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(fact.content);
              }}
              className="rounded-full px-3 py-1 text-[12.5px] text-black/50 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              data-testid={`mem-profile-${fact.id}-save`}
              onClick={() => {
                const t = draft.trim();
                if (t && updateProfileFact(contactId, fact.id, t)) {
                  refresh();
                  showToast('画像事实已更新');
                }
                setEditing(false);
              }}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-medium active:opacity-80 ${INK}`}
            >
              <Check className="h-[13px] w-[13px]" /> 保存
            </button>
          </div>
        </>
      ) : confirmDel ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-black/55 dark:text-white/55">删除「{fact.topic}」这条画像？</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              className="rounded-full px-2.5 py-1 text-[12.5px] text-black/50 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              data-testid={`mem-profile-${fact.id}-del-confirm`}
              onClick={() => {
                deleteProfileFact(contactId, fact.id);
                refresh();
                showToast('画像事实已删除');
              }}
              className={`rounded-full px-3 py-1 text-[12.5px] font-medium active:opacity-80 ${INK}`}
            >
              删除
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-snug">{fact.topic}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{fact.content}</p>
            </div>
            <div className="-mr-1 flex shrink-0 items-center">
              <button
                type="button"
                aria-label="编辑画像事实"
                onClick={() => {
                  setDraft(fact.content);
                  setEditing(true);
                }}
                className="grid h-7 w-7 place-items-center rounded-full text-black/30 transition-colors active:bg-black/[0.06] active:text-black/70 dark:text-white/30 dark:active:bg-white/[0.1] dark:active:text-white/70"
              >
                <Pencil className="h-[14px] w-[14px]" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                aria-label="删除画像事实"
                onClick={() => setConfirmDel(true)}
                className="grid h-7 w-7 place-items-center rounded-full text-black/30 transition-colors active:bg-black/[0.06] active:text-black/70 dark:text-white/30 dark:active:bg-white/[0.1] dark:active:text-white/70"
              >
                <Trash2 className="h-[14px] w-[14px]" strokeWidth={1.8} />
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-black/40 dark:text-white/40">
            {fact.editedAt != null && <ManualTimeBadge />}
            {fact.weight === 'high' && <WeightBadge weight="high" />}
            {!!fact.sourceFragmentIds?.length && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium text-black/45 dark:bg-white/[0.08] dark:text-white/45">
                来自 {fact.sourceFragmentIds.length} 条碎片
              </span>
            )}
            <span>更新于 {relTime(fact.updatedAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{fmtTime(fact.createdAt)} 建立</span>
          </div>
        </>
      )}
    </div>
  );
}

/** 画像图谱 Tab：按五类分组的卡片列表 + 顶部「立即提取画像」（长列表 max-h + 细滚动条） */
function ProfileTab({
  contactId,
  facts,
  apiConfig,
  memNames,
  refresh,
  showToast,
}: {
  contactId: string;
  facts: MemProfileFact[];
  apiConfig: ApiConfig;
  memNames: MemNames;
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  /** 顶部「立即提取画像」：取该联系人最近对话当场归纳画像事实（与三层「立即总结」同款交互） */
  const extractNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await memProfileExtractNow(contactId, apiConfig, memNames);
      const parts: string[] = [];
      if (res.added > 0) parts.push(`新增 ${res.added} 条`);
      if (res.merged > 0) parts.push(`更新 ${res.merged} 条`);
      showToast(`画像提取完成：${parts.join('，')}`);
      refresh();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : '提取失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  // 按 MEM_PROFILE_CATEGORIES 固定顺序分组（身份→喜好→忌讳→习惯→重要日子），空组不渲染
  const groups = MEM_PROFILE_CATEGORIES.map((cat) => ({
    cat,
    items: facts.filter((f) => f.category === cat),
  }));

  return (
    <div>
      {/* 顶部「立即提取画像」：与三层 Tab 右上角「立即总结」同款按钮样式 */}
      <div className="flex items-center justify-end pb-2">
        <button
          type="button"
          data-testid="mem-profile-extract"
          onClick={() => void extractNow()}
          disabled={busy}
          className="flex h-8 items-center gap-1.5 rounded-full bg-white/60 px-3 text-[12.5px] font-medium text-neutral-700 shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.96] disabled:opacity-50 dark:bg-white/[0.08] dark:text-neutral-200 dark:ring-white/[0.1]"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5" strokeWidth={1.9} />}
          {busy ? '正在提取…' : '立即提取画像'}
        </button>
      </div>
      {facts.length === 0 ? (
        <EmptyState
          icon={<Fingerprint className="h-8 w-8" strokeWidth={1.5} />}
          text="还没有用户画像。聊满一定轮数后会自动归纳（喜好/忌讳/习惯/身份/重要日子），也可点上方「立即提取画像」马上生成。"
        />
      ) : (
        <div className="max-h-96 space-y-3.5 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/15 [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-white/15">
          {groups.map(({ cat, items }) =>
            items.length === 0 ? null : (
              <section key={cat} aria-label={MEM_PROFILE_CATEGORY_LABEL[cat]}>
                <h4 className="flex items-center gap-1.5 px-1 pb-1.5 text-[13px] font-semibold text-black/55 dark:text-white/55">
                  {MEM_PROFILE_CATEGORY_LABEL[cat]}
                  <span
                    data-testid={`mem-profile-count-${cat}`}
                    className="rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium tabular-nums text-black/45 dark:bg-white/[0.08] dark:text-white/45"
                  >
                    {items.length}
                  </span>
                </h4>
                <div className="space-y-2">
                  {items.map((f) => (
                    <ProfileFactRow key={f.id} contactId={contactId} fact={f} refresh={refresh} showToast={showToast} />
                  ))}
                </div>
              </section>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Tab 3：设置 ----------------

/** 设置小节标题（纯文字，无图标） */
function SetSectionHead({ title }: { title: string }) {
  return <h3 className="text-[15px] font-semibold">{title}</h3>;
}

function SetTab({
  contactId,
  contactName,
  ownerName,
  refresh,
  showToast,
}: {
  contactId: string;
  contactName: string;
  ownerName: string;
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const apiConfig = useSettings((s) => s.apiConfig);
  /** 机主名字：优先联系人 App「机主(user)」卡片真实名字，无卡片时回退 Apple 账户名 */
  const profileName = useSettings((s) => s.profile.name);
  const owner = ownerName || profileName;
  /** 双方名字（视角统一）：总结/修复一律用「机主真实名字 + 联系人真实名字」指代（均非昵称） */
  const memNames = useMemo(() => ({ user: owner, peer: contactName }), [owner, contactName]);
  const [settings, setSettings] = useState<MemSettings>(() => getMemSettings(contactId));
  const [busy, setBusy] = useState(false);
  const [dedupeBusy, setDedupeBusy] = useState(false);
  /** 手动总结粒度：frag=只总结碎片 / core=碎片→核心 / long=核心→长期 / all=全部执行 */
  const [scope, setScope] = useState<'frag' | 'core' | 'long' | 'all'>('all');
  const fragCount = listFragments(contactId).length;
  const pending = pendingFragmentCount(contactId);
  const archived = archivedFragmentCount(contactId);
  const expiredCnt = expiredFragmentCount(contactId);
  const supersededCnt = supersededFragmentCount(contactId);
  const coreCount = listCores(contactId).length;
  const corePending = pendingCoreCount(contactId);
  const longCount = listLongTerm(contactId).length;
  // 召回预览：每次渲染实时重算（父组件每 5s 轻刷，改动设置后 refresh 会触发重渲）
  const preview = memRecallPreview(contactId);

  const patch = (p: Partial<MemSettings>) => {
    const next = saveMemSettings(contactId, p);
    setSettings(next);
    refresh();
  };

  /** 整理重复记忆：相似记忆（同一件事的不同说法）合并为一条 */
  const dedupe = () => {
    if (dedupeBusy) return;
    setDedupeBusy(true);
    // 轻微延时让 busy 态可见，体验更稳
    window.setTimeout(() => {
      const n = memDedupeNow(contactId);
      setDedupeBusy(false);
      refresh();
      showToast(n > 0 ? `整理完成：合并了 ${n} 条相似记忆` : '没有发现重复的记忆');
    }, 350);
  };

  /** 修复旧记忆视角：旧版「对方/用户」代称 → 真实名字（碎片/核心/长期三层一次处理） */
  const repair = () => {
    if (busy) return;
    setBusy(true);
    window.setTimeout(() => {
      const r = memRepairPerspectiveNow(contactId, memNames);
      setBusy(false);
      refresh();
      const total = r.frags + r.cores + r.longs;
      showToast(
        total > 0
          ? `修复完成：${r.frags} 条碎片、${r.cores} 条核心、${r.longs} 条长期`
          : '没有发现需要修复的旧代称（在联系人 App 填写机主卡片的名字，修复效果更完整）'
      );
    }, 350);
  };

  /** 立即总结：按所选粒度手动执行（不等 N 轮） */
  const runSummary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (scope === 'frag') {
        // 只总结碎片：把最近对话提取为碎片入库，不碰核心/长期
        // 【fix3-a 2e】最近对话来自群聊时把群元信息传入（同碎片页右上角入口）
        const meta = memMostRecentApp(contactId);
        const res = await memExtractNow(
          contactId,
          apiConfig,
          memNames,
          meta?.group
            ? { participants: meta.group.memberNames, group: { id: meta.group.id, members: [contactId] } }
            : undefined
        );
        const parts = [`新增 ${res.added} 条碎片`];
        if (res.merged > 0) parts.push(`合并/加强 ${res.merged} 条相似记忆`);
        showToast(`总结完成：${parts.join('，')}`);
      } else if (scope === 'core') {
        // 碎片→核心：把待总结碎片立即凝结为核心记忆
        const res = await memSummarizeCoreNow(contactId, apiConfig, memNames);
        showToast(`总结完成：${res.consumed} 条碎片凝结为 1 条核心记忆`);
      } else if (scope === 'long') {
        // 核心→长期：把待总结核心立即凝结为长期记忆
        const res = await memSummarizeLongNow(contactId, apiConfig, memNames);
        showToast(`总结完成：${res.consumed} 条核心记忆凝结为 1 条长期记忆`);
      } else {
        // 全部执行：提取碎片 + 达阈值时顺带总结核心/长期
        const recent = memMostRecentApp(contactId);
        if (!recent) {
          showToast('当前没有可总结的对话，先去和TA聊聊吧');
          return;
        }
        // 【fix3-a 2e】recent 来自群聊（convo 带发言人前缀）时把 participants/群来源标记一并传入：
        // 手动总结不再把群聊归属坍塌成二人对话（同 memAfterAiTurn 群聊轮次口径）
        const res = await memSummarizeNow(
          contactId,
          recent.app,
          apiConfig,
          recent.convo,
          memNames,
          recent.group
            ? { participants: recent.group.memberNames, group: { id: recent.group.id, members: [contactId] } }
            : undefined
        );
        const parts = [`新增 ${res.fragments} 条碎片`];
        if (res.merged > 0) parts.push(`合并/加强 ${res.merged} 条相似记忆`);
        if (res.cores > 0) parts.push(`生成 ${res.cores} 条核心记忆`);
        if (res.longs > 0) parts.push(`生成 ${res.longs} 条长期记忆`);
        showToast(`总结完成：${parts.join('，')}`);
      }
      refresh();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : '总结失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 对话总结频率 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-interval">
        <SetSectionHead title="对话总结频率" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          累计多少条消息（你和 TA 的都算）自动提取一次记忆碎片；跨 App 互通开启时微信/QQ/信息/电话合并计算，关闭时各 App 独立计数
        </p>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {MEM_INTERVAL_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={settings.interval === n}
              data-testid={`mem-interval-${n}`}
              onClick={() => patch({ interval: n })}
              className={`rounded-lg py-2 text-[14px] font-semibold tabular-nums transition-colors ${
                settings.interval === n
                  ? INK
                  : 'bg-black/[0.05] text-black/60 active:bg-black/[0.1] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.14]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* 核心记忆总结频率 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-threshold">
        <SetSectionHead title="核心记忆总结频率" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          积累多少条记忆碎片后，自动总结一条核心记忆
        </p>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {MEM_THRESHOLD_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={settings.threshold === n}
              data-testid={`mem-threshold-${n}`}
              onClick={() => patch({ threshold: n })}
              className={`rounded-lg py-2 text-[14px] font-semibold tabular-nums transition-colors ${
                settings.threshold === n
                  ? INK
                  : 'bg-black/[0.05] text-black/60 active:bg-black/[0.1] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.14]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* 长期记忆总结频率 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-long-threshold">
        <SetSectionHead title="长期记忆总结频率" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          积累多少条（未归档的）核心记忆后，自动总结一条长期记忆；
          总结后参与的核心记忆标记为「已入长期」，不再重复参与总结
        </p>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {MEM_LONG_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={settings.longThreshold === n}
              data-testid={`mem-long-${n}`}
              onClick={() => patch({ longThreshold: n })}
              className={`rounded-lg py-2 text-[13px] font-semibold tabular-nums transition-colors ${
                settings.longThreshold === n
                  ? INK
                  : 'bg-black/[0.05] text-black/60 active:bg-black/[0.1] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.14]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* 失忆程度 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-forget">
        <SetSectionHead title="失忆程度" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          有时效的记忆（如「明天去北京」）会先「淡化」（召回降权）、后「归档」（不再参与召回）：
          快≈3 天、中≈2 周、慢≈2 个月。从不重要的记忆开始淡化，重要记忆（姓名/关系/承诺）更持久。
        </p>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {MEM_FORGET_OPTIONS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={settings.forget === v}
              data-testid={`mem-forget-${v}`}
              onClick={() => patch({ forget: v })}
              className={`rounded-lg py-2 text-[14px] font-semibold transition-colors ${
                settings.forget === v
                  ? INK
                  : 'bg-black/[0.05] text-black/60 active:bg-black/[0.1] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.14]'
              }`}
            >
              {MEM_FORGET_LABEL[v]}
            </button>
          ))}
        </div>
      </section>

      {/* 跨 App 互通开关 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-share">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SetSectionHead title="跨 App 互通记忆" />
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
              开启后 QQ、微信、信息、电话共享「{contactName}」的记忆；关闭后各 App 记忆互相隔离。不同联系人之间永远隔离。
            </p>
          </div>
          <MemSwitch
            checked={settings.share}
            testid="mem-share-toggle"
            onChange={(v) => patch({ share: v })}
          />
        </div>
      </section>

      {/* 手动总结（按粒度） */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-summary">
        <SetSectionHead title="手动总结" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          不用等 N 轮，按所选粒度立刻整理：只提取碎片、把碎片凝结为核心、把核心凝结为长期，或全部执行。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {(
            [
              ['frag', '只总结碎片'],
              ['core', '碎片 → 核心记忆'],
              ['long', '核心 → 长期记忆'],
              ['all', '全部执行'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={scope === v}
              data-testid={`mem-scope-${v}`}
              onClick={() => setScope(v)}
              className={`rounded-lg py-2 text-[13.5px] font-medium transition-colors ${
                scope === v
                  ? INK
                  : 'bg-black/[0.05] text-black/60 active:bg-black/[0.1] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.14]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="mem-summarize"
          onClick={() => void runSummary()}
          disabled={busy}
          className={`mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-semibold transition-opacity active:opacity-80 ${INK} ${
            busy ? 'opacity-50' : ''
          }`}
        >
          {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Sparkles className="h-[18px] w-[18px]" />}
          {busy ? '正在整理记忆…' : '立即总结'}
        </button>
      </section>

      {/* 修复旧记忆视角 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-repair">
        <SetSectionHead title="修复旧记忆视角" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          旧版本提取的记忆可能混用「对方 / 用户」代称，导致谁对谁分不清；
          一键把它们替换为真实名字（「对方」→ {contactName || '角色名字'}，
          「用户」→ 机主真实名字，取联系人 App 中「机主」卡片的名字，而非 Apple 账户名）。
        </p>
        <button
          type="button"
          data-testid="mem-repair"
          onClick={repair}
          disabled={busy}
          className={`mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-semibold transition-opacity active:opacity-80 ${INK} ${
            busy ? 'opacity-50' : ''
          }`}
        >
          {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Wand2 className="h-[18px] w-[18px]" />}
          {busy ? '正在修复…' : '修复旧记忆视角'}
        </button>
      </section>

      {/* 整理重复记忆 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-dedupe">
        <SetSectionHead title="整理重复记忆" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          同一件事的不同说法（如「喜欢海边」/「很喜欢去海边」）在提取时会自动合并为一条，避免重复占位；这里可一次性清理全部相似记忆。
        </p>
        <button
          type="button"
          data-testid="mem-dedupe"
          onClick={dedupe}
          disabled={dedupeBusy}
          className={`mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-semibold transition-opacity active:opacity-80 ${INK} ${
            dedupeBusy ? 'opacity-50' : ''
          }`}
        >
          {dedupeBusy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Combine className="h-[18px] w-[18px]" />}
          {dedupeBusy ? '正在整理…' : '整理重复记忆'}
        </button>
      </section>

      {/* 召回预览 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-recall">
        <SetSectionHead title="召回预览" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          下次与 TA 聊天时，将按「权重 × 相关性」注入以下记忆（已排除归档；互通关闭时各 App 仅注入自己来源的部分）。
        </p>
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto" data-testid="mem-recall-preview">
          {preview.longs.length === 0 && preview.cores.length === 0 && preview.frags.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-black/35 dark:text-white/35">还没有可召回的记忆</p>
          ) : (
            <>
              {preview.longs.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start gap-2 rounded-xl bg-black/[0.035] px-2.5 py-2 text-[12.5px] leading-relaxed text-black/70 dark:bg-white/[0.06] dark:text-white/70"
                >
                  <span className={`mt-[1px] inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-[1px] text-[10px] font-semibold ${INK}`}>
                    <Landmark aria-hidden="true" className="h-2.5 w-2.5" />
                    长期
                  </span>
                  <span className="min-w-0">{m.content}</span>
                </div>
              ))}
              {preview.cores.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start gap-2 rounded-xl bg-black/[0.035] px-2.5 py-2 text-[12.5px] leading-relaxed text-black/70 dark:bg-white/[0.06] dark:text-white/70"
                >
                  <span className={`mt-[1px] inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-[1px] text-[10px] font-semibold ${INK}`}>
                    <Gem aria-hidden="true" className="h-2.5 w-2.5" />
                    核心
                  </span>
                  <span className="min-w-0">{m.content}</span>
                </div>
              ))}
              {preview.frags.map((f) => (
                <div
                  key={f.id}
                  className="flex items-start gap-2 rounded-xl bg-black/[0.035] px-2.5 py-2 text-[12.5px] leading-relaxed text-black/70 dark:bg-white/[0.06] dark:text-white/70"
                >
                  {f.weight === 'high' && (
                    <span className={`mt-[1px] shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold ${INK}`}>重要</span>
                  )}
                  {f.weight === 'low' && (
                    <span className="mt-[1px] shrink-0 rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10px] font-medium text-black/40 dark:bg-white/[0.08] dark:text-white/40">
                      临时
                    </span>
                  )}
                  <span className="min-w-0">{f.content}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* 数据说明 */}
      <section
        className="flex gap-2 rounded-[18px] bg-black/[0.04] p-4 text-[12.5px] leading-relaxed text-black/45 dark:bg-white/[0.06] dark:text-white/45"
        data-testid="mem-set-note"
      >
        <Info aria-hidden="true" className="mt-[1px] h-4 w-4 shrink-0 text-black/30 dark:text-white/30" />
        <div>
          <p>
            当前联系人：{fragCount} 条碎片（{pending} 条待总结{archived > 0 ? ` · ${archived} 条已归档` : ''}
            {expiredCnt > 0 ? ` · ${expiredCnt} 条已过期` : ''}
            {supersededCnt > 0 ? ` · ${supersededCnt} 条已更新` : ''}）·
            {' '}
            {coreCount} 条核心记忆（{corePending} 条待总结）· {longCount} 条长期记忆
          </p>
          <p className="mt-1">
            记忆按联系人独立存储、跨重启保留；删除联系人时其全部记忆一并删除。默认设置：每 {DEFAULT_MEM_SETTINGS.interval} 轮提取、
            {DEFAULT_MEM_SETTINGS.threshold} 条碎片总结一次核心、{DEFAULT_MEM_SETTINGS.longThreshold} 条核心总结一次长期、互通开启、失忆程度「中」。
          </p>
        </div>
      </section>
    </div>
  );
}

// ---------------- 通用小组件 ----------------

/** iOS 风格开关（水墨单色：on 浅灰 / 暗色中灰，全页无纯黑纯白实心块） */
function MemSwitch({ checked, onChange, testid }: { checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testid}
      onClick={() => onChange(!checked)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        checked ? 'bg-neutral-400 dark:bg-neutral-500' : 'bg-black/15 dark:bg-white/25'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow transition-all duration-200 ${
          checked ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

/** 空状态（中性圆底徽章） */
function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="grid place-items-center gap-3 px-8 py-14 text-center">
      <span
        aria-hidden="true"
        className="grid h-16 w-16 place-items-center rounded-full bg-black/[0.05] text-black/35 dark:bg-white/[0.08] dark:text-white/35"
      >
        {icon}
      </span>
      <p className="text-[13.5px] leading-relaxed text-black/45 dark:text-white/45">{text}</p>
    </div>
  );
}

/** 记忆卡片（档案风）：头部时间/徽章 + 右上角常驻操作图标 + 虚线分隔 + 底部来源徽章行。
 * - frag：头部时钟时间；权重徽标 + 淡化状态 + 相对时间 + 来源消息 ID；过期可「回忆一下」；
 *   编辑态可调权重（重要/普通/临时）
 * - ltm：头部浅灰「核心记忆」徽章
 * - 透明度取「淡化/消费」更淡的一档：已归档 0.55 > 淡化中 0.8 > 已入核心 0.72
 */
function MemoryCard({
  variant,
  consumed = false,
  fade = 'fresh',
  dim = false,
  weight = 'normal',
  showWeight = false,
  content,
  header,
  meta,
  testid,
  time,
  onSave,
  onDelete,
  onReinforce,
}: {
  variant: 'frag' | 'ltm' | 'long';
  /** 仅 frag：已被长期记忆总结消费 */
  consumed?: boolean;
  /** 淡化状态：fading=淡化中（半淡显），faded=已归档（沉底淡显） */
  fade?: FadeState;
  /** 额外淡显（时间感知：已过期/已更新，不再参与召回） */
  dim?: boolean;
  /** 仅 frag：记忆权重（编辑态可调） */
  weight?: MemWeight;
  /** 编辑态是否显示权重选择 */
  showWeight?: boolean;
  content: string;
  /** 头部左侧：碎片=时钟时间，核心=黑徽章 */
  header: React.ReactNode;
  /** 底部来源徽章 / 元信息 */
  meta: React.ReactNode;
  testid: string;
  /** 时间感知：事件/过期时间（传入后编辑态可手动修改；留空=无事件时间/永不过期） */
  time?: { eventTime?: number; expiresAt?: number; timeEdited?: boolean };
  /** 保存：内容 + 权重 + 时间草稿（null=清除事件时间/恢复永不过期；时间有变化时由调用方落库） */
  onSave: (text: string, weight: MemWeight, time: { eventTime: number | null; expiresAt: number | null }) => void;
  onDelete: () => void;
  /** 仅 frag：淡化中/已归档时显示「回忆一下」 */
  onReinforce?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [editWeight, setEditWeight] = useState<MemWeight>(weight);
  const [confirmDel, setConfirmDel] = useState(false);
  /** 编辑态的时间草稿（datetime-local 字符串；空=无事件时间/永不过期） */
  const [editEvent, setEditEvent] = useState('');
  const [mbWheel, setMbWheel] = useState(false); // 事件时间滚轮（第二十轮：上下滑式）
  const [editExpire, setEditExpire] = useState('');

  const dimCls =
    fade === 'faded' || dim
      ? 'opacity-[0.55]'
      : fade === 'fading'
        ? 'opacity-[0.8]'
        : consumed
          ? 'opacity-[0.72]'
          : '';

  const weightOptions: [MemWeight, string][] = [
    ['high', '重要'],
    ['normal', '普通'],
    ['low', '临时'],
  ];

  return (
    <div data-testid={testid} className={`rounded-[20px] p-4 ${CARD_CLS} ${dimCls}`}>
      {/* 头部：时间/徽章 + 常驻操作图标 */}
      <div className="flex min-h-8 items-center justify-between gap-2">
        {header}
        {!editing && (
          <div className="-mr-1.5 flex items-center">
            {fade !== 'fresh' && onReinforce && (
              <button
                type="button"
                aria-label="回忆一下"
                data-testid={`${testid}-reinforce`}
                onClick={onReinforce}
                className="grid h-8 w-8 place-items-center rounded-full text-black/30 transition-colors active:bg-black/[0.06] active:text-black/70 dark:text-white/30 dark:active:bg-white/[0.1] dark:active:text-white/70"
              >
                <RotateCcw className="h-[15px] w-[15px]" strokeWidth={1.8} />
              </button>
            )}
            <button
              type="button"
              aria-label="编辑记忆"
              onClick={() => {
                setDraft(content);
                setEditWeight(weight);
                setEditEvent(time?.eventTime != null ? toInputValue(time.eventTime) : '');
                setEditExpire(time?.expiresAt != null ? toInputValue(time.expiresAt) : '');
                setEditing(true);
              }}
              className="grid h-8 w-8 place-items-center rounded-full text-black/30 transition-colors active:bg-black/[0.06] active:text-black/70 dark:text-white/30 dark:active:bg-white/[0.1] dark:active:text-white/70"
            >
              <Pencil className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="删除记忆"
              onClick={() => setConfirmDel(true)}
              className="grid h-8 w-8 place-items-center rounded-full text-black/30 transition-colors active:bg-black/[0.06] active:text-black/70 dark:text-white/30 dark:active:bg-white/[0.1] dark:active:text-white/70"
            >
              <Trash2 className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {/* 虚线分隔：档案质感 */}
      <div aria-hidden="true" className="mt-2 border-t border-dashed border-black/[0.12] dark:border-white/[0.14]" />

      {editing ? (
        <div className="pt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={300}
            aria-label="编辑记忆内容"
            className="w-full resize-none rounded-xl bg-black/[0.04] p-2.5 text-[14.5px] leading-relaxed outline-none ring-1 ring-black/[0.08] focus:ring-neutral-900/35 dark:bg-white/[0.06] dark:ring-white/[0.12] dark:focus:ring-white/40"
          />
          {showWeight && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[11.5px] text-black/40 dark:text-white/40">权重</span>
              {weightOptions.map(([w, label]) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={editWeight === w}
                  data-testid={`mem-weight-${w}`}
                  onClick={() => setEditWeight(w)}
                  className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    editWeight === w
                      ? INK
                      : 'bg-black/[0.05] text-black/55 active:bg-black/[0.1] dark:bg-white/[0.08] dark:text-white/55 dark:active:bg-white/[0.14]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {time && (
            <div className="mt-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-[52px] shrink-0 text-[11.5px] text-black/40 dark:text-white/40">事件时间</span>
                <button
                  type="button"
                  onClick={() => setMbWheel(true)}
                  aria-label="设置事件时间"
                  data-testid={`${testid}-event-time`}
                  className={`h-8 min-w-0 flex-1 rounded-lg bg-black/[0.04] px-2 text-left text-[12.5px] tabular-nums outline-none ring-1 ring-black/[0.08] focus:ring-neutral-900/35 dark:bg-white/[0.06] dark:ring-white/[0.12] dark:focus:ring-white/40 ${editEvent ? 'text-foreground' : 'text-black/40 dark:text-white/40'}`}
                >
                  {editEvent ? editEvent.replace('T', ' ') : '设置时间'}
                </button>
                {/* 事件时间滚轮弹窗（第二十轮：上下滑式，含时分） */}
                <WheelDatePicker
                  open={mbWheel}
                  value={editEvent}
                  withTime
                  onConfirm={(v) => {
                    setEditEvent(v);
                    setMbWheel(false);
                  }}
                  onCancel={() => setMbWheel(false)}
                  title="事件时间"
                />
                {editEvent && (
                  <button
                    type="button"
                    aria-label="清除事件时间"
                    onClick={() => setEditEvent('')}
                    className="shrink-0 text-[11.5px] text-black/40 active:opacity-60 dark:text-white/40"
                  >
                    清除
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="w-[52px] shrink-0 text-[11.5px] text-black/40 dark:text-white/40">过期时间</span>
                <input
                  type="datetime-local"
                  value={editExpire}
                  onChange={(e) => setEditExpire(e.target.value)}
                  aria-label="设置过期时间"
                  data-testid={`${testid}-expire-time`}
                  className="h-8 min-w-0 flex-1 rounded-lg bg-black/[0.04] px-2 text-[12.5px] tabular-nums outline-none ring-1 ring-black/[0.08] focus:ring-neutral-900/35 dark:bg-white/[0.06] dark:ring-white/[0.12] dark:focus:ring-white/40"
                />
                {editExpire && (
                  <button
                    type="button"
                    aria-label="清除过期时间"
                    onClick={() => setEditExpire('')}
                    className="shrink-0 text-[11.5px] text-black/40 active:opacity-60 dark:text-white/40"
                  >
                    清除
                  </button>
                )}
              </div>
              <p className="text-[10.5px] leading-relaxed text-black/30 dark:text-white/30">
                过期时间留空 = 永不过期；手动设置后以这里为准，自动提取不再改写时间
              </p>
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(content);
              }}
              className="rounded-full px-3.5 py-1.5 text-[13.5px] text-black/50 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              data-testid={`${testid}-save`}
              onClick={() => {
                const t = draft.trim();
                if (t)
                  onSave(t, editWeight, {
                    eventTime: editEvent ? fromInputValue(editEvent) : null,
                    expiresAt: editExpire ? fromInputValue(editExpire) : null,
                  });
                setEditing(false);
              }}
              className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium active:opacity-80 ${INK}`}
            >
              <Check className="h-[14px] w-[14px]" /> 保存
            </button>
          </div>
        </div>
      ) : confirmDel ? (
        <div className="flex items-center justify-between gap-2 pt-3">
          <span className="text-[12.5px] text-black/55 dark:text-white/55">确定删除这条记忆？</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              className="rounded-full px-3 py-1.5 text-[13.5px] text-black/50 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              data-testid={`${testid}-del-confirm`}
              onClick={() => onDelete()}
              className={`rounded-full px-3.5 py-1.5 text-[13.5px] font-medium active:opacity-80 ${INK}`}
            >
              删除
            </button>
          </div>
        </div>
      ) : (
        <>
          <p
            className={`whitespace-pre-wrap break-words pt-3 text-[14.5px] leading-relaxed ${
              variant !== 'frag' ? 'font-medium' : ''
            }`}
          >
            {content}
          </p>
          <div className="mt-2.5 text-[11.5px] text-black/40 dark:text-white/40">{meta}</div>
        </>
      )}
    </div>
  );
}
