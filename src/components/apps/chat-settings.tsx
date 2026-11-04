'use client';

/**
 * 聊天设置页 + 聊天背景页 + 回复条数页 + 翻译页 + 查找聊天记录页 + 信息端聊天设置页
 * （微信 / QQ / 信息三端，variant 区分主题）：
 * - ChatSettingsPage（微信/QQ）：信息卡片（头像/名字/微信号或QQ号/地区职业）、备注、置顶聊天、消息免打扰、
 *   查找聊天记录、聊天背景（均紧跟免打扰）、回复条数入口（进入独立二级页 ChatReplyCountPage）、
 *   翻译入口（进入 ChatTranslatePage）、分句发送开关、时间感知开关（AI 感知当前时间/节日/事件时长/上次聊天间隔，按会话独立）
 * - ChatReplyCountPage：回复条数选择页 —— 1/3/5/7/15/20/25/30 条（上限，可少发），AI 像
 *   真人一样一句一句连发多条消息（一句一条，由 @/lib/reply-count 切分与节奏控制）
 * - ChatTranslatePage：翻译语言页（三端共用，参考 iOS 翻译语言页）—— 总开关 + 语言对选择：
 *   上方左右两个语言槽可点选（点一侧再在下方列表选语言），中间 ⇄ 一键互换；
 *   聊天中按消息语言双向翻译：左侧语言的消息译成右侧，右侧语言的消息译成左侧
 * - SmsChatSettingsPage：信息 App 的聊天设置页（iOS 风格：翻译入口 + 回复条数入口 + 分句发送开关 + 时间感知开关）
 * - WorldBookPickerPage：世界书挂载页（三端共用二级页）——「局部」书勾选挂载（既有交互不变）；
 *   34-d 新增「专属」区块：列出全部专属书，可一键绑定/解绑到当前联系人（写书本体 targetContactId）
 * - ChatBgPage：聊天背景独立页 —— 顶部预览卡片、从手机相册上传、内置纯色壁纸
 * - ChatSearchPage：关键词查找当前聊天记录，点击结果定位回聊天页并高亮
 * - ChatVoicePage：「他的声音」页（三端共用二级页）——选角色说话音色（默认/内置音色/
 *   我的音色（chip 内喇叭可试听），宿主持久化到联系人 voiceId）+「AI 语音频率」入口行
 * - ChatVoiceFreqPage：AI 语音发送频率选择页（三端共用）—— 关闭/每条都发语音/经常(1/3)/
 *   偶尔(1/7)/不经常(1/12)，按会话独立（群聊按群），发送时现场读取
 * - 置顶/免打扰/背景持久化在 @/lib/chat-flags（localStorage），回复条数/翻译/分句发送持久化在
 *   @/lib/reply-count / @/lib/chat-translate / @/lib/sentence-send（localStorage，按会话键隔离），
 *   背景图片本体在 IndexedDB（@/lib/ios/contacts-store 的 getChatBgImage/setChatBgImage）
 *   （形象锁定/锁脸页已迁移到「设置 › 图像生成」页尾的 FaceLockSection，数据层 @/lib/imggen 不变）
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeftRight, AudioLines, BookMarked, Check, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Palette, Search, Zap } from 'lucide-react';
import { deepThinkCaption } from '@/lib/deep-think';
import type { ChatBgMode } from '@/lib/chat-flags';
import type { ContactRecord } from '@/lib/contacts';
import { REPLY_COUNT_OPTIONS } from '@/lib/reply-count';
import { COMMON_TRANSLATE_LANGS, MORE_TRANSLATE_LANGS, translateLangLabel, type ChatTranslateCfg, type TranslateLang } from '@/lib/chat-translate';
import { AI_VOICE_FREQ_OPTIONS, aiVoiceFreqLabel, type AiVoiceFreq } from '@/lib/ios/ai-voice';
import { BUILTIN_TTS_VOICES, isBuiltinVoiceId, isBuiltinVoiceSupported, speakBuiltin, stopBuiltinSpeech } from '@/lib/ios/builtin-voices';
import { listContacts } from '@/lib/ios/contacts-store';
import { useMyVoices } from '@/lib/ios/my-voices';
import { voiceIdForProvider } from '@/lib/ios/tts-client';
import { useSettings } from '@/lib/ios/store';
import { getBoundBookIds, loadBooks, saveBooks, type WorldBook } from '@/lib/ios/worldbook';
import { LocalToast, useLocalToast } from './page-toast';
import { ChatDisplaySection } from './chat-display-settings';
import { ChatCssSection } from './custom-css-editor';
import { useChatSkin } from '@/lib/ios/chat-skin';

export type ChatSettingsVariant = 'wx' | 'qq' | 'sms';

/** 当前聊天背景状态（从 chat-flags 取） */
export interface ChatSettingsBg {
  mode: ChatBgMode;
  /** mode === 'color' 时的纯色 */
  color: string;
}

/** App 默认聊天底色（预览卡片与「默认」色块用） */
export const WX_CHAT_BG_DEFAULT = '#EDEDED';
export const QQ_CHAT_BG_DEFAULT = '#F5F6F7';

/** 内置纯色壁纸（淡色系 14 款，搭配白/绿气泡均可读） */
export const CHAT_BG_SOLID_COLORS: readonly string[] = [
  '#BAD5E8',
  '#A8D8B9',
  '#FFE3B3',
  '#FFC9D4',
  '#D6C9F0',
  '#B5E3D8',
  '#FFF6B3',
  '#CDD7E0',
  '#FFC7A8',
  '#E2E8CD',
  '#F3D9E5',
  '#C9E7F5',
  '#E5D3BD',
  '#D7DBDE',
];

/** 聊天页背景层样式：color → 纯色；image → 图片（cover 居中）；default → undefined（不渲染层） */
export function chatBgLayerStyle(bg: ChatSettingsBg, imageUrl: string | null): CSSProperties | undefined {
  if (bg.mode === 'color' && bg.color) {
    return { backgroundColor: bg.color };
  }
  if (bg.mode === 'image' && imageUrl) {
    return {
      backgroundImage: `url(${imageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }
  return undefined;
}

/** iOS 风格开关（微信绿 / QQ 绿，on 色随 variant） */
export function ChatToggle({
  on,
  onChange,
  accent,
  testId,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  accent: string;
  testId?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        on ? '' : 'bg-black/[0.12] dark:bg-white/[0.22]'
      }`}
      style={on ? { backgroundColor: accent } : undefined}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-all duration-200 ${
          on ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

/** 聊天设置页 */

export function ChatSettingsPage({
  variant,
  title,
  peerName,
  peerAvatar,
  idLabel,
  idValue,
  metaLine,
  remark,
  pinned,
  muted,
  bg,
  bgImageUrl,
  replyCount,
  translateSummary,
  sentenceSend,
  timeAware,
  stickersOn,
  worldBooksSummary,
  /** 当前会话联系人 id（显示设置按联系人隔离）；不传 = 隐藏显示设置区块（信息端 / 自己会话） */
  contactId,
  onBack,
  onSaveRemark,
  /** 与角色的关系（当前账号视角，多账号关系感知）；不传 = 隐藏该行 */
  relation,
  /** 保存关系（当前账号作用域；宿主调 setAppRelation）；不传 = 隐藏该行 */
  onSaveRelation,
  onTogglePinned,
  onToggleMuted,
  onOpenReplyCount,
  onOpenTranslate,
  onToggleSentenceSend,
  onToggleTimeAware,
  onToggleStickers,
  actionDescOn,
  onToggleActionDesc,
  /** 深度思考开关状态（开启后气泡上方显示思维链卡片；按联系人隔离，见 @/lib/deep-think） */
  deepThinkOn,
  /** 深度思考开关切换（宿主调 setDeepThinkOn 持久化到 IndexedDB，按联系人隔离） */
  onToggleDeepThink,
  /** 「回车键发送消息」开关状态（App 级、按账号隔离，单聊+群聊共用；默认开启=回车发送） */
  enterSend,
  /** 回车键发送开关切换（宿主调 setEnterSend(app, v) 持久化+即时广播） */
  onToggleEnterSend,
  onOpenWorldBooks,
  onOpenSearch,
  onOpenBg,
  onOpenPeerProfile,
  blockedByUser,
  blockReqCount,
  onToggleBlock,
  onResetBlockReqCount,
  /** 他的声音摘要（角色音色展示名；空 = 默认） */
  voiceSummary,
  /** 打开「他的声音」页；不传 = 隐藏该入口行 */
  onOpenVoice,
  /** 打开「主动发消息」设置页；不传 = 隐藏该入口行 */
  onOpenProactive,
  /** 主动发消息入口行摘要（宿主用 proactiveCfgSummary 计算） */
  proactiveSummary,
  onDeleteContact,
}: {
  variant: ChatSettingsVariant;
  /** 标题：微信「聊天信息」/ QQ「聊天设置」 */
  title: string;
  peerName: string;
  peerAvatar: string | null;
  /** 信息卡第二行：微信号 / QQ 号 */
  idLabel: string;
  idValue: string;
  /** 信息卡第三行：地区 · 职业（可为空） */
  metaLine: string;
  /** 备注名（仅机主自己可见；空 = 未设置） */
  remark: string;
  pinned: boolean;
  muted: boolean;
  bg: ChatSettingsBg;
  /** mode === 'image' 时已加载的图片 data URL（未加载完为 null；入口行迷你预览用） */
  bgImageUrl: string | null;
  /** 当前会话的回复条数（AI 连发多条消息） */
  replyCount: number;
  /** 翻译入口行右侧摘要：未开启 / 已选语言列表 / 未选择语言 */
  translateSummary: string;
  /** 分句发送开关状态（开启后连续发消息 AI 不回复，输入框为空再点发送才触发回复） */
  sentenceSend: boolean;
  /** 时间感知开关状态（开启后 AI 感知当前时间/节日/事件时长/上次聊天间隔） */
  timeAware: boolean;
  /** 表情包开关状态（关闭后 AI 不发表情包也不发 emoji，见 @/lib/sticker-toggle） */
  stickersOn: boolean;
  /** 动作描写开关状态（开启后 AI 回复里的动作描写以灰色小字居中显示，关闭后自动过滤，见 @/lib/action-desc） */
  actionDescOn: boolean;
  /** 深度思考开关状态（开启后气泡上方显示可展开的思维链卡片；思考指令始终注入，开关只控制展示） */
  deepThinkOn: boolean;
  /** 挂载的世界书摘要（未挂载时「未选择」） */
  worldBooksSummary: string;
  /** 当前会话联系人 id（显示设置按联系人隔离：头像样式 / 已读未读回执 / 时间显示）；不传 = 隐藏该区块 */
  contactId?: string;
  onBack: () => void;
  /** 保存备注（空串 = 清除备注；宿主负责持久化并刷新展示名） */
  onSaveRemark: (v: string) => void;
  /** 与角色的关系（当前账号视角；多账号关系感知）；不传 = 隐藏该行（用户/自己会话） */
  relation?: string | null;
  /** 保存关系（当前账号作用域，宿主调 setAppRelation）；不传 = 隐藏该行 */
  onSaveRelation?: (v: string) => void;
  onTogglePinned: (v: boolean) => void;
  onToggleMuted: (v: boolean) => void;
  onOpenReplyCount: () => void;
  onOpenTranslate: () => void;
  onToggleSentenceSend: (v: boolean) => void;
  onToggleTimeAware: (v: boolean) => void;
  onToggleStickers: (v: boolean) => void;
  /** 动作描写开关切换（宿主负责持久化，见 @/lib/action-desc） */
  onToggleActionDesc: (v: boolean) => void;
  /** 深度思考开关切换（宿主调 setDeepThinkOn(contactId, v)，IndexedDB 按联系人隔离） */
  onToggleDeepThink: (v: boolean) => void;
  /** 「回车键发送消息」开关状态（App 级、按账号隔离；开启=回车/移动端「发送」键直接发送；关闭=回车换行） */
  enterSend: boolean;
  /** 回车键发送开关切换（即时生效，无需重启） */
  onToggleEnterSend: (v: boolean) => void;
  onOpenWorldBooks: () => void;
  onOpenSearch: () => void;
  onOpenBg: () => void;
  /** 点击信息卡片 → 进入联系人详细界面（QQ 好友资料页 / 微信好友详情页）；不传则卡片不可点 */
  onOpenPeerProfile?: () => void;
  /** 双向拉黑：当前是否已拉黑对方（不传 = 该会话不支持拉黑，隐藏开关） */
  blockedByUser?: boolean;
  /** #39：角色被拒申请计数（调用方从 BlockEntry.reqCount 传入；>0 且 onResetBlockReqCount 提供时显示重置入口） */
  blockReqCount?: number;
  /** 拉黑开关切换（宿主负责持久化 + 生成系统消息） */
  onToggleBlock?: (v: boolean) => void;
  /** #39：手动重置角色被拒申请计数回调（被拒 3 次后角色彻底沉默，给用户恢复通道入口） */
  onResetBlockReqCount?: () => void;
  /** 他的声音摘要（角色音色展示名；空 = 默认） */
  voiceSummary?: string;
  /** 打开「他的声音」页；不传 = 隐藏该入口行 */
  onOpenVoice?: () => void;
  /** 打开「主动发消息」设置页（定时/事件/自主/提醒四类触发）；不传 = 隐藏该入口行 */
  onOpenProactive?: () => void;
  /** 主动发消息入口行摘要（宿主用 proactiveCfgSummary 计算；空 = 未开启） */
  proactiveSummary?: string;
  /** 删除联系人（删除好友关系：列表移除/聊天关闭；记录/记忆/朋友圈/通话保留但不可见，加回恢复）。不传 = 隐藏入口 */
  onDeleteContact?: () => void;
}) {
  const wx = variant === 'wx';

  // 主题 token（微信灰白 / QQ 冷灰白）
  const skin = useChatSkin();
  const pageCls = skin.retro ? 'chat-set-page rt-root text-black dark:text-white' : skin.liquid ? 'chat-set-page lg-root text-black dark:text-white' : wx ? 'chat-set-page bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'chat-set-page bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  /* chat-set-card：聊天设置页卡片锚点（自定义 CSS 示例模板可改卡底） */
  const cardCls = skin.retro ? 'chat-set-card rounded-[6px] bg-white dark:bg-[#1A1A1A]' : wx ? 'chat-set-card rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'chat-set-card rounded-[14px] bg-white dark:bg-[#232529]';
  const barCls = skin.retro ? 'rt-bar' : '';
  const dividerCls = wx ? 'border-black/5 dark:border-white/10' : 'border-black/[0.04] dark:border-white/[0.06]';
  /* chat-set-row：设置行锚点 */
  const rowCls = wx
    ? 'chat-set-row flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
    : 'chat-set-row flex w-full items-center justify-between px-4 min-h-[54px] text-left text-[15.5px] active:bg-black/[0.03] dark:active:bg-white/[0.05]';
  // 开关选中色：微信绿 / QQ 蓝
  const accent = wx ? '#07C160' : '#0099FF';
  const defaultBg = wx ? WX_CHAT_BG_DEFAULT : QQ_CHAT_BG_DEFAULT;
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;
  /** 备注编辑弹窗（本地草稿，保存时交回宿主持久化） */
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState('');
  /** 关系编辑弹窗（多账号关系感知：保存当前账号视角下的关系） */
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationDraft, setRelationDraft] = useState('');
  /** 页内 toast（自定义 CSS 编辑器等区块的操作反馈） */
  const [toast, showToast] = useLocalToast();

  return (
    <div
      className={`absolute inset-0 z-40 flex h-full w-full flex-col ${pageCls}`}
      data-chat-set-app={variant}
    >
      <LocalToast msg={toast} />
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-chat-settings-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>{title}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 信息卡片（点击进入联系人详细界面：QQ 好友资料页 / 微信好友详情页） */}
        <div className={`${cardCls} overflow-hidden`}>
          {(() => {
            const inner = (
              <>
                <ChatSettingsAvatar variant={variant} src={peerAvatar} alt={peerName} size={56} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold'}`}>{peerName}</p>
                  <p className="mt-1 truncate text-[13px] text-black/45 dark:text-white/45">
                    {idLabel}：{idValue}
                  </p>
                  {metaLine && <p className="mt-0.5 truncate text-[13px] text-black/45 dark:text-white/45">{metaLine}</p>}
                </div>
              </>
            );
            if (!onOpenPeerProfile) {
              return <div className={`flex items-center gap-3 px-4 ${wx ? 'py-4' : 'py-3.5'}`}>{inner}</div>;
            }
            return (
              <button
                type="button"
                data-testid={`${testPrefix}-chat-settings-card`}
                onClick={onOpenPeerProfile}
                aria-label={`查看${peerName}的资料`}
                className={`flex w-full items-center gap-3 px-4 text-left transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06] ${wx ? 'py-4' : 'py-3.5'}`}
              >
                {inner}
                <ChevronRight className="h-5 w-5 shrink-0 text-black/20 dark:text-white/25" aria-hidden="true" />
              </button>
            );
          })()}
        </div>

        {/* 备注：仅机主自己可见的显示名（保存后聊天界面/消息列表优先显示备注） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button
            type="button"
            data-testid={`${testPrefix}-settings-remark`}
            onClick={() => {
              setRemarkDraft(remark);
              setRemarkOpen(true);
            }}
            className={rowCls}
          >
            <span>备注</span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid={`${testPrefix}-remark-value`} className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40">
                {remark || '未设置'}
              </span>
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
          {/* 第三十二轮：聊天设置里的「关系」行已按用户要求删除（关系数据与 AI 感知链路保留，仅不再展示入口） */}
        </div>

        {/* 置顶 / 免打扰开关（纯文字行，无图标） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>置顶聊天</span>
            <ChatToggle
              on={pinned}
              onChange={onTogglePinned}
              accent={accent}
              testId={`${testPrefix}-settings-pin`}
              label="置顶聊天"
            />
          </div>
          <div className={`border-t ${dividerCls}`} />
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>消息免打扰</span>
            <ChatToggle
              on={muted}
              onChange={onToggleMuted}
              accent={accent}
              testId={`${testPrefix}-settings-mute`}
              label="消息免打扰"
            />
          </div>
        </div>

        {/* 查找聊天记录（消息免打扰下方） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button type="button" data-testid={`${testPrefix}-settings-search`} onClick={onOpenSearch} className={rowCls}>
            <span className="flex items-center gap-2.5">
              <Search className="h-[18px] w-[18px] text-black/60 dark:text-white/60" strokeWidth={1.9} aria-hidden="true" />
              查找聊天记录
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 聊天背景：二级页入口行（右侧当前背景迷你预览；消息免打扰下方） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button type="button" data-testid={`${testPrefix}-settings-bg`} onClick={onOpenBg} className={rowCls}>
            <span>聊天背景</span>
            <span className="flex shrink-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-[22px] w-[22px] rounded-[5px] border border-black/10 bg-cover bg-center dark:border-white/15"
                style={chatBgLayerStyle(bg, bgImageUrl) ?? { backgroundColor: defaultBg }}
              />
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 显示设置（本轮：折叠区块——头像样式 / 已读未读回执 / 时间显示，按联系人隔离；
            信息端（sms）不参与，未传 contactId（如自己会话）也不显示） */}
        {variant !== 'sms' && contactId ? <ChatDisplaySection app={variant} contactId={contactId} /> : null}

        {/* 自定义 CSS（第六十五轮首建 · 第七十轮按联系人隔离）：折叠区块，作用域 = 当前联系人的
            聊天页（消息/气泡/输入栏），每个联系人一套互不影响；信息端（sms）与无 contactId 的
            自己会话不显示（和上方显示设置同规则） */}
        {variant !== 'sms' && contactId ? (
          <ChatCssSection app={variant} contactId={contactId} accent={accent} onToast={showToast} />
        ) : null}

        {/* 回复条数：AI 按选定条数连发多条消息（独立二级页选择） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button
            type="button"
            data-testid={`${testPrefix}-settings-reply-count`}
            onClick={onOpenReplyCount}
            className={rowCls}
          >
            <span>回复条数</span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid={`${testPrefix}-reply-count-value`} className="text-[14px] text-black/40 dark:text-white/40">
                {replyCount} 条
              </span>
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 翻译：气泡下方多语言翻译（独立二级页选语言，三端共用 ChatTranslatePage） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button
            type="button"
            data-testid={`${testPrefix}-settings-translate`}
            onClick={onOpenTranslate}
            className={rowCls}
          >
            <span>翻译</span>
            <span className="flex shrink-0 items-center gap-2">
              <span
                data-testid={`${testPrefix}-translate-summary`}
                className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40"
              >
                {translateSummary}
              </span>
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 分句发送：开启后连续发的消息对方不回复，输入框为空时再点一次「发送」才触发回复 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>分句发送</span>
            <ChatToggle
              on={sentenceSend}
              onChange={onToggleSentenceSend}
              accent={accent}
              testId={`${testPrefix}-settings-sentence`}
              label="分句发送"
            />
          </div>
        </div>

        {/* 回车键发送消息：App 级开关（按账号隔离，单聊+群聊共用）——
            开启=桌面回车/移动端键盘「发送」键直接发消息（与点「发送」按钮一致）；
            关闭=回车一律换行（多行内容正确显示），点「发送」按钮才发送；切换即时生效 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>回车键发送消息</span>
            <ChatToggle
              on={enterSend}
              onChange={onToggleEnterSend}
              accent={accent}
              testId={`${testPrefix}-settings-enter-send`}
              label="回车键发送消息"
            />
          </div>
        </div>

        {/* 时间感知：AI 感知当前时间/季节/节日、事件耗时与上次聊天间隔（按会话独立开关，发送时现场读取） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>时间感知</span>
            <ChatToggle
              on={timeAware}
              onChange={onToggleTimeAware}
              accent={accent}
              testId={`${testPrefix}-settings-time`}
              label="时间感知"
            />
          </div>
        </div>

        {/* 主动发消息：定时/事件/自主/自然语言提醒四类触发（独立二级页，每角色独立设置） */}
        {onOpenProactive && (
          <div className={`${cardCls} mt-3 overflow-hidden`}>
            <button type="button" data-testid={`${testPrefix}-settings-proactive`} onClick={onOpenProactive} className={rowCls}>
              <span className="flex items-center gap-2.5">
                <Zap className="h-[18px] w-[18px] text-black/60 dark:text-white/60" strokeWidth={1.9} aria-hidden="true" />
                主动发消息
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span data-testid={`${testPrefix}-proactive-summary`} className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40">
                  {proactiveSummary || '未开启'}
                </span>
                <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
              </span>
            </button>
          </div>
        )}

        {/* 表情包：AI 发表情包与 emoji 的总开关（关闭后不发表情包也不发 emoji，按会话独立，发送时现场读取） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>表情包</span>
            <ChatToggle
              on={stickersOn}
              onChange={onToggleStickers}
              accent={accent}
              testId={`${testPrefix}-settings-stickers`}
              label="表情包"
            />
          </div>
        </div>

        {/* 动作描写：AI 回复中动作/情景描写的显示开关（开启时 *...* 包裹的描写以灰色小字居中独立成行，关闭时自动过滤；按会话独立） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>动作描写</span>
            <ChatToggle
              on={actionDescOn}
              onChange={onToggleActionDesc}
              accent={accent}
              testId={`${testPrefix}-settings-action-desc`}
              label="动作描写"
            />
          </div>
        </div>

        {/* 深度思考：AI 回复前先深度思考，气泡上方可展开查看思考过程（指令始终注入，开关只控制展示；按联系人隔离持久化） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span>深度思考</span>
            <ChatToggle
              on={deepThinkOn}
              onChange={onToggleDeepThink}
              accent={accent}
              testId={`${testPrefix}-settings-deep-think`}
              label="深度思考"
            />
          </div>
        </div>
        {/* A2 开关说明小字：「关 ≠ 不思考」——指令始终注入，关闭仅隐藏思维链展示，防用户误以为关闭=省流量 */}
        <p className="px-1 pt-2.5 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
          {deepThinkCaption(deepThinkOn)}
        </p>

        {/* 世界书：为联系人挂载设定库（命中触发词的条目注入提示词，独立二级页选择） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <button type="button" data-testid={`${testPrefix}-settings-worldbooks`} onClick={onOpenWorldBooks} className={rowCls}>
            <span className="flex items-center gap-2.5">
              <BookMarked className="h-[18px] w-[18px] text-black/60 dark:text-white/60" strokeWidth={1.9} aria-hidden="true" />
              世界书
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid={`${testPrefix}-worldbooks-summary`} className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40">
                {worldBooksSummary}
              </span>
              <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 他的声音：角色说话音色（内置音色/我的音色）+ AI 语音发送频率（独立二级页） */}
        {onOpenVoice && (
          <>
            <div className={`${cardCls} mt-3 overflow-hidden`}>
              <button type="button" data-testid={`${testPrefix}-settings-voice`} onClick={onOpenVoice} className={rowCls}>
                <span>他的声音</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span data-testid={`${testPrefix}-voice-summary`} className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40">
                    {voiceSummary || '默认'}
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
                </span>
              </button>
            </div>
          </>
        )}

        {/* 拉黑：双向拉黑开关（40-a 重构后真实拦截：byUser=true → AI 静默不发普通消息、仅可发申请卡回应；
            byChar=true → 用户所有发送入口被拦 toast。开关只控制 byUser；对方拉黑时 byChar 由 AI 决策） */}
        {onToggleBlock && (
          <>
            <div className={`${cardCls} mt-3 overflow-hidden`}>
              <div className={`flex items-center justify-between ${rowCls}`}>
                <span>拉黑</span>
                <ChatToggle
                  on={blockedByUser === true}
                  onChange={onToggleBlock}
                  accent={accent}
                  testId={`${testPrefix}-settings-block`}
                  label="拉黑"
                />
              </div>
              {/* #39：被拒申请计数 > 0 且提供回调时显示重置入口——角色被拒 3 次后彻底沉默，给用户恢复通道入口 */}
              {onResetBlockReqCount && blockReqCount && blockReqCount > 0 ? (
                <>
                  <div className={`h-px ${dividerCls}`} />
                  <button
                    type="button"
                    onClick={onResetBlockReqCount}
                    className={`flex w-full items-center justify-between ${rowCls}`}
                    data-testid={`${testPrefix}-settings-reset-block-req`}
                    aria-label="重置申请计数"
                  >
                    <span className="flex flex-col gap-0.5 text-left">
                      <span>重置申请计数</span>
                      <span className="text-[12px] text-black/40 dark:text-white/40">
                        {blockReqCount >= 3 ? '对方已被拒达到上限，彻底沉默' : `对方已申请被拒 ${blockReqCount} 次`}
                      </span>
                    </span>
                    <span className="text-[14px]" style={{ color: accent }}>点击重置</span>
                  </button>
                </>
              ) : null}
            </div>
          </>
        )}

        {/* 删除联系人（微信/QQ 单聊；删除好友关系而非删联系人本体）：二次确认弹窗由宿主层渲染 */}
        {onDeleteContact && (
          <div className={`${cardCls} mt-3 overflow-hidden`}>
            <button
              type="button"
              data-testid={`${testPrefix}-settings-delete-contact`}
              onClick={onDeleteContact}
              className="flex w-full items-center justify-center px-4 py-3 text-[16px] text-red-500 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              删除联系人
            </button>
          </div>
        )}

        {/* 备注编辑弹窗 */}
        {remarkOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setRemarkOpen(false)}>
            <div className={`w-full max-w-[300px] ${cardCls} p-5`} onClick={(e) => e.stopPropagation()}>
              <p className="text-[16px] font-medium">备注</p>
              <input
                value={remarkDraft}
                onChange={(e) => setRemarkDraft(e.target.value)}
                placeholder={`给${peerName}添加备注`}
                maxLength={30}
                data-testid={`${testPrefix}-remark-input`}
                className="mt-3 h-10 w-full rounded-[8px] bg-black/[0.05] px-3 text-[14px] outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/10 dark:bg-white/10 dark:placeholder:text-white/30 dark:focus:ring-white/15"
              />
              <p className="mt-2 text-[12px] leading-relaxed text-black/40 dark:text-white/40">备注仅自己可见，保存后聊天界面和消息列表优先显示备注名；清空并保存即可恢复原名。</p>
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setRemarkOpen(false)}
                  className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid={`${testPrefix}-remark-save`}
                  onClick={() => {
                    onSaveRemark(remarkDraft.trim());
                    setRemarkOpen(false);
                  }}
                  className="h-10 flex-1 rounded-[8px] text-[14px] font-medium text-white active:opacity-80"
                  style={{ backgroundColor: accent }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 关系编辑弹窗（多账号关系感知） */}
        {relationOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setRelationOpen(false)}>
            <div className={`w-full max-w-[300px] ${cardCls} p-5`} onClick={(e) => e.stopPropagation()}>
              <p className="text-[16px] font-medium">关系</p>
              <input
                value={relationDraft}
                onChange={(e) => setRelationDraft(e.target.value)}
                placeholder={`你和${peerName}是什么关系（如：朋友 / 同事 / 恋人）`}
                maxLength={30}
                data-testid={`${testPrefix}-relation-input`}
                className="mt-3 h-10 w-full rounded-[8px] bg-black/[0.05] px-3 text-[14px] outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/10 dark:bg-white/10 dark:placeholder:text-white/30 dark:focus:ring-white/15"
              />
              <p className="mt-2 text-[12px] leading-relaxed text-black/40 dark:text-white/40">这里保存的是「当前账号」和 TA 的关系，决定 AI 怎么称呼、对待你；每个账号互相独立、互不影响。清空保存可恢复默认。</p>
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setRelationOpen(false)}
                  className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid={`${testPrefix}-relation-save`}
                  onClick={() => {
                    onSaveRelation?.(relationDraft.trim());
                    setRelationOpen(false);
                  }}
                  className="h-10 flex-1 rounded-[8px] text-[14px] font-medium text-white active:opacity-80"
                  style={{ backgroundColor: accent }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 删除联系人二次确认弹窗（微信/QQ 共用，variant 区分主题）：
 *  明确告知「会删除什么（好友关系）」与「会保留什么（聊天记录/记忆/朋友圈动态与互动/通话记录，
 *  不可见但保留；重新加回好友后恢复可见）」；确认后回调 onConfirm（宿主执行 removeFriendByUser） */
export function FriendDeleteConfirmDialog({
  variant,
  peerName,
  onCancel,
  onConfirm,
}: {
  variant: ChatSettingsVariant;
  peerName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const wx = variant === 'wx';
  const cardCls = wx ? 'chat-set-card rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'chat-set-card rounded-[14px] bg-white dark:bg-[#232529]';
  const appLabel = wx ? '微信' : 'QQ';
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-8" data-testid={`${variant}-delete-contact-dialog`} onClick={onCancel}>
      <div className={`w-full max-w-[320px] ${cardCls} p-5`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`删除联系人${peerName}`}>
        <p className="text-[16px] font-medium">删除联系人</p>
        <p className="mt-2.5 text-[13.5px] leading-[1.7] text-black/70 dark:text-white/70">
          将删除与「{peerName}」的好友关系：TA 将从你的{appLabel}好友列表中移除，聊天界面关闭。
        </p>
        <p className="mt-2 text-[13.5px] leading-[1.7] text-black/70 dark:text-white/70">
          以下数据会保留（删除后不可见）：
          <br />· 聊天记录
          <br />· 记忆
          <br />· 朋友圈动态与互动
          <br />· 通话记录
        </p>
        <p className="mt-2 text-[13.5px] leading-[1.7] text-black/70 dark:text-white/70">重新加回好友后，这些数据将恢复可见。对方可能会申请重新加你为好友。</p>
        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            data-testid={`${variant}-delete-contact-cancel`}
            className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid={`${variant}-delete-contact-confirm`}
            className="h-10 flex-1 rounded-[8px] bg-red-500 text-[14px] font-medium text-white active:opacity-80"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

/** 回复条数选择页（聊天设置二级页）：AI 像真人一样按选定条数连发多条消息。
 *  groupMode = 群聊语义（#34）：群引擎对单成员每轮硬上限 5 条（群页 Math.min(N,5)，
 *  buildReplyCountPrompt groupMode 同口径），高档位就地加注 + 页脚说明，展示不再与实际不符；
 *  单聊不传该参，行为与旧版完全一致（向后兼容）。 */

export function ChatReplyCountPage({
  variant,
  value,
  onBack,
  onSelect,
  groupMode = false,
}: {
  variant: ChatSettingsVariant;
  /** 当前会话的回复条数 */
  value: number;
  onBack: () => void;
  onSelect: (n: number) => void;
  /** 群聊语义：高档位按每轮 5 条生效（群聊中每位成员每轮最多 5 条） */
  groupMode?: boolean;
}) {
  const wx = variant === 'wx';

  // 主题 token（与 ChatSettingsPage 一致）
  const skin = useChatSkin();
  const pageCls = skin.retro ? 'chat-set-page rt-root text-black dark:text-white' : skin.liquid ? 'chat-set-page lg-root text-black dark:text-white' : wx ? 'chat-set-page bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'chat-set-page bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  /* chat-set-card：聊天设置页卡片锚点（自定义 CSS 示例模板可改卡底） */
  const cardCls = skin.retro ? 'chat-set-card rounded-[6px] bg-white dark:bg-[#1A1A1A]' : wx ? 'chat-set-card rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'chat-set-card rounded-[14px] bg-white dark:bg-[#232529]';
  const barCls = skin.retro ? 'rt-bar' : '';
  const dividerCls = wx ? 'border-black/5 dark:border-white/10' : 'border-black/[0.04] dark:border-white/[0.06]';
  /* chat-set-row：设置行锚点 */
  const rowCls = wx
    ? 'chat-set-row flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
    : 'chat-set-row flex w-full items-center justify-between px-4 min-h-[54px] text-left text-[15.5px] active:bg-black/[0.03] dark:active:bg-white/[0.05]';
  // 选中勾色：微信绿 / 信息 iOS 绿 / QQ 蓝
  const accent = wx ? '#07C160' : variant === 'sms' ? '#34C759' : '#0099FF';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;

  return (
    <div
      className={`absolute inset-0 z-50 flex h-full w-full flex-col ${pageCls}`}
      data-chat-set-app={variant}
    >
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-reply-count-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>回复条数</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        <div className={`${cardCls} overflow-hidden`}>
          {REPLY_COUNT_OPTIONS.map((n, i) => (
            <div key={n}>
              {i > 0 && <div className={`border-t ${dividerCls}`} />}
              <button
                type="button"
                data-testid={`${testPrefix}-reply-count-option-${n}`}
                aria-label={`回复条数 ${n} 条`}
                onClick={() => onSelect(n)}
                className={rowCls}
              >
                <span>
                  {n} 条
                  {/* #34 群聊语义：引擎单成员每轮上限 5 条（群页 runCharTurn 的 Math.min(N,5)），高档位就地加注 */}
                  {groupMode && n > 5 && (
                    <span className="ml-1 text-[12px] text-black/35 dark:text-white/35">群聊按 5 条生效</span>
                  )}
                </span>
                {value === n && (
                  <span className="grid place-items-center" style={{ color: accent }} aria-label="已选中">
                    <Check className="h-5 w-5" strokeWidth={2.4} />
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
        <p className="px-1 pt-3 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
          {groupMode
            ? '群聊中每位成员每轮最多发 5 条（给其他成员留出发言空间，避免一个人刷屏）：选择更高档位时也按每轮 5 条生效；换一个群需要单独设置。'
            : '对方将按选定条数像真人一样连续发送多条消息，每条独立一个气泡；换一个聊天对象需要单独设置。'}
        </p>
      </div>
    </div>
  );
}

/** 聊天背景页（聊天设置二级页）：顶部预览卡片 → 从手机相册上传 → 内置纯色壁纸 */

export function ChatBgPage({
  variant,
  bg,
  bgImageUrl,
  uploading,
  onBack,
  onPickColor,
  onPickImageFile,
  onResetBg,
}: {
  variant: ChatSettingsVariant;
  bg: ChatSettingsBg;
  /** mode === 'image' 时已加载的图片 data URL（未加载完为 null） */
  bgImageUrl: string | null;
  uploading: boolean;
  onBack: () => void;
  onPickColor: (color: string) => void;
  onPickImageFile: (file: File) => void;
  onResetBg: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const wx = variant === 'wx';

  // 主题 token（与 ChatSettingsPage 一致）
  const skin = useChatSkin();
  const pageCls = skin.retro ? 'chat-set-page rt-root text-black dark:text-white' : skin.liquid ? 'chat-set-page lg-root text-black dark:text-white' : wx ? 'chat-set-page bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'chat-set-page bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  /* chat-set-card：聊天设置页卡片锚点（自定义 CSS 示例模板可改卡底） */
  const cardCls = skin.retro ? 'chat-set-card rounded-[6px] bg-white dark:bg-[#1A1A1A]' : wx ? 'chat-set-card rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'chat-set-card rounded-[14px] bg-white dark:bg-[#232529]';
  const barCls = skin.retro ? 'rt-bar' : '';
  // 选中/勾色：微信绿 / QQ 蓝
  const accent = wx ? '#07C160' : '#0099FF';
  const defaultBg = wx ? WX_CHAT_BG_DEFAULT : QQ_CHAT_BG_DEFAULT;
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;

  // 「默认」色块当前选中 = 背景为默认模式
  const isDefault = bg.mode === 'default';

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${pageCls}`}>
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-bg-page-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>聊天背景</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        <div className={`${cardCls} overflow-hidden p-4`}>
          {/* 预览卡片（9:16 竖版，模拟聊天效果，即时反映当前选择） */}
          <div
            data-testid={`${testPrefix}-bg-preview`}
            className="relative mx-auto w-full max-w-[248px] overflow-hidden rounded-[14px] border border-black/10 shadow-[0_2px_12px_rgba(0,0,0,0.08)] dark:border-white/10"
            style={{ aspectRatio: '9 / 16' }}
          >
            <div className="absolute inset-0" style={chatBgLayerStyle(bg, bgImageUrl) ?? { backgroundColor: defaultBg }} />
            <div className={`relative flex h-full flex-col p-3 text-[11px] leading-[1.5] ${wx ? 'text-black' : 'text-[#1F2329]'}`}>
              <p className="text-center text-[9px] text-black/35 dark:text-white/40">昨天 20:15</p>
              <div className="mt-2 max-w-[78%] self-start rounded-[7px] bg-white/95 px-2 py-1.5 shadow-sm dark:bg-[#2A2C31]/95 dark:text-white">
                在吗？
              </div>
              <div
                className="mt-2 max-w-[78%] self-end rounded-[7px] px-2 py-1.5 text-black shadow-sm"
                style={{ backgroundColor: wx ? '#95EC69' : '#0099FF', color: wx ? '#000' : '#fff' }}
              >
                刚看到消息啦～
              </div>
              <div className="mt-2 max-w-[78%] self-start rounded-[7px] bg-white/95 px-2 py-1.5 shadow-sm dark:bg-[#2A2C31]/95 dark:text-white">
                周末一起出去玩吗？
              </div>
              <div
                className="mt-auto max-w-[78%] self-end rounded-[7px] px-2 py-1.5 text-black shadow-sm"
                style={{ backgroundColor: wx ? '#95EC69' : '#0099FF', color: wx ? '#000' : '#fff' }}
              >
                好呀好呀 😄
              </div>
            </div>
            {bg.mode === 'image' && !bgImageUrl && (
              <div className="absolute inset-0 grid place-items-center bg-black/25">
                <Loader2 className="h-5 w-5 animate-spin text-white" aria-label="背景加载中" />
              </div>
            )}
          </div>

          {/* 从手机相册上传 */}
          <button
            type="button"
            data-testid={`${testPrefix}-bg-upload`}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-[10px] border border-black/10 py-2.5 text-[15px] active:bg-black/[0.04] disabled:opacity-60 dark:border-white/15 dark:active:bg-white/[0.06] ${
              wx ? '' : 'text-[14.5px]'
            }`}
          >
            {uploading ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
            ) : (
              <ImageIcon className="h-[18px] w-[18px] text-black/55 dark:text-white/55" strokeWidth={1.9} aria-hidden="true" />
            )}
            {uploading ? '正在处理图片…' : '从手机相册上传'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            data-testid={`${testPrefix}-bg-input`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onPickImageFile(f);
            }}
          />

          {/* 内置纯色壁纸 */}
          <p className="pb-2.5 pt-4 text-[13px] text-black/40 dark:text-white/40">内置纯色壁纸</p>
          <div className="grid grid-cols-5 gap-3">
            {/* 默认壁纸 */}
            <button
              type="button"
              aria-label="恢复默认背景"
              data-testid={`${testPrefix}-bg-default`}
              onClick={onResetBg}
              className="relative h-14 overflow-hidden rounded-[10px] border border-black/10 active:opacity-70 dark:border-white/15"
              style={{ backgroundColor: defaultBg }}
            >
              {isDefault && (
                <span className="absolute inset-0 grid place-items-center" style={{ color: accent }}>
                  <Check className="h-5 w-5" strokeWidth={2.4} />
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/25 py-[2px] text-center text-[10px] leading-none text-white">
                默认
              </span>
            </button>
            {CHAT_BG_SOLID_COLORS.map((c) => {
              const selected = bg.mode === 'color' && bg.color.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`壁纸 ${c}`}
                  data-testid={`${testPrefix}-bg-color-${c.slice(1)}`}
                  onClick={() => onPickColor(c)}
                  className="relative h-14 overflow-hidden rounded-[10px] border border-black/10 active:opacity-70 dark:border-white/10"
                  style={{ backgroundColor: c }}
                >
                  {selected && (
                    <span className="absolute inset-0 grid place-items-center text-black/55">
                      <Check className="h-5 w-5" strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 设置页头像（微信圆角方 / QQ、信息圆形，首字母兜底同各 App 风格） */
function ChatSettingsAvatar({ variant, src, alt, size }: { variant: ChatSettingsVariant; src: string | null; alt: string; size: number }) {
  const wx = variant === 'wx';
  const style: CSSProperties = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={`shrink-0 bg-muted object-cover ${wx ? 'rounded-[7px]' : 'rounded-full'}`}
        style={style}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-semibold text-white ${
        wx ? 'rounded-[7px] bg-[#C9C9CE] dark:bg-[#3C3C42]' : variant === 'sms' ? 'rounded-full bg-[#C7C7CC] dark:bg-[#3A3A3C]' : 'rounded-full bg-[#B9D9F3]'
      }`}
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
    >
      {alt.slice(0, 1) || (wx ? '' : 'Q')}
    </div>
  );
}

/** 查找聊天记录页 */

export interface ChatSearchItem {
  id: string;
  role: 'me' | 'peer';
  text: string;
  time: number;
}

function fmtSearchTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function ChatSearchPage({
  variant,
  items,
  myName,
  peerName,
  myAvatar,
  peerAvatar,
  onClose,
  onJumpTo,
}: {
  variant: ChatSettingsVariant;
  /** 可搜索的聊天记录（调用方已把各类消息规整成文本摘要） */
  items: ChatSearchItem[];
  myName: string;
  peerName: string;
  myAvatar: string | null;
  peerAvatar: string | null;
  onClose: () => void;
  onJumpTo: (id: string) => void;
}) {
  const [kw, setKw] = useState('');
  const wx = variant === 'wx';

  const skin = useChatSkin();
  const pageCls = skin.retro ? 'chat-set-page rt-root text-black dark:text-white' : skin.liquid ? 'chat-set-page lg-root text-black dark:text-white' : wx ? 'chat-set-page bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'chat-set-page bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  /* chat-set-card：聊天设置页卡片锚点（自定义 CSS 示例模板可改卡底） */
  const cardCls = skin.retro ? 'chat-set-card rounded-[6px] bg-white dark:bg-[#1A1A1A]' : wx ? 'chat-set-card rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'chat-set-card rounded-[14px] bg-white dark:bg-[#232529]';
  const barCls = skin.retro ? 'rt-bar' : '';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;

  const results = useMemo(() => {
    const key = kw.trim().toLowerCase();
    if (!key) return null;
    return items.filter((it) => it.text.toLowerCase().includes(key));
  }, [items, kw]);

  /** 命中片段高亮：按关键词切片 */
  const renderSnippet = (text: string, key: string) => {
    const lower = text.toLowerCase();
    const k = key.toLowerCase();
    const parts: Array<{ t: string; hit: boolean }> = [];
    let i = 0;
    while (true) {
      const idx = lower.indexOf(k, i);
      if (idx < 0) {
        parts.push({ t: text.slice(i), hit: false });
        break;
      }
      if (idx > i) parts.push({ t: text.slice(i, idx), hit: false });
      parts.push({ t: text.slice(idx, idx + k.length), hit: true });
      i = idx + k.length;
    }
    return parts.map((p, n) =>
      p.hit ? (
        <span key={n} className="rounded-[2px] bg-[#F7E36D]/70 text-black dark:bg-[#8A7A2E]/70 dark:text-white">
          {p.t}
        </span>
      ) : (
        <span key={n}>{p.t}</span>
      )
    );
  };

  const key = kw.trim();

  return (
    <div className={`absolute inset-0 z-40 flex h-full w-full flex-col ${pageCls}`}>
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-chat-search-back`}
            onClick={onClose}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>查找聊天记录</div>
        </div>
        {/* 搜索框 */}
        <div className={`flex items-center gap-2 px-4 pb-2.5 ${wx ? 'pt-1' : 'pt-1.5'}`}>
          {/* 古早 = 白底内凹硬边搜索框（rt-search）；液态/默认 = 原生灰胶囊 */}
          <div
            className={`flex h-[34px] flex-1 items-center gap-2 px-2.5 ${
              skin.retro ? 'rt-search' : 'rounded-[9px] bg-black/[0.05] dark:bg-white/[0.08]'
            }`}
          >
            <Search className="h-[15px] w-[15px] shrink-0 text-black/35 dark:text-white/35" strokeWidth={2.2} aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索聊天内容"
              data-testid={`${testPrefix}-chat-search-input`}
              aria-label="搜索聊天内容"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
            {kw && (
              <button type="button" aria-label="清空" onClick={() => setKw('')} className="shrink-0 active:opacity-60">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-black/25 text-[10px] leading-none text-white dark:bg-white/30">
                  ×
                </span>
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className={`shrink-0 text-[15px] active:opacity-60 ${wx ? '' : 'text-[15px]'}`}>
            取消
          </button>
        </div>
      </div>

      {/* 结果 */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {results === null ? (
          <div className="mt-16 text-center">
            <Search className="mx-auto h-10 w-10 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-3 text-[14px] text-black/35 dark:text-white/35">输入关键词查找聊天记录</p>
          </div>
        ) : results.length === 0 ? (
          <p className="mt-16 text-center text-[14px] text-black/35 dark:text-white/35">没有找到与「{key}」相关的聊天记录</p>
        ) : (
          <>
            <p className="px-1 pb-2 pt-1 text-[12.5px] text-black/40 dark:text-white/40">
              共 {results.length} 条与「{key}」相关的记录，点击可定位
            </p>
            <div className={`${cardCls} overflow-hidden`}>
              {results.map((it, n) => (
                <button
                  key={it.id}
                  type="button"
                  data-testid={`${testPrefix}-chat-search-item-${n}`}
                  onClick={() => onJumpTo(it.id)}
                  className={`flex w-full items-start gap-2.5 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                    n > 0 ? (wx ? 'border-t border-black/5 dark:border-white/10' : 'border-t border-black/[0.04] dark:border-white/[0.06]') : ''
                  }`}
                >
                  <ChatSettingsAvatar variant={variant} src={it.role === 'me' ? myAvatar : peerAvatar} alt={it.role === 'me' ? myName : peerName} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[14.5px]">{it.role === 'me' ? myName : peerName}</span>
                      <span className="shrink-0 text-[11.5px] text-black/35 dark:text-white/35">{fmtSearchTime(it.time)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block break-all text-[13.5px] leading-[1.45] text-black/60 dark:text-white/60">
                      {renderSnippet(it.text, key)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 翻译语言页（三端共用二级页） ----------------

/** 翻译页主题 token（微信灰白 / QQ 冷灰白 / 信息 iOS 风） */
function translateTokens(variant: ChatSettingsVariant) {
  const wx = variant === 'wx';
  const sms = variant === 'sms';
  return {
    wx,
    sms,
    pageCls: sms
      ? 'bg-background text-foreground'
      : wx
        ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white'
        : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white',
    cardCls: sms
      ? 'chat-set-card overflow-hidden rounded-[14px] bg-black/[0.045] dark:bg-white/[0.08]'
      : wx
        ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]'
        : 'rounded-[14px] bg-white dark:bg-[#232529]',
    dividerCls: sms
      ? 'border-border/60'
      : wx
        ? 'border-black/5 dark:border-white/10'
        : 'border-black/[0.04] dark:border-white/[0.06]',
    rowCls: sms
      ? 'chat-set-row flex w-full items-center justify-between px-4 py-3 text-left text-[15.5px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
      : wx
        ? 'flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
        : 'flex w-full items-center justify-between px-4 min-h-[54px] text-left text-[15.5px] active:bg-black/[0.03] dark:active:bg-white/[0.05]',
    accent: sms ? '#007AFF' : wx ? '#07C160' : '#0099FF',
    titleCls: wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold',
    headerH: wx ? 'h-11' : 'h-12',
    captionCls: sms
      ? 'px-1 pt-2.5 text-[12.5px] leading-[1.6] text-muted-foreground'
      : 'px-1 pt-2.5 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40',
  };
}

/**
 * 翻译语言页（聊天设置二级页，微信 / QQ / 信息三端共用，参考 iOS 翻译语言页）：
 * 总开关 + 语言对选择 —— 上方左右两个语言槽都可点选（点一侧设为待选侧，再在下方列表中
 * 选择该侧语言），中间 ⇄ 一键互换两侧语言；下方「常用语言 / 更多语言」分组列表，
 * 两侧已占用的语言灰显。聊天中按消息语言双向翻译：左侧语言的消息译成右侧，反之亦然
 * （如「中文简体 ⇄ 英语」：中文消息显示英文译文，英文消息显示中文译文）。
 */
export function ChatTranslatePage({
  variant,
  cfg,
  onBack,
  onChange,
}: {
  variant: ChatSettingsVariant;
  /** 当前会话的翻译配置（on + 语言对） */
  cfg: ChatTranslateCfg;
  onBack: () => void;
  /** 开关 / 选语言 / 互换 都统一回传新配置，由调用方持久化（按会话隔离） */
  onChange: (next: ChatTranslateCfg) => void;
}) {
  // 第五十六轮：古早/液态皮肤（信息 App 无主题，永远默认）——古早 = 复古纸底 + 6px 方角白卡 + 银灰导航条；
  // 液态 = 液态根渐变（卡片玻璃由 scoped CSS 接管 .bg-white）；默认 = 原生
  const skin = useChatSkin();
  const tBase = translateTokens(variant);
  const t = skin.retro
    ? { ...tBase, pageCls: 'rt-root text-black dark:text-white', cardCls: 'rounded-[6px] bg-white dark:bg-[#1A1A1A]' }
    : skin.liquid
      ? { ...tBase, pageCls: 'lg-root text-black dark:text-white' }
      : tBase;
  const barCls = skin.retro ? 'rt-bar' : '';
  const testPrefix = variant;
  // 当前待设置的一侧（点上方一侧切换；默认左侧）
  const [side, setSide] = useState<'left' | 'right'>('left');

  /** 列表点选：把语言设到待选侧；选到另一侧正在用的语言时直接互换两侧（不会出现两侧同语言） */
  const pick = (code: string) => {
    const other = side === 'left' ? cfg.right : cfg.left;
    if (code === other) {
      onChange({ ...cfg, left: cfg.right, right: cfg.left });
      return;
    }
    onChange(side === 'left' ? { ...cfg, left: code } : { ...cfg, right: code });
  };

  /** 语言槽（左右各一）：待选侧加浅色胶囊底，点击切换待选侧 */
  const renderSlot = (sideKey: 'left' | 'right', code: string) => {
    const active = side === sideKey;
    return (
      <button
        type="button"
        data-testid={`${testPrefix}-translate-side-${sideKey}`}
        aria-label={`选择${sideKey === 'left' ? '左' : '右'}侧语言，当前 ${translateLangLabel(code)}`}
        onClick={() => setSide(sideKey)}
        className={`max-w-[38%] truncate rounded-[12px] px-3.5 py-1.5 text-[20px] font-semibold transition-colors ${
          active ? 'bg-black/[0.06] dark:bg-white/[0.12]' : 'active:bg-black/[0.04] dark:active:bg-white/[0.06]'
        }`}
      >
        {translateLangLabel(code)}
      </button>
    );
  };

  /** 分组语言列表：两侧已占用的语言灰显；✓ 标记待选侧当前语言 */
  const renderGroup = (langs: readonly TranslateLang[], groupLabel: string) => (
    <>
      <p className="px-1 pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">{groupLabel}</p>
      <div className={`${t.cardCls} overflow-hidden`}>
        {langs.map((l, i) => {
          const activeLang = (side === 'left' ? cfg.left : cfg.right) === l.code;
          const used = cfg.left === l.code || cfg.right === l.code;
          return (
            <div key={l.code}>
              {i > 0 && <div className={`border-t ${t.dividerCls}`} />}
              <button
                type="button"
                data-testid={`${testPrefix}-translate-lang-${l.code}`}
                aria-label={`把${side === 'left' ? '左' : '右'}侧语言设为${l.label}`}
                onClick={() => pick(l.code)}
                className={t.rowCls}
              >
                <span className={used ? 'text-black/35 dark:text-white/35' : ''}>{l.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {activeLang && (
                    <span className="grid place-items-center" style={{ color: t.accent }} aria-label="当前语言">
                      <Check className="h-5 w-5" strokeWidth={2.4} />
                    </span>
                  )}
                  <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}>
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${t.headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-translate-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${t.wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={t.wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>翻译语言</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 总开关 */}
        <div className={`${t.cardCls}`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>翻译</span>
            <ChatToggle
              on={cfg.on}
              onChange={(v) => onChange({ ...cfg, on: v })}
              accent={t.accent}
              testId={`${testPrefix}-translate-switch`}
              label="翻译"
            />
          </div>
        </div>
        <p className={t.captionCls}>开启后，消息会按语言双向翻译：左侧语言的消息译成右侧，右侧语言的消息译成左侧，译文显示在气泡下方。</p>

        {/* 语言对选择器：左右两个语言槽 + 中间互换按钮 */}
        <div className="flex items-center justify-center gap-2 pb-1 pt-4">
          {renderSlot('left', cfg.left)}
          <button
            type="button"
            data-testid={`${testPrefix}-translate-swap`}
            aria-label="互换两侧语言"
            onClick={() => onChange({ ...cfg, left: cfg.right, right: cfg.left })}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-black/55 active:bg-black/[0.05] dark:text-white/55 dark:active:bg-white/[0.08]"
          >
            <ArrowLeftRight className="h-[19px] w-[19px]" strokeWidth={2} aria-hidden="true" />
          </button>
          {renderSlot('right', cfg.right)}
        </div>
        <p className="px-1 pb-1 pt-1 text-center text-[13.5px] text-black/40 dark:text-white/40">
          点击上方一侧，再在下方列表中选择该侧语言
        </p>

        {/* 语言列表：常用语言 / 更多语言 */}
        {renderGroup(COMMON_TRANSLATE_LANGS, '常用语言')}
        {renderGroup(MORE_TRANSLATE_LANGS, '更多语言')}

        <p className={t.captionCls}>换一个聊天对象需要单独设置。</p>
      </div>
    </div>
  );
}

// ---------------- 信息 App 聊天设置页（iOS 风格） ----------------

/**
 * 信息 App 的聊天设置页（聊天页顶栏摄像机图标进入）：
 * 对方信息卡片 + 翻译入口（ChatTranslatePage，variant=sms）+ 回复条数入口
 * （ChatReplyCountPage，variant=sms，信息端每会话独立）+ 分句发送开关。
 */
export function SmsChatSettingsPage({
  peerName,
  peerAvatar,
  phone,
  remark,
  translateSummary,
  replyCount,
  sentenceSend,
  timeAware,
  worldBooksSummary,
  /** 主题入口行摘要（当前界面主题 + 气泡样式；宿主从 bubbleStyle.sms 计算） */
  themeSummary,
  onBack,
  onSaveRemark,
  /** 与角色的关系（当前账号视角，多账号关系感知）；不传 = 隐藏该行 */
  relation,
  /** 保存关系（当前账号作用域；宿主调 setAppRelation）；不传 = 隐藏该行 */
  onSaveRelation,
  onOpenTranslate,
  onOpenReplyCount,
  onToggleSentenceSend,
  onToggleTimeAware,
  /** 「回车键发送消息」开关状态（信息 App 级、按账号隔离；默认开启=回车发送） */
  enterSend,
  /** 回车键发送开关切换（宿主调 setEnterSend('sms', v) 持久化+即时广播） */
  onToggleEnterSend,
  actionDescOn,
  onToggleActionDesc,
  /** 深度思考开关状态（开启后气泡上方显示思维链卡片；按联系人隔离，见 @/lib/deep-think） */
  deepThinkOn,
  /** 深度思考开关切换（宿主调 setDeepThinkOn 持久化到 IndexedDB，按联系人隔离） */
  onToggleDeepThink,
  onOpenWorldBooks,
  blockedByUser,
  blockReqCount,
  onToggleBlock,
  onResetBlockReqCount,
  /** 他的声音摘要（角色音色展示名；空 = 默认）；不传 onOpenVoice = 隐藏该入口 */
  voiceSummary,
  onOpenVoice,
  /** 打开「主动发消息」设置页；不传 = 隐藏该入口行 */
  onOpenProactive,
  /** 主动发消息入口行摘要（宿主用 proactiveCfgSummary 计算） */
  proactiveSummary,
  /** 打开主题界面（毛玻璃胶囊：主题/气泡两个选择）；不传 = 隐藏该入口行 */
  onOpenTheme,
}: {
  peerName: string;
  peerAvatar: string | null;
  /** 信息卡第二行：手机号（可为空） */
  phone: string;
  /** 备注名（仅机主自己可见；空 = 未设置） */
  remark: string;
  translateSummary: string;
  /** 当前会话的回复条数（信息端每会话独立；未设置时宿主传默认 5） */
  replyCount: number;
  sentenceSend: boolean;
  /** 时间感知开关状态（开启后 AI 感知当前时间/节日/事件时长/上次聊天间隔） */
  timeAware: boolean;
  /** 动作描写开关状态（开启后 AI 回复里的动作描写以灰色小字居中显示，关闭后自动过滤，见 @/lib/action-desc） */
  actionDescOn: boolean;
  /** 深度思考开关状态（开启后气泡上方显示可展开的思维链卡片；思考指令始终注入，开关只控制展示） */
  deepThinkOn: boolean;
  /** 挂载的世界书摘要（未挂载时「未选择」） */
  worldBooksSummary: string;
  /** 主题入口行摘要（当前界面主题 + 气泡样式；不传/空 = 显示「默认」） */
  themeSummary?: string;
  onBack: () => void;
  /** 保存备注（空串 = 清除备注；宿主负责持久化并刷新展示名） */
  onSaveRemark: (v: string) => void;
  /** 与角色的关系（当前账号视角；多账号关系感知）；不传 = 隐藏该行（AI 助手会话） */
  relation?: string | null;
  /** 保存关系（当前账号作用域，宿主调 setAppRelation）；不传 = 隐藏该行 */
  onSaveRelation?: (v: string) => void;
  onOpenTranslate: () => void;
  /** 打开主题界面（毛玻璃胶囊：主题/气泡两个选择）；不传 = 隐藏入口行 */
  onOpenTheme?: () => void;
  /** 打开回复条数选择页（ChatReplyCountPage，variant=sms；信息端每会话独立） */
  onOpenReplyCount: () => void;
  onToggleSentenceSend: (v: boolean) => void;
  onToggleTimeAware: (v: boolean) => void;
  /** 「回车键发送消息」开关状态（信息 App 级、按账号隔离；开启=回车/移动端「发送」键直接发送；关闭=回车换行） */
  enterSend: boolean;
  /** 回车键发送开关切换（即时生效，无需重启） */
  onToggleEnterSend: (v: boolean) => void;
  /** 动作描写开关切换（宿主负责持久化，见 @/lib/action-desc） */
  onToggleActionDesc: (v: boolean) => void;
  /** 深度思考开关切换（宿主调 setDeepThinkOn(contactId, v)，IndexedDB 按联系人隔离）；不传 = 隐藏开关行（AI 助手会话） */
  onToggleDeepThink?: (v: boolean) => void;
  /** 打开世界书挂载页；AI 助手会话（无联系人角色）不传 → 隐藏该入口行 */
  onOpenWorldBooks?: () => void;
  /** 双向拉黑：当前是否已拉黑对方（不传 = 该会话不支持拉黑，隐藏开关） */
  blockedByUser?: boolean;
  /** #39：角色被拒申请计数（调用方从 BlockEntry.reqCount 传入；>0 且 onResetBlockReqCount 提供时显示重置入口） */
  blockReqCount?: number;
  /** 拉黑开关切换（宿主负责持久化 + 生成系统消息） */
  onToggleBlock?: (v: boolean) => void;
  /** #39：手动重置角色被拒申请计数回调（被拒 3 次后角色彻底沉默，给用户恢复通道入口） */
  onResetBlockReqCount?: () => void;
  /** 他的声音摘要（角色音色展示名；空 = 默认） */
  voiceSummary?: string;
  /** 打开「他的声音」页；不传 = 隐藏该入口行（AI 助手会话无角色音色） */
  onOpenVoice?: () => void;
  /** 打开「主动发消息」设置页（定时/事件/自主/提醒四类触发）；不传 = 隐藏该入口行 */
  onOpenProactive?: () => void;
  /** 主动发消息入口行摘要（宿主用 proactiveCfgSummary 计算；空 = 未开启） */
  proactiveSummary?: string;
}) {
  const t = translateTokens('sms');
  const skinSms = useChatSkin();
  const barCls = skinSms.retro ? 'rt-bar' : '';
  /** 备注编辑弹窗（本地草稿，保存时交回宿主持久化） */
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState('');
  /** 关系编辑弹窗（多账号关系感知：保存当前账号视角下的关系） */
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationDraft, setRelationDraft] = useState('');
  return (
    <div
      className={`chat-set-page absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}
      data-chat-set-app="sms"
    >
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className="relative flex h-12 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="sms-chat-settings-back"
            onClick={onBack}
            className="flex items-center rounded-full p-1 active:opacity-50"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">
            聊天设置
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {/* 对方信息卡片 */}
        <div className={`${t.cardCls}`}>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <ChatSettingsAvatar variant="sms" src={peerAvatar} alt={peerName} size={52} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold">{peerName}</p>
              {phone && (
                <p className="mt-0.5 truncate text-[13px] tabular-nums text-muted-foreground">{phone}</p>
              )}
            </div>
          </div>
        </div>

        {/* 备注行：仅机主自己可见的显示名 */}
        <div className={`${t.cardCls} mt-3`}>
          <button
            type="button"
            data-testid="sms-settings-remark"
            onClick={() => {
              setRemarkDraft(remark);
              setRemarkOpen(true);
            }}
            className={t.rowCls}
          >
            <span>备注</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span data-testid="sms-remark-value" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                {remark || '未设置'}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
            </span>
          </button>
          {/* 关系（多账号关系感知）：当前账号与这个角色的关系；每个账号独立 */}
          {typeof onSaveRelation === 'function' && (
            <button
              type="button"
              data-testid="sms-settings-relation"
              onClick={() => {
                setRelationDraft(relation ?? '');
                setRelationOpen(true);
              }}
              className={`${t.rowCls} border-t ${t.dividerCls}`}
            >
              <span>关系</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span data-testid="sms-relation-value" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                  {relation?.trim() || '未设置'}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
              </span>
            </button>
          )}
        </div>

        {/* 主题（界面顶部毛玻璃胶囊提供主题/气泡两个选择）；
            装扮对信息 App 全部气泡实时生效，且与微信/QQ 完全隔离 */}
        {onOpenTheme && (
          <div className={`${t.cardCls} mt-3`}>
            <button
              type="button"
              data-testid="sms-settings-theme"
              onClick={onOpenTheme}
              className={t.rowCls}
            >
              <span className="flex items-center gap-2.5">
                <Palette className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
                主题
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span data-testid="sms-theme-summary" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                  {themeSummary || '默认'}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
              </span>
            </button>
          </div>
        )}

        {/* 翻译入口 */}
        <div className={`${t.cardCls} mt-3`}>
          <button type="button" data-testid="sms-settings-translate" onClick={onOpenTranslate} className={t.rowCls}>
            <span>翻译</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span data-testid="sms-translate-summary" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                {translateSummary}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 回复条数：AI 按选定条数连发多条消息（独立二级页选择，信息端每会话独立） */}
        <div className={`${t.cardCls} mt-3`}>
          <button type="button" data-testid="sms-settings-reply-count" onClick={onOpenReplyCount} className={t.rowCls}>
            <span>回复条数</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span data-testid="sms-reply-count-value" className="max-w-[150px] truncate text-[14px] text-muted-foreground">{replyCount} 条</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
            </span>
          </button>
        </div>

        {/* 分句发送 */}
        <div className={`${t.cardCls} mt-3`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>分句发送</span>
            <ChatToggle
              on={sentenceSend}
              onChange={onToggleSentenceSend}
              accent="#34C759"
              testId="sms-settings-sentence"
              label="分句发送"
            />
          </div>
        </div>

        {/* 回车键发送消息：信息 App 级开关（按账号隔离）——
            开启=桌面回车/移动端键盘「发送」键直接发消息（与点「发送」按钮一致）；
            关闭=回车一律换行（多行内容正确显示），点「发送」按钮才发送；切换即时生效 */}
        <div className={`${t.cardCls} mt-3`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>回车键发送消息</span>
            <ChatToggle
              on={enterSend}
              onChange={onToggleEnterSend}
              accent="#34C759"
              testId="sms-settings-enter-send"
              label="回车键发送消息"
            />
          </div>
        </div>

        {/* 时间感知 */}
        <div className={`${t.cardCls} mt-3`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>时间感知</span>
            <ChatToggle
              on={timeAware}
              onChange={onToggleTimeAware}
              accent="#34C759"
              testId="sms-settings-time"
              label="时间感知"
            />
          </div>
        </div>

        {/* 主动发消息：每角色独立设置入口（独立二级页，每角色独立设置）；
            第三十四轮：「AI 主动消息」全局总开关删除 */}
        {onOpenProactive && (
          <div className={`${t.cardCls} mt-3`}>
            <button type="button" data-testid="sms-settings-proactive" onClick={onOpenProactive} className={t.rowCls}>
              <span className="flex items-center gap-2.5">
                <Zap className="h-[18px] w-[18px] text-black/60 dark:text-white/60" strokeWidth={1.9} aria-hidden="true" />
                主动发消息
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span data-testid="sms-proactive-summary" className="max-w-[150px] truncate text-[14px] text-black/40 dark:text-white/40">
                  {proactiveSummary || '未开启'}
                </span>
                <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
              </span>
            </button>
          </div>
        )}

        {/* 动作描写：AI 回复中动作/情景描写的显示开关（与微信/QQ 同套逻辑，按会话独立） */}
        <div className={`${t.cardCls} mt-3`}>
          <div className={`flex items-center justify-between ${t.rowCls}`}>
            <span>动作描写</span>
            <ChatToggle
              on={actionDescOn}
              onChange={onToggleActionDesc}
              accent="#34C759"
              testId="sms-settings-action-desc"
              label="动作描写"
            />
          </div>
        </div>

        {/* 深度思考：AI 回复前先深度思考，气泡上方可展开查看思考过程（指令始终注入，开关只控制展示；按联系人隔离持久化；AI 助手会话不提供） */}
        {onToggleDeepThink && (
          <div className={`${t.cardCls} mt-3`}>
            <div className={`flex items-center justify-between ${t.rowCls}`}>
              <span>深度思考</span>
              <ChatToggle
                on={deepThinkOn}
                onChange={onToggleDeepThink}
                accent="#34C759"
                testId="sms-settings-deep-think"
                label="深度思考"
              />
            </div>
          </div>
        )}
        {/* A2 开关说明小字：与微信/QQ 面板同文案（「关 ≠ 不思考」，仅隐藏展示），三端口径一致 */}
        {onToggleDeepThink && <p className={t.captionCls}>{deepThinkCaption(deepThinkOn)}</p>}

        {/* 世界书：为联系人挂载设定库（命中触发词的条目注入提示词，独立二级页选择）；AI 助手会话无此入口 */}
        {onOpenWorldBooks && (
          <>
            <div className={`${t.cardCls} mt-3`}>
              <button type="button" data-testid="sms-settings-worldbooks" onClick={onOpenWorldBooks} className={t.rowCls}>
                <span className="flex items-center gap-2.5">
                  <BookMarked className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
                  世界书
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span data-testid="sms-worldbooks-summary" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                    {worldBooksSummary}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
                </span>
              </button>
            </div>
          </>
        )}

        {/* 他的声音：角色说话音色（内置音色/我的音色）+ AI 语音发送频率（独立二级页） */}
        {onOpenVoice && (
          <>
            <div className={`${t.cardCls} mt-3`}>
              <button type="button" data-testid="sms-settings-voice" onClick={onOpenVoice} className={t.rowCls}>
                <span>他的声音</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span data-testid="sms-voice-summary" className="max-w-[150px] truncate text-[14px] text-muted-foreground">
                    {voiceSummary || '默认'}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} />
                </span>
              </button>
            </div>
          </>
        )}

        {/* 拉黑：双向拉黑开关（40-a 重构后真实拦截：byUser=true → AI 静默不发普通消息、仅可发申请卡回应；
            byChar=true → 用户所有发送入口被拦 toast。开关只控制 byUser；对方拉黑时 byChar 由 AI 决策） */}
        {onToggleBlock && (
          <>
            <div className={`${t.cardCls} mt-3`}>
              <div className={`flex items-center justify-between ${t.rowCls}`}>
                <span>拉黑</span>
                <ChatToggle
                  on={blockedByUser === true}
                  onChange={onToggleBlock}
                  accent="#34C759"
                  testId="sms-settings-block"
                  label="拉黑"
                />
              </div>
              {/* #39：被拒申请计数 > 0 且提供回调时显示重置入口——角色被拒 3 次后彻底沉默，给用户恢复通道入口 */}
              {onResetBlockReqCount && blockReqCount && blockReqCount > 0 ? (
                <>
                  <div className={t.dividerCls} />
                  <button
                    type="button"
                    onClick={onResetBlockReqCount}
                    className={`flex w-full items-center justify-between ${t.rowCls}`}
                    data-testid="sms-settings-reset-block-req"
                    aria-label="重置申请计数"
                  >
                    <span className="flex flex-col gap-0.5 text-left">
                      <span>重置申请计数</span>
                      <span className="text-[12px] text-black/40 dark:text-white/40">
                        {blockReqCount >= 3 ? '对方已被拒达到上限，彻底沉默' : `对方已申请被拒 ${blockReqCount} 次`}
                      </span>
                    </span>
                    <span className="text-[14px] text-[#34C759]">点击重置</span>
                  </button>
                </>
              ) : null}
            </div>
          </>
        )}

        {/* 备注编辑弹窗 */}
        {remarkOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setRemarkOpen(false)}>
            <div className={`w-full max-w-[300px] ${t.cardCls} p-5`} onClick={(e) => e.stopPropagation()}>
              <p className="text-[16px] font-semibold">备注</p>
              <input
                value={remarkDraft}
                onChange={(e) => setRemarkDraft(e.target.value)}
                placeholder={`给${peerName}添加备注`}
                maxLength={30}
                data-testid="sms-remark-input"
                className="mt-3 h-10 w-full rounded-[8px] bg-black/[0.05] px-3 text-[14px] outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/10 dark:bg-white/10 dark:placeholder:text-white/30"
              />
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">备注仅自己可见，保存后聊天界面和消息列表优先显示备注名；清空并保存即可恢复原名。</p>
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setRemarkOpen(false)}
                  className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid="sms-remark-save"
                  onClick={() => {
                    onSaveRemark(remarkDraft.trim());
                    setRemarkOpen(false);
                  }}
                  className="h-10 flex-1 rounded-[8px] bg-[#007AFF] text-[14px] font-medium text-white active:opacity-80"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 关系编辑弹窗（多账号关系感知） */}
        {relationOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setRelationOpen(false)}>
            <div className={`w-full max-w-[300px] ${t.cardCls} p-5`} onClick={(e) => e.stopPropagation()}>
              <p className="text-[16px] font-semibold">关系</p>
              <input
                value={relationDraft}
                onChange={(e) => setRelationDraft(e.target.value)}
                placeholder={`你和${peerName}是什么关系（如：朋友 / 同事 / 恋人）`}
                maxLength={30}
                data-testid="sms-relation-input"
                className="mt-3 h-10 w-full rounded-[8px] bg-black/[0.05] px-3 text-[14px] outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/10 dark:bg-white/10 dark:placeholder:text-white/30 dark:focus:ring-white/15"
              />
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">这里保存的是「当前账号」和 TA 的关系，决定 AI 怎么称呼、对待你；每个账号互相独立、互不影响。清空保存可恢复默认。</p>
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setRelationOpen(false)}
                  className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid="sms-relation-save"
                  onClick={() => {
                    onSaveRelation?.(relationDraft.trim());
                    setRelationOpen(false);
                  }}
                  className="h-10 flex-1 rounded-[8px] bg-[#007AFF] text-[14px] font-medium text-white active:opacity-80"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 世界书挂载页（三端共用二级页） ----------------

/**
 * 34-d：同步「探针」反查当前联系人 id。
 * 背景：本页由微信/QQ/信息三个调用方以纯 props 渲染（books/boundIds/onChange），组件内拿不到
 * 当前联系人 id；而「专属」书的绑定/解绑要写书本体 targetContactId，必须知道当前联系人。
 * 做法：把一个一次性探针 id 经 onChange 回传给调用方（调用方 setBoundBookIds → kvSet 同步落内存），
 * 随即同步扫描联系人名单，找出挂载列表刚被写入探针的那个联系人；finally 里无条件恢复原挂载列表。
 * 全程同步完成（idb-kv 内存写穿层保证同步可见），React 批处理下不产生中间渲染，探针绝不残留
 * （万一极端时序残留，也只是挂载列表里多一个不对应任何真实书的 id，注入与展示均无感，下次勾选自愈）。
 * 探针未命中（如未来调用方改为异步持久化）时，回退「挂载列表与 boundIds 完全一致且唯一」的反查；
 * 仍无法确定则返回 null（专属区块降级为只读展示，不影响上方局部书挂载）。
 */
function probeCurrentContactId(
  contacts: ReadonlyArray<Pick<ContactRecord, 'id'>>,
  boundIds: string[],
  onChange: (ids: string[]) => void,
): string | null {
  if (contacts.length === 0) return null;
  const probe = `__wb-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    onChange([probe]);
    const hit = contacts.find((c) => getBoundBookIds(c.id).includes(probe));
    if (hit) return hit.id;
  } catch {
    // 探针异常：落入下方反查兜底
  } finally {
    onChange([...new Set(boundIds)]); // 无条件恢复原挂载列表
  }
  const want = [...new Set(boundIds)];
  const sameSet = (ids: string[]) => ids.length === want.length && want.every((x) => ids.includes(x));
  const candidates = contacts.filter((c) => sameSet(getBoundBookIds(c.id)));
  return candidates.length === 1 ? candidates[0].id : null;
}

/**
 * 世界书挂载页（微信/QQ/信息聊天设置二级页）：为当前联系人勾选要挂载的世界书（可多选）。
 * 范围在书级：「局部」书挂载后命中关键词才注入（勾选即挂载/卸载，既有交互与 testid 不变）；
 * 「全局」书无需挂载、对所有对话常驻生效（不在此页展示）；「专属」书仅对绑定的角色生效——
 * 34-d 起本页新增「专属」区块：列出全部专属书（无论绑定的是谁），点行即绑定/解绑到当前联系人
 * （未绑定/绑定他人 → 绑定当前并覆盖；已绑定当前 → 解绑。写书本体 targetContactId，与世界书 App
 * 同一 loadBooks/saveBooks 通道，不新造存储；注入层发送时现场读取，改动立即生效）。
 * 书籍本体与条目仍在「世界书」App 里维护。
 */
export function WorldBookPickerPage({
  variant,
  books,
  boundIds,
  onBack,
  onChange,
}: {
  variant: ChatSettingsVariant;
  /** 可挂载的世界书（局部范围；id/名字/条目数） */
  books: Array<{ id: string; name: string; entryCount: number; enabledCount: number }>;
  /** 当前联系人已挂载的书 id */
  boundIds: string[];
  onBack: () => void;
  /** 勾选变化（每次点选回传完整 id 列表，由调用方持久化） */
  onChange: (ids: string[]) => void;
}) {
  // 第五十六轮：古早/液态皮肤（信息 App 无主题，永远默认）——古早 = 复古纸底 + 6px 方角白卡 + 银灰导航条；
  // 液态 = 液态根渐变（卡片玻璃由 scoped CSS 接管 .bg-white）；默认 = 原生
  const skin = useChatSkin();
  const tBase = translateTokens(variant);
  const t = skin.retro
    ? { ...tBase, pageCls: 'rt-root text-black dark:text-white', cardCls: 'rounded-[6px] bg-white dark:bg-[#1A1A1A]' }
    : skin.liquid
      ? { ...tBase, pageCls: 'lg-root text-black dark:text-white' }
      : tBase;
  const barCls = skin.retro ? 'rt-bar' : '';
  const testPrefix = variant;
  const bound = useMemo(() => new Set(boundIds), [boundIds]);

  // ---------- 34-d「专属」区块：全部专属书也列出来，可直接绑定/解绑到当前联系人 ----------
  // 专属书绑定关系存在书本体 targetContactId 上（wb-bind 挂载列表只管局部书）；
  // 读写走世界书 App 同款 loadBooks/saveBooks 既有通道，不新造存储。
  const [exBooks, setExBooks] = useState<WorldBook[]>(() => loadBooks().filter((b) => b.scope === 'exclusive'));
  /** 联系人名单（null = 加载中）：解析专属书已绑定的角色名 + 反查当前联系人 */
  const [exContacts, setExContacts] = useState<ContactRecord[] | null>(null);
  /** 当前联系人 id（探针反查；null = 未能确定 → 专属区降级为只读展示） */
  const [currentContactId, setCurrentContactId] = useState<string | null>(null);
  const [toast, showToast] = useLocalToast();

  // 探针恢复现场要用「当次渲染」的 boundIds/onChange；effect 只在挂载时跑一次，经 ref 取最新值。
  // ref 更新放 effect（React Compiler 规则禁止 render 期间写 ref）；本 effect 声明在主探针 effect
  // 之前，挂载时先执行，主 effect 读到的即挂载时的 props。
  const latestProps = useRef({ boundIds, onChange });
  useEffect(() => {
    latestProps.current = { boundIds, onChange };
  });

  useEffect(() => {
    let alive = true;
    listContacts()
      .then((list) => {
        if (!alive) return;
        setExContacts(list);
        // 反查当前联系人（组件由调用方以纯 props 渲染、拿不到联系人 id，见 probeCurrentContactId）
        const found = probeCurrentContactId(list, latestProps.current.boundIds, latestProps.current.onChange);
        // 与世界书 App 同款约束：kind=user 是机主本人，不参与专属绑定（反查命中本人则视为未确定）
        const foundContact = found ? list.find((c) => c.id === found) : undefined;
        setCurrentContactId(foundContact && foundContact.kind !== 'user' ? found : null);
      })
      .catch(() => {
        // 联系人不可用：名单保持 null，专属区降级为只读展示（不影响上方局部书挂载）
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 专属书行副标题：绑定状态（已绑角色名可解析时展示）+ 条目计数 */
  const exBookSubtitle = (book: WorldBook): string => {
    const count = `${book.entries.length} 条目 · ${book.entries.filter((e) => e.enabled).length} 启用`;
    if (!exContacts) return count;
    if (!book.targetContactId) return `未绑定角色 · ${count}`;
    if (book.targetContactId === currentContactId) return `已绑定当前角色 · ${count}`;
    const other = exContacts.find((c) => c.id === book.targetContactId);
    return `已绑定「${other?.name ?? '其他角色'}」 · ${count}`;
  };

  /** 绑定/解绑当前联系人（语义对齐世界书 App 的绑定行：未绑定/绑定他人 → 绑定当前并覆盖；已绑定当前 → 解绑） */
  const toggleExclusiveBook = (bookId: string) => {
    if (!currentContactId) return; // 名单加载中 / 反查失败：只读降级
    const all = loadBooks();
    const target = all.find((b) => b.id === bookId && b.scope === 'exclusive');
    if (!target) return;
    const bind = target.targetContactId !== currentContactId;
    const next = all.map((b) =>
      b.id === bookId ? { ...b, targetContactId: bind ? currentContactId : null, updatedAt: Date.now() } : b,
    );
    saveBooks(next);
    setExBooks(next.filter((b) => b.scope === 'exclusive'));
    showToast(bind ? `已把「${target.name}」绑定到当前角色` : `已解绑「${target.name}」`);
  };

  const wbSectionTitleCls = `px-1 pb-1.5 text-[12.5px] font-medium ${
    t.sms ? 'text-muted-foreground' : 'text-black/40 dark:text-white/40'
  }`;

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}>
      {/* 顶栏（顶部氛围光斑已按需求全局移除） */}
      <div className={`relative shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${t.headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-worldbooks-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${t.wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={t.wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>世界书</div>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 局部区块：挂载列表（既有行结构与 testid 保持不变） */}
        <p className={wbSectionTitleCls}>局部 · 挂载后生效</p>
        {books.length === 0 ? (
          <div className="mt-10 text-center">
            <BookMarked className="mx-auto h-10 w-10 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
            <p className={`mt-3 text-[14px] ${t.sms ? 'text-muted-foreground' : 'text-black/35 dark:text-white/35'}`}>
              没有可挂载的「局部」世界书；到「世界书」App 创建（范围选局部）后再来挂载
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[18px] bg-white/55 shadow-[0_8px_24px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.09]">
            {books.map((book, i) => {
              const selected = bound.has(book.id);
              return (
                <div key={book.id}>
                  {i > 0 && <div className={`border-t ${t.dividerCls}`} />}
                  <button
                    type="button"
                    data-testid={`${testPrefix}-worldbook-option-${i}`}
                    aria-label={`${selected ? '取消挂载' : '挂载'}${book.name}`}
                    onClick={() => {
                      const next = new Set(bound);
                      if (selected) next.delete(book.id);
                      else next.add(book.id);
                      onChange(books.filter((b) => next.has(b.id)).map((b) => b.id));
                    }}
                    className={t.rowCls}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{book.name}</span>
                      <span
                        className={`mt-0.5 block truncate text-[12.5px] ${
                          t.sms ? 'text-muted-foreground' : 'text-black/40 dark:text-white/40'
                        }`}
                      >
                        {book.entryCount} 条目 · {book.enabledCount} 启用
                      </span>
                    </span>
                    {selected && (
                      <span className="grid shrink-0 place-items-center pl-2" style={{ color: t.accent }} aria-label="已挂载">
                        <Check className="h-5 w-5" strokeWidth={2.4} />
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* 34-d 新增「专属」区块：全部专属书也列出来，点行即绑定/解绑到当前联系人（无需去世界书 App） */}
        <div className="mt-5" data-testid={`${testPrefix}-wb-local-section`}>
          <p className={wbSectionTitleCls}>专属 · 绑定当前角色后生效</p>
          {exBooks.length === 0 ? (
            <p
              className="rounded-[16px] border border-white/60 bg-white/45 px-4 py-3.5 text-center text-[13px] leading-relaxed text-black/35 shadow-[0_3px_14px_rgba(17,24,39,0.05)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white/35"
              data-testid={`${testPrefix}-wb-local-empty`}
            >
              暂无「专属」世界书；到「世界书」App 创建（范围选专属）后，可在这里直接绑定/解绑当前角色
            </p>
          ) : (
            <div className="overflow-hidden rounded-[18px] bg-white/55 shadow-[0_8px_24px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.09]">
              {exBooks.map((book, i) => {
                const boundToCurrent = currentContactId !== null && book.targetContactId === currentContactId;
                return (
                  <div key={book.id}>
                    {i > 0 && <div className={`border-t ${t.dividerCls}`} />}
                    <button
                      type="button"
                      data-testid={`${testPrefix}-wb-local-book-${i}`}
                      aria-label={`${boundToCurrent ? '解绑' : '绑定'}专属世界书：${book.name}`}
                      onClick={() => toggleExclusiveBook(book.id)}
                      className={t.rowCls}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{book.name}</span>
                        <span
                          className={`mt-0.5 block truncate text-[12.5px] ${
                            t.sms ? 'text-muted-foreground' : 'text-black/40 dark:text-white/40'
                          }`}
                        >
                          {exBookSubtitle(book)}
                        </span>
                      </span>
                      {boundToCurrent && (
                        <span
                          className="grid shrink-0 place-items-center pl-2"
                          style={{ color: t.accent }}
                          aria-label="已绑定当前角色"
                          data-testid={`${testPrefix}-wb-local-book-check-${i}`}
                        >
                          <Check className="h-5 w-5" strokeWidth={2.4} />
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className={t.captionCls}>
          只有「局部」范围的世界书需要挂载：挂载后，聊天内容命中条目触发词时才注入对应设定（未命中不发送）。「全局」书无需挂载、对所有对话常驻生效；「专属」书仅对绑定的角色生效——可在上方「专属」区块直接绑定/解绑当前角色，书籍本体与条目仍在「世界书」App 里维护。
        </p>
      </div>
      <LocalToast msg={toast} />
    </div>
  );
}

// ---------------- AI 语音发送频率选择页（三端共用二级页） ----------------

/**
 * AI 语音发送频率选择页（他的声音二级页 / 群聊信息页进入）：
 * 关闭 / 每条都发语音 / 经常（每 3 条 1 条语音）/ 偶尔（每 7 条 1 条语音）/ 不经常（每 12 条 1 条语音）。
 * 按会话独立保存（群聊按群）；计数器按「会话×角色」隔离，语音发出后重新计数。
 */
export function ChatVoiceFreqPage({
  variant,
  value,
  onBack,
  onSelect,
}: {
  variant: ChatSettingsVariant;
  /** 当前会话的 AI 语音频率 */
  value: AiVoiceFreq;
  onBack: () => void;
  onSelect: (freq: AiVoiceFreq) => void;
}) {
  // 第五十六轮：古早/液态皮肤（信息 App 无主题，永远默认）——古早 = 复古纸底 + 6px 方角白卡 + 银灰导航条；
  // 液态 = 液态根渐变（卡片玻璃由 scoped CSS 接管 .bg-white）；默认 = 原生
  const skin = useChatSkin();
  const tBase = translateTokens(variant);
  const t = skin.retro
    ? { ...tBase, pageCls: 'rt-root text-black dark:text-white', cardCls: 'rounded-[6px] bg-white dark:bg-[#1A1A1A]' }
    : skin.liquid
      ? { ...tBase, pageCls: 'lg-root text-black dark:text-white' }
      : tBase;
  const barCls = skin.retro ? 'rt-bar' : '';
  const testPrefix = variant;
  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}>
      {/* 顶栏 */}
      <div className={`shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${t.headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-voice-freq-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${t.wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={t.wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>AI 语音频率</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        <div className={`${t.cardCls} overflow-hidden`}>
          {AI_VOICE_FREQ_OPTIONS.map((opt, i) => (
            <div key={opt.value}>
              {i > 0 && <div className={`border-t ${t.dividerCls}`} />}
              <button
                type="button"
                data-testid={`${testPrefix}-voice-freq-option-${opt.value}`}
                aria-label={`AI 语音频率 ${opt.label}`}
                onClick={() => onSelect(opt.value)}
                className={t.rowCls}
              >
                <span className="min-w-0">
                  <span className="block truncate">{opt.label}</span>
                  <span
                    className={`mt-0.5 block truncate text-[12.5px] ${t.sms ? 'text-muted-foreground' : 'text-black/40 dark:text-white/40'}`}
                  >
                    {opt.desc}
                  </span>
                </span>
                {value === opt.value && (
                  <span className="grid shrink-0 place-items-center pl-2" style={{ color: t.accent }} aria-label="已选中">
                    <Check className="h-5 w-5" strokeWidth={2.4} />
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
        <p className={t.captionCls}>
          开启后，AI 生成回复时按该频率决定这条用语音还是文字发送：语音用 TA 的音色合成，显示为语音气泡，可点击播放、
          长按转文字；合成失败会自动降级为文字。每个角色、每个会话独立计数，发出一条语音后重新计数；群聊里各成员互不影响。
        </p>
      </div>
    </div>
  );
}

// ---------------- 他的声音页（三端共用二级页） ----------------

/**
 * 他的声音页（聊天设置二级页，微信 / QQ / 信息三端共用）：
 * 选择该角色说话用的音色 —— 默认（跟随全局）/ 内置音色（6 个免费声线，可试听）/
 * 我的音色（设置 › 语音 API 里保存的音色；chip 内喇叭可试听——内置声线/内置服务商走
 * 本地引擎，其余走当前语音 API，与设置页试听同规则）；
 * 选择结果由宿主持久化到联系人 voiceId（点已选中的=取消，恢复「默认」）。
 * 页内还有「AI 语音频率」入口行 → ChatVoiceFreqPage（按会话独立）。
 */
export function ChatVoicePage({
  variant,
  peerName,
  voiceId,
  voiceFreq,
  onBack,
  onSelect,
  onOpenFreq,
}: {
  variant: ChatSettingsVariant;
  /** 角色名（标题/说明用） */
  peerName: string;
  /** 当前角色的音色（contact.voiceId；空 = 跟随全局默认） */
  voiceId: string;
  /** 当前会话的 AI 语音频率（入口行摘要） */
  voiceFreq: AiVoiceFreq;
  onBack: () => void;
  /** 选择音色（传空串 = 恢复「默认」；宿主负责持久化） */
  onSelect: (voiceId: string) => void;
  /** 打开 AI 语音频率选择页 */
  onOpenFreq: () => void;
}) {
  // 第五十六轮：古早/液态皮肤（信息 App 无主题，永远默认）——古早 = 复古纸底 + 6px 方角白卡 + 银灰导航条；
  // 液态 = 液态根渐变（卡片玻璃由 scoped CSS 接管 .bg-white）；默认 = 原生
  const skin = useChatSkin();
  const tBase = translateTokens(variant);
  const t = skin.retro
    ? { ...tBase, pageCls: 'rt-root text-black dark:text-white', cardCls: 'rounded-[6px] bg-white dark:bg-[#1A1A1A]' }
    : skin.liquid
      ? { ...tBase, pageCls: 'lg-root text-black dark:text-white' }
      : tBase;
  const barCls = skin.retro ? 'rt-bar' : '';
  const testPrefix = variant;
  const myVoices = useMyVoices((s) => s.voices);
  /** 内置声线试听状态（播放中的声线 id） */
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** 我的音色试听状态（在播的记录 id；内置引擎与 API 音频两路共用） */
  const [previewingMyId, setPreviewingMyId] = useState<string | null>(null);
  const myPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  /** 试听 ObjectURL 回收（内存：原先每次试听泄漏一个 blob: URL，关页才释放） */
  const revokePreviewSrc = (audio: HTMLAudioElement | null): void => {
    const src = audio?.src;
    if (src && src.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(src);
      } catch {
        /* 忽略 */
      }
    }
  };
  // 本页只在客户端渲染：直接惰性初始化（避免 effect 内 setState 的水合/告警问题）
  const [builtinSupport] = useState<boolean | null>(() => (typeof window === 'undefined' ? null : isBuiltinVoiceSupported()));

  useEffect(() => {
    return () => {
      stopBuiltinSpeech();
      if (myPreviewAudioRef.current) {
        myPreviewAudioRef.current.pause();
        myPreviewAudioRef.current = null;
      }
    };
  }, []);

  const previewBuiltin = (id: string) => {
    // 与「我的音色」试听互斥：开始内置试听前停掉在播的 API 音频
    if (myPreviewAudioRef.current) {
      myPreviewAudioRef.current.pause();
      myPreviewAudioRef.current = null;
    }
    setPreviewingMyId(null);
    // #44：切换声线时连续点同一 id 会先 stop 再 speak，原实现 setPreviewId(null) 与 setPreviewId(id)
    // 在同一同步块内被 React 合并为最终 id，onEnd/onError 回调里 setPreviewId(null) 可能清掉刚换的 id——
    // 改用函数式 setState：当前 id === id 视为「点同一个」→ 停止并置 null；否则停止并切到新 id。
    setPreviewId((prev) => {
      if (prev === id) {
        stopBuiltinSpeech();
        return null;
      }
      stopBuiltinSpeech();
      void speakBuiltin({
        text: '你好，用这个声音和你聊天，很高兴认识你。',
        voiceId: id,
        onEnd: () => setPreviewId((p) => (p === id ? null : p)),
        onError: () => setPreviewId((p) => (p === id ? null : p)),
      }).catch(() => setPreviewId((p) => (p === id ? null : p)));
      return id;
    });
  };

  const mutedText = t.sms ? 'text-muted-foreground' : 'text-black/40 dark:text-white/40';
  const current = voiceId.trim();

  /**
   * 我的音色试听（与设置 › 语音 API › 我的音色的试听同规则）：
   * 内置声线 id / 当前服务商为内置 → 浏览器引擎本地朗读；其余走当前语音 API（/api/tts）。
   * fishaudio: 前缀音色只在 Fish Audio 服务商下生效（voiceIdForProvider 同规则）。
   * 与内置声线试听互斥：任一方开始都停掉对方；再点同一个 = 停止。
   */
  const previewMyVoice = (recordId: string, voiceId: string) => {
    // 停掉在播的试听（内置引擎 + API 音频）
    stopBuiltinSpeech();
    setPreviewId(null);
    if (myPreviewAudioRef.current) {
      myPreviewAudioRef.current.pause();
      myPreviewAudioRef.current = null;
    }
    if (previewingMyId === recordId) {
      setPreviewingMyId(null);
      return;
    }
    const cfg = useSettings.getState().ttsConfig;
    const reset = () => setPreviewingMyId((p) => (p === recordId ? null : p));
    const resolved = voiceIdForProvider(voiceId, cfg.provider);
    if (!resolved) {
      reset(); // 前缀音色与当前服务商不匹配：不请求
      return;
    }
    if (isBuiltinVoiceId(resolved) || cfg.provider === 'builtin') {
      setPreviewingMyId(recordId);
      void speakBuiltin({
        text: '你好，这是保存的音色，很高兴认识你。',
        voiceId: isBuiltinVoiceId(resolved) ? resolved : undefined,
        onEnd: reset,
        onError: reset,
      }).catch(reset);
      return;
    }
    setPreviewingMyId(recordId);
    void (async () => {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: cfg, voiceId: resolved, text: '你好，这是保存的音色，很高兴认识你。' }),
        });
        if (!res.ok) {
          reset();
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        myPreviewAudioRef.current = audio;
        audio.onended = () => {
          revokePreviewSrc(audio);
          if (myPreviewAudioRef.current === audio) myPreviewAudioRef.current = null;
          reset();
        };
        audio.onerror = () => {
          revokePreviewSrc(audio);
          reset();
        };
        await audio.play().catch(reset);
      } catch {
        reset();
      }
    })();
  };

  /** 音色 chip（我的音色）：点名字选即用（再点取消回「默认」），右侧喇叭按钮试听（stopPropagation 不影响选择） */
  const voiceChip = (id: string, name: string, testId: string, recordId: string) => {
    const active = current === id;
    const previewing = previewingMyId === recordId;
    return (
      <div
        key={recordId}
        role="button"
        tabIndex={0}
        data-testid={testId}
        aria-pressed={active}
        title={name === id ? id : `${name}（${id}）`}
        onClick={() => onSelect(active ? '' : id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(active ? '' : id);
          }
        }}
        className={`flex max-w-full items-center gap-1.5 rounded-full py-2 pl-3.5 pr-2 text-[13px] shadow-[0_3px_12px_rgba(17,24,39,0.06)] backdrop-blur-xl transition-all active:scale-[0.97] ${
          active
            ? 'border border-transparent text-white shadow-[0_5px_16px_rgba(0,0,0,0.18)]'
            : 'border border-white/70 bg-white/50 text-black/75 hover:bg-white/75 dark:border-white/[0.08] dark:bg-white/[0.08] dark:text-white/80 dark:hover:bg-white/[0.13]'
        }`}
        style={active ? { backgroundColor: t.accent } : undefined}
      >
        <span className="min-w-0 max-w-[140px] truncate">{name}</span>
        <button
          type="button"
          aria-label={`试听音色${name}`}
          data-testid={`${testId}-preview`}
          onClick={(e) => {
            e.stopPropagation();
            previewMyVoice(recordId, id);
          }}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${
            active
              ? 'bg-white/25 text-white'
              : 'bg-white/70 text-black/60 ring-1 ring-black/[0.05] active:bg-white dark:bg-white/[0.12] dark:text-white/75 dark:ring-white/[0.1]'
          }`}
        >
          <AudioLines className={`h-3 w-3 ${previewing ? 'animate-pulse' : ''}`} aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${t.pageCls}`}>
      {/* 顶栏（顶部氛围光斑已按需求全局移除） */}
      <div className={`relative shrink-0 pt-[54px] ${barCls}`}>
        <div className={`flex ${t.headerH} items-center px-2`}>
          <button
            type="button"
            aria-label="返回"
            data-testid={`${testPrefix}-voice-back`}
            onClick={onBack}
            className={`flex items-center rounded-full px-1 active:opacity-50 ${t.wx ? '' : 'p-1'}`}
          >
            <ChevronLeft className={t.wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${t.titleCls}`}>他的声音</div>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* AI 语音频率入口（按会话独立；关闭时 AI 只发文字）——毛玻璃卡（三端统一 glassmorphism） */}
        <div className="overflow-hidden rounded-[18px] bg-white/55 shadow-[0_8px_24px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.09]">
          <button type="button" data-testid={`${testPrefix}-voice-freq-row`} onClick={onOpenFreq} className={t.rowCls}>
            <span>AI 语音频率</span>
            <span className="flex shrink-0 items-center gap-2">
              <span data-testid={`${testPrefix}-voice-freq-value`} className={`max-w-[150px] truncate text-[14px] ${mutedText}`}>
                {aiVoiceFreqLabel(voiceFreq)}
              </span>
              <ChevronRight className={`h-[18px] w-[18px] ${t.sms ? 'text-muted-foreground/50' : 'text-black/25 dark:text-white/25'}`} strokeWidth={2} />
            </span>
          </button>
        </div>
        <p className={t.captionCls}>设置 TA 回复时用语音还是文字（关闭 = 只发文字）。</p>

        {/* 默认 / 音色选择状态 */}
        <p className={`px-1 pb-1.5 pt-4 text-[12.5px] ${mutedText}`}>
          {current ? `当前音色已为 ${peerName} 单独设置` : '当前为「默认」：跟随全局默认音色（全局也没设时按 TA 的性别自动选内置男女声）'}
        </p>

        {/* 内置音色（免费 · 可试听） */}
        <p className={`px-1 pb-1.5 text-[12.5px] font-medium ${t.sms ? 'text-foreground/80' : 'text-black/55 dark:text-white/55'}`}>
          内置音色（免费）
        </p>
        <div className="grid grid-cols-2 gap-2">
          {BUILTIN_TTS_VOICES.map((v) => {
            const active = current === v.id;
            const playing = previewId === v.id;
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`选择音色${v.name}`}
                data-testid={`${testPrefix}-voice-builtin-${v.id.replace('builtin:', '')}`}
                onClick={() => onSelect(active ? '' : v.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(active ? '' : v.id);
                  }
                }}
                className={`flex flex-col gap-1 rounded-[16px] p-2.5 shadow-[0_4px_16px_rgba(17,24,39,0.05)] ring-1 backdrop-blur-xl transition-all active:scale-[0.98] ${
                  active
                    ? 'text-white ring-transparent'
                    : 'bg-white/55 text-black/80 ring-white/70 hover:bg-white/75 dark:bg-white/[0.07] dark:text-white/85 dark:ring-white/[0.09] dark:hover:bg-white/[0.11]'
                }`}
                style={active ? { backgroundColor: t.accent } : undefined}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium">{v.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        active
                          ? 'bg-white/25 text-white'
                          : v.gender === 'female'
                            ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
                            : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                      }`}
                    >
                      {v.gender === 'female' ? '女' : '男'}
                    </span>
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
                </div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className={`truncate text-[11px] ${active ? 'text-white/80' : mutedText}`}>{v.label}</span>
                  <button
                    type="button"
                    aria-label={`试听声线${v.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      previewBuiltin(v.id);
                    }}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                      active ? 'bg-white/25 text-white' : 'bg-black/[0.06] text-black/60 active:bg-black/[0.1] dark:bg-white/15 dark:text-white/75'
                    }`}
                  >
                    <AudioLines className={`h-3.5 w-3.5 ${playing ? 'animate-pulse' : ''}`} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {builtinSupport === false && (
          <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-[#FF3B30]">
            当前浏览器不支持内置语音试听；语音消息将自动回退其它方式，不影响文字聊天。
          </p>
        )}

        {/* 我的音色（设置 › 语音 API 保存的音色） */}
        <div className="flex items-center justify-between px-1 pb-2 pt-4">
          <p className={`text-[12.5px] font-medium ${t.sms ? 'text-foreground/80' : 'text-black/55 dark:text-white/55'}`}>我的音色</p>
          {myVoices.length > 0 && (
            <span
              data-testid={`${testPrefix}-voice-my-count`}
              className="rounded-full bg-white/55 px-2 py-0.5 text-[10.5px] font-medium text-black/45 shadow-sm ring-1 ring-white/70 backdrop-blur-md dark:bg-white/[0.08] dark:text-white/45 dark:ring-white/[0.08]"
            >
              {myVoices.length} 个
            </span>
          )}
        </div>
        {myVoices.length === 0 ? (
          <div className="flex items-start gap-2.5 rounded-[18px] border border-white/60 bg-white/45 px-4 py-3.5 shadow-[0_3px_14px_rgba(17,24,39,0.05)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05]">
            <AudioLines className="mt-0.5 h-4 w-4 shrink-0 opacity-45" aria-hidden="true" />
            <p className={`text-[12.5px] leading-relaxed ${mutedText}`}>
              还没有保存的音色。到「设置 › 语音 API › 我的音色」添加（填名字 + 音色 ID，永久保存），这里就能点选。
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">{myVoices.map((v, i) => voiceChip(v.voiceId, v.name, `${testPrefix}-voice-my-${i}`, v.id))}</div>
        )}

        <p className={t.captionCls}>
          音色立即生效：TA 的语音消息、语音气泡朗读、语音通话都用这里的音色。需要自定义音色就到「设置 › 语音 API › 我的音色」添加。
        </p>
      </div>
    </div>
  );
}

