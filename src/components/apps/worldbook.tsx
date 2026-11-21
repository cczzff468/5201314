'use client';

/**
 * 世界书 App —— 给 AI 挂载静态设定和世界观（按关键词触发的设定库）。
 *
 * 页面结构（iOS 黑白灰风格：白 / 浅灰 / 深灰，深色模式自动适配）：
 * - 书库首页：顶栏标题「我的世界书库」紧跟返回键右侧 + 统计卡（全局/局部/专属 三列可点按
 *   范围筛选 + 已启用计数）+ 底部范围筛选栏（椭圆胶囊底座整体包裹 全部/全局/局部/专属，
 *   激活段黑底白字圆片）；右上角「全部角色」筛选**只在专属 tab 显示**
 *   （筛绑定给某角色的专属书）；新建走居中大弹窗（名称 + 范围三选卡片 + 专属绑定角色），
 *   名字校验：非空 + 禁 emoji；书籍管理：重命名、删除、导出、导入（.json）
 * - 书籍详情页：条目计数 + 范围徽章 + 一句话说明；设置卡（范围 / 启用总开关 / 专属时绑定角色）；
 *   虚线「+ 新建条目」大按钮；条目卡片列表（开关 + 触发词预览 + 插入位置徽章），
 *   点卡片进入编辑，长按条目或点右侧 ⋯ 弹出操作菜单（编辑/删除），行尾无删除图标
 * - 条目编辑页：开关 / 名字（仅本地显示）/ 触发词（全局书可留空）/ 内容 / 插入位置（6 选 1）/
 *   优先级 / 忽略大小写；右上角「保存」才写入，返回不保存，新建条目保存前不落盘
 *
 * 范围（全局/局部/专属）与「启用」属于**世界书本体**（不是条目）：
 * - 全局：所有对话生效，内容常驻注入（无需关键词）；
 * - 局部：聊天设置里挂载后，命中关键词才注入；
 * - 专属：仅对绑定的角色生效，命中关键词才注入。
 * 数据与触发逻辑在 @/lib/ios/worldbook；聊天侧挂载入口在微信/QQ/信息的聊天设置 →「世界书」。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  BookMarked,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FileText,
  Globe,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import type { ContactRecord } from '@/lib/contacts';
import { listContacts } from '@/lib/ios/contacts-store';
import { useUI } from '@/lib/ios/store';
import { BackToHome } from '@/components/ios/BackToHome';
import { useLocalToast, LocalToast } from './page-toast';
import {
  WB_POSITIONS,
  WB_POSITION_LABELS,
  WB_SCOPES,
  WB_SCOPE_LABELS,
  WB_SCOPE_SHORT_DESC,
  WB_SCOPE_SUBTITLES,
  WB_SCOPE_TIPS,
  buildExportPayload,
  createEntryDraft,
  loadBooks,
  newWbId,
  parseKeywordsInput,
  parseWorldBookImport,
  pruneBookFromAllBindings,
  saveBooks,
  wbEntryCheck,
  wbNameCheck,
  type WorldBook,
  type WbEntry,
  type WbPosition,
  type WbScope,
} from '@/lib/ios/worldbook';

// ---------------- 主题 token（黑白灰，深色自动适配） ----------------

const PAGE_CLS = 'bg-[#F2F2F7] text-black dark:bg-black dark:text-white';
const CARD_CLS = 'overflow-hidden rounded-[16px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]';
const DIVIDER_CLS = 'border-black/[0.06] dark:border-white/[0.08]';
const SUB_CLS = 'text-black/45 dark:text-white/45';
const CAPTION_CLS = `px-1 pt-2 text-[12.5px] leading-[1.6] ${SUB_CLS}`;
const DESTRUCTIVE_CLS = 'text-[#FF3B30] dark:text-[#FF453A]';

/** 单色 iOS 开关：开 = 黑底白钮（深色模式白底黑钮），贴合黑白灰主色调 */
function MonoToggle({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        on ? 'bg-black dark:bg-white' : 'bg-black/[0.14] dark:bg-white/[0.24]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-all duration-200 ${
          on ? 'left-[22px] bg-white dark:bg-black' : 'left-[2px] bg-white dark:bg-[#E9E9EB]'
        }`}
      />
    </button>
  );
}

// ---------------- 通用浮层 ----------------

interface SheetAction {
  /** 稳定唯一 key：label 可能重复（如两个同名 AI 角色），提供 id 时优先用 id 作 key */
  id?: string;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}

/** iOS 风格底部操作菜单 */
function ActionSheet({ title, actions, onClose }: { title: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-label={title}>
      <button type="button" aria-label="关闭菜单" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-x-3 bottom-4 flex flex-col gap-2">
        <div className={`${CARD_CLS} p-1.5`}>
          <p className={`px-3 py-2 text-center text-[12.5px] leading-[1.4] ${SUB_CLS}`}>{title}</p>
          {actions.map((a, ai) => (
            <button
              key={a.id ?? `${a.label}-${ai}`}
              type="button"
              onClick={() => {
                onClose();
                a.onSelect();
              }}
              className={`flex w-full items-center justify-center rounded-[10px] px-4 py-3 text-[16px] active:bg-black/[0.05] dark:active:bg-white/[0.08] ${
                a.destructive ? DESTRUCTIVE_CLS : ''
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`${CARD_CLS} flex items-center justify-center py-3 text-[16px] font-semibold active:bg-black/[0.05] dark:active:bg-white/[0.08]`}
        >
          取消
        </button>
      </div>
    </div>
  );
}

/** 范围图标（书级范围：全局=地球 / 局部=准星 / 专属=人像） */
function ScopeIcon({ scope, className }: { scope: WbScope; className?: string }) {
  const cls = className ?? 'h-5 w-5';
  if (scope === 'global') return <Globe className={cls} strokeWidth={1.8} aria-hidden="true" />;
  if (scope === 'local') return <Crosshair className={cls} strokeWidth={1.8} aria-hidden="true" />;
  return <User className={cls} strokeWidth={1.8} aria-hidden="true" />;
}

/** 名字输入弹层（重命名世界书用；emoji 校验在确认时进行，错误就地显示） */
function NameDialog({
  title,
  initial,
  confirmText,
  onConfirm,
  onClose,
}: {
  title: string;
  initial: string;
  confirmText: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const submit = () => {
    const check = wbNameCheck(value);
    if (!check.ok) setError(check.reason);
    else onConfirm(value);
  };
  return (
    <div className="absolute inset-0 z-[70] grid place-items-center px-8" role="dialog" aria-label={title}>
      <button type="button" aria-label="取消" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className={`${CARD_CLS} relative w-full p-4`}>
        <p className="text-center text-[16px] font-semibold">{title}</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="世界书名字"
          aria-label="世界书名字"
          maxLength={40}
          className="mt-3 h-10 w-full rounded-[10px] border border-black/10 bg-black/[0.03] px-3 text-[15px] outline-none focus:border-black/25 dark:border-white/15 dark:bg-white/[0.06] dark:focus:border-white/35"
        />
        {error && <p className={`mt-2 text-[12.5px] ${DESTRUCTIVE_CLS}`}>{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-[10px] bg-black/[0.05] text-[15px] active:bg-black/[0.1] dark:bg-white/[0.08] dark:active:bg-white/[0.14]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className="h-10 flex-1 rounded-[10px] bg-black text-[15px] font-medium text-white active:opacity-80 dark:bg-white dark:text-black"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 新建世界书大弹窗（按用户参考图：图标 + 标题副标题 + 名称 + 范围三选卡片 + 底部取消/创建） */
function CreateBookDialog({
  contacts,
  userNames,
  onConfirm,
  onClose,
  onCreateCharacter,
}: {
  /** 角色可选名单（已排除 user 用户自己），供「专属」绑定 */
  contacts: ContactRecord[];
  /** 被排除的 user（用户自己）名字列表：名单为空时用于诊断提示（用户常把 AI 角色建在 USER 标签页下） */
  userNames: string[];
  onConfirm: (name: string, scope: WbScope, targetContactId: string | null) => void;
  onClose: () => void;
  /** 名单为空时跳去联系人 App 创建角色 */
  onCreateCharacter: () => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<WbScope>('global');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const submit = () => {
    const check = wbNameCheck(name);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    if (scope === 'exclusive' && !targetId) {
      setError('专属世界书需要绑定一个角色');
      return;
    }
    onConfirm(name.trim(), scope, scope === 'exclusive' ? targetId : null);
  };

  return (
    <div className="absolute inset-0 z-[70] grid place-items-center px-6" role="dialog" aria-label="新建世界书">
      <button type="button" aria-label="取消" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[88%] w-full flex-col overflow-y-auto rounded-[24px] bg-white/75 p-5 pb-6 shadow-[0_8px_28px_rgba(17,24,39,0.1)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#1C1C1E]/85 dark:ring-white/[0.09]" data-testid="wb-create-dialog">
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-3.5 top-3.5 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] active:bg-black/[0.1] dark:bg-white/[0.1] dark:active:bg-white/[0.18]"
        >
          <X className="h-4 w-4 text-black/50 dark:text-white/50" strokeWidth={2.4} aria-hidden="true" />
        </button>

        {/* 头部：图标 + 标题 + 副标题 */}
        <div className="mt-2 flex flex-col items-center">
          <span aria-hidden="true" className="grid h-16 w-16 place-items-center rounded-[18px] border-[1.5px] border-black/15 dark:border-white/25">
            <BookOpen className="h-7 w-7 text-black/70 dark:text-white/70" strokeWidth={1.6} />
          </span>
          <p className="mt-3.5 text-[21px] font-bold leading-tight">新建世界书</p>
          <p className={`mt-1 text-[14px] ${SUB_CLS}`}>为 AI 聊天准备的世界观设定库</p>
        </div>

        {/* 名称 */}
        <p className="mt-5 text-[16px] font-semibold">名称</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          placeholder="例如：现代都市背景"
          aria-label="世界书名称"
          data-testid="wb-dialog-name"
          maxLength={40}
          className="mt-2.5 h-16 w-full shrink-0 rounded-[16px] bg-black/[0.05] px-5 text-[18px] outline-none placeholder:text-[16px] placeholder:text-black/25 dark:bg-white/[0.08] dark:placeholder:text-white/25"
        />

        {/* 范围三选卡片 */}
        <p className="mt-5 text-[16px] font-semibold">范围</p>
        <div className="mt-2 flex w-full shrink-0 flex-col gap-2.5">
          {WB_SCOPES.map((s) => {
            const selected = scope === s;
            return (
              <button
                key={s}
                type="button"
                data-testid={`wb-dialog-scope-${s}`}
                aria-pressed={selected}
                onClick={() => {
                  setScope(s);
                  setError('');
                }}
                className={`flex w-full items-center gap-3 rounded-[14px] border-2 px-3.5 py-3 text-left transition-colors ${
                  selected
                    ? 'border-black bg-white dark:border-white dark:bg-transparent'
                    : 'border-transparent bg-black/[0.05] active:bg-black/[0.08] dark:bg-white/[0.08] dark:active:bg-white/[0.12]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border-[1.5px] ${
                    selected ? 'border-black/60 dark:border-white/60' : 'border-black/15 dark:border-white/25'
                  }`}
                >
                  <ScopeIcon scope={s} className="h-5 w-5 text-black/70 dark:text-white/70" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16.5px] font-semibold leading-tight">{WB_SCOPE_LABELS[s]}</span>
                  <span className={`mt-1 block truncate text-[12.5px] ${SUB_CLS}`}>{WB_SCOPE_SUBTITLES[s]}</span>
                </span>
                {selected ? (
                  <span aria-label="已选中" className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-black dark:bg-white">
                    <Check className="h-3.5 w-3.5 text-white dark:text-black" strokeWidth={3} aria-hidden="true" />
                  </span>
                ) : (
                  <span aria-hidden="true" className="h-[26px] w-[26px] shrink-0 rounded-full border-[1.5px] border-black/20 dark:border-white/30" />
                )}
              </button>
            );
          })}
        </div>

        {/* 所选范围的说明（短说明 + 适用提示） */}
        <p className={`mt-3.5 text-[13px] leading-[1.6] ${SUB_CLS}`}>
          {WB_SCOPE_SHORT_DESC[scope]}，{WB_SCOPE_TIPS[scope]}
        </p>

        {/* 专属：绑定角色 */}
        {scope === 'exclusive' && (
          <>
            <p className="mt-4 text-[16px] font-semibold">绑定角色</p>
            {contacts.length === 0 ? (
              /* 名单为空：分两种原因说清楚 + 去创建的入口（直接预选 CHAR 新建表单，
                 避免用户在 USER 标签页下建「角色」后回来看还是空） */
              <div
                data-testid="wb-dialog-empty-chars"
                className="mt-2 w-full shrink-0 rounded-[14px] bg-black/[0.05] px-4 py-4 dark:bg-white/[0.08]"
              >
                <p className="text-[14px] font-medium">
                  {userNames.length > 0 ? '名单为空：你添加的联系人都是 user（你自己）' : '还没有可绑定的 AI 角色'}
                </p>
                <p className={`mt-1 text-[12.5px] leading-[1.55] ${SUB_CLS}`}>
                  {userNames.length > 0 ? (
                    <>
                      绑定名单只显示 AI 角色（CHAR），user 不在其中（当前 user 卡片：{userNames.slice(0, 3).join('、')}
                      {userNames.length > 3 ? ' 等' : ''}）。
                      AI 角色要在「联系人」App 底部切到 <span className="font-medium">CHAR</span> 标签页创建，或直接点下面新建。
                    </>
                  ) : (
                    <>名单只列 AI 角色，你自己（user）不会出现在名单里。到「联系人」App 用 CHAR 标签创建一个，再回来绑定。</>
                  )}
                </p>
                <button
                  type="button"
                  data-testid="wb-dialog-goto-contacts"
                  onClick={onCreateCharacter}
                  className="mt-3 h-11 w-full rounded-[12px] bg-black text-[14px] font-medium text-white active:opacity-80 dark:bg-white dark:text-black"
                >
                  去联系人 App 新建 AI 角色
                </button>
              </div>
            ) : (
              /* 关键：shrink-0 防止 flex 弹窗把列表压成 0 高（overflow-y-auto 子项 min-height:auto 会被压缩，
                  角色明明存在却整列不可见 = 用户看到的「绑定角色那里没有角色」；内部超高走 max-h-44 滚动） */
              <div className="mt-2 max-h-44 w-full shrink-0 overflow-y-auto rounded-[14px] bg-black/[0.05] dark:bg-white/[0.08]">
                {contacts.map((c) => {
                  const selected = targetId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`wb-dialog-target-${c.id}`}
                      onClick={() => {
                        setTargetId(c.id);
                        setError('');
                      }}
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-[15px] first:rounded-t-[14px] last:rounded-b-[14px] active:bg-black/[0.05] dark:active:bg-white/[0.08] ${
                        selected ? 'font-medium' : ''
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      {selected && (
                        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-black dark:bg-white">
                          <Check className="h-3 w-3 text-white dark:text-black" strokeWidth={3} aria-hidden="true" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {error && <p className={`mt-3 text-[12.5px] ${DESTRUCTIVE_CLS}`}>{error}</p>}

        {/* 底部按钮 */}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            data-testid="wb-dialog-cancel"
            onClick={onClose}
            className="h-[52px] flex-[0.85] rounded-[16px] bg-black/[0.05] text-[16px] active:bg-black/[0.1] dark:bg-white/[0.08] dark:active:bg-white/[0.14]"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="wb-dialog-submit"
            onClick={submit}
            className="h-[52px] flex-[1.15] rounded-[16px] bg-black text-[16px] font-semibold text-white active:opacity-80 dark:bg-white dark:text-black"
          >
            创建世界书
          </button>
        </div>
      </div>
    </div>
  );
}

/** 通用确认弹层（删除等破坏性操作） */
function ConfirmDialog({
  title,
  message,
  confirmText,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[70] grid place-items-center px-8" role="dialog" aria-label={title}>
      <button type="button" aria-label="取消" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className={`${CARD_CLS} relative w-full p-4`}>
        <p className="text-center text-[16px] font-semibold">{title}</p>
        <p className={`mt-2 text-center text-[13.5px] leading-[1.55] ${SUB_CLS}`}>{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-[10px] bg-black/[0.05] text-[15px] active:bg-black/[0.1] dark:bg-white/[0.08] dark:active:bg-white/[0.14]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className={`h-10 flex-1 rounded-[10px] text-[15px] font-medium text-white active:opacity-80 ${
              destructive ? 'bg-[#FF3B30] dark:bg-[#FF453A]' : 'bg-black dark:bg-white dark:text-black'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 小工具 ----------------

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** 专属书绑定角色名（单个；可能未绑定/已删除） */
function exclusiveNameOf(book: WorldBook, contacts: ContactRecord[]): string {
  if (!book.targetContactId) return '';
  return contacts.find((c) => c.id === book.targetContactId)?.name ?? '已删除角色';
}

type ScopeFilter = 'all' | WbScope;

interface WbStats {
  global: number;
  local: number;
  exclusive: number;
  enabled: number;
}

/** 长按手势（指针事件实现；移动超过阈值视为滚动，取消触发） */
function useLongPress(onLongPress: () => void, ms = 480) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      fired.current = false;
      startPoint.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const s = startPoint.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    didFire: () => fired.current,
  };
}

// ---------------- 页面组件 ----------------

type Nav =
  | { name: 'list' }
  | { name: 'book'; bookId: string }
  | { name: 'entry'; bookId: string; entryId: string; isNew?: boolean };

/** 世界书 App 主组件 */
export default function WorldBookApp() {
  const [books, setBooks] = useState<WorldBook[]>([]);
  const [nav, setNav] = useState<Nav>({ name: 'list' });
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameDialog, setRenameDialog] = useState<{ bookId: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmText: string; destructive?: boolean; action: () => void } | null>(null);
  const [sheetBookId, setSheetBookId] = useState<string | null>(null);
  const [toast, showToast] = useLocalToast();
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<WbEntry | null>(null); // 新建条目的未保存草稿（保存才落盘，返回即放弃）
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [charFilterId, setCharFilterId] = useState<string | null>(null);
  const [charSheet, setCharSheet] = useState(false);
  const [sheetEntryId, setSheetEntryId] = useState<string | null>(null);
  const [scopeSheetFor, setScopeSheetFor] = useState<string | null>(null); // 详情页「范围」行
  const [bindSheetFor, setBindSheetFor] = useState<string | null>(null); // 详情页「绑定角色」行
  const editorSaveRef = useRef<(() => void) | null>(null);

  // 开机门控保证 kv 已注水：挂载时同步读一次即可（书籍只在本 App 内修改）
  useEffect(() => {
    setBooks(loadBooks());
    void listContacts()
      .then(setContacts)
      .catch(() => undefined);
  }, []);

  // 打开新建弹窗/任一角色名单时刷新联系人（用户中途去联系人 App 建了角色回来能立刻看到）
  useEffect(() => {
    if (!createOpen && !bindSheetFor && !charSheet) return;
    void listContacts()
      .then(setContacts)
      .catch(() => undefined);
  }, [createOpen, bindSheetFor, charSheet]);

  /** 角色可选名单：只列 AI 角色/配角——user 是用户自己，不参与绑定与筛选 */
  const aiContacts = useMemo(() => contacts.filter((c) => c.kind !== 'user'), [contacts]);

  /** 被排除的 user 名字：名单为空时用于诊断（用户常把 AI 角色建在 USER 标签页下） */
  const userNames = useMemo(() => contacts.filter((c) => c.kind === 'user').map((c) => c.name), [contacts]);

  /** 从世界书跳去联系人 App 创建 AI 角色：预置 CHAR 新建表单（避免用户建在 USER 标签页下，导致绑定名单依旧为空） */
  const gotoCreateChar = () => {
    useUI.getState().setPendingContactCreate('char');
    useUI.getState().switchToApp('contacts');
  };

  const persist = (next: WorldBook[]) => {
    setBooks(next);
    saveBooks(next);
  };

  const contactNameOf = (id: string | null | undefined) => (id ? contacts.find((c) => c.id === id)?.name ?? '已删除角色' : '');

  const stats: WbStats = {
    global: books.filter((b) => b.scope === 'global').length,
    local: books.filter((b) => b.scope === 'local').length,
    exclusive: books.filter((b) => b.scope === 'exclusive').length,
    enabled: books.filter((b) => b.enabled && b.entries.some((e) => e.enabled)).length,
  };

  const activeCharFilter =
    charFilterId && contacts.some((c) => c.id === charFilterId && c.kind !== 'user') ? charFilterId : null;
  const charFilterName = activeCharFilter ? contacts.find((c) => c.id === activeCharFilter)?.name ?? '' : '';

  /** 切换范围 tab；离开「专属」时清掉角色筛选（角色筛选只在专属界面有意义） */
  const applyScopeFilter = (s: ScopeFilter) => {
    setScopeFilter(s);
    if (s !== 'exclusive') setCharFilterId(null);
  };

  // 范围筛选按书级 scope；角色筛选（仅专属界面出现）筛绑定给该角色的专属书
  const filteredBooks = books.filter((b) => {
    if (scopeFilter !== 'all' && b.scope !== scopeFilter) return false;
    if (activeCharFilter) return b.scope === 'exclusive' && b.targetContactId === activeCharFilter;
    return true;
  });

  const lastUpdateText = books.length === 0 ? '—' : fmtTime(Math.max(...books.map((b) => b.updatedAt)));

  const createBook = (name: string, scope: WbScope, targetContactId: string | null) => {
    const now = Date.now();
    const book: WorldBook = { id: newWbId('wb'), name, enabled: true, scope, targetContactId, entries: [], createdAt: now, updatedAt: now };
    setCreateOpen(false);
    persist([...books, book]);
    showToast(`已创建「${name}」`);
    setNav({ name: 'book', bookId: book.id });
  };

  const renameBook = (bookId: string, name: string) => {
    const trimmed = name.trim();
    setRenameDialog(null);
    persist(books.map((b) => (b.id === bookId ? { ...b, name: trimmed, updatedAt: Date.now() } : b)));
    showToast('已重命名');
  };

  const deleteBook = (bookId: string) => {
    const target = books.find((b) => b.id === bookId);
    persist(books.filter((b) => b.id !== bookId));
    void pruneBookFromAllBindings(bookId);
    showToast(`已删除「${target?.name ?? ''}」`);
    if (nav.name !== 'list' && 'bookId' in nav && nav.bookId === bookId) setNav({ name: 'list' });
  };

  /** 书级启用总开关：关闭后整本书永不注入 */
  const toggleBookEnabled = (bookId: string, v: boolean) => {
    persist(books.map((b) => (b.id === bookId ? { ...b, enabled: v, updatedAt: Date.now() } : b)));
  };

  /** 改书级范围；切到专属且未绑定角色时，紧接着打开绑定角色菜单 */
  const changeBookScope = (bookId: string, scope: WbScope) => {
    const target = books.find((b) => b.id === bookId)?.targetContactId ?? null;
    persist(books.map((b) => (b.id === bookId ? { ...b, scope, updatedAt: Date.now() } : b)));
    if (scope === 'exclusive' && !target) {
      showToast('请选择绑定的角色');
      setBindSheetFor(bookId);
    }
  };

  /** 绑定/更换专属书的目标角色 */
  const bindBookTarget = (bookId: string, contactId: string) => {
    persist(books.map((b) => (b.id === bookId ? { ...b, targetContactId: contactId, updatedAt: Date.now() } : b)));
    showToast('已绑定角色');
  };

  const exportBook = (bookId: string) => {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    const payload = buildExportPayload([book], (id) => contactNameOf(id));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(book.name)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast('已导出 .json 文件');
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const imported = parseWorldBookImport(parsed, (name) => contacts.find((c) => c.name === name)?.id ?? null);
      persist([...books, ...imported]);
      showToast(imported.length === 1 ? `已导入「${imported[0].name}」` : `已导入 ${imported.length} 本世界书`);
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : '导入失败：文件不是合法的 JSON');
    } finally {
      setImporting(false);
    }
  };

  const sheetBook = sheetBookId ? books.find((b) => b.id === sheetBookId) : null;
  const sheetEntryBook = nav.name === 'book' ? books.find((b) => b.id === nav.bookId) : null;
  const sheetEntry = sheetEntryBook && sheetEntryId ? sheetEntryBook.entries.find((e) => e.id === sheetEntryId) ?? null : null;
  const scopeSheetBook = scopeSheetFor ? books.find((b) => b.id === scopeSheetFor) : null;
  const bindSheetBook = bindSheetFor ? books.find((b) => b.id === bindSheetFor) : null;

  return (
    <div className={`absolute inset-0 flex h-full w-full flex-col ${PAGE_CLS}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          {nav.name !== 'list' ? (
            <button
              type="button"
              aria-label="返回"
              data-testid="wb-back"
              onClick={() => {
                if (nav.name === 'entry') {
                  if (nav.isNew) setPendingDraft(null); // 新建未保存：返回即放弃草稿
                  setNav({ name: 'book', bookId: nav.bookId });
                } else {
                  setNav({ name: 'list' });
                }
              }}
              className="flex items-center rounded-full px-1 active:opacity-50"
            >
              <ChevronLeft className="h-7 w-7" strokeWidth={2.2} />
            </button>
          ) : (
            <BackToHome className="static!" />
          )}
          {/* 书库首页：标题紧跟返回键右侧（用户要求），其余页面标题居中 */}
          {nav.name === 'list' && <h1 className="ml-1 text-[17px] font-semibold leading-none">我的世界书库</h1>}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">
            {nav.name === 'book'
              ? books.find((b) => b.id === nav.bookId)?.name ?? ''
              : nav.name === 'entry'
                ? nav.isNew
                  ? '新建条目'
                  : '编辑条目'
                : ''}
          </div>
          <div className="ml-auto flex items-center gap-1 pr-1">
            {nav.name === 'list' && (
              <>
                <button
                  type="button"
                  aria-label="导入世界书"
                  data-testid="wb-import"
                  onClick={() => importRef.current?.click()}
                  disabled={importing}
                  className="grid h-9 w-9 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1] disabled:opacity-50"
                >
                  <Upload className="h-[21px] w-[21px]" strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="新建世界书"
                  data-testid="wb-create"
                  onClick={() => setCreateOpen(true)}
                  className="grid h-9 w-9 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
                >
                  <Plus className="h-[23px] w-[23px]" strokeWidth={2.2} aria-hidden="true" />
                </button>
              </>
            )}
            {nav.name === 'book' && (
              <>
                <button
                  type="button"
                  aria-label="新建条目"
                  data-testid="wb-add-entry"
                  onClick={() => {
                    const draft = createEntryDraft();
                    setPendingDraft(draft); // 草稿不落盘，点右上角「保存」才创建
                    setNav({ name: 'entry', bookId: nav.bookId, entryId: draft.id, isNew: true });
                  }}
                  className="grid h-9 w-9 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
                >
                  <Plus className="h-[23px] w-[23px]" strokeWidth={2.2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="更多操作"
                  data-testid="wb-book-more"
                  onClick={() => setSheetBookId(nav.bookId)}
                  className="grid h-9 w-9 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
                >
                  <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
                </button>
              </>
            )}
            {nav.name === 'entry' && (
              <button
                type="button"
                data-testid="wb-edit-save-top"
                onClick={() => editorSaveRef.current?.()}
                className="rounded-full px-2.5 py-1.5 text-[16px] font-semibold active:opacity-50"
              >
                保存
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {nav.name === 'list' && (
          <BookListPage
            books={filteredBooks}
            totalCount={books.length}
            stats={stats}
            lastUpdateText={lastUpdateText}
            scopeFilter={scopeFilter}
            onScopeTab={applyScopeFilter}
            charFilterName={charFilterName}
            onOpenCharSheet={() => setCharSheet(true)}
            contacts={contacts}
            onOpen={(id) => setNav({ name: 'book', bookId: id })}
            onSheet={setSheetBookId}
          />
        )}
        {nav.name === 'book' && (() => {
          const book = books.find((b) => b.id === nav.bookId);
          if (!book) return <EmptyHint text="这本书不存在或已被删除" />;
          return (
            <BookDetailPage
              book={book}
              contacts={contacts}
              onToggleEntry={(entryId, v) =>
                persist(
                  books.map((b) =>
                    b.id === book.id
                      ? { ...b, updatedAt: Date.now(), entries: b.entries.map((e) => (e.id === entryId ? { ...e, enabled: v } : e)) }
                      : b,
                  ),
                )
              }
              onOpenEntry={(entryId) => setNav({ name: 'entry', bookId: book.id, entryId })}
              onEntrySheet={(entryId) => setSheetEntryId(entryId)}
              onAddEntry={() => {
                const draft = createEntryDraft();
                setPendingDraft(draft);
                setNav({ name: 'entry', bookId: book.id, entryId: draft.id, isNew: true });
              }}
              onToggleBook={(v) => toggleBookEnabled(book.id, v)}
              onOpenScopeSheet={() => setScopeSheetFor(book.id)}
              onOpenBindSheet={() => {
                if (aiContacts.length === 0) {
                  showToast('暂无角色，先到「联系人」App 创建');
                  return;
                }
                setBindSheetFor(book.id);
              }}
            />
          );
        })()}
        {nav.name === 'entry' && (() => {
          const book = books.find((b) => b.id === nav.bookId);
          const entry = nav.isNew ? pendingDraft : book?.entries.find((e) => e.id === nav.entryId);
          if (!book || !entry) return <EmptyHint text="该条目不存在或已被放弃" />;
          return (
            <EntryEditorPage
              key={entry.id}
              entry={entry}
              isNew={nav.isNew === true}
              bookScope={book.scope}
              registerSave={(fn) => {
                editorSaveRef.current = fn;
              }}
              showToast={showToast}
              onSave={(next) => {
                if (nav.isNew) {
                  persist(books.map((b) => (b.id === book.id ? { ...b, updatedAt: Date.now(), entries: [...b.entries, next] } : b)));
                  setPendingDraft(null);
                  showToast('已创建条目');
                } else {
                  persist(books.map((b) => (b.id === book.id ? { ...b, updatedAt: Date.now(), entries: b.entries.map((e) => (e.id === entry.id ? next : e)) } : b)));
                  showToast('已保存');
                }
                setNav({ name: 'book', bookId: book.id });
              }}
              onDelete={() => {
                setConfirm({
                  title: '删除条目',
                  message: `「${entry.name || '未命名条目'}」删除后不可恢复。`,
                  confirmText: '删除',
                  destructive: true,
                  action: () => {
                    persist(books.map((b) => (b.id === book.id ? { ...b, entries: b.entries.filter((e) => e.id !== entry.id), updatedAt: Date.now() } : b)));
                    showToast('已删除条目');
                    setNav({ name: 'book', bookId: book.id });
                  },
                });
              }}
            />
          );
        })()}
      </div>

      {/* 底部范围筛选栏（书库首页）：椭圆胶囊底座整体包裹，激活黑底白字圆片；整体上移（加大底部留白） */}
      {nav.name === 'list' && (
        <div className="shrink-0 px-4 pb-[calc(1.35rem+env(safe-area-inset-bottom))] pt-1" data-testid="wb-scope-bar">
          <div className="flex items-center gap-1 rounded-full bg-white/60 p-1 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
            {([
              ['all', '全部'],
              ['global', WB_SCOPE_LABELS.global],
              ['local', WB_SCOPE_LABELS.local],
              ['exclusive', WB_SCOPE_LABELS.exclusive],
            ] as const).map(([s, label]) => (
              <button
                key={s}
                type="button"
                data-testid={`wb-filter-${s}`}
                aria-pressed={scopeFilter === s}
                onClick={() => applyScopeFilter(s)}
                className={`h-9 flex-1 rounded-full text-[13px] font-medium transition-colors ${
                  scopeFilter === s
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'text-black/60 active:bg-black/[0.06] dark:text-white/60 dark:active:bg-white/[0.1]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 浮层 */}
      {createOpen && (
        <CreateBookDialog
          contacts={aiContacts}
          userNames={userNames}
          onConfirm={createBook}
          onClose={() => setCreateOpen(false)}
          onCreateCharacter={() => {
            setCreateOpen(false);
            gotoCreateChar();
          }}
        />
      )}
      {renameDialog && (
        <NameDialog
          title="重命名世界书"
          initial={books.find((b) => b.id === renameDialog.bookId)?.name ?? ''}
          confirmText="保存"
          onConfirm={(name) => renameBook(renameDialog.bookId, name)}
          onClose={() => setRenameDialog(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          destructive={confirm.destructive}
          onConfirm={confirm.action}
          onClose={() => setConfirm(null)}
        />
      )}
      {sheetBook && (
        <ActionSheet
          title={sheetBook.name}
          onClose={() => setSheetBookId(null)}
          actions={[
            { label: '重命名', onSelect: () => setRenameDialog({ bookId: sheetBook.id }) },
            { label: '导出', onSelect: () => exportBook(sheetBook.id) },
            {
              label: '删除世界书',
              destructive: true,
              onSelect: () =>
                setConfirm({
                  title: '删除世界书',
                  message: `「${sheetBook.name}」及其 ${sheetBook.entries.length} 个条目将被删除，且不再注入任何聊天。`,
                  confirmText: '删除',
                  destructive: true,
                  action: () => deleteBook(sheetBook.id),
                }),
            },
          ]}
        />
      )}
      {sheetEntry && (
        <ActionSheet
          title={sheetEntry.name || '未命名条目'}
          onClose={() => setSheetEntryId(null)}
          actions={[
            {
              label: '编辑条目',
              onSelect: () => {
                if (!sheetEntryBook) return;
                setNav({ name: 'entry', bookId: sheetEntryBook.id, entryId: sheetEntry.id });
              },
            },
            {
              label: '删除条目',
              destructive: true,
              onSelect: () => {
                const targetBook = sheetEntryBook;
                if (!targetBook) return;
                setConfirm({
                  title: '删除条目',
                  message: `「${sheetEntry.name || '未命名条目'}」删除后不可恢复。`,
                  confirmText: '删除',
                  destructive: true,
                  action: () => {
                    persist(
                      books.map((b) =>
                        b.id === targetBook.id ? { ...b, entries: b.entries.filter((e) => e.id !== sheetEntry.id), updatedAt: Date.now() } : b,
                      ),
                    );
                    showToast('已删除条目');
                  },
                });
              },
            },
          ]}
        />
      )}
      {/* 专属 tab 的角色筛选（只筛绑定给该角色的专属书） */}
      {charSheet && (
        <ActionSheet
          title="只看绑定给哪个角色的专属世界书"
          onClose={() => setCharSheet(false)}
          actions={[
            { id: 'wb-char-all', label: '全部角色', onSelect: () => setCharFilterId(null) },
            // 只列 AI 角色/配角（不显示角色类型标签），不包括 user（用户自己）；空名单时给去创建的入口
            ...(aiContacts.length > 0
              ? aiContacts.map((c) => ({
                  id: c.id,
                  label: c.name,
                  onSelect: () => setCharFilterId(c.id),
                }))
              : [
                  {
                    id: 'wb-char-goto-create',
                    label: '还没有 AI 角色，去联系人 App 新建（CHAR）',
                    onSelect: gotoCreateChar,
                  },
                ]),
          ]}
        />
      )}
      {/* 详情页「范围」行：改书级范围 */}
      {scopeSheetBook && (
        <ActionSheet
          title={`更换范围（当前：${WB_SCOPE_LABELS[scopeSheetBook.scope]}）`}
          onClose={() => setScopeSheetFor(null)}
          actions={WB_SCOPES.map((s) => ({
            id: s,
            label: `${WB_SCOPE_LABELS[s]} · ${WB_SCOPE_SUBTITLES[s]}`,
            onSelect: () => changeBookScope(scopeSheetBook.id, s),
          }))}
        />
      )}
      {/* 详情页「绑定角色」行：换绑专属书的目标角色（空名单时说明原因 + 可操作入口，不再弹一张空白菜单） */}
      {bindSheetBook && (
        <ActionSheet
          title={
            aiContacts.length > 0
              ? '绑定角色（仅对该角色的聊天生效）'
              : '还没有可绑定的 AI 角色（user 你自己不在名单内）'
          }
          onClose={() => setBindSheetFor(null)}
          actions={
            aiContacts.length > 0
              ? aiContacts.map((c) => ({
                  id: c.id,
                  label: c.name,
                  onSelect: () => bindBookTarget(bindSheetBook.id, c.id),
                }))
              : [
                  {
                    id: 'wb-bind-goto-create',
                    label: '去联系人 App 新建 AI 角色（CHAR）',
                    onSelect: gotoCreateChar,
                  },
                ]
          }
        />
      )}
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="wb-import-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />
      <LocalToast msg={toast} />
    </div>
  );
}

/** 空态提示 */
function EmptyHint({ text }: { text: string }) {
  return (
    <div className="grid place-items-center pt-16 text-center">
      <BookMarked className="h-10 w-10 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
      <p className={`mt-3 text-[14px] ${SUB_CLS}`}>{text}</p>
    </div>
  );
}

/** 书库首页：角色筛选（仅专属 tab）+ 统计卡（可点筛选）+ 书籍卡片列表 + 空态（大标题已上移顶栏返回键右侧） */
function BookListPage({
  books,
  totalCount,
  stats,
  lastUpdateText,
  scopeFilter,
  onScopeTab,
  charFilterName,
  onOpenCharSheet,
  contacts,
  onOpen,
  onSheet,
}: {
  books: WorldBook[]; // 已按范围/角色过滤后的书籍
  totalCount: number;
  stats: WbStats;
  lastUpdateText: string;
  scopeFilter: ScopeFilter;
  onScopeTab: (scope: ScopeFilter) => void;
  charFilterName: string;
  onOpenCharSheet: () => void;
  contacts: ContactRecord[];
  onOpen: (bookId: string) => void;
  onSheet: (bookId: string) => void;
}) {
  return (
    <>
      {/* 「全部角色」筛选只在专属界面显示（原大标题行保留，仅剩筛选钮靠右） */}
      {scopeFilter === 'exclusive' && (
        <div className="flex items-center justify-end gap-2 px-1 pt-1">
          <button
            type="button"
            data-testid="wb-char-filter"
            onClick={onOpenCharSheet}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/60 px-2.5 text-[12px] shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.1]"
          >
            {charFilterName || '全部角色'}
            <ChevronDown className="h-3.5 w-3.5 opacity-50" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}
      <p className={`px-1 pt-1 text-[13px] ${SUB_CLS}`} data-testid="wb-library-sub">
        共 {totalCount} 个世界书 · 最后更新 {lastUpdateText}
      </p>

      {/* 统计卡（紧凑）：全局/局部/专属 三列可点（再点一次取消筛选），已启用为计数展示 */}
      <div className={`${CARD_CLS} mt-2.5 flex items-stretch`}>
        {(['global', 'local', 'exclusive'] as const).map((s, i) => (
          <button
            key={s}
            type="button"
            data-testid={`wb-scope-tab-${s}`}
            aria-pressed={scopeFilter === s}
            onClick={() => onScopeTab(scopeFilter === s ? 'all' : s)}
            className={`relative flex-1 py-2 text-center transition-colors ${
              i > 0 ? `border-l ${DIVIDER_CLS}` : ''
            } ${scopeFilter === s ? 'bg-black/[0.04] dark:bg-white/[0.06]' : 'active:bg-black/[0.03] dark:active:bg-white/[0.04]'}`}
          >
            <span className="block text-[16px] font-bold leading-none tabular-nums">{stats[s]}</span>
            <span className={`mt-[3px] block text-[10.5px] ${scopeFilter === s ? 'font-medium' : SUB_CLS}`}>{WB_SCOPE_LABELS[s]}</span>
            {scopeFilter === s && (
              <span aria-hidden="true" className="absolute inset-x-9 bottom-0 h-[2px] rounded-t-full bg-black dark:bg-white" />
            )}
          </button>
        ))}
        <div className={`flex-1 border-l py-2 text-center ${DIVIDER_CLS}`}>
          <span className="block text-[16px] font-bold leading-none tabular-nums" data-testid="wb-stat-enabled">
            {stats.enabled}
          </span>
          <span className={`mt-[3px] block text-[10.5px] ${SUB_CLS}`}>已启用</span>
        </div>
      </div>
      {charFilterName && <p className={CAPTION_CLS}>只看绑定给「{charFilterName}」的专属世界书。</p>}

      {totalCount === 0 ? (
        <EmptyHint text="还没有世界书，点右上角 + 新建" />
      ) : books.length === 0 ? (
        <div className="grid place-items-center pt-16 text-center">
          <Globe className="h-12 w-12 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-[15px] font-medium text-black/35 dark:text-white/35">该范围下暂无世界书</p>
          <p className={`mt-1.5 text-[13px] ${SUB_CLS}`}>切换范围筛选，或点 + 新建一个</p>
        </div>
      ) : (
        <div className={`${CARD_CLS} mt-3`}>
          {books.map((book, i) => {
            const enabled = book.entries.filter((e) => e.enabled).length;
            const exName = book.scope === 'exclusive' ? exclusiveNameOf(book, contacts) : '';
            return (
              <div key={book.id} className={i > 0 ? `border-t ${DIVIDER_CLS}` : ''}>
                <div className="flex items-center">
                  <button
                    type="button"
                    data-testid={`wb-book-${i}`}
                    onClick={() => onOpen(book.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-black/[0.05] dark:bg-white/[0.08]">
                      <BookMarked className="h-5 w-5 text-black/60 dark:text-white/60" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px]">
                        {book.name}
                        <span className="ml-1.5 inline-block rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 align-middle text-[10.5px] leading-none text-black/55 dark:bg-white/[0.09] dark:text-white/55">
                          {WB_SCOPE_LABELS[book.scope]}
                          {exName ? ` · ${exName}` : ''}
                        </span>
                        {!book.enabled && (
                          <span className="ml-1 inline-block rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 align-middle text-[10.5px] leading-none text-black/40 dark:bg-white/[0.09] dark:text-white/40">
                            已停用
                          </span>
                        )}
                      </span>
                      <span className={`mt-0.5 block truncate text-[12.5px] ${SUB_CLS}`}>
                        {book.entries.length} 条目 · {enabled} 启用 · {fmtDate(book.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${book.name} 更多操作`}
                    data-testid={`wb-book-more-${i}`}
                    onClick={() => onSheet(book.id)}
                    className="grid h-11 w-10 shrink-0 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
                  >
                    <MoreHorizontal className="h-5 w-5 text-black/35 dark:text-white/35" strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** 位置徽章（范围在书级，条目不再显示范围徽章） */
function EntryBadges({ entry }: { entry: WbEntry }) {
  const base = 'rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 text-[11px] leading-none dark:bg-white/[0.09]';
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className={base}>{WB_POSITION_LABELS[entry.position]}</span>
      {entry.priority > 0 && <span className={base}>优先级 {entry.priority}</span>}
    </span>
  );
}

/** 单条条目行（点=编辑；长按或 ⋯=操作菜单，行尾不再放删除图标） */
function EntryRow({
  entry,
  index,
  onToggle,
  onOpen,
  onSheet,
}: {
  entry: WbEntry;
  index: number;
  onToggle: (v: boolean) => void;
  onOpen: () => void;
  onSheet: () => void;
}) {
  const lp = useLongPress(onSheet);
  return (
    <div className={index > 0 ? `border-t ${DIVIDER_CLS}` : ''}>
      <div className="flex items-center gap-2 pr-2">
        <button
          type="button"
          data-testid={`wb-entry-${index}`}
          onClick={() => {
            if (!lp.didFire()) onOpen(); // 长按已触发菜单时抑制紧随的 click
          }}
          onPointerDown={lp.onPointerDown}
          onPointerMove={lp.onPointerMove}
          onPointerUp={lp.onPointerUp}
          onPointerLeave={lp.onPointerLeave}
          onPointerCancel={lp.onPointerCancel}
          onContextMenu={(e) => e.preventDefault()}
          className="min-w-0 flex-1 select-none px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] [-webkit-touch-callout:none]"
        >
          <span className={`block truncate text-[15.5px] ${entry.enabled ? '' : SUB_CLS}`}>{entry.name || '未命名条目'}</span>
          <span className={`mt-0.5 block truncate text-[12.5px] ${SUB_CLS}`}>
            {entry.keywords.length > 0 ? `触发词：${entry.keywords.join('、')}` : '无触发词（全局书内容常驻注入）'}
          </span>
          <EntryBadges entry={entry} />
        </button>
        <MonoToggle on={entry.enabled} onChange={onToggle} label={`启用${entry.name || '未命名条目'}`} testId={`wb-entry-toggle-${index}`} />
        <button
          type="button"
          aria-label={`${entry.name || '未命名条目'} 更多操作`}
          data-testid={`wb-entry-more-${index}`}
          onClick={onSheet}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
        >
          <MoreHorizontal className="h-5 w-5 text-black/35 dark:text-white/35" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 书籍详情页（按参考图）：计数 + 范围徽章 + 说明；范围/启用/绑定角色设置卡；虚线新建条目；条目列表 */
function BookDetailPage({
  book,
  contacts,
  onToggleEntry,
  onOpenEntry,
  onEntrySheet,
  onAddEntry,
  onToggleBook,
  onOpenScopeSheet,
  onOpenBindSheet,
}: {
  book: WorldBook;
  contacts: ContactRecord[];
  onToggleEntry: (entryId: string, v: boolean) => void;
  onOpenEntry: (entryId: string) => void;
  onEntrySheet: (entryId: string) => void;
  onAddEntry: () => void;
  /** 书级启用总开关 */
  onToggleBook: (v: boolean) => void;
  /** 打开「范围」选择菜单 */
  onOpenScopeSheet: () => void;
  /** 打开「绑定角色」菜单（仅专属范围） */
  onOpenBindSheet: () => void;
}) {
  const boundName = book.scope === 'exclusive' ? exclusiveNameOf(book, contacts) : '';
  return (
    <>
      {/* 头部：条目计数 + 范围徽章 + 一句话说明 */}
      <div className="flex items-center gap-2.5 px-1 pt-1.5">
        <span className="text-[34px] font-bold leading-none tabular-nums" data-testid="wb-detail-count">
          {book.entries.length}
        </span>
        {book.enabled ? (
          <span className="rounded-[8px] bg-black px-2.5 py-1 text-[14px] font-semibold leading-none text-white dark:bg-white dark:text-black">
            {WB_SCOPE_LABELS[book.scope]}
          </span>
        ) : (
          <span className="rounded-[8px] bg-black/35 px-2.5 py-1 text-[14px] font-semibold leading-none text-white dark:bg-white/35">
            已停用
          </span>
        )}
      </div>
      <p className={`mt-2 px-1 text-[14.5px] ${SUB_CLS}`}>{WB_SCOPE_SHORT_DESC[book.scope]}</p>

      {/* 设置卡：范围 / 启用（总开关）/ 绑定角色（仅专属） */}
      <div className={`${CARD_CLS} mt-3`}>
        <button
          type="button"
          data-testid="wb-detail-scope-row"
          onClick={onOpenScopeSheet}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
        >
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-black/15 dark:border-white/20">
            <ScopeIcon scope={book.scope} className="h-5 w-5 text-black/70 dark:text-white/70" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px]">范围</span>
          </span>
          <span className={`shrink-0 text-[15px] ${SUB_CLS}`}>
            {WB_SCOPE_LABELS[book.scope]}
            {book.scope === 'exclusive' ? ` · ${boundName || '未绑定'}` : ''}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
        </button>
        <div className={`border-t ${DIVIDER_CLS}`}>
          <div className="flex items-center gap-3 px-4 py-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-black/15 dark:border-white/20">
              <FileText className="h-5 w-5 text-black/70 dark:text-white/70" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">启用</span>
            </span>
            <MonoToggle on={book.enabled} onChange={onToggleBook} label="启用世界书" testId="wb-detail-enable" />
          </div>
        </div>
        {book.scope === 'exclusive' && (
          <div className={`border-t ${DIVIDER_CLS}`}>
            <button
              type="button"
              data-testid="wb-detail-bind-row"
              onClick={onOpenBindSheet}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-black/15 dark:border-white/20">
                <User className="h-5 w-5 text-black/70 dark:text-white/70" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px]">绑定角色</span>
              </span>
              <span className={`shrink-0 truncate text-[15px] ${boundName ? SUB_CLS : DESTRUCTIVE_CLS}`}>{boundName || '未绑定'}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <p className={CAPTION_CLS}>{WB_SCOPE_TIPS[book.scope]}</p>

      {/* 虚线「+ 新建条目」大按钮 */}
      <button
        type="button"
        data-testid="wb-detail-add"
        onClick={onAddEntry}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-[14px] border-[1.5px] border-dashed border-black/25 bg-white/50 py-4 text-[16px] font-semibold backdrop-blur-xl active:bg-black/[0.03] dark:border-white/30 dark:bg-white/[0.04] dark:active:bg-white/[0.05]"
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden="true" />
        新建条目
      </button>

      {book.entries.length > 0 && (
        <div className={`${CARD_CLS} mt-3`}>
          {book.entries.map((entry, i) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              index={i}
              onToggle={(v) => onToggleEntry(entry.id, v)}
              onOpen={() => onOpenEntry(entry.id)}
              onSheet={() => onEntrySheet(entry.id)}
            />
          ))}
        </div>
      )}

      {book.entries.length === 0 && (
        <div className="grid place-items-center pt-14 text-center">
          <FileText className="h-12 w-12 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-[16px] font-semibold">还没有条目</p>
          <p className={`mt-1.5 text-[13.5px] ${SUB_CLS}`}>条目是发送给 AI 的世界观设定</p>
        </div>
      )}
    </>
  );
}

/** 设置组里的选项行（右侧勾） */
function OptionRow({
  label,
  note,
  selected,
  testId,
  onClick,
  first,
}: {
  label: string;
  note?: string;
  selected: boolean;
  testId: string;
  onClick: () => void;
  first?: boolean;
}) {
  return (
    <div className={first ? '' : `border-t ${DIVIDER_CLS}`}>
      <button type="button" data-testid={testId} onClick={onClick} className="flex w-full items-center justify-between px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]">
        <span className="min-w-0">
          <span className="block text-[15px]">{label}</span>
          {note && <span className={`mt-0.5 block text-[12px] leading-[1.4] ${SUB_CLS}`}>{note}</span>}
        </span>
        {selected && (
          <span className="grid shrink-0 place-items-center pl-2" aria-label="已选中">
            <Check className="h-5 w-5" strokeWidth={2.4} />
          </span>
        )}
      </button>
    </div>
  );
}

const POSITION_NOTES: Record<WbPosition, string> = {
  before_system: '插入整段系统提示词最前面',
  after_system: '插入整段系统提示词最后面',
  before_char: '插在角色人设定义之前',
  after_char: '插在角色人设定义之后',
  before_user: '包裹在最后一条用户消息之前',
  after_user: '包裹在最后一条用户消息之后',
};

/** 条目编辑页（本地草稿，点右上角「保存」才落盘；新建条目在保存前不落盘，返回即放弃）。
 * 范围在书级：编辑页不再有生效范围区块；全局书触发词可留空（内容常驻注入）。 */
function EntryEditorPage({
  entry,
  isNew,
  bookScope,
  registerSave,
  showToast,
  onSave,
  onDelete,
}: {
  entry: WbEntry;
  /** 新建未保存的条目：不渲染删除按钮，保存时才写入书籍 */
  isNew?: boolean;
  /** 所属书的范围：全局书触发词可留空 */
  bookScope: WbScope;
  /** 把内部 save 暴露给顶栏（右上角「保存」按钮） */
  registerSave?: (fn: (() => void) | null) => void;
  showToast?: (msg: string) => void;
  onSave: (next: WbEntry) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<WbEntry>(entry);
  const [keywordsInput, setKeywordsInput] = useState(entry.keywords.join('，'));
  const [error, setError] = useState('');
  const keywords = useMemo(() => parseKeywordsInput(keywordsInput), [keywordsInput]);

  const save = () => {
    const check = wbEntryCheck({ keywords, content: draft.content }, { requireKeywords: bookScope !== 'global' });
    if (!check.ok) {
      setError(check.reason);
      showToast?.(check.reason);
      return;
    }
    onSave({
      ...draft,
      name: draft.name.trim() || '未命名条目',
      keywords,
      content: draft.content,
    });
  };

  // 草稿状态在本组件内：每次渲染把最新 save 暴露给顶栏右上角「保存」按钮
  useEffect(() => {
    registerSave?.(save);
    return () => registerSave?.(null);
  });

  return (
    <div className="pb-2">
      {/* 开关 + 条目名字 */}
      <div className={`${CARD_CLS}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15.5px]">启用条目</span>
          <MonoToggle on={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="启用条目" testId="wb-edit-enabled" />
        </div>
        <div className={`border-t ${DIVIDER_CLS}`}>
          <label className="block px-4 pb-1 pt-2.5 text-[12.5px]">
            <span className={SUB_CLS}>条目名字（仅本地显示，不发送给 AI）</span>
          </label>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="如：魔法世界观"
            aria-label="条目名字"
            data-testid="wb-edit-name"
            className="h-10 w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
        </div>
      </div>

      {/* 触发词（全局书可留空：内容常驻注入不扫描关键词） */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">
        触发词
        {bookScope === 'global' && <span className="ml-1.5 text-[11.5px] text-black/35 dark:text-white/35">全局书无需触发词，可留空</span>}
      </p>
      <div className={`${CARD_CLS} p-3`}>
        <input
          value={keywordsInput}
          onChange={(e) => {
            setKeywordsInput(e.target.value);
            setError('');
          }}
          placeholder={bookScope === 'global' ? '可留空（内容始终注入）' : '多个触发词用逗号分隔，命中任一即激活'}
          aria-label="触发词"
          data-testid="wb-edit-keywords"
          className="h-9 w-full rounded-[9px] bg-black/[0.04] px-3 text-[14.5px] outline-none placeholder:text-black/25 dark:bg-white/[0.07] dark:placeholder:text-white/25"
        />
        {keywords.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {keywords.map((kw) => (
              <button
                key={kw}
                type="button"
                aria-label={`删除触发词 ${kw}`}
                onClick={() => {
                  const rest = keywords.filter((k) => k !== kw);
                  setKeywordsInput(rest.join('，'));
                }}
                className="flex items-center gap-1 rounded-full bg-black/[0.06] py-1 pl-2.5 pr-1.5 text-[12.5px] active:opacity-60 dark:bg-white/[0.1]"
              >
                {kw}
                <span aria-hidden="true" className="grid h-3.5 w-3.5 place-items-center rounded-full bg-black/25 text-[9px] leading-none text-white dark:bg-white/30">
                  ×
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 内容 */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">内容（激活后插入的设定文本）</p>
      <div className={`${CARD_CLS} p-3`}>
        <textarea
          value={draft.content}
          onChange={(e) => {
            setDraft({ ...draft, content: e.target.value });
            setError('');
          }}
          placeholder="写给 AI 的设定文本，如：这个世界是一片魔法大陆，共有五大王国……"
          aria-label="条目内容"
          data-testid="wb-edit-content"
          rows={6}
          className="w-full resize-none rounded-[9px] bg-black/[0.04] px-3 py-2.5 text-[14.5px] leading-[1.6] outline-none placeholder:text-black/25 dark:bg-white/[0.07] dark:placeholder:text-white/25"
        />
      </div>

      {/* 插入位置 */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">插入位置</p>
      <div className={CARD_CLS}>
        {WB_POSITIONS.map((pos, i) => (
          <OptionRow
            key={pos}
            label={WB_POSITION_LABELS[pos]}
            note={POSITION_NOTES[pos]}
            selected={draft.position === pos}
            testId={`wb-edit-pos-${pos}`}
            first={i === 0}
            onClick={() => setDraft({ ...draft, position: pos })}
          />
        ))}
      </div>

      {/* 优先级 + 忽略大小写 */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">排序与匹配</p>
      <div className={CARD_CLS}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="min-w-0">
            <span className="block text-[15px]">优先级</span>
            <span className={`mt-0.5 block text-[12px] leading-[1.4] ${SUB_CLS}`}>同一位置多条命中时，数字大的排前面</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              aria-label="降低优先级"
              data-testid="wb-edit-priority-minus"
              onClick={() => setDraft({ ...draft, priority: Math.max(0, draft.priority - 1) })}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] text-[18px] active:bg-black/[0.1] dark:bg-white/[0.09] dark:active:bg-white/[0.15]"
            >
              −
            </button>
            <span data-testid="wb-edit-priority-value" className="w-8 text-center text-[15.5px] tabular-nums">
              {draft.priority}
            </span>
            <button
              type="button"
              aria-label="提高优先级"
              data-testid="wb-edit-priority-plus"
              onClick={() => setDraft({ ...draft, priority: Math.min(9999, draft.priority + 1) })}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] text-[18px] active:bg-black/[0.1] dark:bg-white/[0.09] dark:active:bg-white/[0.15]"
            >
              +
            </button>
          </span>
        </div>
        <div className={`border-t ${DIVIDER_CLS}`}>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="min-w-0">
              <span className="block text-[15px]">忽略大小写</span>
              <span className={`mt-0.5 block text-[12px] leading-[1.4] ${SUB_CLS}`}>触发词匹配时不区分英文字母大小写</span>
            </span>
            <MonoToggle on={draft.ignoreCase} onChange={(v) => setDraft({ ...draft, ignoreCase: v })} label="忽略大小写" testId="wb-edit-ignorecase" />
          </div>
        </div>
      </div>

      {error && <p className={`px-1 pt-2.5 text-[12.5px] ${DESTRUCTIVE_CLS}`}>{error}</p>}

      {/* 删除（仅已保存的条目；保存按钮在顶栏右上角） */}
      {!isNew && (
        <div className="mt-5">
          <button
            type="button"
            data-testid="wb-edit-delete"
            onClick={onDelete}
            className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] bg-white/60 text-[15.5px] shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.98] active:bg-black/[0.04] dark:bg-white/[0.08] dark:ring-white/[0.1] dark:active:bg-white/[0.12] ${DESTRUCTIVE_CLS}`}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            删除条目
          </button>
        </div>
      )}
      <p className={`pt-2 text-center text-[12px] ${SUB_CLS}`}>
        {isNew ? '点右上角「保存」创建条目；返回则放弃' : '点右上角「保存」才会生效；返回不保存修改'}
      </p>
    </div>
  );
}
