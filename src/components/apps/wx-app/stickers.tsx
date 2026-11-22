'use client';

/** 表情（消息气泡/面板/管理页） —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronLeft } from 'lucide-react';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import {
  DEFAULT_STICKER_GROUP_ID,
  extractMeaningFromUrl,
  fileNameMeaning,
  isBuiltinGroupId,
  isImageUrl,
  isOfficialEmojiSticker,
  loadStickerGroups,
  loadStickers,
  newStickerId,
  saveStickerGroups,
  saveStickers,
  stickerGroupOf,
} from '@/lib/ios/stickers';
import { BUILTIN_STICKER_GROUP_ID } from '@/lib/ios/builtin-stickers';
import type { Sticker, StickerGroup } from '@/lib/ios/stickers';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）
import { BatchStickerSheet, makeStickerGroup, StickerGroupBar, StickerGroupManageSheet, StickerMeaningPicker } from '@/components/apps/sticker-batch';
import { StickerSearchSheet } from '../sticker-search-sheet';
import type { BatchDraftItem } from '@/components/apps/sticker-batch';

import { readImageFile } from './core';

/** 表情消息气泡（点开全屏预览 + 意思提示；群聊复用同一套组件）。
 *  builtinWx：微信内置经典表情（/wechat-emojis/ 资源）——真微信同款：表情包在颜色气泡里（我方绿/对方白），
 *  尺寸与文字行高接近；用户收藏的大表情包保持原全宽无气泡样式 */
export function StickerMsgBubble({
  src,
  meaning,
  onClick,
  me,
}: {
  src: string;
  meaning: string;
  onClick: () => void;
  /** 消息角色：内置表情气泡配色（true=绿 #95EC69 / false=白） */
  me?: boolean;
}) {
  const builtin = src.startsWith('/wechat-emojis/');
  if (builtin) {
    return (
      <button
        type="button"
        data-testid="wx-sticker-bubble"
        onClick={onClick}
        className={
          'flex items-center justify-center rounded-[8px] px-2 py-1.5 active:opacity-80 ' +
          (me === false ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] dark:bg-[#1E1E1E]' : 'bg-[#95EC69] dark:bg-[#3EB575]')
        }
        title={meaning || '表情'}
      >
        <img
          src={src}
          alt={meaning ? `表情：${meaning}` : '表情'}
          className="h-[52px] w-[52px] object-contain"
          loading="lazy"
        />
      </button>
    );
  }
  return (
    <button type="button" data-testid="wx-sticker-bubble" onClick={onClick} className="block active:opacity-80" title={meaning || '表情'}>
      <img
        src={src}
        alt={meaning ? `表情：${meaning}` : '表情'}
        className="max-h-[110px] w-auto max-w-[118px] rounded-[10px] object-contain"
        loading="lazy"
      />
    </button>
  );
}

/** 表情添加表单（面板与管理页共用渲染逻辑抽出的内部组件） */
export function StickerAddForm({
  tab,
  onTab,
  preview,
  url,
  meaning,
  onUrl,
  onMeaning,
  onPickFile,
  onSave,
  onCancel,
  saveLabel = '保存',
}: {
  tab: 'file' | 'url';
  onTab: (t: 'file' | 'url') => void;
  preview: string | null;
  url: string;
  meaning: string;
  onUrl: (v: string) => void;
  onMeaning: (v: string) => void;
  onPickFile: (files: FileList | null) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex gap-2">
        {(
          [
            ['file', '手机图片'],
            ['url', '图片 URL'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onTab(k)}
            className={`h-8 rounded-full px-4 text-[13px] ${tab === k ? 'bg-[#07C160] text-white' : 'bg-black/[0.05] text-black/60 dark:bg-white/10 dark:text-white/60'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'file' ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-3 flex h-[96px] w-full items-center justify-center overflow-hidden rounded-[10px] border border-dashed border-black/20 bg-white text-[13px] text-black/40 active:bg-black/[0.03] dark:border-white/20 dark:bg-[#1A1A1A] dark:text-white/40"
        >
          {preview ? (
            <img src={preview} alt="表情预览" className="h-full w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <span className="text-[26px] leading-none">＋</span>
              从手机选择表情图片
            </span>
          )}
        </button>
      ) : (
        <input
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="粘贴表情图片 URL（含中文可自动识别意思）"
          className="mt-3 h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
        />
      )}
      <input
        value={meaning}
        onChange={(e) => onMeaning(e.target.value)}
        placeholder="表情的意思（AI 会据此理解并回复）"
        maxLength={20}
        className="mt-2 h-[44px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-[8px] bg-black/[0.05] px-5 text-[15px] text-black/60 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/60"
        >
          取消
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPickFile(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/** 聊天表情面板（表情按钮弹出：网格点选 + 内嵌添加[手机图片/URL+意思] + 管理删除）。
 *  内置表情（微信表情分组）点选不直接发送：走 onPickBuiltin 把 [微笑] 文字代码插入输入框，可与文字混排一起发
 *  （对照真实微信交互，用户截图参考）；用户收藏的大表情贴纸仍点选直发（onPick） */
export function WxStickerPanel({
  onPick,
  onPickBuiltin,
  onClose,
  onToast,
  liquid = false,
}: {
  onPick: (s: Sticker) => void;
  /** 内置表情点选回调（插入输入框；面板保持展开可连续点选） */
  onPickBuiltin?: (s: Sticker) => void;
  onClose: () => void;
  onToast: (m: string) => void;
  /** 液态玻璃主题（单聊传入；群聊等调用点不传保持默认白底面板） */
  liquid?: boolean;
}) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('wx'));
  const [groups, setGroups] = useState<StickerGroup[]>(() => loadStickerGroups('wx'));
  const [activeGroupId, setActiveGroupId] = useState<string>(DEFAULT_STICKER_GROUP_ID);
  const [mode, setMode] = useState<'grid' | 'add'>('grid');
  /** 网上表情搜索面板（Task 28 替换式：打开时替换面板本体，占面板原位同高，关闭恢复） */
  const [searchOpen, setSearchOpen] = useState(false);
  /** 面板容器 ref + 打开搜索瞬间实测的面板高度（offsetHeight 即壳本地 px，transform 不影响它） */
  const panelRef = useRef<HTMLDivElement>(null);
  const [searchH, setSearchH] = useState(0);
  const openSearch = () => {
    const h = panelRef.current?.offsetHeight ?? 0;
    if (h > 100) setSearchH(h);
    setSearchOpen(true);
  };
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [editMode, setEditMode] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftMeaning, setDraftMeaning] = useState('');

  const commit = (next: Sticker[]) => {
    setList(next);
    saveStickers('wx', next);
  };
  // Task 32：聊天页长按表情「添加到表情」后面板同步刷新（面板开着也能立即看到新表情）
  useEffect(() => {
    const syncStickers = () => {
      setList(loadStickers('wx'));
      setGroups(loadStickerGroups('wx'));
    };
    window.addEventListener('wx-stickers-changed', syncStickers);
    return () => window.removeEventListener('wx-stickers-changed', syncStickers);
  }, []);
  /** 当前分组下的表情（groupId 缺失/指向已删分组 → 归默认分组，防孤儿不可见） */
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const visible = useMemo(() => list.filter((s) => stickerGroupOf(s, groupIds) === activeGroupId), [list, groupIds, activeGroupId]);
  /** 新建分组（分组栏「＋」胶囊）：持久化 + 自动选中新分组（新组为空，接着点「添加」即归入该组） */
  const createGroup = (name: string) => {
    const g = makeStickerGroup(name);
    const next = [...groups, g];
    setGroups(next);
    saveStickerGroups('wx', next);
    setActiveGroupId(g.id);
    onToast(`已新建分组「${g.name}」`);
  };
  const pickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      setPreview(await readImageFile(f, 240));
      setDraftMeaning(fileNameMeaning(f.name));
    } catch {
      onToast('图片读取失败');
    }
  };
  const save = () => {
    const url = tab === 'file' ? preview : draftUrl.trim();
    if (!url || !isImageUrl(url)) {
      onToast(tab === 'file' ? '请先选择图片' : '请输入正确的图片 URL');
      return;
    }
    const meaning = draftMeaning.trim();
    commit([{ id: newStickerId(), url, meaning, groupId: activeGroupId, createdAt: Date.now() }, ...list]);
    onToast(meaning ? `已添加表情（${meaning}）` : '已添加表情');
    setPreview(null);
    setDraftUrl('');
    setDraftMeaning('');
    setMode('grid');
  };

  /** 点表情下方的意思标签 → 弹出意思选择 UI（预设胶囊 + 自定义 + 可不设置） */
  const [meaningFor, setMeaningFor] = useState<Sticker | null>(null);

  /** 长按表情 → 预览卡（真微信同款：大图 + 名称 + 删除/取消），无需进管理模式即可删除 */
  const [pressSticker, setPressSticker] = useState<Sticker | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const suppressPickRef = useRef(false);
  const clearStickerPress = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  useEffect(() => () => clearStickerPress(), []);
  const onStickerPointerDown = (s: Sticker) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearStickerPress();
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      setPressSticker(s);
      suppressPickRef.current = true;
    }, 480);
  };
  const onStickerPointerMove = (e: React.PointerEvent) => {
    if (!pressTimerRef.current) return;
    const t = e.currentTarget as HTMLElement;
    const r = t.getBoundingClientRect();
    if (e.clientX < r.left - 12 || e.clientX > r.right + 12 || e.clientY < r.top - 12 || e.clientY > r.bottom + 12) clearStickerPress();
  };
  const closeStickerPreview = () => {
    setPressSticker(null);
    suppressPickRef.current = false;
  };

  return (
    <div
      ref={panelRef}
      className={
        liquid
          ? /* 液态玻璃（用户指定）：去实底与上边框，乳白强模糊玻璃面板 */
            'lg-sheet relative shrink-0 mx-2.5 mb-2.5 rounded-[24px]'
          : 'relative shrink-0 border-t border-black/[0.05] bg-[#F7F7F7] dark:border-white/[0.06] dark:bg-[#161616]'
      }
      style={searchOpen ? { height: searchH > 0 ? searchH : 380 } : undefined}
      data-testid="wx-sticker-panel"
    >
      {searchOpen ? (
        /* 网上表情搜索面板（替换式）：整体替换面板本体占面板原位，关闭/选中后恢复原面板 */
        <StickerSearchSheet
          app="wx"
          onClose={() => setSearchOpen(false)}
          onSend={onPick}
          onAdd={(s) => commit([s, ...list])}
          isSaved={(url) => list.some((x) => x.url === url)}
          onToast={onToast}
        />
      ) : (
        <>
      <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
        <p className="text-[15px] font-medium">表情</p>
        <div className="flex items-center gap-4">
          {mode === 'grid' && (
            <button
              type="button"
              aria-label="搜索表情"
              data-testid="wx-sticker-panel-search"
              onClick={openSearch}
              className="text-black/45 active:opacity-60 dark:text-white/45"
            >
              <Search className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          )}
          {mode === 'grid' && !isBuiltinGroupId(activeGroupId) && list.some((s) => !s.builtin) && (
            <button
              type="button"
              data-testid="wx-sticker-panel-manage"
              onClick={() => setEditMode((v) => !v)}
              className="text-[13px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              {editMode ? '完成' : '管理'}
            </button>
          )}
          <button type="button" aria-label="收起表情面板" onClick={onClose} className="text-black/40 active:opacity-60 dark:text-white/40">
            <ChevronLeft className="h-5 w-5 -rotate-90" strokeWidth={2} />
          </button>
        </div>
      </div>
      {/* 分组栏：毛玻璃胶囊分组名字（点选切换下方网格）+「＋」新建分组 */}
      <StickerGroupBar testPrefix="wx" groups={groups} activeId={activeGroupId} onSelect={setActiveGroupId} onCreate={createGroup} />
      {mode === 'grid' ? (
        <div className="h-[280px] overflow-y-auto px-3 pb-4 pt-1">
          {/* 内置表情=真机同款小表情（8列小尺寸）；用户收藏贴纸=大瓦片（4列） */}
          <div className={`grid ${activeGroupId === 'builtin' ? 'grid-cols-8 gap-1' : 'grid-cols-4 gap-2'}`}>
            {visible.map((s, i) => (
              <div key={s.id} className="relative">
                <button
                  type="button"
                  data-testid={`wx-sticker-panel-item-${i}`}
                  onClick={() => {
                    if (suppressPickRef.current) {
                      suppressPickRef.current = false;
                      return;
                    }
                    if (editMode) return;
                    // v62：官方小表情插入 [代码] 混排；内置包大贴纸与用户表情一样点选直接发送
                    if (isOfficialEmojiSticker(s)) onPickBuiltin?.(s);
                    else onPick(s);
                  }}
                  onPointerDown={onStickerPointerDown(s)}
                  onPointerMove={onStickerPointerMove}
                  onPointerUp={clearStickerPress}
                  onPointerCancel={clearStickerPress}
                  onPointerLeave={clearStickerPress}
                  className={
                    s.builtin && s.groupId === BUILTIN_STICKER_GROUP_ID
                      ? `flex h-10 w-full items-center justify-center overflow-hidden rounded-[8px] p-[3px] active:bg-black/[0.05]`
                      : `aspect-square w-full overflow-hidden rounded-[10px] active:bg-black/[0.05] p-1.5`
                  }
                  title={s.meaning || '表情'}
                >
                  <img src={s.url} alt={s.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </button>
                {/* v62：用户表情=可点改意思的按钮；内置包贴纸=纯文本标签（常量不可改）；官方小表情不显 */}
                {!s.builtin && (
                  <button
                    type="button"
                    data-testid={`wx-sticker-meaning-${i}`}
                    onClick={() => setMeaningFor(s)}
                    className="mt-0.5 block h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 active:opacity-60 dark:text-white/40"
                  >
                    {s.meaning || '＋意思'}
                  </button>
                )}
                {s.builtin && s.groupId !== BUILTIN_STICKER_GROUP_ID && (
                  <p className="mt-0.5 h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 dark:text-white/40">{s.meaning}</p>
                )}
                {editMode && !s.builtin && (
                  <button
                    type="button"
                    aria-label="删除表情"
                    data-testid={`wx-sticker-panel-del-${i}`}
                    onClick={() => commit(list.filter((x) => x.id !== s.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#FA5151] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {/* 内置分组（官方小表情 + v62 内置表情包）不可添加（静态常量）；空占位与各自网格尺寸对齐 */}
            {isBuiltinGroupId(activeGroupId) ? (
              <span aria-hidden="true" className={activeGroupId === 'builtin' ? 'h-10 w-full' : 'aspect-square w-full'} />
            ) : (
              <button
                type="button"
                data-testid="wx-sticker-panel-add"
                onClick={() => setMode('add')}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-black/20 text-black/35 active:bg-black/[0.04] dark:border-white/20 dark:text-white/35"
              >
                <span className="text-[24px] leading-none">＋</span>
                <span className="text-[11px]">添加</span>
              </button>
            )}
            <span aria-hidden="true" className="mt-0.5 h-4" />
          </div>
          {visible.length === 0 && (
            <p className="pb-2 pt-3 text-center text-[13px] text-black/35 dark:text-white/35">
              {list.length === 0 ? '还没有表情，点「＋」添加一张' : '该分组还没有表情，点「＋」添加一张'}
            </p>
          )}
        </div>
      ) : (
        <div className="px-4 pb-4 pt-1">
          <StickerAddForm
            tab={tab}
            onTab={setTab}
            preview={preview}
            url={draftUrl}
            meaning={draftMeaning}
            onUrl={(v) => {
              setDraftUrl(v);
              const m = extractMeaningFromUrl(v);
              if (m) setDraftMeaning(m);
            }}
            onMeaning={setDraftMeaning}
            onPickFile={(files) => void pickFile(files)}
            onSave={save}
            onCancel={() => setMode('grid')}
          />
        </div>
      )}

      {/* 意思选择 UI（预设胶囊 + 自定义 + 不设置） */}
      {meaningFor && (
        <StickerMeaningPicker
          testPrefix="wx"
          url={meaningFor.url}
          value={meaningFor.meaning}
          onConfirm={(v) => {
            commit(list.map((x) => (x.id === meaningFor.id ? { ...x, meaning: v } : x)));
            onToast(v ? `意思已设为「${v}」` : '已清除意思');
            setMeaningFor(null);
          }}
          onClose={() => setMeaningFor(null)}
        />
      )}

      {/* 长按表情预览卡（真微信同款：白卡大图 + 名称 + 红色删除；点遮罩取消） */}
      {pressSticker && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/45"
          data-testid="wx-sticker-preview"
          onClick={closeStickerPreview}
        >
          <div
            className="w-[220px] overflow-hidden rounded-[16px] bg-white shadow-2xl dark:bg-[#2A2A2E]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-[150px] items-center justify-center p-3">
              <img src={pressSticker.url} alt={pressSticker.meaning || '表情'} className="max-h-full max-w-full object-contain" />
            </div>
            <p className="pb-2.5 text-center text-[13px] text-black/45 dark:text-white/45">{pressSticker.meaning || '未命名表情'}</p>
            {pressSticker.builtin ? (
              <p className="pb-2.5 text-center text-[11px] text-black/30 dark:text-white/30">内置表情 · 不可删除</p>
            ) : (
              <button
                type="button"
                data-testid="wx-sticker-preview-del"
                onClick={() => {
                  commit(list.filter((x) => x.id !== pressSticker.id));
                  closeStickerPreview();
                  onToast('已删除表情');
                }}
                className="flex h-12 w-full items-center justify-center border-t border-black/[0.06] text-[15px] text-[#FA5151] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
              >
                删除
              </button>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

/** 表情管理页（「我」→表情：网格管理 + 单张编辑[改意思/删除] + 批量导入手机图片 + URL 添加自动识别意思） */
export function WxStickersPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('wx'));
  const [groups, setGroups] = useState<StickerGroup[]>(() => loadStickerGroups('wx'));
  const [activeGroupId, setActiveGroupId] = useState<string>(DEFAULT_STICKER_GROUP_ID);
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  /** 编辑弹层里的所属分组（保存时随意思一起写入） */
  const [editGroupId, setEditGroupId] = useState<string>(DEFAULT_STICKER_GROUP_ID);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchDraftItem[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);

  const commit = (next: Sticker[]) => {
    setList(next);
    saveStickers('wx', next);
  };
  /** 当前分组下的表情（groupId 缺失/指向已删分组 → 归默认分组，防孤儿不可见） */
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const visible = useMemo(() => list.filter((s) => stickerGroupOf(s, groupIds) === activeGroupId), [list, groupIds, activeGroupId]);
  const applyGroups = (next: StickerGroup[]) => {
    setGroups(next);
    saveStickerGroups('wx', next);
  };
  const createGroup = (name: string) => {
    const g = makeStickerGroup(name);
    applyGroups([...groups, g]);
    onToast(`已新建分组「${g.name}」`);
  };

  /** FileList → 批量草稿项（压缩预览 + 默认名：文件名中文优先，否则文件名去扩展名） */
  const filesToDrafts = async (files: FileList): Promise<BatchDraftItem[]> => {
    const drafts: BatchDraftItem[] = [];
    for (const f of Array.from(files)) {
      try {
        const url = await readImageFile(f, 240);
        if (!url) continue;
        const stem = f.name.replace(/\.[a-z0-9]+$/i, '');
        const cn = fileNameMeaning(f.name);
        drafts.push({ key: newStickerId(), preview: url, name: cn || stem, fallbackName: stem, source: 'file' });
      } catch {
        // 单张失败跳过
      }
    }
    return drafts;
  };

  /** 批量导入：选完先进入预览确认弹窗（可改名/删除/继续选择），点「全部添加」才入库 */
  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const drafts = await filesToDrafts(files);
    if (drafts.length === 0) {
      onToast('没有可导入的图片');
      return;
    }
    setBatchItems(drafts);
    setBatchOpen(true);
  };

  /** 确认批量添加：草稿项转正式表情入库（插到最前，归入当前选中分组） */
  const confirmBatch = (items: BatchDraftItem[]) => {
    const added: Sticker[] = items.map((it) => ({ id: newStickerId(), url: it.preview, meaning: it.name.trim(), groupId: activeGroupId, createdAt: Date.now() }));
    commit([...added, ...list]);
    setBatchOpen(false);
    setBatchItems([]);
    onToast(`已添加 ${added.length} 张表情`);
  };

  const saveEdit = () => {
    if (!editing) return;
    commit(list.map((s) => (s.id === editing.id ? { ...s, meaning: editMeaning.trim(), groupId: editGroupId || DEFAULT_STICKER_GROUP_ID } : s)));
    setEditing(null);
    onToast('已保存');
  };

  /** 右上角「管理」：进入删除模式，点表情上的红色 × 直接删除（再点完成退出） */
  const [delMode, setDelMode] = useState(false);
  const delSticker = (s: Sticker) => {
    commit(list.filter((x) => x.id !== s.id));
    onToast('已删除表情');
    if (list.length <= 1) setDelMode(false);
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-stickers-page">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-stickers-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">表情</div>
          {list.length > 0 ? (
            <button
              type="button"
              data-testid="wx-stickers-manage"
              onClick={() => setDelMode((v) => !v)}
              className="w-[46px] text-center text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              {delMode ? '完成' : '管理'}
            </button>
          ) : (
            <span className="w-[46px]" />
          )}
        </div>
      </div>
      {/* 分组栏：毛玻璃胶囊分组名字（点选切换下方网格）+「＋」新建 +「管理分组」弹层入口 */}
      <StickerGroupBar
        testPrefix="wx"
        groups={groups}
        activeId={activeGroupId}
        onSelect={setActiveGroupId}
        onCreate={createGroup}
        onManage={() => setGroupManageOpen(true)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
        {list.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-black/35 dark:text-white/35">
            还没有表情包
            <br />
            从下方添加，或批量导入手机图片
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-black/35 dark:text-white/35">
            该分组还没有表情
            <br />
            从下方添加，或切换到其他分组
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {visible.map((s, i) => (
              <button
                key={s.id}
                type="button"
                data-testid={`wx-stickers-item-${i}`}
                onClick={() => {
                  if (s.builtin) return; // 内置表情不可编辑/删除
                  if (delMode) {
                    delSticker(s);
                    return;
                  }
                  setEditing(s);
                  setEditMeaning(s.meaning);
                  setEditGroupId(s.groupId ?? DEFAULT_STICKER_GROUP_ID);
                }}
                className="relative rounded-[12px] p-1 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <span className="flex aspect-square items-center justify-center overflow-hidden rounded-[8px]">
                  <img src={s.url} alt={s.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </span>
                <span className="mt-1.5 block truncate text-[12px] text-black/55 dark:text-white/55">{s.meaning || '点此写意思'}</span>
                {delMode && !s.builtin && (
                  <span
                    aria-hidden="true"
                    data-testid={`wx-stickers-del-${i}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#FA5151] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 dark:border-white/[0.06] dark:bg-[#1A1A1A]">
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="wx-stickers-upload"
            onClick={() => uploadRef.current?.click()}
            className="h-11 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
          >
            从手机添加（可批量）
          </button>
          <button
            type="button"
            data-testid="wx-stickers-add-url"
            onClick={() => setBatchOpen(true)}
            className="h-11 rounded-[8px] bg-black/[0.06] px-5 text-[15px] text-black/70 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/70"
          >
            添加 URL
          </button>
        </div>
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void importFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 单张编辑弹层（改意思 / 删除） */}
      {editing && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setEditing(null)} data-testid="wx-stickers-edit">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-4 pb-8 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-[110px] w-[110px] items-center justify-center overflow-hidden rounded-[12px] bg-white p-2 dark:bg-[#1A1A1A]">
              <img src={editing.url} alt={editing.meaning || '表情'} className="h-full w-full object-contain" />
            </div>
            <input
              value={editMeaning}
              onChange={(e) => setEditMeaning(e.target.value)}
              maxLength={20}
              placeholder="表情的意思（AI 会据此理解并回复）"
              data-testid="wx-stickers-edit-meaning"
              className="h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[15px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
            />
            {/* 所属分组：胶囊点选，保存时生效 */}
            <p className="pb-1.5 pt-2.5 text-[12px] text-black/40 dark:text-white/40">所属分组</p>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const on = (editGroupId || DEFAULT_STICKER_GROUP_ID) === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`wx-stickers-edit-group-${g.id === DEFAULT_STICKER_GROUP_ID ? 'my' : g.id}`}
                    onClick={() => setEditGroupId(g.id)}
                    className={`h-7 rounded-full border px-3 text-[12.5px] ${
                      on
                        ? 'border-[#07C160]/40 bg-[#07C160]/10 font-medium text-[#07C160]'
                        : 'border-black/[0.07] bg-white/60 text-black/50 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/50'
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="wx-stickers-edit-del"
                onClick={() => {
                  commit(list.filter((x) => x.id !== editing.id));
                  setEditing(null);
                  onToast('已删除');
                }}
                className="h-11 rounded-[8px] bg-[#FA5151]/10 px-5 text-[15px] text-[#FA5151] active:bg-[#FA5151]/20 dark:bg-[#FA5151]/20"
              >
                删除
              </button>
              <button
                type="button"
                data-testid="wx-stickers-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量添加确认弹窗（预览 + 改名 + 删除 + 从链接导入 + 确认添加 N）；「添加 URL」也走同一弹窗（批量 URL 逐行解析） */}
      <BatchStickerSheet
        open={batchOpen}
        items={batchItems}
        onItemsChange={setBatchItems}
        onCancel={() => {
          setBatchOpen(false);
          setBatchItems([]);
        }}
        onConfirm={confirmBatch}
        onToast={onToast}
        testPrefix="wx"
      />

      {/* 分组管理弹层：重命名/删除自定义分组（组内表情移回默认组），底部新建分组 */}
      {groupManageOpen && (
        <StickerGroupManageSheet
          testPrefix="wx"
          groups={groups}
          stickers={list}
          onRename={(id, name) => {
            applyGroups(groups.map((g) => (g.id === id ? { ...g, name } : g)));
            onToast('分组已重命名');
          }}
          onDelete={(id) => {
            applyGroups(groups.filter((g) => g.id !== id));
            commit(list.map((s) => (stickerGroupOf(s, groupIds) === id ? { ...s, groupId: DEFAULT_STICKER_GROUP_ID } : s)));
            if (activeGroupId === id) setActiveGroupId(DEFAULT_STICKER_GROUP_ID);
            onToast('分组已删除，表情移回「我的表情」');
          }}
          onCreate={createGroup}
          onClose={() => setGroupManageOpen(false)}
        />
      )}
    </div>
  );
}
