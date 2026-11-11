'use client';

/** 表情（面板/气泡/加号宫格/快捷表情/文字卡片/表情管理页） —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronLeft, Gift, Headphones, Loader2, MapPin, Phone, Package, Search, Sparkles, Video, X } from 'lucide-react';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
// 第十六轮：AI 动态状态（情绪+作息）注入
import { // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
import { RtPlusVoice, RtPlusVideo, RtPlusRedPacket, RtPlusTransfer, RtPlusLocation, RtPlusTextCard, RtPlusTogether, RtPlusExpress } from '../retro-icons';
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
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
import { BatchStickerSheet, makeStickerGroup, StickerGroupBar, StickerGroupManageSheet, StickerMeaningPicker } from '@/components/apps/sticker-batch';
import { StickerSearchSheet } from '../sticker-search-sheet';
import type { BatchDraftItem } from '@/components/apps/sticker-batch';

import { QQ_BLUE, compressImageFile } from './core';

// ---------------- 表情：聊天面板 + 表情管理页（qq-stickers 存储，微信端同构） ----------------

/** QQ 表情添加表单（面板/管理页共用；蓝色主题） */
export function QqStickerAddForm({
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
            className={`h-8 rounded-full px-4 text-[13px] ${tab === k ? 'text-white' : 'bg-black/[0.05] text-black/60 dark:bg-white/10 dark:text-white/60'}`}
            style={tab === k ? { backgroundColor: QQ_BLUE } : undefined}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'file' ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-3 flex h-[96px] w-full items-center justify-center overflow-hidden rounded-[10px] border border-dashed border-black/20 bg-[#F6F7F8] text-[13px] text-black/40 active:bg-black/[0.05] dark:border-white/20 dark:bg-white/[0.06] dark:text-white/40"
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
          className="mt-3 h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-[#F6F7F8] px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-white/[0.07] dark:placeholder:text-white/30"
        />
      )}
      <input
        value={meaning}
        onChange={(e) => onMeaning(e.target.value)}
        placeholder="表情包的意思（AI 会据此理解并回复）"
        maxLength={20}
        className="mt-2 h-[44px] w-full rounded-[10px] border border-black/[0.08] bg-[#F6F7F8] px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-white/[0.07] dark:placeholder:text-white/30"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="h-10 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-[10px] bg-black/[0.05] px-5 text-[15px] text-black/60 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/60"
        >
          取消
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPickFile(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/** 图片消息气泡（单聊/群聊共用：固定像素上限，圆角同气泡） */
export function QqImageBubble({ src, testId }: { src: string; testId?: string }) {
  return (
    <img
      src={src}
      alt="图片消息"
      data-testid={testId}
      loading="lazy"
      decoding="async"
      className="max-h-[210px] w-auto max-w-[160px] rounded-[10px] object-cover"
    />
  );
}

/** 表情包消息气泡（单聊/群聊共用：点按提示表情含义） */
export function QqStickerBubble({
  url,
  meaning,
  onClick,
  testId = 'qq-sticker-bubble',
}: {
  url: string;
  meaning: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="active:opacity-80"
      title={meaning || '表情'}
    >
      <img
        src={url}
        alt={meaning ? `表情：${meaning}` : '表情'}
        className="max-h-[110px] w-auto max-w-[118px] rounded-[14px] object-contain"
        loading="lazy"
      />
    </button>
  );
}

/** 加号面板宫格（单聊/群聊共用：彩色圆角瓷贴 + 白色图标，对照新版 QQ 更多面板）。
 *  液态玻璃主题（liquid）：竖向单列列表——图标左 + 文字右，黑图标黑字（参考图同款）；群聊不传保持彩色宫格。
 *  古早主题（retro，第五十五轮）：无彩色瓷贴的平铺灰色图标 + 灰字（微信图1 同款语言）。
 *  第五十八轮（用户指定「加号面板功能图标变成古早主题图标」）：古早改用 RtPlus*
 *  实心剪影图标（与微信加号面板同语言，颜色走 --rt-ic-* 深浅自适应） */
export function QqPlusGrid({
  items,
  liquid = false,
  retro = false,
}: {
  items: Array<{ key: string; label: string; color: string; icon: React.ReactNode; retroIcon?: React.ReactNode; onClick: () => void }>;
  liquid?: boolean;
  retro?: boolean;
}) {
  if (liquid) {
    return (
      <div className="flex flex-col">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            data-testid={`qq-plus-${it.key}`}
            onClick={it.onClick}
            className="lg-menu-row flex h-[44px] w-full items-center gap-3.5 px-5 text-left text-[14.5px] font-semibold text-[#1C1C1E] dark:text-white/90"
          >
            <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center text-black/80 dark:text-white/85 [&_svg]:h-[20px] [&_svg]:w-[20px]">{it.icon}</span>
            {it.label}
          </button>
        ))}
      </div>
    );
  }
  if (retro) {
    return (
      <div className="grid grid-cols-3 gap-y-6">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            data-testid={`qq-plus-${it.key}`}
            onClick={it.onClick}
            className="flex flex-col items-center gap-2 transition-transform active:scale-95"
          >
            {/* 古早（第五十八轮）：RtPlus* 实心剪影（白镂空细节，深浅自适应）；群聊等未提供时回退原线稿 */}
            <span className="flex h-[52px] w-[52px] items-center justify-center" aria-hidden="true">
              {retro ? (it.retroIcon ?? it.icon) : it.icon}
            </span>
            <span className="text-[12px] text-[#6A6E78] dark:text-white/60">{it.label}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-y-6">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          data-testid={`qq-plus-${it.key}`}
          onClick={it.onClick}
          className="flex flex-col items-center gap-2 transition-transform active:scale-95"
        >
          <span
            className="grid h-[52px] w-[52px] place-items-center rounded-[15px] text-white shadow-[0_2px_10px_rgba(0,0,0,0.10)]"
            style={{ backgroundColor: it.color }}
            aria-hidden="true"
          >
            {it.icon}
          </span>
          <span className="text-[12px] text-[#1F2329] dark:text-white/85">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 输入框上方快捷功能条（QQ 端）图标/文案（用户指定「图标再美化，变成黑白色」）：
 * 黑白单色 lucide 线描（currentColor，浅色黑 / 深色白，尺寸由快捷条容器统一压 14px）；
 * 行为不在此定义——点击取加号面板同名项的 onClick（与面板完全等效，面板本身不动）。
 * 第五十八轮（用户指定「输入框上面的功能图标变成古早主题图标」）：每项携带
 * retroIcon 古早实心剪影（与加号面板同语言），古早主题时由快捷条选用。
 * 单聊与群聊共用（qq-group 仅命中其面板实际有的功能，其余自动排除）。
 */
export const QQ_QUICK_META: Record<string, { label: string; icon: React.ReactNode; retroIcon: React.ReactNode }> = {
  call: { label: '语音通话', icon: <Phone className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusVoice /> },
  video: { label: '视频通话', icon: <Video className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusVideo /> },
  rp: { label: '红包', icon: <Gift className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusRedPacket /> },
  transfer: { label: '转账', icon: <ArrowLeftRight className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTransfer /> },
  loc: { label: '位置', icon: <MapPin className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusLocation /> },
  textcard: { label: '文字图片', icon: <Sparkles className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTextCard /> },
  together: { label: '一起听', icon: <Headphones className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTogether /> },
  express: { label: '快递', icon: <Package className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusExpress /> },
};

/**
 * 「文字图片」弹层（加号面板「文字图片」入口；Task 13 卡片版，无生图依赖，微信端 WxTextCardSheet 的 QQ 主题版）。
 * 输入可空——留空时 AI 按人设+最近聊天记录代笔（/api/textcard）；输入非空 = 用户代笔直接上卡；
 * 生成中状态 + 失败错误（留在弹层可重试）。
 */
export function QqTextCardSheet({
  charName,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  charName: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (busy) return;
    onSubmit(text.trim());
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" data-testid="qq-textcard-sheet">
      <div className="w-full max-w-[420px] rounded-t-[16px] bg-white px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4 dark:bg-[#232529]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold text-[#1F2329] dark:text-white">写一张文字图片发给{charName}</p>
          <button
            type="button"
            aria-label="关闭文字图片"
            data-testid="qq-textcard-close"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/50 disabled:opacity-40 dark:bg-white/[0.08] dark:text-white/60"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={3}
          maxLength={160}
          data-testid="qq-textcard-input"
          placeholder="写点想印在卡片上的字（留空 = AI 结合 TA 的人设和你们的聊天记录帮你写）"
          className="w-full resize-none rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 text-[15px] leading-[1.6] text-[#1F2329] outline-none placeholder:text-black/30 focus:border-[#0099FF]/60 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="qq-textcard-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="qq-textcard-submit"
          onClick={submit}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0099FF] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              正在写文字图片…
            </>
          ) : (
            '生成并发送'
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-black/35 dark:text-white/35">
          文字图片以我的身份发出，{charName}会看到卡片上的字
        </p>
      </div>
    </div>
  );
}

/** QQ 聊天表情面板（点选 + 内嵌添加 + 管理删除；数据 qq-stickers；单聊/群聊共用同一套）。
 *  分组栏移到网格下方（对照真机 QQ：面板标签在下）；内置表情（QQ表情分组）点选不直接发送：
 *  走 onPickBuiltin 把 [微笑] 文字代码插入输入框，可与文字混排一起发；用户收藏贴纸仍点选直发 */
export function QqStickerPanel({
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
  const [list, setList] = useState<Sticker[]>(() => loadStickers('qq'));
  const [groups, setGroups] = useState<StickerGroup[]>(() => loadStickerGroups('qq'));
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
    saveStickers('qq', next);
  };
  // Task 32：聊天页长按表情「添加到表情」后面板同步刷新（面板开着也能立即看到新表情）
  useEffect(() => {
    const syncStickers = () => {
      setList(loadStickers('qq'));
      setGroups(loadStickerGroups('qq'));
    };
    window.addEventListener('qq-stickers-changed', syncStickers);
    return () => window.removeEventListener('qq-stickers-changed', syncStickers);
  }, []);
  /** 当前分组下的表情（groupId 缺失/指向已删分组 → 归默认分组，防孤儿不可见） */
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const visible = useMemo(() => list.filter((s) => stickerGroupOf(s, groupIds) === activeGroupId), [list, groupIds, activeGroupId]);
  /** 新建分组（分组栏「＋」胶囊）：持久化 + 自动选中新分组 */
  const createGroup = (name: string) => {
    const g = makeStickerGroup(name);
    const next = [...groups, g];
    setGroups(next);
    saveStickerGroups('qq', next);
    setActiveGroupId(g.id);
    onToast(`已新建分组「${g.name}」`);
  };
  const pickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      setPreview(await compressImageFile(f));
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

  /** 长按表情 → 预览卡（大图 + 名称 + 删除/取消），无需进管理模式即可删除 */
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
          ? /* 液态玻璃（用户指定）：去实底白与上边框，乳白强模糊玻璃面板（.dark 变体 CSS 内建） */
            'lg-sheet relative shrink-0 mx-2.5 mb-2.5 rounded-[24px]'
          : 'relative shrink-0 border-t border-black/[0.05] bg-white dark:border-white/[0.06] dark:bg-[#1B1C1F]'
      }
      style={{ animation: 'qqPanelIn 0.24s ease-out', ...(searchOpen ? { height: searchH > 0 ? searchH : 380 } : {}) }}
      data-testid="qq-sticker-panel"
    >
      {searchOpen ? (
        /* 网上表情搜索面板（替换式）：整体替换面板本体占面板原位，关闭/选中后恢复原面板 */
        <StickerSearchSheet
          app="qq"
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
              data-testid="qq-sticker-panel-search"
              onClick={openSearch}
              className="text-black/45 active:opacity-60 dark:text-white/45"
            >
              <Search className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          )}
          {mode === 'grid' && !isBuiltinGroupId(activeGroupId) && list.some((s) => !s.builtin) && (
            <button
              type="button"
              data-testid="qq-sticker-panel-manage"
              onClick={() => setEditMode((v) => !v)}
              className="text-[13px] active:opacity-60"
              style={{ color: QQ_BLUE }}
            >
              {editMode ? '完成' : '管理'}
            </button>
          )}
          <button type="button" aria-label="收起表情面板" onClick={onClose} className="text-black/40 active:opacity-60 dark:text-white/40">
            <ChevronDown className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </div>
      {mode === 'grid' ? (
        <div className="h-[280px] overflow-y-auto px-3 pb-3 pt-1">
          {/* 内置表情=真机同款小表情（8列小尺寸）；用户收藏贴纸=大瓦片（4列） */}
          <div className={`grid ${activeGroupId === 'builtin' ? 'grid-cols-8 gap-1' : 'grid-cols-4 gap-2'}`}>
            {visible.map((st, i) => (
              <div key={st.id} className="relative">
                <button
                  type="button"
                  data-testid={`qq-sticker-panel-item-${i}`}
                  onClick={() => {
                    if (suppressPickRef.current) {
                      suppressPickRef.current = false;
                      return;
                    }
                    if (editMode) return;
                    // v62：官方小表情插入 [代码] 混排；内置包大贴纸与用户表情一样点选直接发送
                    if (isOfficialEmojiSticker(st)) onPickBuiltin?.(st);
                    else onPick(st);
                  }}
                  onPointerDown={onStickerPointerDown(st)}
                  onPointerMove={onStickerPointerMove}
                  onPointerUp={clearStickerPress}
                  onPointerCancel={clearStickerPress}
                  onPointerLeave={clearStickerPress}
                  className={
                    isOfficialEmojiSticker(st)
                      ? `flex h-10 w-full items-center justify-center overflow-hidden rounded-[8px] p-[3px] active:bg-black/[0.06]`
                      : `aspect-square w-full overflow-hidden rounded-[10px] active:bg-black/[0.06] p-1.5`
                  }
                  title={st.meaning || '表情'}
                >
                  <img src={st.url} alt={st.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </button>
                {/* v62：用户表情=可点改意思的按钮；内置包贴纸=纯文本标签（常量不可改）；官方小表情不显 */}
                {!st.builtin && (
                  <button
                    type="button"
                    data-testid={`qq-sticker-meaning-${i}`}
                    onClick={() => setMeaningFor(st)}
                    className="mt-0.5 block h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 active:opacity-60 dark:text-white/40"
                  >
                    {st.meaning || '＋意思'}
                  </button>
                )}
                {st.builtin && st.groupId !== BUILTIN_STICKER_GROUP_ID && (
                  <p className="mt-0.5 h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 dark:text-white/40">{st.meaning}</p>
                )}
                {editMode && !st.builtin && (
                  <button
                    type="button"
                    aria-label="删除表情"
                    data-testid={`qq-sticker-panel-del-${i}`}
                    onClick={() => commit(list.filter((x) => x.id !== st.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5455C] text-[11px] font-semibold text-white shadow"
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
                data-testid="qq-sticker-panel-add"
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
        <div className="px-4 pb-3 pt-1">
          <QqStickerAddForm
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
      {/* 分组栏（真机 QQ 同款：面板标签在网格下方）：毛玻璃胶囊分组名字 +「＋」新建分组 */}
      <StickerGroupBar testPrefix="qq" groups={groups} activeId={activeGroupId} onSelect={setActiveGroupId} onCreate={createGroup} />

      {/* 意思选择 UI（预设胶囊 + 自定义 + 不设置） */}
      {meaningFor && (
        <StickerMeaningPicker
          testPrefix="qq"
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

      {/* 长按表情预览卡（白卡大图 + 名称 + 红色删除；点遮罩取消） */}
      {pressSticker && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/45"
          data-testid="qq-sticker-preview"
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
                data-testid="qq-sticker-preview-del"
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

/** QQ 表情管理页（个人中心抽屉「表情」入口：网格 + 单张编辑[改意思/所属分组/删除] + 批量导入手机图片 + URL 添加自动识别意思 + 分组管理） */
export function QqStickersPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('qq'));
  const [groups, setGroups] = useState<StickerGroup[]>(() => loadStickerGroups('qq'));
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
    saveStickers('qq', next);
  };
  /** 当前分组下的表情（groupId 缺失/指向已删分组 → 归默认分组，防孤儿不可见） */
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const visible = useMemo(() => list.filter((s) => stickerGroupOf(s, groupIds) === activeGroupId), [list, groupIds, activeGroupId]);
  const applyGroups = (next: StickerGroup[]) => {
    setGroups(next);
    saveStickerGroups('qq', next);
  };
  const createGroup = (name: string) => {
    const g = makeStickerGroup(name);
    applyGroups([...groups, g]);
    onToast(`已新建分组「${g.name}」`);
  };

  /** 右上角「管理」：进入删除模式，点表情上的红色 × 直接删除（再点完成退出） */
  const [delMode, setDelMode] = useState(false);
  const delSticker = (st: Sticker) => {
    commit(list.filter((x) => x.id !== st.id));
    onToast('已删除表情');
    if (list.length <= 1) setDelMode(false);
  };

  /** FileList → 批量草稿项（压缩到 240 + 默认名：文件名中文优先，否则文件名去扩展名） */
  const filesToDrafts = async (files: FileList): Promise<BatchDraftItem[]> => {
    const drafts: BatchDraftItem[] = [];
    for (const f of Array.from(files)) {
      try {
        const url = await compressImageFile(f, 240);
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

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#FAFAFC] text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-stickers-page">
      <div className="shrink-0 bg-[#FAFAFC] pt-[54px] dark:bg-[#16171A]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="qq-stickers-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">表情</div>
          {list.length > 0 ? (
            <button
              type="button"
              data-testid="qq-stickers-manage"
              onClick={() => setDelMode((v) => !v)}
              className="w-[46px] text-center text-[15px] text-[#0099FF] active:opacity-60 dark:text-[#4DB8FF]"
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
        testPrefix="qq"
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
            {visible.map((st, i) => (
              <button
                key={st.id}
                type="button"
                data-testid={`qq-stickers-item-${i}`}
                onClick={() => {
                  if (st.builtin) return; // 内置表情不可编辑/删除
                  if (delMode) {
                    delSticker(st);
                    return;
                  }
                  setEditing(st);
                  setEditMeaning(st.meaning);
                  setEditGroupId(st.groupId ?? DEFAULT_STICKER_GROUP_ID);
                }}
                className="relative rounded-[12px] p-1 text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
              >
                <span className="flex aspect-square items-center justify-center overflow-hidden rounded-[8px]">
                  <img src={st.url} alt={st.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </span>
                <span className="mt-1.5 block truncate text-[12px] text-black/55 dark:text-white/55">{st.meaning || '点此写意思'}</span>
                {delMode && !st.builtin && (
                  <span
                    aria-hidden="true"
                    data-testid={`qq-stickers-del-${i}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5455C] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 dark:border-white/[0.06] dark:bg-[#1B1C1F]">
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="qq-stickers-upload"
            onClick={() => uploadRef.current?.click()}
            className="h-11 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: QQ_BLUE }}
          >
            从手机添加（可批量）
          </button>
          <button
            type="button"
            data-testid="qq-stickers-add-url"
            onClick={() => setBatchOpen(true)}
            className="h-11 rounded-[10px] bg-black/[0.06] px-5 text-[15px] text-black/70 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/70"
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
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setEditing(null)} data-testid="qq-stickers-edit">
          <div className="rounded-t-[14px] bg-[#FAFAFC] px-4 pb-8 pt-4 dark:bg-[#1C1D21]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-[110px] w-[110px] items-center justify-center overflow-hidden rounded-[12px] bg-white p-2 shadow-[0_1px_4px_rgba(0,0,0,0.05)] dark:bg-[#1F2125]">
              <img src={editing.url} alt={editing.meaning || '表情'} className="h-full w-full object-contain" />
            </div>
            <input
              value={editMeaning}
              onChange={(e) => setEditMeaning(e.target.value)}
              maxLength={20}
              placeholder="表情包的意思（AI 会据此理解并回复）"
              data-testid="qq-stickers-edit-meaning"
              className="h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[15px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1F2125] dark:placeholder:text-white/30"
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
                    data-testid={`qq-stickers-edit-group-${g.id === DEFAULT_STICKER_GROUP_ID ? 'my' : g.id}`}
                    onClick={() => setEditGroupId(g.id)}
                    className={`h-7 rounded-full border px-3 text-[12.5px] ${
                      on
                        ? 'border-[#0099FF]/40 bg-[#0099FF]/10 font-medium text-[#0099FF]'
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
                data-testid="qq-stickers-edit-del"
                onClick={() => {
                  commit(list.filter((x) => x.id !== editing.id));
                  setEditing(null);
                  onToast('已删除');
                }}
                className="h-11 rounded-[10px] bg-[#F5455C]/10 px-5 text-[15px] text-[#F5455C] active:bg-[#F5455C]/20 dark:bg-[#F5455C]/20"
              >
                删除
              </button>
              <button
                type="button"
                data-testid="qq-stickers-edit-save"
                onClick={() => {
                  if (!editing) return;
                  commit(list.map((x) => (x.id === editing.id ? { ...x, meaning: editMeaning.trim(), groupId: editGroupId || DEFAULT_STICKER_GROUP_ID } : x)));
                  setEditing(null);
                  onToast('已保存');
                }}
                className="h-11 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
                style={{ backgroundColor: QQ_BLUE }}
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
        testPrefix="qq"
      />

      {/* 分组管理弹层：重命名/删除自定义分组（组内表情移回默认组），底部新建分组 */}
      {groupManageOpen && (
        <StickerGroupManageSheet
          testPrefix="qq"
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
