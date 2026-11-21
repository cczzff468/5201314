'use client';

/**
 * 线下模式（约会）—— 全屏见面页（QQ / 微信两端共用；信息端入口已移除，历史 sms 数据仍兼容回看）。
 *
 * 结构（对照需求与参考截图，整体毛玻璃/胶囊玻璃风格）：
 * - 环境：纯色底（氛围光斑已按需求全局移除），所有卡片/按钮均为毛玻璃（backdrop-blur）；
 * - 头部：一整颗大毛玻璃胶囊包住 返回 + 头像名字日期 + 收藏（保存）+ 现场设置；
 * - 叙事流：角色叙述（玻璃大卡 + 迷你头像名字时间头）+ 用户输入（灰色玻璃气泡，内部同样是头像+名字+时间头）；
 *   两边消息均可编辑/删除；动作·叙述文字渲染为灰色小字，说话保持原样式
 *   （角色按「」『』“”"" 引号识别说话，用户按（）、*星号* 识别动作描写）；
 * - 底部：继续 / 重Roll 圆钮 + 输入框（内嵌深色圆形↑发送钮）；保存走顶部收藏钮；
 *   重Roll 后可一键恢复上一版回复；
 * - 存档（头部右侧 Archive 按钮）：新建（保存当前进度）/ 覆盖 / 读档（恢复到存档时刻）/ 删除 /
 *   重命名 / 导出为 JSON 文件 / 从文件导入；按角色隔离，含整场见面完整快照；
 * - 无见面时：极简开始页（头像 + 名字 + 开始见面 + 过去的见面历史入口，历史只读回看）；
 * - 现场设置面板：「从聊天继续」承接最近 N 条（置于最上方）/ 回复字数 / 用户·角色叙述人称 /
 *   回复预设 / 基础设置 / 变量说明 / 角色回复预设模板编辑 / 现场文风（内置+新建）。
 *
 * 数据：进行中的见面按角色 ID 隔离（offline-meet:<contactId>）；生成走 /api/offline；
 * 保存时经 memAddEventFragment 写入记忆库（sourceTag 'offline-meet'），线上聊天可召回。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { promptTextOf } from '@/lib/prompt-entries';
import {
  Archive,
  ArrowUp,
  ChevronLeft,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Star,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';

import type { ContactRecord } from '@/lib/contacts';
import { getContact, listContacts } from '@/lib/ios/contacts-store';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';
import { useSettings } from '@/lib/ios/store';
import { isLiquidTheme, isRetroTheme, type BubbleStyleConfig } from '@/lib/ios/bubble-style';
import { OFFLINE_CSS_TEMPLATES, OFFLINE_CSS_SCOPE, scopeCss } from '@/lib/ios/custom-css';
import { CustomCssEditor } from './custom-css-editor';
import { getMemSettings, memAddEventFragment, memRecallBlock } from '@/lib/memory';
import {
  collectWbBlocks,
  wbRulesBlock,
  wbScanText,
} from '@/lib/ios/worldbook';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import {
  BUILTIN_STYLES,
  DEFAULT_OFFLINE_SETTINGS,
  OFFLINE_BUILTIN_PRESET_ID,
  OFFLINE_BUILTIN_STYLE_ID,
  OFFLINE_CARRY_OPTIONS,
  OFFLINE_DEFAULT_TEMPLATE,
  OFFLINE_PACE_LABEL,
  OFFLINE_TRI_LABEL,
  OFFLINE_VARIABLES,
  addMeetToHistory,
  buildContinueInstruction,
  buildMeetDigest,
  buildOfflineDirective,
  buildOfflineHistoryText,
  buildOpenInstruction,
  clearMeet,
  effectiveCharPerson,
  effectiveReplyTarget,
  extractSceneHeader,
  loadMeet,
  loadMeetHistory,
  loadMeetSettings,
  loadPresets,
  loadStyles,
  loadTplOverride,
  loadWbBgCache,
  loadArchives,
  looksLikeRepeat,
  normalizeOfflineSettings,
  offlineUid,
  renderTemplate,
  saveArchives,
  saveCustomPresets,
  saveCustomStyles,
  saveMeet,
  saveMeetSettings,
  saveTplOverride,
  saveWbBgCache,
  sanitizeArchive,
  type OfflineApp,
  type OfflineArchive,
  type OfflineEntry,
  type OfflineMeet,
  type OfflineMeetSettings,
  type OfflineOnlineMsg,
  type OfflinePreset,
  type OfflineStyle,
} from '@/lib/offline-meet';
import { LocalToast, useLocalToast } from '@/components/apps/page-toast';

// ---------------- 对外类型 ----------------

export interface OfflineMeetingPageProps {
  /** 来源 App（决定记忆库的 app 键与文案） */
  app: OfflineApp;
  /** 渠道名（微信 / QQ / 短信，人设注入用） */
  channel: string;
  /** 当前角色（联系人）id —— 线下见面按角色 ID 隔离 */
  contactId: string;
  /** 用户称呼（addressNameOf 解析结果；空 = 回退「我」） */
  userName: string;
  /** 机主真实姓名（人设称呼用；用户规则：昵称不再传入，AI 永远不知道机主昵称） */
  userRealName?: string | null;
  /** 机主头像（用户消息头显示用；微信/QQ 传 me.avatar，信息端传资料头像） */
  userAvatar?: string | null;
  /** 读取最近 n 条线上聊天（宿主按各 App 消息结构映射） */
  loadRecentMsgs: (n: number) => OfflineOnlineMsg[];
  onBack: () => void;
  /** App 级 toast（宿主提供；信息端传自己的 showToast） */
  onToast?: (m: string) => void;
}

// ---------------- 玻璃风格共用件 ----------------

/** 毛玻璃卡（叙事 / 信息卡；默认主题） */
const GLASS_CARD =
  'border border-white/60 bg-white/55 shadow-[0_8px_28px_rgba(60,50,40,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[0_8px_28px_rgba(0,0,0,0.4)]';

/** 毛玻璃胶囊（圆钮 / 小按钮 / 状态条；默认主题） */
const GLASS_CAPSULE =
  'border border-white/70 bg-white/55 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08]';

/** 主按钮（新建/保存等；默认 & 液态共用深色实心玻璃） */
const DARK_PRIMARY =
  'bg-[#1C1C1E]/90 text-white shadow-md backdrop-blur-xl active:opacity-80 dark:bg-white dark:text-black';

// ---------------- 主题皮肤（第六十五轮：线下界面跟随古早/液态玻璃主题） ----------------

/** 线下界面皮肤 token：默认 = 毛玻璃；古早 = 银灰拟物（rt-*）；液态 = 清透玻璃（lg-*）。
 *  同时携带语义类（off-card / off-chip / off-input…），给「自定义 CSS」提供稳定错点 */
export interface OfflineSkin {
  retro: boolean;
  liquid: boolean;
  /** 页面根底色（默认暖米色 / rt-root / lg-root） */
  pageCls: string;
  /** 卡片（叙事 / 信息 / 表单卡） */
  cardCls: string;
  /** 小圆钮独立椭圆包裹（返回/收藏/存档/设置/继续/重Roll） */
  chipCls: string;
  /** 输入框（表单字段） */
  inputCls: string;
  /** 主按钮（深色实心 / 复古蓝） */
  primaryCls: string;
  /** 次按钮（取消 / 关闭） */
  ghostCls: string;
  /** 底部聊天输入条 */
  chatInputCls: string;
  /** 底部发送钮 */
  sendCls: string;
  /** 自定义 CSS 编辑器主色 */
  editorAccent: string;
}

/** 表单输入框共用的排版部分（高度/内边距/字号由各用途自带；这里只给文字色系） */
const INPUT_TEXT =
  'text-black outline-none placeholder:text-black/25 focus:border-black/25 dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/30';

function resolveOfflineSkin(retro: boolean, liquid: boolean): OfflineSkin {
  if (retro) {
    return {
      retro: true,
      liquid: false,
      pageCls: 'rt-root',
      cardCls: 'off-card rt-panel',
      chipCls: 'off-chip rt-chip',
      inputCls: `off-input rt-input ${INPUT_TEXT}`,
      primaryCls: 'off-btn-primary rt-send-qq text-white font-medium',
      ghostCls: 'off-btn-ghost rt-chip text-black/60 dark:text-white/60',
      chatInputCls: 'off-input rt-search text-black outline-none placeholder:text-black/30 dark:text-white dark:placeholder:text-white/30',
      sendCls: 'off-send rt-send-qq text-white',
      editorAccent: '#3D6DB5',
    };
  }
  if (liquid) {
    return {
      retro: false,
      liquid: true,
      pageCls: 'lg-root',
      cardCls: 'off-card lg-card',
      chipCls: 'off-chip lg-chip',
      inputCls: `off-input lg-input ${INPUT_TEXT}`,
      primaryCls: `off-btn-primary ${DARK_PRIMARY}`,
      ghostCls: 'off-btn-ghost lg-chip text-black/60 dark:text-white/60',
      chatInputCls: 'off-input lg-input text-black outline-none placeholder:text-black/30 dark:text-white dark:placeholder:text-white/30',
      sendCls: `off-send ${DARK_PRIMARY}`,
      editorAccent: '#007AFF',
    };
  }
  return {
    retro: false,
    liquid: false,
    pageCls: 'bg-[#F3F1EE] dark:bg-[#0C0C0E]',
    cardCls: `off-card ${GLASS_CARD}`,
    chipCls: `off-chip ${GLASS_CAPSULE}`,
    inputCls: `off-input border border-white/70 bg-white/70 ${INPUT_TEXT}`,
    primaryCls: `off-btn-primary ${DARK_PRIMARY}`,
    ghostCls: `off-btn-ghost ${GLASS_CAPSULE} text-black/60 dark:text-white/60`,
    chatInputCls: 'off-input border border-white/70 bg-white/60 text-black outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/30',
    sendCls: `off-send ${DARK_PRIMARY}`,
    editorAccent: '#1C1C1E',
  };
}

const OfflineSkinCtx = createContext<OfflineSkin>(resolveOfflineSkin(false, false));

/** 线下页内部件读取当前皮肤 token（由主页面 OfflineSkinProvider 下发） */
function useOfflineSkin(): OfflineSkin {
  return useContext(OfflineSkinCtx);
}

/** M月D日 HH:MM（正文时间戳：角色 / 用户消息都用） */
function mdhm(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 多档分段选择（毛玻璃药丸） */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<{ v: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full bg-black/[0.06] p-1 dark:bg-white/[0.08]">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`h-8 flex-1 rounded-full text-[13px] transition ${
            value === o.v
              ? 'bg-white/90 font-medium text-black shadow-sm backdrop-blur-md dark:bg-white/[0.18] dark:text-white'
              : 'text-black/45 dark:text-white/45'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FieldLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <p className="text-[15px] font-medium text-black/85 dark:text-white/90">{title}</p>
      {hint ? <p className="mt-0.5 text-[12px] leading-[1.4] text-black/40 dark:text-white/40">{hint}</p> : null}
    </div>
  );
}

/** 表单字段共用排版（高度/内边距/字号；皮肤只给底色描边文字色） */
const FIELD_BASE = 'h-11 w-full rounded-[14px] px-3 text-[15px]';

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const skin = useOfflineSkin();
  return <div className={`rounded-[20px] p-4 ${skin.cardCls} ${className}`}>{children}</div>;
}

/** 头像（联系人头像 dataURL 或首字母圆） */
function MeetAvatar({ contact, size = 44 }: { contact: ContactRecord | null; size?: number }) {
  const name = contact?.nickname?.trim() || contact?.name || '?';
  if (contact?.avatar) {
    return <img src={contact.avatar} alt={name} className="rounded-full object-cover ring-2 ring-white/80 dark:ring-white/15" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#FFD54F] to-[#FFB300] font-semibold text-white ring-2 ring-white/80 dark:ring-white/15"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </div>
  );
}

/** 用户头像（机主资料头像 dataURL 或首字母圆；绿色系与角色区分） */
function UserAvatar({ avatar, name, size = 44 }: { avatar?: string | null; name: string; size?: number }) {
  if (avatar) {
    return <img src={avatar} alt={name} className="rounded-full object-cover ring-2 ring-white/80 dark:ring-white/15" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#6EE7B7] to-[#10B981] font-semibold text-white ring-2 ring-white/80 dark:ring-white/15"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </div>
  );
}

// ---------------- 叙事富文本：动作·叙述灰字，说话原样 ----------------

interface NarrSeg {
  text: string;
  /** true = 说话（保持原样式）；false = 动作/叙述（灰色小字） */
  speech: boolean;
}

/** 角色叙述：引号内（「」『』“”""）= 说话，其余 = 动作/叙述描写 */
const CHAR_SPEECH_RE = /「[^」\n]*」|『[^』\n]*』|“[^”\n]*”|"[^"\n]*"/g;

/** 用户输入：（…）、(…)、*…* 内 = 动作描写，其余 = 说话 */
const USER_ACTION_RE = /（[^）\n]*）|\([^)\n]*\)|\*[^*\n]+\*/g;

/** 把文本切成 说话/动作 片段：matchesSpeech 决定正则命中段算说话（角色）还是动作（用户） */
function splitNarrative(text: string, re: RegExp, matchesSpeech: boolean): NarrSeg[] {
  const segs: NarrSeg[] = [];
  const rx = new RegExp(re.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), speech: !matchesSpeech });
    segs.push({ text: m[0], speech: matchesSpeech });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last), speech: !matchesSpeech });
  return segs.length ? segs : [{ text, speech: true }];
}

/** 叙事正文渲染：灰色小字 = 动作/叙述，正常样式 = 说话 */
function NarrBody({ text, role }: { text: string; role: 'char' | 'user' }) {
  const segs = splitNarrative(text, role === 'char' ? CHAR_SPEECH_RE : USER_ACTION_RE, role === 'char');
  return (
    <div className="whitespace-pre-wrap">
      {segs.map((s, i) =>
        s.speech ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span key={i} className="text-[13px] text-black/40 dark:text-white/40">{s.text}</span>
        ),
      )}
    </div>
  );
}

/** 条目小工具：编辑 / 删除（我和角色的消息都有） */
function EntryTools({ onEdit, onDelete, disabled }: { onEdit: () => void; onDelete: () => void; disabled?: boolean }) {
  const base = 'text-black/30 hover:bg-black/5 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60';
  const danger = 'text-black/30 hover:bg-red-500/10 hover:text-red-500 dark:text-white/30 dark:hover:text-red-400';
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label="编辑这条内容"
        title="编辑"
        onClick={onEdit}
        disabled={disabled}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-30 ${base}`}
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label="删除这条内容"
        title="删除"
        onClick={onDelete}
        disabled={disabled}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-30 ${danger}`}
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

/** 条目编辑块：textarea + 取消/保存 */
function EntryEdit({ value, onChange, onCancel, onSave }: { value: string; onChange: (v: string) => void; onCancel: () => void; onSave: () => void }) {
  const skin = useOfflineSkin();
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(12, Math.max(3, Math.ceil(value.length / 24)))}
        autoFocus
        className="w-full resize-y rounded-[14px] border border-white/70 bg-white/70 p-3 text-[14px] leading-[1.7] text-black outline-none backdrop-blur-md focus:border-black/25 dark:border-white/10 dark:bg-black/25 dark:text-white dark:focus:border-white/30"
        aria-label="编辑内容"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`h-8 rounded-full px-4 text-[13px] active:opacity-60 ${skin.ghostCls}`}
        >
          取消
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!value.trim()}
          className={`h-8 rounded-full px-4 text-[13px] disabled:opacity-40 ${skin.primaryCls}`}
        >
          保存
        </button>
      </div>
    </div>
  );
}

// ---------------- 存档面板（新建 / 覆盖 / 读档 / 删除 / 重命名 / 导出 / 导入） ----------------

/** 存档行内小按钮 */
function MiniBtn({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  const skin = useOfflineSkin();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center rounded-full px-3 text-[12px] backdrop-blur-md transition active:scale-95 ${
        danger
          ? 'border border-red-500/25 bg-red-500/10 text-red-500 dark:border-red-400/20 dark:text-red-400'
          : skin.ghostCls
      }`}
    >
      {children}
    </button>
  );
}

type ArchiveConfirmKind = 'load' | 'overwrite' | 'delete';

interface ArchivePanelProps {
  archives: OfflineArchive[];
  /** 是否有进行中的见面（新建 / 覆盖入口的可用性） */
  meetActive: boolean;
  /** 当前进度是否已有内容（读档确认用：无内容时读档免确认） */
  hasProgress: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  onLoad: (id: string) => void;
  onOverwrite: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onExport: (id: string) => void;
  onImport: (file: File) => void;
}

function ArchivePanel({ archives, meetActive, hasProgress, onClose, onCreate, onLoad, onOverwrite, onDelete, onRename, onExport, onImport }: ArchivePanelProps) {
  const skin = useOfflineSkin();
  const [newName, setNewName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmAct, setConfirmAct] = useState<null | { id: string; kind: ArchiveConfirmKind }>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 危险操作二次确认：第一次点击进入确认态，再点确认才执行；读档在无进度时直接执行 */
  const ask = (id: string, kind: ArchiveConfirmKind) => {
    if (kind === 'load' && !hasProgress) {
      onLoad(id);
      return;
    }
    if (confirmAct && confirmAct.id === id && confirmAct.kind === kind) {
      if (kind === 'load') onLoad(id);
      else if (kind === 'overwrite') onOverwrite(id);
      else onDelete(id);
      setConfirmAct(null);
      return;
    }
    setConfirmAct({ id, kind });
  };

  const confirmText: Record<ArchiveConfirmKind, string> = {
    load: '读档会把当前进度替换成这份存档',
    overwrite: '覆盖会用当前进度替换这份存档的旧内容',
    delete: '删除后无法恢复',
  };

  return (
    /* off-panel-archive：存档面板根锚点（线下自定义 CSS 模板可单独改存档页） */
    <div className={`off-panel-archive absolute inset-0 z-30 flex flex-col overflow-hidden ${skin.pageCls} text-black dark:text-white`}>
      <div className="flex items-start justify-between px-5 pb-3 pt-[58px]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-black/35 dark:text-white/35">Save Files</p>
          <h2 className="mt-1 text-[26px] font-bold text-black dark:text-white">存档</h2>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">见面进度快照，按角色保存；读档随时回到存档那一刻。</p>
        </div>
        <button
          type="button"
          aria-label="关闭存档"
          data-testid="offline-archive-close"
          onClick={onClose}
          className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-black/60 active:opacity-60 dark:text-white/70 ${skin.chipCls}`}
        >
          <X className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6 thin-scrollbar">
        {/* 新建存档 */}
        <Card>
          <FieldLabel title="新建存档" hint={meetActive ? '把当前见面进度完整保存为一个新存档' : '当前没有进行中的见面，开始见面后才能新建存档'} />
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`存档名称，默认「见面存档 ${mdhm(Date.now())}」`}
              maxLength={30}
              disabled={!meetActive}
              className={`${skin.inputCls} ${FIELD_BASE}`}
              aria-label="存档名称"
            />
            <button
              type="button"
              data-testid="offline-archive-create"
              onClick={() => {
                onCreate(newName.trim());
                setNewName('');
              }}
              disabled={!meetActive}
              className={`h-11 shrink-0 rounded-[14px] px-4 text-[14px] disabled:opacity-40 ${skin.primaryCls}`}
            >
              新建
            </button>
          </div>
        </Card>

        {/* 存档列表 */}
        {archives.length === 0 ? (
          <p className="pt-10 text-center text-[14px] text-black/40 dark:text-white/40">还没有存档</p>
        ) : (
          archives.map((a) => {
            const act = confirmAct && confirmAct.id === a.id ? confirmAct : null;
            return (
              <div key={a.id} data-testid="offline-archive-item" className={`rounded-[20px] p-4 ${skin.cardCls}`}>
                {renameId === a.id ? (
                  <div>
                    <FieldLabel title="重命名存档" />
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        maxLength={30}
                        className={`${skin.inputCls} ${FIELD_BASE}`}
                        aria-label="新存档名称"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && renameText.trim()) {
                            onRename(a.id, renameText.trim());
                            setRenameId(null);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setRenameId(null)}
                        className={`h-11 shrink-0 rounded-[14px] px-4 text-[14px] active:opacity-60 ${skin.ghostCls}`}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={!renameText.trim()}
                        onClick={() => {
                          onRename(a.id, renameText.trim());
                          setRenameId(null);
                        }}
                        className={`h-11 shrink-0 rounded-[14px] px-4 text-[14px] disabled:opacity-40 ${skin.primaryCls}`}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-black/85 dark:text-white/90">{a.name}</p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-black/40 dark:text-white/40">
                        存于 {mdhm(a.savedAt)} · 见面 {mdhm(a.meet.startedAt)} · {a.meet.entries.length} 条
                      </p>
                    </div>
                    {act ? (
                      <div className="mt-3 flex items-center gap-2">
                        <p className="min-w-0 flex-1 text-[12px] leading-[1.4] text-red-500/90 dark:text-red-400/90">
                          {confirmText[act.kind]}，确认{act.kind === 'load' ? '读档' : act.kind === 'overwrite' ? '覆盖' : '删除'}？
                        </p>
                        <button
                          type="button"
                          onClick={() => ask(a.id, act.kind)}
                          className="h-8 shrink-0 rounded-full bg-red-500/90 px-3.5 text-[12px] font-medium text-white shadow-sm active:opacity-80"
                        >
                          确认
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmAct(null)}
                          className={`h-8 shrink-0 rounded-full px-3.5 text-[12px] active:opacity-60 ${skin.ghostCls}`}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <MiniBtn onClick={() => ask(a.id, 'load')}>读档</MiniBtn>
                        {meetActive ? <MiniBtn onClick={() => ask(a.id, 'overwrite')}>覆盖</MiniBtn> : null}
                        <MiniBtn
                          onClick={() => {
                            setRenameId(a.id);
                            setRenameText(a.name);
                            setConfirmAct(null);
                          }}
                        >
                          重命名
                        </MiniBtn>
                        <MiniBtn onClick={() => onExport(a.id)}>导出</MiniBtn>
                        <MiniBtn danger onClick={() => ask(a.id, 'delete')}>
                          删除
                        </MiniBtn>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}

        {/* 导入存档 */}
        <button
          type="button"
          data-testid="offline-archive-import"
          onClick={() => fileRef.current?.click()}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-dashed border-black/20 bg-white/40 text-[13px] text-black/60 backdrop-blur-md active:opacity-60 dark:border-white/20 dark:bg-white/[0.05] dark:text-white/60"
        >
          <Upload className="h-4 w-4" />
          导入存档（选择导出的 .json 文件）
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

// ---------------- 现场设置面板 ----------------

interface SettingsPanelProps {
  initial: OfflineMeetSettings;
  presets: OfflinePreset[];
  styles: OfflineStyle[];
  tpl: string;
  meetActive: boolean;
  /** 可承接的线上聊天条数（提示用） */
  availableCount: number;
  onClose: () => void;
  onCommit: (settings: OfflineMeetSettings, tpl: string) => void;
  /** 重新分析世界背景（清缓存 → 再分析 → 见面中同步更新本次见面） */
  onRefreshWorldBg: () => void;
  bgRefreshing: boolean;
  /** 放弃这次见面（仅见面中提供；无见面时不传） */
  onAbandon?: () => void;
  onCreatePreset: (name: string, template: string) => string;
  onSavePreset: (id: string, template: string) => void;
  onDeletePreset: (id: string) => void;
  onCreateStyle: (name: string, content: string) => string;
  onDeleteStyle: (id: string) => void;
  /** 弹提示（自定义 CSS 编辑器等区块的操作反馈） */
  onToast: (m: string) => void;
}

function OfflineSettingsPanel({ initial, presets, styles, tpl, meetActive, availableCount, onClose, onCommit, onRefreshWorldBg, bgRefreshing, onAbandon, onCreatePreset, onSavePreset, onDeletePreset, onCreateStyle, onDeleteStyle, onToast }: SettingsPanelProps) {
  const skin = useOfflineSkin();
  const [d, setD] = useState<OfflineMeetSettings>({ ...initial });
  const [tplDraft, setTplDraft] = useState(tpl);
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  const [carrySel, setCarrySel] = useState<number | 'custom'>(() =>
    (OFFLINE_CARRY_OPTIONS as readonly number[]).includes(initial.carryCount) ? initial.carryCount : 'custom',
  );
  const [carryCustom, setCarryCustom] = useState(String(initial.carryCount));
  const [presetPanel, setPresetPanel] = useState<null | { mode: 'new' | 'save-as'; name: string }>(null);
  const [stylePanel, setStylePanel] = useState<null | { name: string; content: string }>(null);
  const activePreset = presets.find((p) => p.id === d.presetId) ?? presets[0];
  const activeStyle = styles.find((s) => s.id === d.styleId) ?? styles[0];

  const up = (patch: Partial<OfflineMeetSettings>) => setD((prev) => ({ ...prev, ...patch }));

  return (
    /* off-panel-settings：现场设置面板根锚点（线下自定义 CSS 模板可单独改设置页） */
    <div className={`off-panel-settings absolute inset-0 z-30 flex flex-col overflow-hidden ${skin.pageCls} text-black dark:text-white`}>
      <div className="flex items-start justify-between px-5 pb-3 pt-[58px]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-black/35 dark:text-white/35">Meeting Preferences</p>
          <h2 className="mt-1 text-[26px] font-bold text-black dark:text-white">现场设置</h2>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">承接条数在下次开始见面时生效；其余只影响{meetActive ? '本次线下见面' : '下次线下见面'}。</p>
        </div>
        <button
          type="button"
          aria-label="关闭现场设置"
          onClick={onClose}
          className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-black/60 active:opacity-60 dark:text-white/70 ${skin.chipCls}`}
        >
          <X className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 thin-scrollbar">
        {/* 从聊天继续（承接最近 N 条线上聊天）—— 置于最上方 */}
        <Card>
          <FieldLabel title="从聊天继续" hint="开始见面时承接最近的线上聊天；已开始的见面不受影响" />
          <div className="flex flex-wrap gap-2">
            {OFFLINE_CARRY_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCarrySel(n)}
                className={`off-btn-ghost h-9 min-w-[52px] rounded-full px-3 text-[14px] transition ${
                  carrySel === n ? skin.primaryCls : skin.ghostCls
                }`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCarrySel('custom')}
              className={`off-btn-ghost h-9 rounded-full px-3 text-[14px] transition ${
                carrySel === 'custom' ? skin.primaryCls : skin.ghostCls
              }`}
            >
              自定义
            </button>
          </div>
          {carrySel === 'custom' ? (
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={200}
              value={carryCustom}
              onChange={(e) => setCarryCustom(e.target.value)}
              onBlur={() => setCarryCustom(String(Math.min(200, Math.max(5, Math.floor(Number(carryCustom) || 20)))))}
              className={`mt-3 h-10 w-32 rounded-[14px] ${skin.inputCls} px-3 text-[15px]`}
              aria-label="自定义承接条数"
              placeholder="5 ~ 200"
            />
          ) : null}
          <p className="mt-3 text-[12px] text-black/40 dark:text-white/40">
            {availableCount > 0 ? `共找到 ${availableCount} 条线上聊天记录可承接` : '最近没有线上聊天记录，也可以直接见面'}
          </p>
        </Card>

        {/* 回复字数 + 叙述人称 + 预设 */}
        <Card>
          <FieldLabel title="角色回复字数" hint="每次回复按设定字数上下浮动 20%" />
          <input
            type="number"
            inputMode="numeric"
            value={d.replyLength}
            min={100}
            max={8000}
            onChange={(e) => up({ replyLength: Math.min(8000, Math.max(100, Math.floor(Number(e.target.value) || 0))) })}
            onBlur={(e) => {
              const v = Math.floor(Number(e.target.value) || 0);
              up({ replyLength: Math.min(8000, Math.max(100, v || DEFAULT_OFFLINE_SETTINGS.replyLength)) });
            }}
            className={`${skin.inputCls} ${FIELD_BASE}`}
            aria-label="角色回复字数"
          />
          <div className="mt-4">
            <FieldLabel title="用户叙述人称" hint="识别用户动作时使用" />
            <select
              value={d.userPerson}
              onChange={(e) => up({ userPerson: e.target.value === '我' ? '我' : '你' })}
              className={`${skin.inputCls} ${FIELD_BASE}`}
              aria-label="用户叙述人称"
            >
              <option value="你">你</option>
              <option value="我">我</option>
            </select>
          </div>
          <div className="mt-4">
            <FieldLabel title="角色叙述人称" hint="角色描述自己时使用" />
            <select
              value={d.charPerson}
              onChange={(e) => up({ charPerson: e.target.value as OfflineMeetSettings['charPerson'] })}
              className={`${skin.inputCls} ${FIELD_BASE}`}
              aria-label="角色叙述人称"
            >
              <option value="他">他</option>
              <option value="她">她</option>
              <option value="我">我</option>
            </select>
          </div>
          <div className="mt-4">
            <FieldLabel title="选择回复预设" />
            <select
              value={activePreset?.id ?? OFFLINE_BUILTIN_PRESET_ID}
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (!p) return;
                up({ presetId: p.id });
                setTplDraft(p.template);
              }}
              className={`${skin.inputCls} ${FIELD_BASE}`}
              aria-label="选择回复预设"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPresetPanel({ mode: 'new', name: '' })}
                className={`flex h-10 items-center justify-center gap-1 rounded-full text-[13px] active:opacity-60 ${skin.ghostCls}`}
              >
                <Plus className="h-4 w-4" /> 新建预设
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activePreset && !activePreset.builtin) {
                    onSavePreset(activePreset.id, tplDraft);
                  } else {
                    setPresetPanel({ mode: 'save-as', name: '' });
                  }
                }}
                className={`flex h-10 items-center justify-center rounded-full text-[13px] active:opacity-60 ${skin.ghostCls}`}
              >
                保存当前预设
              </button>
            </div>
            {activePreset && !activePreset.builtin ? (
              <button
                type="button"
                onClick={() => {
                  const fallback = presets.find((p) => p.builtin);
                  onDeletePreset(activePreset.id);
                  if (fallback) {
                    up({ presetId: fallback.id });
                    setTplDraft(fallback.template);
                  }
                }}
                className="mt-2 flex h-9 w-full items-center justify-center gap-1 rounded-full text-[13px] text-red-500/80 active:opacity-60"
              >
                <Trash2 className="h-4 w-4" /> 删除「{activePreset.name}」
              </button>
            ) : null}
          </div>
        </Card>

        {/* 新建/另存预设 命名面板 */}
        {presetPanel ? (
          <Card className="border-dashed">
            <FieldLabel title={presetPanel.mode === 'new' ? '新建预设' : '保存为新预设'} hint="把当前编辑区里的模板内容保存成一个预设" />
            <input
              value={presetPanel.name}
              onChange={(e) => setPresetPanel({ ...presetPanel, name: e.target.value })}
              placeholder="预设名称，如：慢热型开场"
              maxLength={20}
              className={`${skin.inputCls} ${FIELD_BASE}`}
              aria-label="预设名称"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPresetPanel(null)}
                className={`h-10 rounded-full text-[13px] active:opacity-60 ${skin.ghostCls}`}
              >
                取消
              </button>
              <button
                type="button"
                disabled={!presetPanel.name.trim()}
                onClick={() => {
                  const id = onCreatePreset(presetPanel.name.trim(), tplDraft);
                  up({ presetId: id });
                  setPresetPanel(null);
                }}
                className={`h-10 rounded-full text-[13px] disabled:opacity-40 ${skin.primaryCls}`}
              >
                保存
              </button>
            </div>
          </Card>
        ) : null}

        {/* 基础设置 */}
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-black/35 dark:text-white/35">Basics</p>
          <h3 className="mt-1 text-[16px] font-semibold text-black/85 dark:text-white/90">基础设置</h3>
          <div className="mt-3 space-y-4">
            <div>
              <FieldLabel title="字数区间" hint="回复长度的硬性范围（目标字数会夹进该区间）" />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={d.lenMin}
                  min={50}
                  max={8000}
                  onChange={(e) => up({ lenMin: Math.min(8000, Math.max(50, Math.floor(Number(e.target.value) || 0))) })}
                  className={`${skin.inputCls} ${FIELD_BASE}`}
                  aria-label="字数区间下限"
                />
                <span className="text-black/40 dark:text-white/40">~</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={d.lenMax}
                  min={50}
                  max={8000}
                  onChange={(e) => up({ lenMax: Math.min(8000, Math.max(50, Math.floor(Number(e.target.value) || 0))) })}
                  className={`${skin.inputCls} ${FIELD_BASE}`}
                  aria-label="字数区间上限"
                />
              </div>
            </div>
            <div>
              <FieldLabel title="人称" hint="自动 = 按上面两个字段；指定时覆盖角色叙述人称" />
              <Seg
                value={d.person}
                onChange={(v) => up({ person: v })}
                options={[
                  { v: 'auto', label: '自动' },
                  { v: 'first', label: '一人称' },
                  { v: 'second', label: '二人称' },
                  { v: 'third', label: '三人称' },
                ]}
              />
            </div>
            <button type="button" onClick={() => up({ director: !d.director })} className="flex w-full items-center justify-between" aria-pressed={d.director}>
              <span className="text-left">
                <span className="block text-[15px] font-medium text-black/85 dark:text-white/90">导演模式</span>
                <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">开启后 AI 可推进小事件、转换场景、推动时间流动</span>
              </span>
              <span className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition ${d.director ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/20'}`}>
                <span className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${d.director ? 'left-[20px]' : 'left-[2px]'}`} />
              </span>
            </button>
            <div>
              <FieldLabel title="自主推进强度" />
              <Seg
                value={d.autonomy}
                onChange={(v) => up({ autonomy: v })}
                options={[
                  { v: 'low', label: OFFLINE_TRI_LABEL.low },
                  { v: 'medium', label: OFFLINE_TRI_LABEL.medium },
                  { v: 'high', label: OFFLINE_TRI_LABEL.high },
                ]}
              />
            </div>
            <div>
              <FieldLabel title="修辞密度" />
              <Seg
                value={d.rhetoric}
                onChange={(v) => up({ rhetoric: v })}
                options={[
                  { v: 'low', label: OFFLINE_TRI_LABEL.low },
                  { v: 'medium', label: OFFLINE_TRI_LABEL.medium },
                  { v: 'high', label: OFFLINE_TRI_LABEL.high },
                ]}
              />
            </div>
            <div>
              <FieldLabel title="描写占比" />
              <Seg
                value={d.description}
                onChange={(v) => up({ description: v })}
                options={[
                  { v: 'low', label: OFFLINE_TRI_LABEL.low },
                  { v: 'medium', label: OFFLINE_TRI_LABEL.medium },
                  { v: 'high', label: OFFLINE_TRI_LABEL.high },
                ]}
              />
            </div>
            <div>
              <FieldLabel title="节奏快慢" />
              <Seg
                value={d.pace}
                onChange={(v) => up({ pace: v })}
                options={[
                  { v: 'slow', label: OFFLINE_PACE_LABEL.slow },
                  { v: 'medium', label: OFFLINE_PACE_LABEL.medium },
                  { v: 'fast', label: OFFLINE_PACE_LABEL.fast },
                ]}
              />
            </div>
          </div>
        </Card>

        {/* 变量说明 */}
        <Card>
          <p className="text-[15px] font-medium text-black/85 dark:text-white/90">变量说明</p>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {OFFLINE_VARIABLES.map((v) => (
              <p key={v.name} className="text-[12px] leading-[1.5] text-black/55 dark:text-white/55">
                <code className="rounded-md bg-white/60 px-1.5 py-0.5 font-mono text-[11px] text-black/75 ring-1 ring-white/70 dark:bg-white/[0.08] dark:text-white/75 dark:ring-white/10">{v.name}</code> {v.desc}
              </p>
            ))}
          </div>
        </Card>

        {/* 角色回复预设模板 */}
        <Card>
          <FieldLabel title="角色回复预设" hint="默认显示完整模板；支持 {{char_name}} 等变量，发送前自动替换" />
          <textarea
            value={tplDraft}
            onChange={(e) => setTplDraft(e.target.value)}
            rows={14}
            className="w-full rounded-[14px] border border-white/70 bg-white/70 p-3 text-[13px] leading-[1.7] text-black outline-none backdrop-blur-md focus:border-black/25 dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:focus:border-white/30"
            aria-label="角色回复预设模板"
          />
          <p className="mt-1.5 text-[12px] leading-[1.5] text-black/40 dark:text-white/40">
            保存设置后，这里的内容会在每次线下回复前被读取；变量会先替换成当前角色、用户、世界背景和现场记录，再发送给 API。要长期保留请用「保存当前预设」。
          </p>
        </Card>

        {/* 现场文风 */}
        <Card>
          <FieldLabel title="现场文风" hint="沿用内置文风，也可以自己新建" />
          <select
            value={activeStyle?.id ?? OFFLINE_BUILTIN_STYLE_ID}
            onChange={(e) => up({ styleId: e.target.value })}
            className={`${skin.inputCls} ${FIELD_BASE}`}
            aria-label="现场文风"
          >
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {activeStyle ? (
            <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[14px] border border-white/60 bg-white/50 p-3 text-[12px] leading-[1.7] text-black/60 backdrop-blur-md thin-scrollbar dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60">
              {activeStyle.content}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setStylePanel({ name: '', content: '' })}
            className={`mt-2 flex h-10 w-full items-center justify-center gap-1 rounded-full border border-dashed border-black/20 bg-white/40 text-[13px] text-black/60 backdrop-blur-md active:opacity-60 dark:border-white/20 dark:bg-white/[0.05] dark:text-white/60`}
          >
            <Plus className="h-4 w-4" /> 新建文风
          </button>
          {activeStyle && !activeStyle.builtin ? (
            <button
              type="button"
              onClick={() => {
                const fallback = styles.find((s) => s.builtin);
                onDeleteStyle(activeStyle.id);
                if (fallback) up({ styleId: fallback.id });
              }}
              className="mt-1 flex h-9 w-full items-center justify-center gap-1 rounded-full text-[13px] text-red-500/80 active:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> 删除「{activeStyle.name}」
            </button>
          ) : null}
        </Card>

        {/* 新建文风面板 */}
        {stylePanel ? (
          <Card className="border-dashed">
            <FieldLabel title="新建文风" hint="文风内容会替换进 {{writing_style}} 变量，写给 AI 的写作指令" />
            <input
              value={stylePanel.name}
              onChange={(e) => setStylePanel({ ...stylePanel, name: e.target.value })}
              placeholder="文风名称，如：港式都市"
              maxLength={20}
              className={`${skin.inputCls} ${FIELD_BASE}`}
              aria-label="文风名称"
            />
            <textarea
              value={stylePanel.content}
              onChange={(e) => setStylePanel({ ...stylePanel, content: e.target.value })}
              rows={6}
              placeholder="描述这种文风的句子节奏、用词、修辞与情绪处理方式…"
              className="mt-2 w-full rounded-[14px] border border-white/70 bg-white/70 p-3 text-[13px] leading-[1.7] text-black outline-none backdrop-blur-md focus:border-black/25 dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:focus:border-white/30"
              aria-label="文风内容"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStylePanel(null)}
                className={`h-10 rounded-full text-[13px] active:opacity-60 ${skin.ghostCls}`}
              >
                取消
              </button>
              <button
                type="button"
                disabled={!stylePanel.name.trim() || !stylePanel.content.trim()}
                onClick={() => {
                  const id = onCreateStyle(stylePanel.name.trim(), stylePanel.content.trim());
                  up({ styleId: id });
                  setStylePanel(null);
                }}
                className={`h-10 rounded-full text-[13px] disabled:opacity-40 ${skin.primaryCls}`}
              >
                保存
              </button>
            </div>
          </Card>
        ) : null}

        {/* 自定义 CSS（第六十五轮建 · 第七十一轮示例升级为完整模板）：作用域 = 线下模式全部界面
            （开始页/见面页/存档/现场设置/历史），与全局/聊天 CSS 互不影响；
            模板逐段列出线下界面所有能改的元素（off-card / off-chip / off-start / off-input 等稳定语义锚点） */}
        <Card>
          <CustomCssEditor scope="offline" templates={OFFLINE_CSS_TEMPLATES} accent={skin.editorAccent} onToast={onToast} />
        </Card>

        {/* 背景读取说明 + 重新分析 */}
        <div className="flex items-start gap-2 rounded-[18px] border border-white/50 bg-white/40 px-3.5 py-3 backdrop-blur-lg dark:border-white/[0.08] dark:bg-white/[0.05]">
          <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-black/50 dark:bg-white/50" aria-hidden="true" />
          <p className="flex-1 text-[12px] leading-[1.6] text-black/50 dark:text-white/50">
            生成前会先读取世界书分析出的世界背景；没有分析结果时，再根据角色设定推断背景。之后才读取人设、字数、人称、文风和现场记录。修改世界书后可在这里重新分析。
          </p>
          <button
            type="button"
            onClick={onRefreshWorldBg}
            disabled={bgRefreshing}
            className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] active:opacity-60 disabled:opacity-40 ${skin.ghostCls}`}
          >
            {bgRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            重新分析
          </button>
        </div>

        {/* 放弃这次见面（危险区，仅见面中显示） */}
        {meetActive && onAbandon ? (
          <Card className="border-red-500/20 dark:border-red-400/15">
            <FieldLabel title="放弃这次见面" hint="不写记忆、不进历史，直接清空当前进度；想保留请先用顶部 ★ 保存或新建存档" />
            {abandonConfirm ? (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-[12px] leading-[1.4] text-red-500/90 dark:text-red-400/90">当前进度会被清空且无法恢复，确认放弃？</p>
                <button
                  type="button"
                  data-testid="offline-abandon-confirm"
                  onClick={onAbandon}
                  className="h-8 shrink-0 rounded-full bg-red-500/90 px-3.5 text-[12px] font-medium text-white shadow-sm active:opacity-80"
                >
                  确认放弃
                </button>
                <button
                  type="button"
                  onClick={() => setAbandonConfirm(false)}
                  className={`h-8 shrink-0 rounded-full px-3.5 text-[12px] active:opacity-60 ${skin.ghostCls}`}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="offline-abandon"
                onClick={() => setAbandonConfirm(true)}
                className="flex h-10 w-full items-center justify-center rounded-full border border-red-500/25 bg-red-500/10 text-[13px] text-red-500 backdrop-blur-md active:opacity-60 dark:border-red-400/20 dark:text-red-400"
              >
                放弃这次见面
              </button>
            )}
          </Card>
        ) : null}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center gap-3 border-t border-white/50 bg-white/40 px-4 pb-[30px] pt-3 backdrop-blur-xl dark:border-white/[0.06] dark:bg-white/[0.04]">
        <button
          type="button"
          onClick={onClose}
          className={`off-btn-ghost h-12 flex-1 rounded-full text-[15px] font-medium active:opacity-70 ${skin.ghostCls}`}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            const n = carrySel === 'custom' ? Math.min(200, Math.max(5, Math.floor(Number(carryCustom) || 20))) : carrySel;
            onCommit({ ...d, carryCount: n }, tplDraft);
          }}
          className={`off-btn-primary h-12 flex-1 rounded-full text-[15px] font-semibold active:opacity-80 ${skin.primaryCls}`}
        >
          保存设置
        </button>
      </div>
    </div>
  );
}

// ---------------- 主页面 ----------------

export default function OfflineMeetingPage({ app, channel, contactId, userName, userRealName, userAvatar, loadRecentMsgs, onBack, onToast }: OfflineMeetingPageProps) {
  const [contact, setContact] = useState<ContactRecord | null>(null);
  const [contactsAll, setContactsAll] = useState<ContactRecord[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [meet, setMeet] = useState<OfflineMeet | null>(null);
  const [setupSettings, setSetupSettings] = useState<OfflineMeetSettings>(DEFAULT_OFFLINE_SETTINGS);
  const [presets, setPresets] = useState<OfflinePreset[]>(() => loadPresets());
  const [styles, setStyles] = useState<OfflineStyle[]>(() => loadStyles());
  const [tplOv, setTplOv] = useState<string | null>(null);

  const [carryChoice, setCarryChoice] = useState<number | 'custom'>(20);
  const [customN, setCustomN] = useState('20');
  const [availableCount, setAvailableCount] = useState(0);
  const [starting, setStarting] = useState(false);
  const [gen, setGen] = useState<null | 'open' | 'next' | 'reroll'>(null);
  const genRef = useRef(false);
  const startingRef = useRef(false);
  const meetRef = useRef<OfflineMeet | null>(null);
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<null | { id: string; text: string }>(null);
  const [rerollBackup, setRerollBackup] = useState<OfflineEntry | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySel, setHistorySel] = useState<number | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archives, setArchives] = useState<OfflineArchive[]>([]);
  const [bgRefreshing, setBgRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef(loadRecentMsgs);
  loadRef.current = loadRecentMsgs;
  const [toast, showToast] = useLocalToast();
  const toastFn = onToast ?? showToast;

  // 第六十五轮：线下界面跟随宿主 App 的界面主题（古早 = 银灰拟物 rt-*；液态 = 清透玻璃 lg-*；
  // 默认 = 原毛玻璃暖米色）；主题换页内所有面板/按钮/输入框同步切换（OfflineSkinProvider 下发 token）
  const bubbleStyleCfg = useSettings((s) => s.bubbleStyle);
  const skinRetro = isRetroTheme(bubbleStyleCfg as BubbleStyleConfig, app);
  const skinLiquid = isLiquidTheme(bubbleStyleCfg as BubbleStyleConfig, app);
  const skin = useMemo(() => resolveOfflineSkin(skinRetro, skinLiquid), [skinRetro, skinLiquid]);
  // 自定义 CSS（线下作用域）：只作用于线下所有界面（根节点挂 data-offline-css）
  const offlineCustomCss = useSettings((s) => s.customCss.offline);

  const shownName = contact?.nickname?.trim() || contact?.name || '对方';
  const userNameEff = userName.trim() || '我';

  // 挂载：加载联系人 / 全量联系人（NPC 圈）/ 进行中的见面 / 设置
  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const [c, all] = await Promise.all([getContact(contactId), listContacts().catch(() => [] as ContactRecord[])]);
        if (!on) return;
        if (!c) {
          setLoadErr('找不到这个联系人');
          setLoaded(true);
          return;
        }
        setContact(c);
        setContactsAll(all);
        const m = loadMeet(contactId);
        meetRef.current = m;
        setMeet(m);
        const s = m?.settings ?? loadMeetSettings(contactId);
        setSetupSettings(s);
        setTplOv(loadTplOverride(contactId));
        setArchives(loadArchives(contactId));
        const isBuiltin = (OFFLINE_CARRY_OPTIONS as readonly number[]).includes(s.carryCount);
        setCarryChoice(isBuiltin ? s.carryCount : 'custom');
        setCustomN(String(s.carryCount));
      } catch {
        if (on) setLoadErr('加载失败');
      } finally {
        if (on) setLoaded(true);
      }
    })();
    return () => {
      on = false;
    };
  }, [contactId]);

  // 可承接条数（宿主映射后的可用聊天条数）
  useEffect(() => {
    if (!loaded) return;
    try {
      setAvailableCount(loadRef.current(500).length);
    } catch {
      setAvailableCount(0);
    }
  }, [loaded, contactId]);

  // 新消息自动滚底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [meet?.entries.length, gen]);

  const settings = meet?.settings ?? setupSettings;
  const charPersonEff = useMemo(() => effectiveCharPerson(settings, contact?.gender), [settings, contact?.gender]);
  const activePreset = presets.find((p) => p.id === settings.presetId) ?? presets[0] ?? null;
  const activeTpl = meet?.template ?? tplOv ?? activePreset?.template ?? OFFLINE_DEFAULT_TEMPLATE;

  /** system prompt：人设 + 世界书 + 记忆召回 + 时间感知 + 线下总纲 */
  const buildSystemPrompt = useCallback(
    (m: OfflineMeet, target: number): string => {
      if (!contact) return '';
      const npcExtra = buildNpcPromptExtra(contact, contactsAll);
      const persona = buildPersonaSystemPrompt(contact as PersonaSource, {
        channel,
        userName: userNameEff,
        multiApp: getMemSettings(contactId).share,
        ...(npcExtra ?? {}),
      });
      const recentText = m.entries
        .slice(-2)
        .map((e) => e.text)
        .join(' ');
      const scanText = wbScanText([contact.persona, contact.background, m.onlineExcerpt, recentText]);
      const wb = collectWbBlocks(contactId, scanText, { charName: shownName, userName: userNameEff });
      const wbText = [wb.beforeSystem, wb.afterSystem, wb.beforeChar, wb.afterChar, wb.beforeUser, wb.afterUser]
        .filter((s) => s && s.trim())
        .join('\n\n');
      const mem = memRecallBlock(contactId, app, scanText);
      // 时间感知锚点：见面已开场时用现场最后一条消息的时间（时间流随对话推进），未开场回落到承接的线上最后一条
      const lastAt = m.entries.length ? m.entries[m.entries.length - 1].at : (m.lastOnlineTime ?? null);
      const time = buildTimeAwareBlock({ lastMsgTime: lastAt, regionHint: contact.region || null });
      const directive = buildOfflineDirective({
        settings: m.settings,
        charPersonEff,
        charName: shownName,
        userName: userNameEff,
        channel,
        target,
      });
      return [persona, wbText, wbRulesBlock(wb), mem, time, directive].filter((s) => s && s.trim()).join('\n\n');
    },
    [contact, contactsAll, channel, userNameEff, userRealName, contactId, app, shownName, charPersonEff],
  );

  /** 世界背景：世界书分析缓存 → LLM 分析 → 角色资料推断 */
  const ensureWorldBg = useCallback(async (): Promise<string> => {
    const cached = loadWbBgCache(contactId);
    if (cached) return cached;
    const scanText = wbScanText([contact?.persona, contact?.background]);
    const wb = collectWbBlocks(contactId, scanText, { charName: shownName, userName: userNameEff });
    const wbRaw = [wb.beforeSystem, wb.afterSystem, wb.beforeChar, wb.afterChar, wb.beforeUser, wb.afterUser]
      .filter((s) => s && s.trim())
      .join('\n\n');
    const localFallback = wbRaw.trim()
      ? `（世界书设定摘录）\n${wbRaw.slice(0, 2500)}`
      : `（未配置世界书）根据角色资料推断：${shownName}${contact?.occupation ? `，${contact.occupation}` : ''}${
          contact?.region ? `，坐标${contact.region}` : ''
        }。${(contact?.background || contact?.persona || '').slice(0, 500)}。世界观以现代日常为主，除非人设或世界书另有说明。`;
    if (!wbRaw.trim()) {
      saveWbBgCache(contactId, localFallback);
      return localFallback;
    }
    // v63 全局预设管理器：offline-world-analysis（关闭=跳过 LLM 分析，直接用本地推断）
    const waSys = promptTextOf(
      'offline-world-analysis',
      undefined,
      '你是世界观分析助手。把给定的世界书设定与角色资料浓缩成一段 200 字以内的客观世界背景描述：世界观类型、时代、地点、关键规则/组织/关系背景。只输出这段描述本身，不要标题、不要列表、不要评论。',
    );
    if (waSys) {
    try {
      const cfg = useSettings.getState().apiConfig;
      const res = await fetch('/api/offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: cfg,
          maxTokens: 900,
          messages: [
            {
              role: 'system',
              content: waSys,
            },
            {
              role: 'user',
              content: `角色：${shownName}\n用户称呼：${userNameEff}\n角色资料：${(contact?.persona || '').slice(0, 600)}\n\n世界书设定：\n${wbRaw.slice(0, 4000)}`,
            },
          ],
        }),
      });
      const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      if (res.ok && text) {
        saveWbBgCache(contactId, text);
        return text;
      }
    } catch {
      // 兜底走本地推断
    }
    } // v63：waSys 为空（条目关闭）时不发 LLM 请求
    return localFallback;
  }, [contactId, contact, shownName, userNameEff]);

  /** 生成（open=开场 / next=继续或用户输入 / reroll=重Roll） */
  const runGen = useCallback(
    async (kind: 'open' | 'next' | 'reroll', fromInput: string) => {
      const m = meetRef.current;
      if (!m || !contact || genRef.current) return;
      genRef.current = true;
      setGen(kind);
      setEditing(null);
      if (kind !== 'reroll') setRerollBackup(null);
      try {
        const s = m.settings;
        const style = styles.find((x) => x.id === s.styleId);
        const target = effectiveReplyTarget(s);
        const cpe = effectiveCharPerson(s, contact.gender);
        const openMode = kind === 'open' || fromInput === '__open__';
        /** 之前所有角色回复（防复读范围：不只上一条，更早的回复也要查）；prevCharEntry 仅作续写锚点与 {{last_reply}} */
        const prevCharEntry =
          kind === 'reroll'
            ? (m.entries[m.entries.length - 1] ?? null)
            : ([...m.entries].reverse().find((e) => e.role === 'char') ?? null);
        const prevCharTexts = m.entries.filter((e) => e.role === 'char').map((e) => e.text);
        const vars: Record<string, string> = {
          char_name: shownName,
          user_name: userNameEff,
          reply_length: String(target),
          user_person: s.userPerson,
          char_person: cpe,
          world_background: m.worldBg || '（未提供世界背景，以角色人设与现实日常为准）',
          writing_style: style ? `${style.name}：${style.content}` : `${BUILTIN_STYLES[0].name}：${BUILTIN_STYLES[0].content}`,
          scene: `地点：${m.scene.location || '待定'}；时间：${m.scene.time || '延续当前时间'}；缘由：${m.scene.reason || '延续线上聊天'}；${shownName}的状态：${
            m.scene.charState || '延续刚才的情绪'
          }`,
          user_message: openMode ? '（刚见面：请生成这次见面的开场）' : fromInput.trim() || `（让${shownName}自然继续当前场景，推进一点点）`,
          last_reply: prevCharEntry?.text?.trim().slice(-800) ?? '',
          online_chat: m.onlineExcerpt || '（无最近线上聊天记录）',
          offline_history: buildOfflineHistoryText(m, userNameEff, shownName, kind === 'reroll'),
        };
        let rendered = renderTemplate(activeTpl, vars);
        if (openMode) rendered += `\n\n${buildOpenInstruction(shownName, userNameEff)}`;
        else
          rendered += `\n\n${buildContinueInstruction({
            lastReply: vars.last_reply,
            fromInput,
            charName: shownName,
            userName: userNameEff,
          })}`;
        const system = buildSystemPrompt(m, target);
        const cfg = useSettings.getState().apiConfig;
        // 防复读：新回复与之前任一角色回复高度相似/整段包含/长段照搬时，带强指令自动重试一次
        let text = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          const payload =
            attempt === 0
              ? rendered
              : `${rendered}\n\n【防复读重试】你上一次的输出和之前的回复大量重复，这是被禁止的。这次必须输出完全不同的新内容：禁止复用之前任何一条回复（包括更早的回复）里的句子和表述，直接接着剧情往下写。`;
          const res = await fetch('/api/offline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config: cfg,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: payload },
              ],
              maxTokens: Math.min(8000, Math.max(1200, target * 2 + 400)),
            }),
          });
          const data = (await res.json().catch(() => null)) as { text?: unknown; error?: string } | null;
          if (!res.ok) throw new Error(data?.error || `生成失败（HTTP ${res.status}）`);
          text = typeof data?.text === 'string' ? data.text.trim() : '';
          if (!text) throw new Error('生成内容为空，请重试');
          if (attempt === 0 && !openMode && prevCharTexts.some((t) => looksLikeRepeat(text, t))) continue;
          break;
        }
        const next: OfflineMeet = { ...m, entries: kind === 'reroll' ? m.entries.slice(0, -1) : [...m.entries] };
        if (openMode) {
          const { scene, body } = extractSceneHeader(text);
          if (scene) next.scene = scene;
          text = body.trim() || text;
        }
        next.entries = [
          ...next.entries,
          { id: offlineUid(), role: 'char', text, at: Date.now(), fromInput: openMode ? '__open__' : fromInput },
        ];
        saveMeet(next);
        meetRef.current = next;
        setMeet(next);
      } catch (e) {
        toastFn(e instanceof Error ? e.message : '生成失败，请重试');
      } finally {
        genRef.current = false;
        setGen(null);
      }
    },
    [contact, styles, activeTpl, shownName, userNameEff, buildSystemPrompt, toastFn],
  );

  /** 开始见面：承接最近 N 条 → 世界背景 → 建会话 → 开场生成 */
  const startMeeting = useCallback(async () => {
    if (starting || genRef.current || startingRef.current || !contact) return;
    const n = carryChoice === 'custom' ? Math.min(200, Math.max(5, Math.floor(Number(customN) || 20))) : carryChoice;
    setStarting(true);
    startingRef.current = true;
    try {
      const msgs = loadRef.current(n);
      const full = msgs
        .map((m) => `${m.role === 'me' ? userNameEff : shownName}：${m.text.trim()}`)
        .join('\n');
      // 承接超长时保留最新的 8000 字：消息是时间正序（最新在末尾），slice(-8000) 才不会把最新的截掉；
      // 再切掉开头被截断的半行，保证承接文本从完整一行开始
      let excerpt = full;
      if (excerpt.length > 8000) {
        excerpt = excerpt.slice(-8000);
        const nl = excerpt.indexOf('\n');
        if (nl >= 0) excerpt = excerpt.slice(nl + 1);
      }
      const lastTime = msgs.length ? msgs[msgs.length - 1].time : null;
      const worldBg = await ensureWorldBg();
      const m: OfflineMeet = {
        id: offlineUid(),
        contactId,
        appId: app,
        startedAt: Date.now(),
        carryN: n,
        onlineExcerpt: excerpt,
        lastOnlineTime: lastTime,
        scene: { location: '', time: '', reason: '', charState: '延续刚才的情绪' },
        entries: [],
        settings: setupSettings,
        worldBg,
      };
      saveMeet(m);
      meetRef.current = m;
      setMeet(m);
      void runGen('open', '');
    } catch (e) {
      toastFn(e instanceof Error ? e.message : '开始失败，请重试');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [starting, contact, carryChoice, customN, userNameEff, shownName, ensureWorldBg, contactId, app, setupSettings, runGen, toastFn]);

  /** 保存这次见面 → 记忆库 + 历史 */
  const saveMeeting = useCallback(() => {
    const m = meetRef.current;
    if (!m) return;
    if (genRef.current) {
      toastFn('正在生成，请稍候再保存');
      return;
    }
    if (!m.entries.length) {
      toastFn('这次见面还没有内容，先聊几句再保存');
      return;
    }
    const digest = buildMeetDigest(m, userNameEff, shownName);
    memAddEventFragment(contactId, app, digest, { eventTime: Date.now(), sourceTag: 'offline-meet' });
    addMeetToHistory(contactId, m);
    clearMeet(contactId);
    meetRef.current = null;
    setMeet(null);
    setEditing(null);
    setRerollBackup(null);
    setHistorySel(null);
    setHistoryOpen(false);
    toastFn('已保存这次见面，已写入记忆');
  }, [contactId, app, userNameEff, shownName, toastFn]);

  /** 放弃这次见面：不写记忆、不进历史，直接清空当前进度 */
  const abandonMeeting = useCallback(() => {
    if (genRef.current) {
      toastFn('正在生成，请稍候再操作');
      return;
    }
    clearMeet(contactId);
    meetRef.current = null;
    setMeet(null);
    setEditing(null);
    setRerollBackup(null);
    setSettingsOpen(false);
    setInput('');
    toastFn('已放弃这次见面');
  }, [contactId, toastFn]);

  const sendInput = useCallback(() => {
    const t = input.trim();
    if (!t || genRef.current || !meetRef.current) return;
    const m = meetRef.current;
    setRerollBackup(null);
    const next: OfflineMeet = { ...m, entries: [...m.entries, { id: offlineUid(), role: 'user', text: t, at: Date.now() }] };
    saveMeet(next);
    meetRef.current = next;
    setMeet(next);
    setInput('');
    void runGen('next', t);
  }, [input, runGen]);

  const reroll = useCallback(() => {
    const m = meetRef.current;
    if (!m || genRef.current) return;
    const last = m.entries[m.entries.length - 1];
    if (!last || last.role !== 'char') {
      toastFn('没有可重Roll的回复');
      return;
    }
    setRerollBackup({ ...last });
    const from = last.fromInput === '__open__' ? '__open__' : last.fromInput ?? '';
    void runGen('reroll', from);
  }, [runGen, toastFn]);

  /** 恢复重Roll前的回复（把备份条目放回最后一条角色回复的位置） */
  const restoreReroll = useCallback(() => {
    const m = meetRef.current;
    if (!m || !rerollBackup || genRef.current) return;
    const entries = [...m.entries];
    let li = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].role === 'char') {
        li = i;
        break;
      }
    }
    if (li >= 0 && entries[li].id === rerollBackup.id) {
      setRerollBackup(null);
      return;
    }
    if (li >= 0) entries[li] = { ...rerollBackup };
    else entries.push({ ...rerollBackup });
    const next: OfflineMeet = { ...m, entries };
    saveMeet(next);
    meetRef.current = next;
    setMeet(next);
    setRerollBackup(null);
    toastFn('已恢复重Roll前的回复');
  }, [rerollBackup, toastFn]);

  /** 编辑条目文本（我和角色的消息都可以；只影响之后的生成上下文） */
  const updateEntryText = useCallback((id: string, text: string) => {
    const m = meetRef.current;
    if (!m) return;
    const next: OfflineMeet = { ...m, entries: m.entries.map((e) => (e.id === id ? { ...e, text } : e)) };
    saveMeet(next);
    meetRef.current = next;
    setMeet(next);
  }, []);

  /** 删除条目（我和角色的消息都可以；重Roll 按删除后的最后一条角色回复定位） */
  const deleteEntry = useCallback(
    (id: string) => {
      const m = meetRef.current;
      if (!m || genRef.current) return;
      const next: OfflineMeet = { ...m, entries: m.entries.filter((e) => e.id !== id) };
      saveMeet(next);
      meetRef.current = next;
      setMeet(next);
      setEditing((cur) => (cur?.id === id ? null : cur));
      toastFn('已删除这条内容');
    },
    [toastFn],
  );

  /** 重新分析世界背景：清缓存 → 再分析 → 见面中同步更新本次见面 */
  const refreshWorldBg = useCallback(async () => {
    if (bgRefreshing) return;
    if (genRef.current) {
      toastFn('正在生成，请稍候再重新分析');
      return;
    }
    setBgRefreshing(true);
    try {
      saveWbBgCache(contactId, '');
      const bg = await ensureWorldBg();
      if (meetRef.current) {
        const next: OfflineMeet = { ...meetRef.current, worldBg: bg };
        saveMeet(next);
        meetRef.current = next;
        setMeet(next);
      }
      toastFn('世界背景已重新分析');
    } catch {
      toastFn('刷新失败，请稍后再试');
    } finally {
      setBgRefreshing(false);
    }
  }, [bgRefreshing, contactId, ensureWorldBg, toastFn]);

  // —— 存档（新建 / 覆盖 / 读档 / 删除 / 重命名 / 导出 / 导入）——
  const createArchive = useCallback(
    (name: string) => {
      const m = meetRef.current;
      if (!m) {
        toastFn('还没有进行中的见面');
        return;
      }
      if (genRef.current) {
        toastFn('正在生成，请稍候再存档');
        return;
      }
      const finalName = (name || `见面存档 ${mdhm(m.startedAt)}`).slice(0, 30);
      const next: OfflineArchive[] = [{ id: offlineUid(), name: finalName, savedAt: Date.now(), meet: { ...m } }, ...loadArchives(contactId)];
      saveArchives(contactId, next);
      setArchives(next);
      toastFn(`已新建存档「${finalName}」`);
    },
    [contactId, toastFn],
  );

  const overwriteArchive = useCallback(
    (id: string) => {
      const m = meetRef.current;
      if (!m) {
        toastFn('当前没有进行中的见面');
        return;
      }
      if (genRef.current) {
        toastFn('正在生成，请稍候再存档');
        return;
      }
      const list = loadArchives(contactId);
      if (!list.some((a) => a.id === id)) {
        toastFn('存档不存在');
        return;
      }
      const next = list.map((a) => (a.id === id ? { ...a, savedAt: Date.now(), meet: { ...m } } : a));
      saveArchives(contactId, next);
      setArchives(next);
      toastFn(`已覆盖存档「${next.find((a) => a.id === id)?.name ?? ''}」`);
    },
    [contactId, toastFn],
  );

  const loadArchive = useCallback(
    (id: string) => {
      if (genRef.current) {
        toastFn('正在生成，请稍候再读档');
        return;
      }
      if (startingRef.current) {
        toastFn('正在准备见面，请稍候再读档');
        return;
      }
      const a = loadArchives(contactId).find((x) => x.id === id);
      if (!a) {
        toastFn('存档不存在');
        return;
      }
      const m: OfflineMeet = { ...a.meet, contactId, settings: normalizeOfflineSettings(a.meet.settings) };
      saveMeet(m);
      meetRef.current = m;
      setMeet(m);
      setEditing(null);
      setRerollBackup(null);
      setHistoryOpen(false);
      setHistorySel(null);
      setArchiveOpen(false);
      toastFn(`已读档「${a.name}」，回到存档时刻`);
    },
    [contactId, toastFn],
  );

  const deleteArchive = useCallback(
    (id: string) => {
      const next = loadArchives(contactId).filter((a) => a.id !== id);
      saveArchives(contactId, next);
      setArchives(next);
      toastFn('已删除存档');
    },
    [contactId, toastFn],
  );

  const renameArchive = useCallback(
    (id: string, name: string) => {
      const next = loadArchives(contactId).map((a) => (a.id === id ? { ...a, name: name.slice(0, 30) || a.name } : a));
      saveArchives(contactId, next);
      setArchives(next);
      toastFn('已重命名存档');
    },
    [contactId, toastFn],
  );

  const exportArchive = useCallback(
    (id: string) => {
      const a = loadArchives(contactId).find((x) => x.id === id);
      if (!a) {
        toastFn('存档不存在');
        return;
      }
      try {
        const payload = JSON.stringify({ kind: 'offline-meet-archive', name: a.name, savedAt: a.savedAt, meet: a.meet }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const el = document.createElement('a');
        el.href = url;
        el.download = `线下存档-${a.name.replace(/[\\/:*?"<>|]/g, '_')}-${mdhm(a.savedAt).replace(/\s+/g, '_').replace(/:/g, '')}.json`;
        document.body.appendChild(el);
        el.click();
        el.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toastFn('已导出存档文件');
      } catch {
        toastFn('导出失败，请重试');
      }
    },
    [contactId, toastFn],
  );

  const importArchive = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const arc = sanitizeArchive(JSON.parse(text) as unknown, contactId);
        if (!arc) {
          toastFn('导入失败：不是有效的存档文件');
          return;
        }
        const next = [arc, ...loadArchives(contactId)];
        saveArchives(contactId, next);
        setArchives(next);
        toastFn(`已导入存档「${arc.name}」`);
      } catch {
        toastFn('导入失败：文件解析出错');
      }
    },
    [contactId, toastFn],
  );

  // —— 设置面板回调 ——
  const commitSettings = (s: OfflineMeetSettings, tpl: string) => {
    if (genRef.current || startingRef.current) {
      toastFn('正在生成或准备见面，请稍候再保存设置');
      return;
    }
    if (meetRef.current) {
      const next: OfflineMeet = { ...meetRef.current, settings: s, template: tpl };
      saveMeet(next);
      meetRef.current = next;
      setMeet(next);
    } else {
      saveMeetSettings(contactId, s);
      saveTplOverride(contactId, tpl);
      setSetupSettings(s);
      setTplOv(tpl);
      const isBuiltin = (OFFLINE_CARRY_OPTIONS as readonly number[]).includes(s.carryCount);
      setCarryChoice(isBuiltin ? s.carryCount : 'custom');
      setCustomN(String(s.carryCount));
    }
    setSettingsOpen(false);
    toastFn('设置已保存');
  };
  const createPreset = (name: string, template: string): string => {
    const id = `preset-${offlineUid()}`;
    const list = [...presets.filter((p) => !p.builtin), { id, name, template, createdAt: Date.now() }];
    saveCustomPresets(list);
    setPresets(loadPresets());
    return id;
  };
  const savePreset = (id: string, template: string) => {
    const list = presets.filter((p) => !p.builtin).map((p) => (p.id === id ? { ...p, template } : p));
    saveCustomPresets(list);
    setPresets(loadPresets());
    toastFn('预设已保存');
  };
  const deletePreset = (id: string) => {
    saveCustomPresets(presets.filter((p) => !p.builtin && p.id !== id));
    setPresets(loadPresets());
    toastFn('预设已删除');
  };
  const createStyle = (name: string, content: string): string => {
    const id = `style-${offlineUid()}`;
    saveCustomStyles([...styles.filter((s) => !s.builtin), { id, name, content, createdAt: Date.now() }]);
    setStyles(loadStyles());
    return id;
  };
  const deleteStyle = (id: string) => {
    saveCustomStyles(styles.filter((s) => !s.builtin && s.id !== id));
    setStyles(loadStyles());
    toastFn('文风已删除');
  };

  // ---------------- 渲染 ----------------

  const body = (() => {
  if (loadErr) {
    return (
      <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden ${skin.pageCls} px-8 text-center dark:text-white`}>
        <p className="text-[15px] text-black/50 dark:text-white/50">{loadErr}</p>
        <button type="button" onClick={onBack} className={`mt-4 rounded-full px-5 py-2 text-[14px] ${skin.primaryCls}`}>
          返回
        </button>
      </div>
    );
  }
  if (!loaded || !contact) {
    return (
      <div className={`absolute inset-0 z-50 flex items-center justify-center overflow-hidden ${skin.pageCls}`}>
        <Loader2 className="h-6 w-6 animate-spin text-black/30 dark:text-white/30" />
      </div>
    );
  }

  const lastEntry = meet?.entries[meet.entries.length - 1] ?? null;
  const canReroll = !!lastEntry && lastEntry.role === 'char' && !gen;
  /** 顶部日期：见面中显示见面开始日期，未开始显示今天 */
  const headerDate = (() => {
    const d = new Date(meet ? meet.startedAt : Date.now());
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  })();
  /** 过去的见面（同步内存读，开销可忽略）；只读回看 */
  const meetHistory = loaded ? loadMeetHistory(contactId) : [];
  const historyDetail = historyOpen && historySel !== null ? meetHistory[historySel] ?? null : null;
  const lastCharEntry = meet ? [...meet.entries].reverse().find((x) => x.role === 'char') ?? null : null;
  const showRestore = !!rerollBackup && (!lastCharEntry || lastCharEntry.id !== rerollBackup.id);
  /** 完整时间戳：YYYY年M月D日 HH:mm（历史见面列表用） */
  const fullTs = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div
      className={`off-page absolute inset-0 z-50 flex flex-col overflow-hidden ${skin.pageCls} text-black dark:text-white`}
      data-testid={`offline-meet-${app}`}
      data-offline-css=""
    >
      {/* 自定义 CSS（线下作用域）：只影响线下所有界面；前缀 [data-phone-shell] [data-offline-css]
          比全局多一级属性 → 特异性压制全局 CSS（第七十轮优先级阶梯） */}
      {offlineCustomCss.trim() ? <style>{scopeCss(offlineCustomCss, OFFLINE_CSS_SCOPE)}</style> : null}
      <LocalToast msg={onToast ? '' : toast} />

      {/* 头部（第六十五轮改版，用户指定）：删掉包住整行的大椭圆胶囊——
          头像+名字+日期裸奔居中，每个按钮（返回/收藏/存档/现场设置）各自独立小椭圆包裹；
          主题跟随：古早 = 银灰拟物 rt-chip；液态 = 玻璃 lg-chip；默认 = 毛玻璃胶囊 */}
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-[54px]">
        <button
          type="button"
          aria-label="返回聊天"
          onClick={onBack}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-black/70 transition active:opacity-60 dark:text-white/80 ${skin.chipCls}`}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="off-title flex min-w-0 flex-1 items-center justify-center gap-2.5">
          <div className="relative shrink-0">
            <MeetAvatar contact={contact} size={32} />
            {meet ? (
              <span className="absolute bottom-0 right-0 h-[9px] w-[9px] rounded-full border-2 border-white bg-[#34C759] dark:border-[#2a2a2c]" aria-hidden="true" />
            ) : null}
          </div>
          <div className="min-w-0 text-left leading-tight">
            <h1 className="truncate text-[15px] font-semibold text-black dark:text-white">{shownName}</h1>
            <p className="mt-[1px] truncate text-[10px] tabular-nums text-black/40 dark:text-white/40">{headerDate}</p>
          </div>
        </div>
        {meet ? (
          <button
            type="button"
            aria-label="保存这次见面"
            data-testid="offline-save-star"
            onClick={saveMeeting}
            disabled={!!gen}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-black/70 transition active:opacity-60 disabled:opacity-40 dark:text-white/80 ${skin.chipCls}`}
          >
            <Star className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="存档管理"
          title="存档"
          data-testid="offline-archive-entry"
          onClick={() => {
            setSettingsOpen(false);
            setArchiveOpen(true);
          }}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-black/70 transition active:opacity-60 dark:text-white/80 ${skin.chipCls}`}
        >
          <Archive className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="现场设置"
          data-testid="offline-settings-entry"
          onClick={() => {
            setArchiveOpen(false);
            setSettingsOpen(true);
          }}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-black/70 transition active:opacity-60 dark:text-white/80 ${skin.chipCls}`}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </div>

      {/* 主体 */}
      {!meet ? (
        /* —— 极简开始页：头像 + 名字 + 开始见面（承接条数在「现场设置」最上方配置） ——
           off-hero：开始页中心区锚点（线下自定义 CSS 模板可单独改开始页） */
        <div className="off-hero flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-16">
          <div className="flex flex-col items-center gap-2.5">
            <MeetAvatar contact={contact} size={76} />
            <p className="text-[17px] font-semibold text-black/85 dark:text-white/90">{shownName}</p>
          </div>
          <button
            type="button"
            data-testid="offline-start"
            onClick={() => void startMeeting()}
            disabled={starting}
            className={`off-start flex h-[52px] items-center justify-center gap-2 rounded-[16px] px-12 text-[16px] font-semibold active:opacity-80 disabled:opacity-50 ${skin.primaryCls}`}
          >
            {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Star className="h-5 w-5" strokeWidth={2} />}
            {starting ? '正在准备见面…' : '开始见面'}
          </button>
          {meetHistory.length > 0 ? (
            <button
              type="button"
              data-testid="offline-history-open"
              onClick={() => {
                setHistorySel(null);
                setHistoryOpen(true);
              }}
              className={`flex h-10 items-center gap-2 rounded-full px-5 text-[13px] active:opacity-60 ${skin.ghostCls}`}
            >
              <History className="h-4 w-4" />
              过去的见面 · {meetHistory.length}
            </button>
          ) : null}
        </div>
      ) : (
        /* —— 见面进行中 —— */
        <>
          {/* 叙事流（off-feed：见面页消息流锚点，线下自定义 CSS 可单独改） */}
          <div ref={scrollRef} className="off-feed mt-3 flex-1 space-y-4 overflow-y-auto px-4 pb-3 thin-scrollbar">
            {meet.entries.map((e) =>
              e.role === 'char' ? (
                <div key={e.id} className={`rounded-[20px] rounded-tl-[8px] p-4 ${skin.cardCls}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <MeetAvatar contact={contact} size={20} />
                    <div className="min-w-0 leading-tight">
                      <p className="text-[12px] font-semibold text-black/55 dark:text-white/60">{shownName}</p>
                      <p className="mt-[1px] text-[10px] tabular-nums text-black/30 dark:text-white/30">{mdhm(e.at)}</p>
                    </div>
                    <div className="ml-auto">
                      <EntryTools disabled={!!gen} onEdit={() => setEditing({ id: e.id, text: e.text })} onDelete={() => deleteEntry(e.id)} />
                    </div>
                  </div>
                  {editing?.id === e.id ? (
                    <EntryEdit
                      value={editing.text}
                      onChange={(v) => setEditing({ id: e.id, text: v })}
                      onCancel={() => setEditing(null)}
                      onSave={() => {
                        const v = editing.text.trim();
                        if (v) updateEntryText(e.id, v);
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap text-[15px] leading-[1.95] text-black/85 dark:text-white/85">
                      <NarrBody text={e.text} role="char" />
                    </div>
                  )}
                </div>
              ) : (
                <div key={e.id} className="flex justify-end">
                  {editing?.id === e.id ? (
                    <div className="w-full max-w-[85%]">
                      <EntryEdit
                        value={editing.text}
                        onChange={(v) => setEditing({ id: e.id, text: v })}
                        onCancel={() => setEditing(null)}
                        onSave={() => {
                          const v = editing.text.trim();
                          if (v) updateEntryText(e.id, v);
                          setEditing(null);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="max-w-[85%]">
                      {/* 灰色玻璃气泡（浅色模式浅灰 / 深色模式深灰；古早 = 白拟物面板，液态 = 原玻璃） */}
                      <div className={`off-bubble-user rounded-[20px] rounded-br-[8px] p-4 text-[15px] leading-[1.95] text-black/85 shadow-[0_8px_24px_rgba(60,50,40,0.10)] dark:text-white/85 ${
                        skin.retro ? 'rt-panel' : 'border border-black/[0.06] bg-[#ECEAE7]/85 backdrop-blur-xl dark:border-white/10 dark:bg-[#2C2C2E]/85'
                      }`}>
                        {/* 气泡内同款头像 + 名字 + 时间头（和 AI 卡一致） */}
                        <div className="mb-2 flex items-center gap-2">
                          <UserAvatar avatar={userAvatar} name={userNameEff} size={20} />
                          <div className="min-w-0 leading-tight">
                            <p className="text-[12px] font-semibold text-black/55 dark:text-white/60">{userNameEff}</p>
                            <p className="mt-[1px] text-[10px] tabular-nums text-black/30 dark:text-white/30">{mdhm(e.at)}</p>
                          </div>
                          <div className="ml-auto">
                            <EntryTools disabled={!!gen} onEdit={() => setEditing({ id: e.id, text: e.text })} onDelete={() => deleteEntry(e.id)} />
                          </div>
                        </div>
                        <NarrBody text={e.text} role="user" />
                      </div>
                    </div>
                  )}
                </div>
              ),
            )}
            {gen ? (
              <div className={`flex items-center gap-2 rounded-[20px] rounded-tl-[8px] p-4 text-[14px] text-black/45 dark:text-white/45 ${skin.cardCls}`}>
                <Loader2 className="h-4 w-4 animate-spin" />
                {gen === 'reroll' ? '重新书写中…' : '正在书写…'}
              </div>
            ) : null}
          </div>

          {/* 恢复重Roll前的回复 */}
          {showRestore ? (
            <div className="px-4 pb-1.5">
              <button
                type="button"
                data-testid="offline-restore"
                onClick={restoreReroll}
                className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] active:opacity-60 ${skin.ghostCls}`}
              >
                <Undo2 className="h-3.5 w-3.5" />
                恢复重Roll前的回复
              </button>
            </div>
          ) : null}

          {/* 底部：继续 / 重Roll 圆钮 + 输入框（保存走顶部收藏钮）；off-dock = 底部输入区锚点 */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendInput();
            }}
            className="off-dock flex items-center gap-1.5 px-3 pb-[30px] pt-1"
          >
            <button
              type="button"
              data-testid="offline-continue"
              aria-label={`让 ${shownName} 继续`}
              title={`让 ${shownName} 继续`}
              onClick={() => void runGen('next', '')}
              disabled={!!gen}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-black/75 active:scale-95 active:opacity-60 disabled:opacity-40 dark:text-white/80 ${skin.chipCls}`}
            >
              <RotateCcw className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              data-testid="offline-reroll"
              aria-label="重 Roll"
              title="重 Roll"
              onClick={reroll}
              disabled={!canReroll}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-black/75 active:scale-95 active:opacity-60 disabled:opacity-40 dark:text-white/80 ${skin.chipCls}`}
            >
              <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <div className="relative min-w-0 flex-1">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`说点什么，或描述你的动作…`}
                aria-label="线下输入"
                data-testid="offline-input"
                className={`h-10 w-full rounded-full pl-4 pr-11 text-[14px] ${skin.chatInputCls}`}
              />
              <button
                type="submit"
                data-testid="offline-send"
                aria-label="发送"
                title="发送"
                disabled={!input.trim() || !!gen}
                className={`absolute inset-y-0 right-[3px] my-auto flex h-[34px] w-[34px] items-center justify-center rounded-full transition-transform active:scale-90 active:opacity-80 disabled:opacity-40 ${skin.sendCls}`}
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.6} />
              </button>
            </div>
          </form>
        </>
      )}

      {/* 过去的见面（历史记录，只读回看）；off-panel-history = 历史页锚点 */}
      {historyOpen ? (
        <div className={`off-panel-history absolute inset-0 z-40 flex flex-col overflow-hidden ${skin.pageCls} text-black dark:text-white`}>
          <div className="flex items-center gap-2 px-4 pb-3 pt-[58px]">
            <button
              type="button"
              aria-label="返回"
              onClick={() => (historySel === null ? setHistoryOpen(false) : setHistorySel(null))}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-black/70 active:opacity-60 dark:text-white/80 ${skin.chipCls}`}
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
            <h2 className="truncate text-[17px] font-semibold">{historySel === null ? '过去的见面' : '见面记录'}</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-6 thin-scrollbar">
            {historySel === null ? (
              meetHistory.length === 0 ? (
                <p className="pt-16 text-center text-[14px] text-black/40 dark:text-white/40">还没有保存过见面</p>
              ) : (
                <div className="space-y-3">
                  {meetHistory.map((h, i) => (
                    <button key={`${h.id}-${i}`} type="button" onClick={() => setHistorySel(i)} className={`block w-full rounded-[20px] p-4 text-left ${skin.cardCls}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[14px] font-semibold">{fullTs(h.startedAt)}</p>
                        <p className="shrink-0 text-[11px] tabular-nums text-black/40 dark:text-white/40">{h.entries.length} 条</p>
                      </div>
                      <p className="mt-1 truncate text-[12px] text-black/50 dark:text-white/50">
                        {h.scene.location || '（未记录地点）'}·{h.scene.reason || '延续线上聊天'}
                      </p>
                      <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.6] text-black/40 dark:text-white/40">{h.entries[0]?.text?.slice(0, 80) ?? '（无内容）'}</p>
                    </button>
                  ))}
                </div>
              )
            ) : historyDetail ? (
              <div className="space-y-4">
                <div className={`rounded-[20px] p-4 ${skin.cardCls}`}>
                  <p className="text-[14px] font-semibold">{fullTs(historyDetail.startedAt)}</p>
                  <p className="mt-1 text-[12px] leading-[1.6] text-black/50 dark:text-white/50">
                    {historyDetail.scene.location || '（未记录地点）'} · {historyDetail.scene.reason || '延续线上聊天'}
                  </p>
                </div>
                {historyDetail.entries.map((e) => (
                  <div key={e.id} className={`rounded-[20px] p-4 ${skin.cardCls} ${e.role === 'user' ? 'ml-8' : 'mr-8'}`}>
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] text-black/45 dark:text-white/45">
                      <span className="font-semibold">{e.role === 'char' ? shownName : userNameEff}</span>
                      <span className="tabular-nums">{mdhm(e.at)}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-[14px] leading-[1.85] text-black/85 dark:text-white/85">
                      <NarrBody text={e.text} role={e.role} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 存档面板（新建 / 覆盖 / 读档 / 删除 / 重命名 / 导出 / 导入） */}
      {archiveOpen ? (
        <ArchivePanel
          archives={archives}
          meetActive={!!meet}
          hasProgress={!!meet && meet.entries.length > 0}
          onClose={() => setArchiveOpen(false)}
          onCreate={createArchive}
          onLoad={loadArchive}
          onOverwrite={overwriteArchive}
          onDelete={deleteArchive}
          onRename={renameArchive}
          onExport={exportArchive}
          onImport={(f) => void importArchive(f)}
        />
      ) : null}

      {/* 现场设置面板 */}
      {settingsOpen ? (
        <OfflineSettingsPanel
          initial={settings}
          presets={presets}
          styles={styles}
          tpl={activeTpl}
          meetActive={!!meet}
          availableCount={availableCount}
          onClose={() => setSettingsOpen(false)}
          onCommit={commitSettings}
          onRefreshWorldBg={() => void refreshWorldBg()}
          bgRefreshing={bgRefreshing}
          onAbandon={abandonMeeting}
          onCreatePreset={createPreset}
          onSavePreset={savePreset}
          onDeletePreset={deletePreset}
          onCreateStyle={createStyle}
          onDeleteStyle={deleteStyle}
          onToast={toastFn}
        />
      ) : null}
    </div>
  );
  })();

  // 皮肤 Provider 包住全部线下 UI（含错误/加载屏）：面板/按钮/输入框按主题切换铭件
  return <OfflineSkinCtx.Provider value={skin}>{body}</OfflineSkinCtx.Provider>;
}
