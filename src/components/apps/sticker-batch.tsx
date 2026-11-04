'use client';

/**
 * 批量添加表情确认弹窗（微信 / QQ 共用）：
 * 选择多张手机图片（或解析批量链接）后先进入预览确认——
 * 缩略图 + 可编辑名称（意思）+ 单项移除 + 批量链接导入，
 * 点「确认添加 (N)」才真正入库。
 * 视觉为自研样式：浅灰底 + 白卡片列表 + 左标题右关闭 + 品牌色主按钮（与参考样式刻意区分）。
 */

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import {
  BUILTIN_STICKER_GROUP_ID,
  builtinTabIconUrl,
} from '@/lib/ios/builtin-stickers';
import {
  DEFAULT_STICKER_GROUP_ID,
  extractMeaningFromUrl,
  isImageUrl,
  newStickerGroupId,
  newStickerId,
  type Sticker,
  type StickerGroup,
} from '@/lib/ios/stickers';

/** 分组栏展示顺序：内置分组（表情图标胶囊）永远最前，其余按传入顺序 */
function orderedGroups(groups: StickerGroup[]): StickerGroup[] {
  const builtin = groups.filter((g) => g.id === BUILTIN_STICKER_GROUP_ID);
  const rest = groups.filter((g) => g.id !== BUILTIN_STICKER_GROUP_ID);
  return [...builtin, ...rest];
}

export interface BatchDraftItem {
  key: string;
  /** dataURL（本机图片）或 http(s) URL */
  preview: string;
  /** 名称（即表情意思，可编辑） */
  name: string;
  /** 来源默认名（文件名去扩展名 / 链接自动识别，作为初始名称） */
  fallbackName: string;
  source: 'file' | 'url';
}

/** 解析一行批量链接：支持「名称: URL」「名称 URL」或纯 URL（名称缺省时从 URL 自动识别） */
function parseBatchUrlLine(line: string): { name: string; url: string } | null {
  const m = line.match(/https?:\/\/\S+/i);
  if (!m) return null;
  const url = m[0];
  if (!isImageUrl(url)) return null;
  let name = line
    .slice(0, m.index ?? 0)
    .trim()
    .replace(/[:：]\s*$/, '')
    .trim();
  if (!name) name = extractMeaningFromUrl(url);
  return { name, url };
}

/** 表情意思预设（聊天面板长按下方意思标签时快速选用；也支持自定义输入或不设置） */
export const STICKER_MEANING_PRESETS = [
  '开心',
  '哈哈',
  '点赞',
  '可爱',
  '贴贴',
  '裂开',
  '哭哭',
  '生气',
  '疑惑',
  '惊讶',
  'OK',
  '晚安',
  '抱抱',
  '吃瓜',
  '握手',
  '庆祝',
];

/**
 * 表情意思选择 UI（微信 / QQ 聊天表情面板共用）：
 * 点表情下方的意思标签弹出——预设意思胶囊（点选/再点取消）+ 自定义输入 + 「不设置」（可以不选择意思）。
 */
export function StickerMeaningPicker({
  testPrefix,
  url,
  value,
  onConfirm,
  onClose,
}: {
  testPrefix: string;
  /** 表情缩略图（弹窗内回显） */
  url: string;
  /** 当前意思（可为空 = 未设置） */
  value: string;
  /** 确定：携带最终意思（空串 = 清除） */
  onConfirm: (v: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const t = (k: string) => `${testPrefix}-meaning-${k}`;
  const accent = testPrefix === 'wx' ? '#07C160' : '#0099FF';

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 px-6"
      data-testid={t('sheet')}
      onClick={onClose}
    >
      <div
        className="w-full rounded-[18px] bg-[#F2F3F5] p-4 shadow-2xl dark:bg-[#232427]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">设置意思</p>
          <button
            type="button"
            aria-label="关闭"
            data-testid={t('close')}
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.06] text-black/45 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/45"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white dark:bg-white/[0.08]">
            <img src={url} alt="表情" className="h-full w-full object-contain" />
          </span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={20}
            placeholder="自定义意思，可留空"
            data-testid={t('input')}
            className="h-10 min-w-0 flex-1 rounded-[10px] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/[0.08] dark:placeholder:text-white/30"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {STICKER_MEANING_PRESETS.map((p, i) => (
            <button
              key={p}
              type="button"
              data-testid={`${t('chip')}-${i}`}
              onClick={() => setDraft(draft === p ? '' : p)}
              className={`h-8 rounded-full px-3 text-[13px] active:opacity-70 ${
                draft === p
                  ? 'text-white'
                  : 'bg-black/[0.05] text-black/60 dark:bg-white/[0.08] dark:text-white/60'
              }`}
              style={draft === p ? { backgroundColor: accent } : undefined}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            data-testid={t('clear')}
            onClick={() => onConfirm('')}
            className="h-10 rounded-full border border-black/10 bg-white px-5 text-[14px] text-black/55 active:bg-black/[0.04] dark:border-white/15 dark:bg-white/[0.06] dark:text-white/55"
          >
            不设置
          </button>
          <button
            type="button"
            data-testid={t('done')}
            onClick={() => onConfirm(draft.trim())}
            className="h-10 rounded-full px-6 text-[14px] font-medium text-white active:opacity-85"
            style={{ backgroundColor: accent }}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

export function BatchStickerSheet({
  open,
  items,
  onItemsChange,
  onCancel,
  onConfirm,
  onToast,
  testPrefix,
}: {
  open: boolean;
  items: BatchDraftItem[];
  onItemsChange: (items: BatchDraftItem[]) => void;
  onCancel: () => void;
  onConfirm: (items: BatchDraftItem[]) => void;
  onToast: (m: string) => void;
  testPrefix: string;
}) {
  const [urlText, setUrlText] = useState('');
  if (!open) return null;

  const t = (k: string) => `${testPrefix}-batch-${k}`;
  const MAX = 12;
  /** 品牌主色：微信绿 / QQ 蓝（主按钮与解析按钮用） */
  const accent = testPrefix === 'wx' ? '#07C160' : '#0099FF';

  const appendItems = (next: BatchDraftItem[]) => {
    const merged = [...items, ...next];
    if (merged.length > MAX) {
      onItemsChange(merged.slice(0, MAX));
      onToast(`一次最多添加 ${MAX} 张`);
    } else {
      onItemsChange(merged);
    }
  };

  /** 解析批量链接文本域：每行一个，「名称: URL」「名称 URL」或纯 URL */
  const parseUrls = () => {
    const lines = urlText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      onToast('请先输入图片链接');
      return;
    }
    const added: BatchDraftItem[] = [];
    let bad = 0;
    for (const line of lines) {
      const p = parseBatchUrlLine(line);
      if (!p) {
        bad++;
        continue;
      }
      added.push({ key: newStickerId(), preview: p.url, name: p.name, fallbackName: p.name, source: 'url' });
    }
    if (added.length === 0) {
      onToast('没有有效的图片链接');
      return;
    }
    appendItems(added);
    setUrlText('');
    onToast(bad > 0 ? `已解析 ${added.length} 个，${bad} 行无效已跳过` : `已解析 ${added.length} 个链接`);
  };


  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 px-6"
      data-testid={t('sheet')}
      onClick={onCancel}
    >
      <div
        className="max-h-[86%] w-full overflow-y-auto rounded-[18px] bg-[#F2F3F5] shadow-2xl dark:bg-[#232427]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题左对齐 + 右侧关闭按钮 */}
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <p className="text-[16px] font-semibold" data-testid={t('title')}>
            添加表情
          </p>
          <button
            type="button"
            aria-label="关闭"
            data-testid={t('close')}
            onClick={onCancel}
            className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.06] text-black/45 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/45"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        {items.length > 0 && (
          <p className="px-5 pt-0.5 text-[12px] text-black/40 dark:text-white/40">已选 {items.length} 张，点名称可修改</p>
        )}

        {/* 批量链接导入 */}
        <p className="mt-4 px-5 text-[13px] text-black/45 dark:text-white/45">从链接导入</p>
        <div className="px-5">
          <textarea
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={'每行一个图片链接，名称可省略\n示例：可爱 https://example.com/cat.gif'}
            rows={3}
            data-testid={t('urls')}
            className="mt-2 w-full resize-none rounded-[12px] border border-black/[0.06] bg-white p-3 text-[13px] leading-6 outline-none placeholder:text-black/30 dark:border-white/[0.08] dark:bg-white/[0.06] dark:placeholder:text-white/30"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="pr-3 text-[12px] leading-5 text-black/40 dark:text-white/40">支持「名称: 链接」，名称自动从链接识别</p>
            <button
              type="button"
              data-testid={t('parse')}
              onClick={parseUrls}
              className="h-9 shrink-0 rounded-full px-4 text-[13px] font-medium text-white active:opacity-85"
              style={{ backgroundColor: accent }}
            >
              解析链接
            </button>
          </div>
        </div>

        {/* 待添加列表：白卡片式 */}
        {items.length > 0 && (
          <div className="mt-3 max-h-[240px] space-y-2 overflow-y-auto px-5">
            {items.map((it, i) => (
              <div
                key={it.key}
                className="flex items-center gap-3 rounded-[14px] bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:bg-white/[0.07]"
                data-testid={`${t('item')}-${i}`}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#F2F3F5] dark:bg-white/[0.08]">
                  <img src={it.preview} alt={it.name || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </span>
                <span className="min-w-0 flex-1">
                  <input
                    value={it.name}
                    onChange={(e) => onItemsChange(items.map((x) => (x.key === it.key ? { ...x, name: e.target.value } : x)))}
                    maxLength={20}
                    placeholder="名称（表情意思）"
                    data-testid={`${t('name')}-${i}`}
                    className="h-9 w-full rounded-[8px] bg-black/[0.04] px-2.5 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/[0.08] dark:placeholder:text-white/30"
                  />
                  <span className="mt-0.5 block text-[11px] text-black/35 dark:text-white/35">
                    {it.source === 'file' ? '来自手机' : '来自链接'}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="移除"
                  data-testid={`${t('del')}-${i}`}
                  onClick={() => onItemsChange(items.filter((x) => x.key !== it.key))}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#FA5151] active:bg-[#FA5151]/10"
                >
                  <Trash2 className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 底部操作：描边取消 + 品牌色确认 */}
        <div className="mt-4 flex items-center justify-between px-5 pb-5">
          <button
            type="button"
            data-testid={t('cancel')}
            onClick={onCancel}
            className="h-11 rounded-full border border-black/10 bg-white px-6 text-[15px] text-black/55 active:bg-black/[0.04] dark:border-white/15 dark:bg-white/[0.06] dark:text-white/55"
          >
            取消
          </button>
          <button
            type="button"
            data-testid={t('confirm')}
            onClick={() => onConfirm(items)}
            disabled={items.length === 0}
            className="h-11 rounded-full px-6 text-[15px] font-medium text-white active:opacity-85 disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            确认添加 ({items.length})
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 表情分组栏（微信 / QQ 共用，聊天面板与表情管理页都用）：
 * 顶部一排「毛玻璃胶囊」——每个胶囊里是一个分组名字，点选切换下方表情网格；
 * 末尾「＋」胶囊 → 原地展开新建分组输入（名字 + 新建/取消），建好自动选中并展示该组（空）表情。
 * 毛玻璃胶囊样式：半透明白底 + backdrop-blur + 细描边，选中态更实（更亮底 + 投影 + 加粗）。
 */
export function StickerGroupBar({
  testPrefix,
  groups,
  activeId,
  onSelect,
  onCreate,
  onManage,
}: {
  testPrefix: string;
  groups: StickerGroup[];
  /** 当前选中分组（默认分组在最前） */
  activeId: string;
  onSelect: (id: string) => void;
  /** 新建分组（父级负责持久化 + toast + 选中） */
  onCreate: (name: string) => void;
  /** 可选「管理分组」入口（表情管理页传入；聊天面板不传保持轻量） */
  onManage?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const t = (k: string) => `${testPrefix}-sticker-group-${k}`;
  const accent = testPrefix === 'wx' ? '#07C160' : '#0099FF';

  const confirmCreate = () => {
    const v = name.trim();
    if (!v) return;
    onCreate(v);
    setName('');
    setCreating(false);
  };

  return (
    <div className="px-3 pb-1.5 pt-0.5" data-testid={t('bar')}>
      {creating ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmCreate();
              if (e.key === 'Escape') {
                setCreating(false);
                setName('');
              }
            }}
            maxLength={16}
            placeholder="新分组名字（如：沙雕、猫咪）"
            data-testid={t('new-input')}
            className="h-8 min-w-0 flex-1 rounded-full border border-black/[0.08] bg-white/70 px-3.5 text-[13px] outline-none backdrop-blur-md placeholder:text-black/30 dark:border-white/15 dark:bg-white/10 dark:placeholder:text-white/30"
          />
          <button
            type="button"
            data-testid={t('new-ok')}
            onClick={confirmCreate}
            className="h-8 shrink-0 rounded-full px-4 text-[12.5px] font-medium text-white active:opacity-85"
            style={{ backgroundColor: accent }}
          >
            新建
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setName('');
            }}
            className="h-8 shrink-0 rounded-full bg-black/[0.05] px-3 text-[12.5px] text-black/55 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/55"
          >
            取消
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {orderedGroups(groups).map((g) => {
            const on = g.id === activeId;
            const builtin = g.id === BUILTIN_STICKER_GROUP_ID;
            return (
              <button
                key={g.id}
                type="button"
                aria-label={builtin ? `${g.name}分组` : undefined}
                title={builtin ? g.name : undefined}
                data-testid={`${t('pill')}-${g.id === DEFAULT_STICKER_GROUP_ID ? 'my' : g.id}`}
                onClick={() => onSelect(g.id)}
                className={`h-7 shrink-0 whitespace-nowrap rounded-full border backdrop-blur-md transition-colors active:opacity-80 ${
                  builtin ? 'flex w-9 items-center justify-center px-0' : 'px-3 text-[12.5px]'
                } ${
                  on
                    ? 'border-black/10 bg-white/85 font-medium text-black shadow-[0_1px_5px_rgba(0,0,0,0.08)] dark:border-white/25 dark:bg-white/30 dark:text-white'
                    : 'border-black/[0.07] bg-white/45 text-black/50 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/50'
                }`}
              >
                {builtin ? (
                  /* 内置分组：官方面板首位笑脸图标代替「微信表情/QQ表情」文字标签（真机同款），永远排在分组栏最前 */
                  <img src={builtinTabIconUrl(testPrefix === 'wx' ? 'wx' : 'qq')} alt={g.name} className="h-[19px] w-[19px] object-contain" draggable={false} />
                ) : (
                  g.name
                )}
              </button>
            );
          })}
          <button
            type="button"
            data-testid={t('add')}
            aria-label="新建分组"
            onClick={() => setCreating(true)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-black/20 text-[15px] leading-none text-black/40 backdrop-blur-md active:bg-white/60 dark:border-white/20 dark:text-white/40 dark:active:bg-white/10"
          >
            ＋
          </button>
          {onManage && (
            <button
              type="button"
              data-testid={t('manage')}
              onClick={onManage}
              className="h-7 shrink-0 whitespace-nowrap rounded-full border border-black/[0.07] bg-white/45 px-3 text-[12.5px] text-black/50 backdrop-blur-md active:bg-white/70 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/50"
            >
              管理分组
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 分组管理弹层（微信 / QQ 表情管理页共用）：
 * 列出全部分组（默认分组带「默认」徽标、不可改名/删除）——
 * 自定义分组支持 原地重命名 / 删除（删除时该组表情由父级移回默认分组，不丢数据），
 * 底部「＋ 新建分组」输入行。
 */
export function StickerGroupManageSheet({
  testPrefix,
  groups,
  stickers,
  onRename,
  onDelete,
  onCreate,
  onClose,
}: {
  testPrefix: string;
  groups: StickerGroup[];
  stickers: Sticker[];
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [newName, setNewName] = useState('');
  const t = (k: string) => `${testPrefix}-sticker-group-mg-${k}`;
  const accent = testPrefix === 'wx' ? '#07C160' : '#0099FF';

  const countOf = (id: string) => stickers.filter((s) => (s.groupId ?? DEFAULT_STICKER_GROUP_ID) === id).length;

  const confirmRename = () => {
    if (!renamingId) return;
    const v = renameDraft.trim();
    if (v) onRename(renamingId, v);
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 px-6" data-testid={t('sheet')} onClick={onClose}>
      <div
        className="max-h-[80%] w-full overflow-y-auto rounded-[18px] bg-[#F2F3F5] p-4 shadow-2xl dark:bg-[#232427]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">管理分组</p>
          <button
            type="button"
            aria-label="关闭"
            data-testid={t('close')}
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.06] text-black/45 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/45"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">删除分组不会删除表情，组内表情会移回「我的表情」。</p>

        <div className="mt-3 space-y-2">
          {groups.map((g) => {
            const isDef = g.id === DEFAULT_STICKER_GROUP_ID;
            const isBuiltin = !!g.builtin;
            return (
              <div
                key={g.id}
                className="flex items-center gap-2 rounded-[14px] bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:bg-white/[0.07]"
                data-testid={`${t('row')}-${isDef ? 'my' : g.id}`}
              >
                {renamingId === g.id ? (
                  <>
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      maxLength={16}
                      data-testid={t('rename-input')}
                      className="h-9 min-w-0 flex-1 rounded-[8px] bg-black/[0.04] px-2.5 text-[14px] outline-none dark:bg-white/[0.08]"
                    />
                    <button
                      type="button"
                      data-testid={t('rename-ok')}
                      onClick={confirmRename}
                      className="h-9 shrink-0 rounded-full px-4 text-[13px] font-medium text-white active:opacity-85"
                      style={{ backgroundColor: accent }}
                    >
                      保存
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      {g.name}
                      {isDef && (
                        <span className="ml-1.5 inline-block translate-y-[-1px] rounded-full bg-black/[0.05] px-1.5 py-0.5 align-middle text-[10px] leading-none text-black/40 dark:bg-white/10 dark:text-white/40">
                          默认
                        </span>
                      )}
                      {isBuiltin && (
                        <span className="ml-1.5 inline-block translate-y-[-1px] rounded-full bg-black/[0.05] px-1.5 py-0.5 align-middle text-[10px] leading-none text-black/40 dark:bg-white/10 dark:text-white/40">
                          内置
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[12px] text-black/35 dark:text-white/35">{countOf(g.id)} 张</span>
                    {!isDef && !isBuiltin && (
                      <>
                        <button
                          type="button"
                          data-testid={`${t('rename')}-${g.id}`}
                          onClick={() => {
                            setRenamingId(g.id);
                            setRenameDraft(g.name);
                          }}
                          className="h-8 shrink-0 rounded-full bg-black/[0.05] px-3 text-[12.5px] text-black/55 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/55"
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          data-testid={`${t('del')}-${g.id}`}
                          onClick={() => onDelete(g.id)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#FA5151] active:bg-[#FA5151]/10"
                          aria-label={`删除分组 ${g.name}`}
                        >
                          <Trash2 className="h-[17px] w-[17px]" strokeWidth={2} />
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* 新建分组 */}
        <div className="mt-3 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = newName.trim();
                if (v) {
                  onCreate(v);
                  setNewName('');
                }
              }
            }}
            maxLength={16}
            placeholder="新分组名字"
            data-testid={t('new-input')}
            className="h-10 min-w-0 flex-1 rounded-[10px] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/[0.08] dark:placeholder:text-white/30"
          />
          <button
            type="button"
            data-testid={t('new-ok')}
            onClick={() => {
              const v = newName.trim();
              if (v) {
                onCreate(v);
                setNewName('');
              }
            }}
            className="h-10 shrink-0 rounded-full px-5 text-[13.5px] font-medium text-white active:opacity-85"
            style={{ backgroundColor: accent }}
          >
            新建分组
          </button>
        </div>
      </div>
    </div>
  );
}

/** 由分组栏「＋」/ 管理弹层「新建分组」共用：生成新分组对象（父级 append 后持久化） */
export function makeStickerGroup(name: string): StickerGroup {
  return { id: newStickerGroupId(), name: name.trim().slice(0, 16), createdAt: Date.now() };
}
