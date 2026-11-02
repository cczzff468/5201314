'use client';

import { create } from 'zustand';
import {
  DEFAULT_BUBBLE_STYLE,
  normalizeBubbleSchemes,
  normalizeBubbleStyle,
  type BubbleAppId,
  type BubbleScheme,
  type BubbleStyleConfig,
  type BubbleTheme,
} from './bubble-style';
import {
  defaultLiquidSkinConfig,
  normalizeLiquidSkinConfig,
  type LiquidSkinConfig,
  type LiquidSkinSettings,
} from './liquid-skin';
import {
  defaultChatDecorConfig,
  normalizeChatDecorConfig,
  type ChatDecorConfig,
  type ChatDecorSettings,
  type DecorAppId,
} from './chat-decor';
import {
  defaultCustomCss,
  normalizeCustomCss,
  type CustomCssConfig,
  type CustomCssScheme,
  type CustomCssScope,
} from './custom-css';
import { useSyncExternalStore, useMemo, useState, useEffect, type CSSProperties } from 'react';
import { localDB } from './db';
import { encryptValue, decryptValue } from './secure-store';
import { clearAllChatCooldowns } from '../chat-errors';
import { useGlobalCall } from './global-call';
import { useIncomingCall } from './incoming-call';
import type { AddressMode } from '../contacts';

// ---------------- 类型 ----------------

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export interface ApiConfig {
  /** OpenAI 兼容的 chat/completions 完整地址（或以 /v1 结尾的基地址） */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 0 - 2 */
  temperature: number;
  maxTokens: number;
}

export interface ApiPreset {
  id: string;
  name: string;
  config: ApiConfig;
}

/** 识图模型配置：与聊天模型（ApiConfig）完全独立、互不覆盖，只负责「看图」，不负责回复
 *  ——聊天发图时先用它把图片转成文字描述，再交给聊天模型生成最终回复；未配置（baseUrl 空）时不影响文字聊天 */
export interface VisionConfig {
  /** OpenAI 兼容的 chat/completions 完整地址（或以 /v1 结尾的基地址） */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface VisionPreset {
  id: string;
  name: string;
  config: VisionConfig;
}

/** 默认未配置：发图不触发识图，聊天行为与旧版完全一致 */
export const DEFAULT_VISION_CONFIG: VisionConfig = { baseUrl: '', apiKey: '', model: '' };

/** 复制对象并剔除一个 key（不修改原对象；联系人聊天 CSS 清除时用来删 chats 条目） */
function omitKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  const { [key]: _drop, ...rest } = obj;
  return rest as T;
}

/** 图像生成（生图）配置：与聊天（apiConfig）/识图（visionConfig）完全独立、互不覆盖（含 Key，密文持久化）。
 *  负责把 AI 回复里的照片标签 / 用户手动触发生成图片，支持「锁脸」（角色参考图）保持人物一致。
 *  保存后下一次生成时现场读取 → 自动生效，无需重启 */
export interface ImgGenConfig {
  /** 自动生图总开关：开启后 AI 回复里出现 [照片:描述] 标签时自动生图；关闭后仅手动触发可用 */
  enabled: boolean;
  /** 请求方式：'proxy' = 服务端转发（推荐，避免跨域）；'direct' = 浏览器直连（需接口允许 CORS） */
  mode: 'proxy' | 'direct';
  /** OpenAI 兼容基地址（如 https://api.openai.com/v1）或完整 /images/generations 端点 */
  baseUrl: string;
  apiKey: string;
  /** 模型名（如 gpt-image-2 / flux-pro） */
  model: string;
  /** 尺寸（如 1024x1024 / auto） */
  size: string;
  /** 质量（auto / low / medium / high） */
  quality: string;
  /** 补充提示词（拼在每个生图提示词末尾，如风格要求） */
  extraPrompt: string;
}

export interface ImgGenPreset {
  id: string;
  name: string;
  config: ImgGenConfig;
}

export const DEFAULT_IMGGEN_CONFIG: ImgGenConfig = {
  enabled: false,
  mode: 'proxy',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-2',
  size: '1024x1024',
  quality: 'auto',
  extraPrompt: '',
};

/** 语音 API（TTS）配置：与聊天 API（apiConfig）/识图 API（visionConfig）相互独立、互不覆盖。
 *  服务商支持 内置语音（免费、零配置）与 MiniMax / OpenAI 兼容 / Fish Audio；保存后下一次播放即生效（每次播放现场读取，无缓存无重启）
 *
 *  多服务商分槽（Task 29）：顶层字段始终是「当前激活服务商」的连接配置（运行时读取路径零改动），
 *  accounts 按服务商各存一份快照——切换服务商时快照当前、恢复目标，MiniMax 等已有配置互不覆盖。 */
export type TtsProviderKind = 'minimax' | 'openai' | 'fishaudio';

/** 单个服务商的连接配置快照（accounts 槽位；顶层字段=当前激活服务商的镜像） */
export interface TtsAccount {
  baseUrl: string;
  apiKey: string;
  /** MiniMax 专属 GroupId */
  groupId: string;
  model: string;
  /** 该服务商的全局默认音色（角色未设独立 voiceId 时用） */
  defaultVoiceId: string;
}

export interface TtsConfig {
  /** 'builtin' = 内置语音（浏览器本地引擎，男女声线免配置）；'minimax' = MiniMax（t2a_v2）；
   *  'openai' = OpenAI 兼容（/audio/speech）；'fishaudio' = Fish Audio（/v1/tts，reference_id 即音色） */
  provider: 'builtin' | TtsProviderKind;
  baseUrl: string;
  apiKey: string;
  /** MiniMax 专属：账户 GroupId（get_voice / t2a_v2 必填） */
  groupId: string;
  /** 模型名（如 speech-01-turbo / tts-1；Fish Audio 当前接口无需模型名，可留空） */
  model: string;
  /** 全局默认音色（角色未设独立 voiceId 时用；空 = 用服务商安全默认音色；Fish Audio 空 = 平台默认音色） */
  defaultVoiceId: string;
  /** 各服务商独立配置槽（切换服务商时快照/恢复；旧存档无此字段，首次切换时自动生成） */
  accounts?: Partial<Record<TtsProviderKind, TtsAccount>>;
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  provider: 'builtin',
  baseUrl: 'https://api.minimax.chat',
  apiKey: '',
  groupId: '',
  model: 'speech-01-turbo',
  defaultVoiceId: '',
  accounts: {},
};

/** Fish Audio 官方 API 地址（首次切到 Fish Audio 时自动填入，可改） */
export const FISHAUDIO_DEFAULT_BASE_URL = 'https://fishaudio.org/v1';

/** Fish Audio 音色存储前缀：联系人/我的音色绑定 Fish Audio 音色时用
 *  `fishaudio:<音色ID>` 命名空间隔离（其他服务商读到带前缀的音色会忽略，避免拿 MiniMax 的音色 ID 去请求 Fish Audio） */
export const FISH_VOICE_PREFIX = 'fishaudio:';

/** 旧存档的 accounts 槽位净化：非对象返回空对象；每个槽位逐字段校验为字符串（脏数据丢弃回默认） */
function sanitizeTtsAccounts(raw: unknown): TtsConfig['accounts'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: NonNullable<TtsConfig['accounts']> = {};
  const src = raw as Record<string, unknown>;
  for (const kind of ['minimax', 'openai', 'fishaudio'] as const) {
    const slot = src[kind];
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) continue;
    const s = slot as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    out[kind] = {
      baseUrl: str(s.baseUrl),
      apiKey: str(s.apiKey),
      groupId: str(s.groupId),
      model: str(s.model),
      defaultVoiceId: str(s.defaultVoiceId),
    };
  }
  return out;
}

/** 各服务商的程序安全默认音色（角色/全局都没配时兑底；与服务端 /api/tts 保持一致）。
 *  fishaudio 留空：/v1/tts 不带 reference_id 时 Fish Audio 自动用平台默认音色，不报错 */
export const SAFE_VOICE_BY_PROVIDER: Record<TtsConfig['provider'], string> = {
  builtin: 'builtin:xiaoyue',
  minimax: 'female-shaonv',
  openai: 'alloy',
  fishaudio: '',
};

/** 语音识别（STT）配置：与 TTS 配置相互独立、互不覆盖。
 *  识别主通道 = Web Speech（浏览器原生实时识别，webSpeech 开关控制语音消息实时转写）；
 *  内置识别模型（z-ai ASR）已移除，provider 仅为兼容旧存储保留——服务端兜底只在 'openai' 配置后启用 */
export interface SttConfig {
  /** 旧字段（兼容保留）：'builtin' 已不再使用（等同未配置服务端）；'openai' = OpenAI 兼容服务商 */
  provider: 'builtin' | 'openai';
  /** OpenAI 兼容服务商地址（如 https://api.openai.com/v1） */
  baseUrl: string;
  apiKey: string;
  /** 识别模型名（OpenAI 兼容用；空 = 服务端默认 whisper-1） */
  model: string;
  /** 浏览器实时识别（Web Speech API）：录音按住期间实时转文字，「划到转文字」秒出结果、
   *  直发语音自动附带文字（AI 能读到语音内容）；关闭或浏览器不支持且未配置服务端兜底时，按语音占位处理 */
  webSpeech: boolean;
}

export const DEFAULT_STT_CONFIG: SttConfig = {
  provider: 'builtin',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'whisper-1',
  webSpeech: true,
};

export type PasscodeLength = 4 | 6;

export interface LockConfig {
  /** 是否启用锁屏界面（关闭后开机/电源键不再出现锁屏，直接进主屏幕） */
  lockScreen: boolean;
  /** 是否启用锁屏密码（关闭后锁屏仅需上滑解锁；仅在 lockScreen 开启时生效） */
  enabled: boolean;
  /** 密码（数字字符串，enabled=false 时为 ''） */
  code: string;
  /** 密码位数 */
  len: PasscodeLength;
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 2048,
};

/** 个人信息（设置根页个人卡片 + 锁屏「×××的iPhone」小组件共用） */
export interface Profile {
  name: string;
  tag: string;
  /** 头像 data URL（上传时已缩至 256px，控住体积） */
  avatar: string | null;
}

export const DEFAULT_PROFILE: Profile = { name: '', tag: 'Apple 账户、iCloud', avatar: null };

/** 锁屏壁纸持久化记录（锁屏壁纸与主屏幕完全独立） */
interface LockWallpaperRecord {
  preset?: string;
  customBlob?: Blob;
}

export interface WallpaperPreset {
  id: string;
  name: string;
  css: string;
  /** 浅色壁纸（状态栏文字用黑色） */
  light: boolean;
  /** 底色兜底：PNG 预设图片异步加载/解码前先铺纯色，避免锁屏/主屏透出下层内容闪现 */
  base: string;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'dark-stream',
    name: '暗流',
    css: 'url(/wallpapers/dark-stream.png) center / cover no-repeat',
    light: false,
    base: '#0a0a0d',
  },
  {
    id: 'ink-marble',
    name: '墨纹',
    css: 'url(/wallpapers/ink-marble.png) center / cover no-repeat',
    light: false,
    base: '#141417',
  },
  {
    id: 'mist-mountain',
    name: '雾山',
    css: 'url(/wallpapers/mist-mountain.png) center / cover no-repeat',
    light: true,
    base: '#d9dade',
  },
  {
    id: 'graphite',
    name: '石墨黑',
    css: 'radial-gradient(120% 90% at 20% 0%, #2a2a2e 0%, #161618 45%, #050506 100%)',
    light: false,
    base: '#161618',
  },
  {
    id: 'dusk',
    name: '暮色灰',
    css: 'linear-gradient(180deg, #1b1b1f 0%, #33343b 52%, #5c5d66 100%)',
    light: false,
    base: '#1b1b1f',
  },
  {
    id: 'silver',
    name: '银白',
    css: 'linear-gradient(180deg, #fafafc 0%, #e3e3e9 55%, #b7b8c0 100%)',
    light: true,
    base: '#fafafc',
  },
  {
    id: 'mist',
    name: '晨雾',
    css: 'linear-gradient(180deg, #ececf1 0%, #c6c7cf 55%, #90919b 100%)',
    light: true,
    base: '#ececf1',
  },
];

// ---------------- 设置 Store ----------------

/** 主屏图标风格（本轮新增，主题页「图标样式」三选一）：
 *  real=真实图标（实体 PNG，无实体图的 App 保持磨砂线条）；
 *  glass=毛玻璃图标（全部磨砂玻璃底座 + 粗线条，忽略实体图）；
 *  liquid=液态透明（透明液态玻璃 + 高光亮边） */
export type IconStyle = 'real' | 'glass' | 'liquid';

/** 淘宝/美团商品图样式（第六十四轮）：
 *  cartoon=kawaii 卡通插画（默认，public/goods）；
 *  sketch=简笔画线稿（public/goods-sketch，黑白粗线稿，用户参考图风格）；
 *  emoji=Emoji 大字图（柔和马卡龙底色 + 品类 emoji，无图片请求） */
export type GoodsImgStyle = 'cartoon' | 'sketch' | 'emoji';

interface SettingsState {
  theme: ThemeMode;
  /** 主屏图标风格（默认 real=真实图标；持久化 settings.iconStyle） */
  iconStyle: IconStyle;
  /** 淘宝/美团商品图样式（默认 cartoon=卡通插画；持久化 settings.goodsImgStyle，全站订单/商品/购物车图实时跟随） */
  goodsImgStyle: GoodsImgStyle;
  wallpaperPreset: string;
  /** 自定义壁纸的 ObjectURL（Blob 存 IndexedDB） */
  customWallpaperUrl: string | null;
  /** 锁屏壁纸预设（锁屏壁纸与主屏幕完全独立，各有各的预设/自定义） */
  lockWallpaperPreset: string;
  /** 锁屏自定义壁纸的 ObjectURL（Blob 存 IndexedDB） */
  lockCustomWallpaperUrl: string | null;
  apiConfig: ApiConfig;
  /** 用户自己保存的 API 预设 */
  apiPresets: ApiPreset[];
  /** 识图模型配置（与 apiConfig 互相独立、互不覆盖；密文持久化） */
  visionConfig: VisionConfig;
  /** 用户自己保存的识图模型预设 */
  visionPresets: VisionPreset[];
  /** 生图配置（与 apiConfig/visionConfig 互相独立；密文持久化） */
  imgGenConfig: ImgGenConfig;
  /** 用户自己保存的生图预设 */
  imgGenPresets: ImgGenPreset[];
  /** 锁屏密码配置（持久化） */
  lockConfig: LockConfig;
  /** 个人信息（头像/名字/标签，持久化） */
  profile: Profile;
  /** AI 对用户的称呼方式：用户已要求移除「AI 称呼方式」设置——昵称只是 App 显示昵称、
   *  名字才是真名，AI 统一用真实名字称呼（load 时固定回 'name'，历史存储的 'nickname' 不再生效）；
   *  【用户的称呼】人设注入保留，AI 仍知道昵称与真名同属一人 */
  addressMode: AddressMode;
  /** 语音 API（TTS）配置：与聊天/识图 API 相互独立（含 Key，密文持久化） */
  ttsConfig: TtsConfig;
  /** 语音识别（STT）配置：与 TTS 相互独立（含 Key，密文持久化） */
  sttConfig: SttConfig;
  /** 自定义 App 图标（AppId → ObjectURL，Blob 存 IndexedDB settings.customIcons） */
  customIcons: Record<string, string>;
  /** 全局字体（''=默认 iOS 系统字体；builtin:/custom: 前缀，应用逻辑见 lib/ios/fonts.ts） */
  appFontId: string;
  /** 全局字体大小倍率（1=标准；范围 0.9~1.45，globals.css 的 text-[Npx]/leading-[Npx] calc 规则只缩放文字，见 lib/ios/fonts.ts） */
  appFontScale: number;
  /** 顶部状态栏显示开关（Task 36）：false = 隐藏时间/信号/电量状态栏（灵动岛为硬件开孔保留） */
  statusBarVisible: boolean;
  /** 灵动岛常驻开关：true = 顶部黑色胶囊灵动岛常驻显示；false = 隐藏基础胶囊，
   *  只显示 APP 灵动岛（音乐岛大/小窗、美团/淘宝配送岛、灵动岛通知卡、来电胶囊等）。
   *  与状态栏开关独立：关灵动岛不影响状态栏文字/图标 */
  islandPersistent: boolean;
  /** 全局字重（400=标准；300/400/500/600，未显式设 font-weight 的文本生效） */
  appFontWeight: number;
  /** 聊天气泡装扮（第十八轮重构：微信/QQ 两 App 完全隔离，各持 { kind, mineColor, theirsColor }；
   * 样式不分侧，自定义色区分我的/TA的；持久化 settings.bubbleStyle，聊天实时跟随） */
  bubbleStyle: BubbleStyleConfig;
  /** 「我的气泡」收藏夹已命名方案（归属某个 App，应用时只覆盖该 App；持久化 settings.bubbleSchemes） */
  bubbleSchemes: BubbleScheme[];
  /** 液态玻璃主题皮肤自定义（本轮新增：顶栏名字区模式/分类标签文字/会话列表小组件；三 App 隔离；
   *  持久化 settings.liquidSkin，只在液态主题下生效） */
  liquidSkin: LiquidSkinConfig;
  /** 聊天输入框自定义（输入框占位文字 + 输入框上方快捷功能；微信/QQ 两 App 隔离，信息 App 不接入；
   *  持久化 settings.chatDecor，默认/液态两种界面主题下都生效） */
  chatDecor: ChatDecorConfig;
  /** 自定义 CSS（第六十五轮首建 · 第七十轮按联系人隔离）：global=全局所有界面 /
   *  chats=每个联系人一套聊天 CSS（key=app:联系人ID）/ offline=线下模式所有界面 /
   *  schemes=已命名方案收藏。持久化 settings.customCss */
  customCss: CustomCssConfig;
  loaded: boolean;

  /** 设置主屏图标风格（立即持久化；HomeScreen/多任务实时响应） */
  setIconStyle: (s: IconStyle) => void;
  /** 设置商品图样式（立即持久化；淘宝/美团全部图位实时响应） */
  setGoodsImgStyle: (s: GoodsImgStyle) => void;
  /** 设置聊天气泡装扮（立即持久化；微信/QQ 聊天气泡实时响应） */
  setBubbleStyle: (cfg: BubbleStyleConfig) => void;
  /** 设置 App 界面主题（第四十二轮：默认/液态玻璃；立即持久化，微信/QQ 页面铭件实时响应） */
  setBubbleTheme: (app: BubbleAppId, theme: BubbleTheme) => void;
  /** 替换「我的气泡」收藏夹列表（立即持久化） */
  setBubbleSchemes: (list: BubbleScheme[]) => void;
  /** 更新液态玻璃皮肤设置（patch 合并到对应 App；立即持久化，页面实时响应） */
  setLiquidSkin: (app: BubbleAppId, patch: Partial<LiquidSkinSettings>) => void;
  /** 更新聊天输入框自定义（patch 合并到对应 App；立即持久化，聊天页实时响应） */
  setChatDecor: (app: DecorAppId, patch: Partial<ChatDecorSettings>) => void;
  /** 应用/清除某个作用域的自定义 CSS（scope：'global'/'offline'/`chat:app:联系人ID`；
   *  css 传空串 = 清除；立即持久化，对应界面实时响应；第七十轮聊天作用域按联系人隔离） */
  setCustomCssActive: (scope: CustomCssScope, css: string) => void;
  /** 替换自定义 CSS 方案收藏列表（立即持久化） */
  setCustomCssSchemes: (list: CustomCssScheme[]) => void;

  load: () => Promise<void>;
  /** 锁屏总开关：关闭时同时停用密码并立即回到主屏幕 */
  setLockScreen: (on: boolean) => void;
  setTheme: (t: ThemeMode) => void;
  /** 设置全局字体（''=恢复默认）；立即持久化，UI 层随后调 applyAppFont() 实时生效 */
  setAppFont: (id: string) => void;
  /** 设置全局字体大小倍率；立即持久化，UI 层随后调 applyAppFontScale() 实时生效 */
  setAppFontScale: (scale: number) => void;
  /** 设置全局字重；立即持久化，UI 层随后调 applyAppFontWeight() 实时生效 */
  setAppFontWeight: (weight: number) => void;
  /** 顶部状态栏显示开关；立即持久化，PhoneShell/StatusBar 实时响应 */
  setStatusBarVisible: (v: boolean) => void;
  /** 灵动岛常驻开关；立即持久化，PhoneShell 实时响应（APP 灵动岛不受影响） */
  setIslandPersistent: (v: boolean) => void;
  setWallpaperPreset: (id: string) => void;
  setCustomWallpaper: (blob: Blob | null) => void;
  /** 设置锁屏壁纸预设（独立于主屏幕壁纸） */
  setLockWallpaperPreset: (id: string) => void;
  /** 设置锁屏自定义壁纸（null=移除自定义，回退到锁屏已选预设） */
  setLockCustomWallpaper: (blob: Blob | null) => void;
  updateApiConfig: (patch: Partial<ApiConfig>) => void;
  setApiPresets: (list: ApiPreset[]) => void;
  /** 更新识图模型配置（立即持久化；聊天发送时现场读取 → 保存后自动生效，无需重启） */
  updateVisionConfig: (patch: Partial<VisionConfig>) => void;
  setVisionPresets: (list: VisionPreset[]) => void;
  /** 更新生图配置（立即持久化；生成时现场读取 → 保存后自动生效，无需重启） */
  updateImgGenConfig: (patch: Partial<ImgGenConfig>) => void;
  setImgGenPresets: (list: ImgGenPreset[]) => void;
  applyLockConfig: (cfg: LockConfig) => void;
  /** 更新个人信息（立即持久化） */
  setProfile: (patch: Partial<Profile>) => void;
  /** 设置 AI 称呼方式（无 UI 入口；保留接口兼容，状态恒为 'name'） */
  setAddressMode: (m: AddressMode) => void;
  /** 更新语音 API 配置（立即持久化；播放时现场读取 → 保存后自动生效，无需重启） */
  updateTtsConfig: (patch: Partial<TtsConfig>) => void;
  /** 切换语音服务商（Task 29）：快照当前连接配置进本家槽位 → 恢复目标槽位（首次切换填该家默认值）；
   *  MiniMax 等已有 Key/GroupId/模型/默认音色互不覆盖 */
  switchTtsProvider: (next: TtsConfig['provider']) => void;
  /** 更新语音识别（STT）配置（立即持久化；转文字时现场读取 → 保存后自动生效，无需重启） */
  updateSttConfig: (patch: Partial<SttConfig>) => void;
  /** 设置/移除某 App 的自定义图标（blob=null 恢复默认），同步持久化到 IndexedDB */
  setCustomIcon: (appId: AppId, blob: Blob | null) => void;
  /** 清空全部自定义图标（全部恢复默认） */
  resetAllCustomIcons: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  // 主题默认浅色（用户要求）；load 时无记录/一次性迁移后也回退到浅色
  theme: 'light',
  wallpaperPreset: 'graphite',
  customWallpaperUrl: null,
  lockWallpaperPreset: 'graphite',
  lockCustomWallpaperUrl: null,
  apiConfig: { ...DEFAULT_API_CONFIG },
  apiPresets: [],
  visionConfig: { ...DEFAULT_VISION_CONFIG },
  visionPresets: [],
  imgGenConfig: { ...DEFAULT_IMGGEN_CONFIG },
  imgGenPresets: [],
  lockConfig: { lockScreen: true, enabled: false, code: '', len: 4 },
  profile: { ...DEFAULT_PROFILE },
  addressMode: 'name',
  ttsConfig: { ...DEFAULT_TTS_CONFIG },
  sttConfig: { ...DEFAULT_STT_CONFIG },
  customIcons: {},
  // 全局字体默认空 = 默认 iOS 系统字体（globals.css 的 body font-family 回退栈）
  appFontId: '',
  appFontScale: 1,
  appFontWeight: 400,
  statusBarVisible: true,
  islandPersistent: true,
  iconStyle: 'real',
  goodsImgStyle: 'cartoon',
  bubbleStyle: { wx: { ...DEFAULT_BUBBLE_STYLE.wx }, qq: { ...DEFAULT_BUBBLE_STYLE.qq }, sms: { ...DEFAULT_BUBBLE_STYLE.sms } },
  bubbleSchemes: [],
  liquidSkin: defaultLiquidSkinConfig(),
  chatDecor: defaultChatDecorConfig(),
  customCss: defaultCustomCss(),
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const [themeRec, wallpaperRec, lockWallpaperRec, apiRec, presetsRec, visionRec, visionPresetsRec, lockRec, profileRec, iconsRec, ttsRec, sttRec, imgGenRec, imgGenPresetsRec, fontRec, fontScaleRec, fontWeightRec, statusBarRec, iconStyleRec, goodsImgStyleRec, themeResetRec, islandPersistentRec, bubbleStyleRec, bubbleSchemesRec, liquidSkinRec, chatDecorRec, customCssRec] = await Promise.all([
        localDB.get('settings', 'theme'),
        localDB.get('settings', 'wallpaper'),
        localDB.get('settings', 'lockWallpaper'),
        localDB.get('settings', 'apiConfig'),
        localDB.get('settings', 'apiPresets'),
        localDB.get('settings', 'visionConfig'),
        localDB.get('settings', 'visionPresets'),
        localDB.get('settings', 'lock'),
        localDB.get('settings', 'profile'),
        localDB.get('settings', 'customIcons'),
        localDB.get('settings', 'ttsConfig'),
        localDB.get('settings', 'sttConfig'),
        localDB.get('settings', 'imgGenConfig'),
        localDB.get('settings', 'imgGenPresets'),
        localDB.get('settings', 'appFontId'),
        localDB.get('settings', 'appFontScale'),
        localDB.get('settings', 'appFontWeight'),
        localDB.get('settings', 'statusBarVisible'),
        localDB.get('settings', 'iconStyle'),
        localDB.get('settings', 'goodsImgStyle'),
        localDB.get('settings', 'themeDefaultLight'),
        localDB.get('settings', 'islandPersistent'),
        localDB.get('settings', 'bubbleStyle'),
        localDB.get('settings', 'bubbleSchemes'),
        localDB.get('settings', 'liquidSkin'),
        localDB.get('settings', 'chatDecor'),
        localDB.get('settings', 'customCss'),
      ]);

      // 性能：八个含密文信封的字段并行解密（getKey 并发单飞，密钥只读一次 IDB）——
      // 原先逐个 await 串行 ≈ 16 次异步（读 key + 解密 ×8），开机黑屏期的固定开销
      const [apiDec, presetsDec, visionDec, visionPresetsDec, ttsDec, sttDec, imgGenDec, imgGenPresetsDec] = await Promise.all([
        decryptValue<Partial<ApiConfig>>(apiRec?.value),
        decryptValue<ApiPreset[]>(presetsRec?.value),
        decryptValue<Partial<VisionConfig>>(visionRec?.value),
        decryptValue<VisionPreset[]>(visionPresetsRec?.value),
        decryptValue<Partial<TtsConfig>>(ttsRec?.value),
        decryptValue<Partial<SttConfig>>(sttRec?.value),
        decryptValue<Partial<ImgGenConfig>>(imgGenRec?.value),
        decryptValue<ImgGenPreset[]>(imgGenPresetsRec?.value),
      ]);

      // 图标风格：无记录/记录非法 → 'real'（真实图标）
      let iconStyle: IconStyle = 'real';
      const savedIconStyle = iconStyleRec?.value;
      if (savedIconStyle === 'glass' || savedIconStyle === 'liquid') iconStyle = savedIconStyle;

      // 商品图样式：无记录/记录非法 → 'cartoon'（kawaii 卡通插画）
      let goodsImgStyle: GoodsImgStyle = 'cartoon';
      if (goodsImgStyleRec?.value === 'sketch' || goodsImgStyleRec?.value === 'emoji') {
        goodsImgStyle = goodsImgStyleRec.value;
      }

      // 自定义 App 图标：{ AppId: Blob } → 为每个 Blob 建 ObjectURL
      let customIcons: Record<string, string> = {};
      if (iconsRec && typeof iconsRec.value === 'object' && iconsRec.value !== null) {
        for (const [k, v] of Object.entries(iconsRec.value as Record<string, unknown>)) {
          if (v instanceof Blob) customIcons[k] = URL.createObjectURL(v);
        }
      }

      let profile: Profile = { ...DEFAULT_PROFILE };
      if (profileRec && typeof profileRec.value === 'object' && profileRec.value !== null) {
        const v = profileRec.value as Partial<Profile>;
        profile = {
          name: typeof v.name === 'string' ? v.name : '',
          tag: typeof v.tag === 'string' ? v.tag : DEFAULT_PROFILE.tag,
          avatar:
            typeof v.avatar === 'string' && v.avatar.startsWith('data:image/') && v.avatar.length < 600_000
              ? v.avatar
              : null,
        };
      }

      let lockConfig: LockConfig = { lockScreen: true, enabled: false, code: '', len: 4 };
      if (lockRec && typeof lockRec.value === 'object' && lockRec.value !== null) {
        const v = lockRec.value as Partial<LockConfig>;
        lockConfig = {
          lockScreen: v.lockScreen !== false, // 旧记录无此字段 → 默认开启
          enabled: v.enabled === true,
          code: typeof v.code === 'string' ? v.code : '',
          len: v.len === 6 ? 6 : 4,
        };
      }

      // 主题默认浅色（用户要求）：无记录回退浅色；历史存储里的「深色」一次性重置为浅色
      //（否则用户之前测试时持久化的 dark 会让默认值改动不可见；重置后用户再手动切深色仍可保留）
      let theme: ThemeMode = 'light';
      if (themeRec && (themeRec.value === 'light' || themeRec.value === 'dark' || themeRec.value === 'auto')) {
        theme = themeRec.value;
      }
      const themeReset = !themeResetRec;
      if (themeReset && theme === 'dark') {
        theme = 'light';
        void localDB.put('settings', { key: 'theme', value: 'light' });
      }
      if (themeReset) void localDB.put('settings', { key: 'themeDefaultLight', value: true });

      let wallpaperPreset = 'graphite';
      let customWallpaperUrl: string | null = null;
      if (wallpaperRec && typeof wallpaperRec.value === 'object' && wallpaperRec.value !== null) {
        const w = wallpaperRec.value as { preset?: unknown; customBlob?: unknown };
        if (w.customBlob instanceof Blob) {
          customWallpaperUrl = URL.createObjectURL(w.customBlob);
        } else if (typeof w.preset === 'string' && WALLPAPER_PRESETS.some((p) => p.id === w.preset)) {
          wallpaperPreset = w.preset;
        }
      }

      // 锁屏壁纸（完全独立，默认 graphite）：{ preset, customBlob } 同时记录，移除自定义后可回退到已选预设
      let lockWallpaperPreset = 'graphite';
      let lockCustomWallpaperUrl: string | null = null;
      if (lockWallpaperRec && typeof lockWallpaperRec.value === 'object' && lockWallpaperRec.value !== null) {
        const lw = lockWallpaperRec.value as LockWallpaperRecord;
        if (typeof lw.preset === 'string' && WALLPAPER_PRESETS.some((p) => p.id === lw.preset)) {
          lockWallpaperPreset = lw.preset;
        }
        if (lw.customBlob instanceof Blob) {
          lockCustomWallpaperUrl = URL.createObjectURL(lw.customBlob);
        }
      }

      let apiConfig: ApiConfig = { ...DEFAULT_API_CONFIG };
      if (apiRec && typeof apiRec.value === 'object' && apiRec.value !== null) {
        // 兼容：旧版明文记录 / 新版密文信封都从这里解出
        const v = (apiDec ?? apiRec.value) as Partial<ApiConfig>;
        apiConfig = {
          baseUrl: typeof v.baseUrl === 'string' && v.baseUrl ? v.baseUrl : DEFAULT_API_CONFIG.baseUrl,
          apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
          model: typeof v.model === 'string' && v.model ? v.model : DEFAULT_API_CONFIG.model,
          temperature:
            typeof v.temperature === 'number' && v.temperature >= 0 && v.temperature <= 2
              ? v.temperature
              : DEFAULT_API_CONFIG.temperature,
          maxTokens: typeof v.maxTokens === 'number' ? v.maxTokens : DEFAULT_API_CONFIG.maxTokens,
        };
        // 旧版明文静默升级：立即以密文回写（有 apiKey 才有必要；无 key 的占位配置不动）
        const wasPlain = !('__enc' in (apiRec.value as object));
        if (wasPlain && typeof apiConfig.apiKey === 'string' && apiConfig.apiKey.length > 0) {
          void encryptValue(apiConfig)
            .then((enc) => localDB.put('settings', { key: 'apiConfig', value: enc }))
            .catch(() => undefined);
        }
      }

      let apiPresets: ApiPreset[] = [];
      if (presetsRec && presetsRec.value) {
        // 兼容：旧版明文数组 / 新版密文信封
        const pv = presetsDec ?? presetsRec.value;
        if (Array.isArray(pv)) {
          apiPresets = pv.filter(
            (p): p is ApiPreset =>
              typeof p === 'object' &&
              p !== null &&
              typeof (p as ApiPreset).id === 'string' &&
              typeof (p as ApiPreset).name === 'string' &&
              typeof (p as ApiPreset).config === 'object'
          );
          // 旧版明文含 apiKey 时静默升级为密文
          const hasKey = apiPresets.some((p) => typeof p.config?.apiKey === 'string' && p.config.apiKey.length > 0);
          if (!('__enc' in (presetsRec.value as object)) && hasKey) {
            void encryptValue(apiPresets)
              .then((enc) => localDB.put('settings', { key: 'apiPresets', value: enc }))
              .catch(() => undefined);
          }
        }
      }

      // 识图模型配置（含 apiKey，密文信封，与 apiConfig 同策略；未配置 = baseUrl 空）
      let visionConfig: VisionConfig = { ...DEFAULT_VISION_CONFIG };
      if (visionRec && typeof visionRec.value === 'object' && visionRec.value !== null) {
        const v = (visionDec ?? visionRec.value) as Partial<VisionConfig>;
        visionConfig = {
          baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : '',
          apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
          model: typeof v.model === 'string' ? v.model : '',
        };
        const visionWasPlain = !('__enc' in (visionRec.value as object));
        if (visionWasPlain && visionConfig.apiKey.length > 0) {
          void encryptValue(visionConfig)
            .then((enc) => localDB.put('settings', { key: 'visionConfig', value: enc }))
            .catch(() => undefined);
        }
      }

      let visionPresets: VisionPreset[] = [];
      if (visionPresetsRec && visionPresetsRec.value) {
        const vv = visionPresetsDec ?? visionPresetsRec.value;
        if (Array.isArray(vv)) {
          visionPresets = vv.filter(
            (p): p is VisionPreset =>
              typeof p === 'object' &&
              p !== null &&
              typeof (p as VisionPreset).id === 'string' &&
              typeof (p as VisionPreset).name === 'string' &&
              typeof (p as VisionPreset).config === 'object'
          );
          const visionHasKey = visionPresets.some((p) => typeof p.config?.apiKey === 'string' && p.config.apiKey.length > 0);
          if (!('__enc' in (visionPresetsRec.value as object)) && visionHasKey) {
            void encryptValue(visionPresets)
              .then((enc) => localDB.put('settings', { key: 'visionPresets', value: enc }))
              .catch(() => undefined);
          }
        }
      }

      // 语音 API 配置（含 apiKey，密文信封，与 apiConfig 同策略）
      let ttsConfig: TtsConfig = { ...DEFAULT_TTS_CONFIG };
      if (ttsRec && typeof ttsRec.value === 'object' && ttsRec.value !== null) {
        const v = (ttsDec ?? ttsRec.value) as Partial<TtsConfig>;
        ttsConfig = {
          provider: v.provider === 'builtin' || v.provider === 'openai' || v.provider === 'fishaudio' ? v.provider : 'minimax',
          baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : DEFAULT_TTS_CONFIG.baseUrl,
          apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
          groupId: typeof v.groupId === 'string' ? v.groupId : '',
          // 模型允许为空（OpenAI 兼容 / Fish Audio 可以不需要模型）：只有字段缺失/非字符串才回退默认值
          model: typeof v.model === 'string' ? v.model : DEFAULT_TTS_CONFIG.model,
          defaultVoiceId: typeof v.defaultVoiceId === 'string' ? v.defaultVoiceId : '',
          // 多服务商分槽（Task 29）：旧存档无此字段 → 空对象（首次切换服务商时自动把当前配置快照进槽）
          accounts: sanitizeTtsAccounts(v.accounts),
        };
        const ttsWasPlain = !('__enc' in (ttsRec.value as object));
        if (ttsWasPlain && ttsConfig.apiKey.length > 0) {
          void encryptValue(ttsConfig)
            .then((enc) => localDB.put('settings', { key: 'ttsConfig', value: enc }))
            .catch(() => undefined);
        }
      }

      // 语音识别（STT）配置（含 apiKey，密文信封，与 TTS 同策略；provider 缺省 builtin）
      let sttConfig: SttConfig = { ...DEFAULT_STT_CONFIG };
      if (sttRec && typeof sttRec.value === 'object' && sttRec.value !== null) {
        const v = (sttDec ?? sttRec.value) as Partial<SttConfig>;
        sttConfig = {
          provider: v.provider === 'openai' ? 'openai' : 'builtin',
          baseUrl: typeof v.baseUrl === 'string' && v.baseUrl ? v.baseUrl : DEFAULT_STT_CONFIG.baseUrl,
          apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
          model: typeof v.model === 'string' ? v.model : DEFAULT_STT_CONFIG.model,
          // 旧存档无此字段：默认开启浏览器实时识别
          webSpeech: typeof v.webSpeech === 'boolean' ? v.webSpeech : DEFAULT_STT_CONFIG.webSpeech,
        };
        const sttWasPlain = !('__enc' in (sttRec.value as object));
        if (sttWasPlain && sttConfig.apiKey.length > 0) {
          void encryptValue(sttConfig)
            .then((enc) => localDB.put('settings', { key: 'sttConfig', value: enc }))
            .catch(() => undefined);
        }
      }

      // 生图配置（含 apiKey，密文信封，与 visionConfig 同策略）
      let imgGenConfig: ImgGenConfig = { ...DEFAULT_IMGGEN_CONFIG };
      if (imgGenRec && typeof imgGenRec.value === 'object' && imgGenRec.value !== null) {
        const v = (imgGenDec ?? imgGenRec.value) as Partial<ImgGenConfig>;
        imgGenConfig = {
          enabled: v.enabled === true,
          mode: v.mode === 'direct' ? 'direct' : 'proxy',
          baseUrl: typeof v.baseUrl === 'string' && v.baseUrl ? v.baseUrl : DEFAULT_IMGGEN_CONFIG.baseUrl,
          apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
          model: typeof v.model === 'string' && v.model ? v.model : DEFAULT_IMGGEN_CONFIG.model,
          size: typeof v.size === 'string' && v.size ? v.size : DEFAULT_IMGGEN_CONFIG.size,
          quality: typeof v.quality === 'string' && v.quality ? v.quality : DEFAULT_IMGGEN_CONFIG.quality,
          extraPrompt: typeof v.extraPrompt === 'string' ? v.extraPrompt : '',
        };
        const imgGenWasPlain = !('__enc' in (imgGenRec.value as object));
        if (imgGenWasPlain && imgGenConfig.apiKey.length > 0) {
          void encryptValue(imgGenConfig)
            .then((enc) => localDB.put('settings', { key: 'imgGenConfig', value: enc }))
            .catch(() => undefined);
        }
      }

      let imgGenPresets: ImgGenPreset[] = [];
      if (imgGenPresetsRec && imgGenPresetsRec.value) {
        const gv = imgGenPresetsDec ?? imgGenPresetsRec.value;
        if (Array.isArray(gv)) {
          imgGenPresets = gv.filter(
            (p): p is ImgGenPreset =>
              typeof p === 'object' &&
              p !== null &&
              typeof (p as ImgGenPreset).id === 'string' &&
              typeof (p as ImgGenPreset).name === 'string' &&
              typeof (p as ImgGenPreset).config === 'object'
          );
          const imgGenHasKey = imgGenPresets.some((p) => typeof p.config?.apiKey === 'string' && p.config.apiKey.length > 0);
          if (!('__enc' in (imgGenPresetsRec.value as object)) && imgGenHasKey) {
            void encryptValue(imgGenPresets)
              .then((enc) => localDB.put('settings', { key: 'imgGenPresets', value: enc }))
              .catch(() => undefined);
          }
        }
      }

      // 开机门控收尾前预载主屏/锁屏壁纸（最多等 600ms 兜底，原 1500ms——亮度实测+解码通常
      // 百毫秒级完成，慢网大图场景宁可首帧稍晚铺图也不再多黑屏近一秒）:
      // 锁屏/主屏挂载首帧即完整壁纸 + 正确前景色，修复刚打开网页时锁屏壁纸「闪一下」
      const bootUrls: (string | null | undefined)[] = [customWallpaperUrl, lockCustomWallpaperUrl];
      for (const pid of [wallpaperPreset, lockWallpaperPreset]) {
        const bg = resolveWallpaperStyle(pid, null).backgroundImage;
        if (bg) bootUrls.push(bgImageUrlOf(bg));
      }
      await preloadWallpapersForBoot(bootUrls, 600);

      set({
        theme,
        wallpaperPreset,
        customWallpaperUrl,
        lockWallpaperPreset,
        lockCustomWallpaperUrl,
        apiConfig,
        apiPresets,
        visionConfig,
        visionPresets,
        imgGenConfig,
        imgGenPresets,
        lockConfig,
        profile,
        // 称呼方式已按用户要求固定为「用真实名字」：昵称只是 App 显示昵称，不再是可选项
        addressMode: 'name',
        ttsConfig,
        sttConfig,
        customIcons,
        // 全局字体：无记录/记录非法 → ''（默认 iOS 系统字体；应用由 PhoneShell 的 ensureAppFontApplied 完成）
        appFontId: typeof fontRec?.value === 'string' ? fontRec.value : '',
        appFontScale:
          typeof fontScaleRec?.value === 'number' && fontScaleRec.value >= 0.7 && fontScaleRec.value <= 1.6
            ? fontScaleRec.value
            : 1,
        appFontWeight:
          typeof fontWeightRec?.value === 'number' && [200, 300, 400, 500, 600].includes(fontWeightRec.value)
            ? fontWeightRec.value
            : 400,
        // 状态栏开关：无记录 = 显示（默认开）；仅接受布尔值
        statusBarVisible: typeof statusBarRec?.value === 'boolean' ? statusBarRec.value : true,
        // 灵动岛常驻：无记录 = 常驻（默认开）；仅接受布尔值
        islandPersistent: typeof islandPersistentRec?.value === 'boolean' ? islandPersistentRec.value : true,
        iconStyle,
        goodsImgStyle,
        // 聊天气泡装扮 + 收藏夹：无记录/脏数据回默认（normalize 内部校验 kind/color/结构）
        bubbleStyle: normalizeBubbleStyle(bubbleStyleRec?.value),
        bubbleSchemes: normalizeBubbleSchemes(bubbleSchemesRec?.value),
        // 液态玻璃皮肤：无记录/脏数据回默认（normalize 内部校验模式/文字/开关）
        liquidSkin: normalizeLiquidSkinConfig(liquidSkinRec?.value),
        // 聊天输入框自定义：无记录/脏数据回默认（normalize 内部校验文字长度/功能 key）
        chatDecor: normalizeChatDecorConfig(chatDecorRec?.value),
        // 自定义 CSS：无记录/脏数据回默认（normalize 内部夹长度/方案数量）
        customCss: normalizeCustomCss(customCssRec?.value),
        loaded: true,
      });
      // 锁屏被用户关闭：本次开机直接进主屏幕（跳过锁屏）
      if (!lockConfig.lockScreen) useUI.setState({ locked: false });
    } catch {
      set({ loaded: true });
    }
  },

  setLockScreen: (on) => {
    const cur = get().lockConfig;
    const cfg: LockConfig = on
      ? { ...cur, lockScreen: true }
      : { lockScreen: false, enabled: false, code: '', len: cur.len }; // 关锁屏即停用密码
    set({ lockConfig: cfg });
    void localDB.put('settings', { key: 'lock', value: { ...cfg } });
    if (!on) useUI.setState({ locked: false, screenOff: false, lockCameraOpen: false, torchOpen: false });
  },

  setAddressMode: (m) => {
    set({ addressMode: m });
    void localDB.put('settings', { key: 'addressMode', value: m });
  },

  setTheme: (t) => {
    set({ theme: t });
    void localDB.put('settings', { key: 'theme', value: t });
  },

  setIconStyle: (s) => {
    set({ iconStyle: s });
    void localDB.put('settings', { key: 'iconStyle', value: s });
  },

  setGoodsImgStyle: (s) => {
    set({ goodsImgStyle: s });
    void localDB.put('settings', { key: 'goodsImgStyle', value: s });
  },

  setBubbleStyle: (cfg) => {
    const safe = normalizeBubbleStyle(cfg);
    set({ bubbleStyle: safe });
    void localDB.put('settings', { key: 'bubbleStyle', value: safe });
  },

  setBubbleTheme: (app, theme) => {
    const cur = get().bubbleStyle;
    // 第四十五轮（用户指定）：切换主题时气泡跟着换——液态玻璃主题 → 液态玻璃气泡，
    // 古早主题 → 古早气泡，默认主题 → 原生默认气泡（自定义色一并还原）；
    // 之后再单独切气泡样式不再动主题（patchAppStyle 只写 kind）
    const next = normalizeBubbleStyle({
      ...cur,
      [app]: {
        ...cur[app],
        theme,
        kind: theme === 'liquid' ? 'liquid' : theme === 'retro' ? 'retro' : 'default',
        mineColor: undefined,
        theirsColor: undefined,
      },
    });
    set({ bubbleStyle: next });
    void localDB.put('settings', { key: 'bubbleStyle', value: next });
  },

  setBubbleSchemes: (list) => {
    const safe = normalizeBubbleSchemes(list);
    set({ bubbleSchemes: safe });
    void localDB.put('settings', { key: 'bubbleSchemes', value: safe });
  },

  setLiquidSkin: (app, patch) => {
    const cur = get().liquidSkin;
    const next = normalizeLiquidSkinConfig({ ...cur, [app]: { ...cur[app], ...patch } });
    set({ liquidSkin: next });
    void localDB.put('settings', { key: 'liquidSkin', value: next });
  },

  setChatDecor: (app, patch) => {
    const cur = get().chatDecor;
    const next = normalizeChatDecorConfig({ ...cur, [app]: { ...cur[app], ...patch } });
    set({ chatDecor: next });
    void localDB.put('settings', { key: 'chatDecor', value: next });
  },

  setCustomCssActive: (scope, css) => {
    const cur = get().customCss;
    // 第七十轮（按联系人隔离）：chat:app:联系人ID → 写进 chats[key]（空串 = 删除该联系人的条目）；
    // global / offline 仍是独立字段
    const next =
      scope === 'global' || scope === 'offline'
        ? normalizeCustomCss({ ...cur, [scope]: css })
        : normalizeCustomCss({ ...cur, chats: css.trim() ? { ...cur.chats, [scope.slice('chat:'.length)]: css } : omitKey(cur.chats, scope.slice('chat:'.length)) });
    set({ customCss: next });
    void localDB.put('settings', { key: 'customCss', value: next });
  },

  setCustomCssSchemes: (list) => {
    const cur = get().customCss;
    const next = normalizeCustomCss({ ...cur, schemes: list });
    set({ customCss: next });
    void localDB.put('settings', { key: 'customCss', value: next });
  },

  setAppFont: (id) => {
    set({ appFontId: id });
    void localDB.put('settings', { key: 'appFontId', value: id });
  },

  setAppFontScale: (scale) => {
    set({ appFontScale: scale });
    void localDB.put('settings', { key: 'appFontScale', value: scale });
  },

  setAppFontWeight: (weight) => {
    set({ appFontWeight: weight });
    void localDB.put('settings', { key: 'appFontWeight', value: weight });
  },

  setStatusBarVisible: (v) => {
    set({ statusBarVisible: v });
    void localDB.put('settings', { key: 'statusBarVisible', value: v });
  },

  setIslandPersistent: (v) => {
    set({ islandPersistent: v });
    void localDB.put('settings', { key: 'islandPersistent', value: v });
  },

  setWallpaperPreset: (id) => {
    const old = get().customWallpaperUrl;
    if (old) URL.revokeObjectURL(old);
    set({ wallpaperPreset: id, customWallpaperUrl: null });
    void localDB.put('settings', { key: 'wallpaper', value: { preset: id } });
  },

  setCustomWallpaper: (blob) => {
    const old = get().customWallpaperUrl;
    if (old) URL.revokeObjectURL(old);
    if (!blob) {
      set({ customWallpaperUrl: null });
      void localDB.put('settings', { key: 'wallpaper', value: { preset: get().wallpaperPreset } });
      return;
    }
    const url = URL.createObjectURL(blob);
    set({ customWallpaperUrl: url });
    void localDB.put('settings', { key: 'wallpaper', value: { customBlob: blob } });
  },

  setLockWallpaperPreset: (id) => {
    const old = get().lockCustomWallpaperUrl;
    if (old) URL.revokeObjectURL(old);
    set({ lockWallpaperPreset: id, lockCustomWallpaperUrl: null });
    void localDB.put('settings', { key: 'lockWallpaper', value: { preset: id } });
  },

  setLockCustomWallpaper: (blob) => {
    const old = get().lockCustomWallpaperUrl;
    if (old) URL.revokeObjectURL(old);
    const preset = get().lockWallpaperPreset;
    if (!blob) {
      set({ lockCustomWallpaperUrl: null });
      void localDB.put('settings', { key: 'lockWallpaper', value: { preset } });
      return;
    }
    const url = URL.createObjectURL(blob);
    set({ lockCustomWallpaperUrl: url });
    void localDB.put('settings', { key: 'lockWallpaper', value: { preset, customBlob: blob } });
  },

  updateApiConfig: (patch) => {
    const apiConfig = { ...get().apiConfig, ...patch };
    set({ apiConfig });
    // 「设置 › API 配置」保存即清空聊天重试冷却：用户填好配置回来重试立即放行，
    // 不再被「失败次数较多，请 N 秒后再试」拦住（配置已变，旧失败计数作废）
    clearAllChatCooldowns();
    // 安全：含 apiKey，密文落盘（AES-GCM 非可提取密钥），IndexedDB 不存明文
    void encryptValue(apiConfig)
      .then((v) => localDB.put('settings', { key: 'apiConfig', value: v }))
      .catch(() => undefined);
  },

  setApiPresets: (list) => {
    set({ apiPresets: list });
    // 安全：预设的 config 可能含 apiKey，同样密文落盘
    void encryptValue(list)
      .then((v) => localDB.put('settings', { key: 'apiPresets', value: v }))
      .catch(() => undefined);
  },

  updateVisionConfig: (patch) => {
    const visionConfig = { ...get().visionConfig, ...patch };
    set({ visionConfig });
    // 安全：含 apiKey，密文落盘（与 apiConfig 同策略）
    void encryptValue(visionConfig)
      .then((v) => localDB.put('settings', { key: 'visionConfig', value: v }))
      .catch(() => undefined);
  },

  setVisionPresets: (list) => {
    set({ visionPresets: list });
    void encryptValue(list)
      .then((v) => localDB.put('settings', { key: 'visionPresets', value: v }))
      .catch(() => undefined);
  },

  updateImgGenConfig: (patch) => {
    const imgGenConfig = { ...get().imgGenConfig, ...patch };
    set({ imgGenConfig });
    // 安全：含 apiKey，密文落盘（与 visionConfig 同策略）
    void encryptValue(imgGenConfig)
      .then((v) => localDB.put('settings', { key: 'imgGenConfig', value: v }))
      .catch(() => undefined);
  },

  setImgGenPresets: (list) => {
    set({ imgGenPresets: list });
    void encryptValue(list)
      .then((v) => localDB.put('settings', { key: 'imgGenPresets', value: v }))
      .catch(() => undefined);
  },

  updateTtsConfig: (patch) => {
    const ttsConfig = { ...get().ttsConfig, ...patch };
    // 多服务商分槽（Task 29）：当前是 API 服务商时把连接配置同步写进本家槽位（保证切换回来时是最新值）
    if (ttsConfig.provider !== 'builtin') {
      ttsConfig.accounts = {
        ...(ttsConfig.accounts ?? {}),
        [ttsConfig.provider]: {
          baseUrl: ttsConfig.baseUrl,
          apiKey: ttsConfig.apiKey,
          groupId: ttsConfig.groupId,
          model: ttsConfig.model,
          defaultVoiceId: ttsConfig.defaultVoiceId,
        },
      };
    }
    set({ ttsConfig });
    // 安全：含 apiKey，密文落盘（与 apiConfig 同策略）
    void encryptValue(ttsConfig)
      .then((v) => localDB.put('settings', { key: 'ttsConfig', value: v }))
      .catch(() => undefined);
  },

  /** 切换语音服务商（Task 29）：快照当前连接配置进本家槽位 → 恢复目标槽位（首次切换填该家默认值）。
   *  MiniMax 等已有 Key/GroupId/模型/默认音色互不覆盖 */
  switchTtsProvider: (next) => {
    const cur = get().ttsConfig;
    if (cur.provider === next) return;
    const accounts: NonNullable<TtsConfig['accounts']> = { ...(cur.accounts ?? {}) };
    if (cur.provider !== 'builtin') {
      accounts[cur.provider] = {
        baseUrl: cur.baseUrl,
        apiKey: cur.apiKey,
        groupId: cur.groupId,
        model: cur.model,
        defaultVoiceId: cur.defaultVoiceId,
      };
    }
    const saved = next === 'builtin' ? undefined : accounts[next];
    const firstDefaults: Record<TtsProviderKind, { baseUrl: string; model: string }> = {
      minimax: { baseUrl: 'https://api.minimax.chat', model: 'speech-01-turbo' },
      openai: { baseUrl: 'https://api.openai.com/v1', model: 'tts-1' },
      fishaudio: { baseUrl: FISHAUDIO_DEFAULT_BASE_URL, model: '' },
    };
    const d = next === 'builtin' ? undefined : firstDefaults[next];
    const ttsConfig: TtsConfig = {
      ...cur,
      provider: next,
      baseUrl: saved ? saved.baseUrl : d?.baseUrl ?? '',
      apiKey: saved?.apiKey ?? '',
      groupId: saved?.groupId ?? '',
      model: saved ? saved.model : d?.model ?? '',
      defaultVoiceId: saved?.defaultVoiceId ?? '',
      accounts,
    };
    set({ ttsConfig });
    void encryptValue(ttsConfig)
      .then((v) => localDB.put('settings', { key: 'ttsConfig', value: v }))
      .catch(() => undefined);
  },

  updateSttConfig: (patch) => {
    const sttConfig = { ...get().sttConfig, ...patch };
    set({ sttConfig });
    // 安全：含 apiKey，密文落盘（与 TTS 同策略）
    void encryptValue(sttConfig)
      .then((v) => localDB.put('settings', { key: 'sttConfig', value: v }))
      .catch(() => undefined);
  },

  applyLockConfig: (cfg) => {
    set({ lockConfig: { ...cfg } });
    void localDB.put('settings', { key: 'lock', value: { ...cfg } });
  },

  setProfile: (patch) => {
    const profile = { ...get().profile, ...patch };
    set({ profile });
    void localDB.put('settings', { key: 'profile', value: profile });
  },

  setCustomIcon: (appId, blob) => {
    set((s) => {
      const urls = { ...s.customIcons };
      if (blob) urls[appId] = URL.createObjectURL(blob);
      else delete urls[appId];
      return { customIcons: urls };
    });
    // 持久化：读出完整 Blob 映射，改完写回（store 内只保留 ObjectURL）
    void (async () => {
      try {
        const rec = await localDB.get('settings', 'customIcons');
        const value: Record<string, Blob> = {};
        if (rec && typeof rec.value === 'object' && rec.value !== null) {
          for (const [k, v] of Object.entries(rec.value as Record<string, unknown>)) {
            if (v instanceof Blob) value[k] = v;
          }
        }
        if (blob) value[appId] = blob;
        else delete value[appId];
        await localDB.put('settings', { key: 'customIcons', value });
      } catch {
        /* 持久化失败忽略：本次会话内仍生效 */
      }
    })();
  },

  resetAllCustomIcons: () => {
    for (const u of Object.values(get().customIcons)) URL.revokeObjectURL(u);
    set({ customIcons: {} });
    void localDB.put('settings', { key: 'customIcons', value: {} });
  },
}));

/** 解析后的实际主题（auto 跟随系统） */
export function selectResolvedTheme(theme: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (theme === 'auto') return systemDark ? 'dark' : 'light';
  return theme;
}

/** 由预设 id + 自定义 URL 解析壁纸背景样式（手机壳/锁屏/前景明暗共用，故导出）。
 *  自定义优先；预设 css 可能是 background 简写，需拆解。
 *  始终带 backgroundColor 底色：PNG 壁纸异步加载/解码前先铺不透明纯色，
 *  否则锁屏/主屏头几帧透明，会透出下层界面（刷新时主界面一闪而过的根因） */
export function resolveWallpaperStyle(presetId: string, customUrl: string | null): CSSProperties {
  if (customUrl) {
    return {
      backgroundColor: '#1c1c1e',
      backgroundImage: `url(${customUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }
  const preset = WALLPAPER_PRESETS.find((w) => w.id === presetId) ?? WALLPAPER_PRESETS[0];
  // 预设 css 可能是 background 简写（如 "url(...) center / cover no-repeat"），
  // 不能整体赋给 backgroundImage（浏览器会丢弃整条声明），需拆解
  if (preset.css.startsWith('url(')) {
    const end = preset.css.indexOf(')');
    const url = end > 4 ? preset.css.slice(4, end) : '';
    return {
      backgroundColor: preset.base,
      backgroundImage: `url(${url})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }
  return { backgroundColor: preset.base, backgroundImage: preset.css };
}

/** 主屏幕壁纸背景样式（手机壳用）。锁屏/前景明暗实测也需要它，故导出 */
export function useWallpaperStyle(): CSSProperties {
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  return useMemo(
    () => resolveWallpaperStyle(wallpaperPreset, customWallpaperUrl),
    [customWallpaperUrl, wallpaperPreset]
  );
}

/**
 * 锁屏壁纸（样式 + 明暗）：锁屏壁纸与主屏幕壁纸完全独立，永远用自己的预设/自定义，
 * 不再跟随主屏幕。手机壳壁纸层是主屏幕壁纸，锁屏自绘壁纸层盖住主屏幕。
 */
export function useLockWallpaper(): { style: CSSProperties; light: boolean } {
  const lockPreset = useSettings((s) => s.lockWallpaperPreset);
  const lockCustom = useSettings((s) => s.lockCustomWallpaperUrl);
  return useMemo(() => {
    if (lockCustom) {
      return {
        style: {
          backgroundImage: `url(${lockCustom})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } as CSSProperties,
        light: false, // 自定义壁纸按深色处理（与主屏逻辑一致）
      };
    }
    const preset = WALLPAPER_PRESETS.find((w) => w.id === lockPreset);
    return {
      style: resolveWallpaperStyle(preset?.id ?? WALLPAPER_PRESETS[0].id, null),
      light: preset?.light ?? false,
    };
  }, [lockCustom, lockPreset]);
}

// ---------------- 壁纸亮度实测（锁屏文字跟随背景色） ----------------

/** 区域平均亮度高于该值视为偏浅（该区域文字用黑色） */
const LIGHT_LUMINANCE_THRESHOLD = 0.5;

/** 图片壁纸亮度实测结果的模块级缓存（url → 三区域结果）：
 *  同一张壁纸被多处独立 hook消费（图标底座 ×N / 锁屏 / 状态栏 / 页点），
 *  共享缓存避免每个实例重复解码测量；后挂载的实例（如打开 Spotlight/多任务）
 *  首帧即命中，不会闪「测量中回退静态标记」的错误颜色。上限 32 条防泄漏 */
const wallpaperLightCache = new Map<string, { top: boolean; bottom: boolean; all: boolean }>();
const WALLPAPER_LIGHT_CACHE_MAX = 32;

/** 用已解码的图片实测三区域亮度并写入共享缓存（与 useMeasuredWallpaperLight 同一算法）。
 *  开机预热调用：锁屏/主屏挂载首帧即拿到正确前景色，不闪「测量中回退静态标记」的跳变 */
function measureWallpaperLightInto(url: string, img: HTMLImageElement): void {
  if (wallpaperLightCache.has(url)) return;
  try {
    const W = 32;
    const H = 64;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const rowLum: number[] = [];
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        sum += luminanceOf([data[i], data[i + 1], data[i + 2]]);
      }
      rowLum.push(sum / W);
    }
    const avgRows = (a: number, b: number) => {
      let sum = 0;
      for (let y = a; y < b; y++) sum += rowLum[y];
      return sum / (b - a);
    };
    if (wallpaperLightCache.size >= WALLPAPER_LIGHT_CACHE_MAX) {
      wallpaperLightCache.delete(wallpaperLightCache.keys().next().value as string);
    }
    wallpaperLightCache.set(url, {
      top: avgRows(0, Math.floor(H * 0.35)) > LIGHT_LUMINANCE_THRESHOLD,
      bottom: avgRows(Math.floor(H * 0.86), H) > LIGHT_LUMINANCE_THRESHOLD,
      all: avgRows(0, H) > LIGHT_LUMINANCE_THRESHOLD,
    });
  } catch {
    // 画布被污染等异常：静默放弃，hook 内回退预设静态标记
  }
}

/**
 * 开机预载壁纸（修复刚打开网页时锁屏「闪一下」）：
 * 黑屏开机门控期间把主屏/锁屏壁纸图提前拉取解码并预热亮度实测缓存，
 * 锁屏/主屏挂载首帧即完整壁纸 + 正确前景色，不再「先铺底色 → 图片弹入」。
 * data:/blob: 之外全部适用（data URL 无网络请求无需预载）；
 * 整体带超时兜底，最坏多等 timeoutMs 即放行，绝不卡死开机。
 */
async function preloadWallpapersForBoot(urls: (string | null | undefined)[], timeoutMs = 1500): Promise<void> {
  const list = [...new Set(urls.filter((u): u is string => !!u && !u.startsWith('data:')))];
  if (list.length === 0) return;
  const work = list.map(
    (url) =>
      new Promise<void>((res) => {
        const img = new Image();
        img.onload = () => {
          measureWallpaperLightInto(url, img);
          res();
        };
        img.onerror = () => res();
        img.src = url;
      })
  );
  await Promise.race([Promise.all(work), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

export interface WallpaperLightness {
  /** 顶部区域（状态栏/日期/大时钟/小组件，0–35%）是否偏浅：true=用黑字 */
  top: boolean | null;
  /** 底部区域（上滑提示/快捷按钮/Home 横杠，86–100%）是否偏浅：true=用黑字 */
  bottom: boolean | null;
  /** 整体平均亮度是否偏浅（主屏图标标签/页点分布在全屏，用整体判定）：true=用黑字 */
  all: boolean | null;
}

/** 从 backgroundImage 里提取第一张 url(...) 的图片地址 */
function bgImageUrlOf(bgImage: string): string | null {
  const m = bgImage.match(/url\((['"]?)([^'")]+)\1\)/);
  return m ? m[2] : null;
}

/** 解析 CSS 颜色为 [r,g,b]（支持 #rgb/#rrggbb/#rrggbbaa 与 rgb()/rgba()） */
function parseCssColor(input: string): [number, number, number] | null {
  const s = input.trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
    return null;
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

function luminanceOf([r, g, b]: [number, number, number]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * 分区域实测壁纸亮度（锁屏文字随背景变色）：
 * - 图片壁纸：解码后缩到 32×64 逐行取 Rec.709 亮度，顶部 0–35%（状态栏/时钟/小组件）与
 *   底部 86–100%（上滑提示/快捷按钮/Home 横杠）分别求均值 —— 解决「上亮下暗」壁纸
 *   （如雾山上白山+下深林）一刀切判色导致某端文字看不清的问题；
 * - 纯色/渐变壁纸：解析样式里的色值，按出现顺序（渐变自上而下）前半=顶/后半=底；
 * 返回 true=偏浅（黑字）/ false=偏深（白字）/ null=测量中或失败（调用方回退预设静态标记）。
 */
export function useMeasuredWallpaperLight(style: CSSProperties): WallpaperLightness {
  const bgImage = typeof style.backgroundImage === 'string' ? style.backgroundImage : '';
  const bgColor = typeof style.backgroundColor === 'string' ? style.backgroundColor : '';
  const url = useMemo(() => bgImageUrlOf(bgImage), [bgImage]);

  // 纯色/渐变壁纸：同步纯函数推导
  const colorLight = useMemo<WallpaperLightness>(() => {
    if (url) return { top: null, bottom: null, all: null }; // 图片壁纸走异步实测
    const tokens = `${bgColor} ${bgImage}`.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g) ?? [];
    const lums = tokens
      .map(parseCssColor)
      .filter((c): c is [number, number, number] => c !== null)
      .map(luminanceOf);
    if (lums.length === 0) return { top: null, bottom: null, all: null };
    const half = Math.max(1, Math.ceil(lums.length / 2));
    const avg = (arr: number[]) => arr.reduce((acc, v) => acc + v, 0) / arr.length;
    return {
      top: avg(lums.slice(0, half)) > LIGHT_LUMINANCE_THRESHOLD,
      bottom: avg(lums.slice(Math.max(0, lums.length - half))) > LIGHT_LUMINANCE_THRESHOLD,
      all: avg(lums) > LIGHT_LUMINANCE_THRESHOLD,
    };
  }, [bgColor, bgImage, url]);

  // 图片壁纸：解码后异步实测。结果绑定当时的 url，防止换壁纸瞬间新旧串值
  const [imgState, setImgState] = useState<{ url: string; top: boolean; bottom: boolean; all: boolean } | null>(null);
  useEffect(() => {
    if (!url) return;
    // 共享缓存已命中：渲染时已同步消费，无需重复解码测量
    if (wallpaperLightCache.has(url)) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        const W = 32;
        const H = 64;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return; // 保持 null → 回退静态标记
        ctx.drawImage(img, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);
        const rowLum: number[] = [];
        for (let y = 0; y < H; y++) {
          let sum = 0;
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            sum += luminanceOf([data[i], data[i + 1], data[i + 2]]);
          }
          rowLum.push(sum / W);
        }
        const avgRows = (a: number, b: number) => {
          let sum = 0;
          for (let y = a; y < b; y++) sum += rowLum[y];
          return sum / (b - a);
        };
        const result = {
          top: avgRows(0, Math.floor(H * 0.35)) > LIGHT_LUMINANCE_THRESHOLD,
          bottom: avgRows(Math.floor(H * 0.86), H) > LIGHT_LUMINANCE_THRESHOLD,
          all: avgRows(0, H) > LIGHT_LUMINANCE_THRESHOLD,
        };
        // 写入共享缓存（简单上限淘汰，防长会话换壁纸累积泄漏）
        if (wallpaperLightCache.size >= WALLPAPER_LIGHT_CACHE_MAX) {
          wallpaperLightCache.delete(wallpaperLightCache.keys().next().value as string);
        }
        wallpaperLightCache.set(url, result);
        setImgState({ url, ...result });
      } catch {
        // 画布被污染等异常：保持 null 回退静态标记
      }
    };
    img.onerror = () => {
      if (!cancelled) setImgState(null);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (url) {
    // 共享缓存命中：同步返回（后挂载的图标/多任务/Spotlight 首帧即拿到结果，
    // 不闪「测量中回退静态标记」的错误颜色，也避免 effect 内 setState）
    const cached = wallpaperLightCache.get(url);
    if (cached) return cached;
    return imgState && imgState.url === url
      ? { top: imgState.top, bottom: imgState.bottom, all: imgState.all }
      : { top: null, bottom: null, all: null };
  }
  return colorLight;
}

const darkMQ =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** 是否为系统深色模式（useSyncExternalStore 安全订阅） */
export function useSystemDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!darkMQ) return () => undefined;
      darkMQ.addEventListener('change', onChange);
      return () => darkMQ.removeEventListener('change', onChange);
    },
    () => darkMQ?.matches ?? false,
    () => false
  );
}

// ---------------- UI Store ----------------

export type AppId =
  | 'chat'
  | 'wechat'
  | 'qq'
  | 'taobao'
  | 'phone'
  | 'photos'
  | 'camera'
  | 'music'
  | 'browser'
  | 'weather'
  | 'clock'
  | 'themes'
  | 'files'
  | 'reminders'
  | 'calculator'
  | 'notes'
  | 'calendar'
  | 'recorder'
  | 'contacts'
  | 'settings'
  | 'appstore'
  | 'memory'
  | 'worldbook'
  | 'meituan'
  | 'couple'
  | 'cottage'
  | 'forum';

export type AppPhase = 'closed' | 'opening' | 'open' | 'closing';

/** 多任务卡片上限（最新在前） */
const MAX_RECENT_APPS = 6;

interface UIState {
  activeApp: AppId | null;
  phase: AppPhase;
  /** 最近使用过的 App（多任务切换器卡片，最新在前；关闭 App 仍保留在后台） */
  recentApps: AppId[];
  /** 多任务切换器是否打开（可在主屏幕或任一 App 内打开） */
  switcherOpen: boolean;
  /** 锁屏是否激活（页面加载即锁定；锁定时覆盖全部交互） */
  locked: boolean;
  /** 熄屏（电源键：亮屏锁定 ↔ 熄屏，黑屏遮罩） */
  screenOff: boolean;
  /** 锁屏直达相机（不解锁，关闭相机回锁屏） */
  lockCameraOpen: boolean;
  /** 锁屏手电筒补光开启（全屏白，前景需转黑） */
  torchOpen: boolean;
  /** 闹钟响铃弹层全屏显示中（背景色，前景随主题） */
  alarmRinging: boolean;
  /** 电话 App 通话全屏层显示中（深色背景，状态栏/Home 横杠需白前景） */
  callActive: boolean;
  /** 主屏幕编辑（抖动）模式进行中：底部边缘上滑手势不触发多任务切换器 */
  homeEdit: boolean;
  openApp: (id: AppId) => void;
  closeApp: () => void;
  openSwitcher: () => void;
  closeSwitcher: () => void;
  /** 切换器关闭动画期间先把前台 App 退到后台（立即露出主屏幕） */
  exitForegroundApp: () => void;
  /** 在切换器里点卡片：切到该 App（无论当前是否已有 App 在前台） */
  switchToApp: (id: AppId) => void;
  /** 在切换器里上滑卡片：彻底关闭该 App（若是前台 App 则一并退出） */
  killApp: (id: AppId) => void;
  /** 解锁（锁屏上滑验证通过） */
  unlock: () => void;
  /** 立即锁定（关闭一切 App/切换器/锁屏相机，回到锁屏） */
  lock: () => void;
  /** 电源键：熄屏 ↔ 亮屏锁定 */
  pressPower: () => void;
  setLockCameraOpen: (v: boolean) => void;
  setTorchOpen: (v: boolean) => void;
  setAlarmRinging: (v: boolean) => void;
  setCallActive: (v: boolean) => void;
  /** 跨 App 跳转：电话 App 联系人详情点「信息」→ 打开信息 App 后自动进入该联系人会话（相当于添加好友），消费后置回 null */
  pendingChatContact: string | null;
  setPendingChatContact: (id: string | null) => void;
  /** 跨 App 跳转：QQ 好友资料页「编辑资料」/ 微信好友详情页「朋友资料」→ 打开联系人 App 后直接进入该联系人的编辑页，消费后置回 null */
  pendingContactEdit: string | null;
  setPendingContactEdit: (id: string | null) => void;
  /** 跨 App 跳转：世界书「绑定角色」名单为空的「去创建」→ 打开联系人 App 后直接进入对应类型的新建表单（恒为 char），消费后置回 null */
  pendingContactCreate: 'char' | 'user' | 'npc' | null;
  setPendingContactCreate: (v: 'char' | 'user' | 'npc' | null) => void;
  /** 跨 App 跳转：微信搜索页网络结果 → 打开浏览器 App 后直接导航到该网页，消费后置回 null */
  pendingBrowserUrl: string | null;
  setPendingBrowserUrl: (url: string | null) => void;
  /** 跨 App 跳转：X 论坛「生图模型」入口等 → 打开设置 App 后直接进入指定设置页（如 imggen 图像生成），消费后置回 null */
  pendingSettingsPage: string | null;
  setPendingSettingsPage: (v: string | null) => void;
}

export const useUI = create<UIState>((set, get) => ({
  activeApp: null,
  phase: 'closed',
  recentApps: [],
  switcherOpen: false,
  locked: true,
  screenOff: false,
  lockCameraOpen: false,
  torchOpen: false,
  alarmRinging: false,
  callActive: false,
  homeEdit: false,
  pendingChatContact: null,
  setPendingChatContact: (v) => {
    set({ pendingChatContact: v });
  },
  pendingContactEdit: null,
  setPendingContactEdit: (v) => {
    set({ pendingContactEdit: v });
  },
  pendingContactCreate: null,
  setPendingContactCreate: (v) => {
    set({ pendingContactCreate: v });
  },
  pendingBrowserUrl: null,
  setPendingBrowserUrl: (v) => {
    set({ pendingBrowserUrl: v });
  },
  pendingSettingsPage: null,
  setPendingSettingsPage: (v) => {
    set({ pendingSettingsPage: v });
  },
  openApp: (id) => {
    if (get().locked) return; // 锁屏时禁止打开 App（锁屏直达相机走 lockCameraOpen）
    if (get().activeApp || get().phase !== 'closed') return;
    set({
      activeApp: id,
      phase: 'opening',
      switcherOpen: false,
      recentApps: [id, ...get().recentApps.filter((a) => a !== id)].slice(0, MAX_RECENT_APPS),
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (useUI.getState().phase === 'opening') set({ phase: 'open' });
      });
    });
  },
  closeApp: () => {
    if (get().locked) return;
    if (!get().activeApp || get().phase === 'closing') return;
    set({ phase: 'closing' });
    window.setTimeout(() => {
      if (useUI.getState().phase === 'closing') set({ activeApp: null, phase: 'closed' });
    }, 380);
  },
  openSwitcher: () => {
    // 主屏幕或 App 内都可打开（打开/关闭动画进行中除外；锁定时禁止）
    if (get().locked) return;
    if (get().switcherOpen || get().phase === 'opening' || get().phase === 'closing') return;
    // 全局语音通话全屏页守卫（C-4）：全屏通话页 z-62 在切换器 z-60 之上（层级表既定设计，不改数值），
    // 此刻打开切换器会被通话页完全盖住 → 「隐形切换器」（Home 横杠消失、界面无变化，
    // 且 switcherOpen 后边缘手势被 onDown 短路、z-60 遮罩在 z-62 之下点不到，挂断后才凭空出现）。
    // 处理：直接忽略本次手势——通话页保持最前、Home 横杠不隐藏；用户先点通话页左上角小窗图标
    // 收成悬浮小窗（view='pip'，z-64）后，上滑即可正常打开切换器。
    // 不采用「先最小化再打开」：小窗 z-64 悬在切换器之上，切换器开着时点小窗 expand() 回全屏
    // （z-62）又落到切换器之下，同样复现隐形切换器卡死，而 expand 在 global-call store 无法在此守卫。
    const gCall = useGlobalCall.getState();
    if (gCall.session && gCall.view === 'full') return;
    // 来电响铃中守卫（#1）：来电界面挂 z-94，比切换器 z-60 高得多，且 onDown 也会守卫——
    // 此处双保险：响铃中 openSwitcher 永不应被触发（即使旧调用方绕过边缘手势直接调用本 action）。
    if (useIncomingCall.getState().call) return;
    set({ switcherOpen: true });
  },
  closeSwitcher: () => {
    if (get().switcherOpen) set({ switcherOpen: false });
  },
  exitForegroundApp: () => {
    if (get().activeApp) set({ activeApp: null, phase: 'closed' });
  },
  switchToApp: (id) => {
    if (get().locked) return;
    set({
      activeApp: id,
      phase: 'open',
      switcherOpen: false,
      recentApps: [id, ...get().recentApps.filter((a) => a !== id)].slice(0, MAX_RECENT_APPS),
    });
  },
  killApp: (id) => {
    const patch: Partial<UIState> = { recentApps: get().recentApps.filter((a) => a !== id) };
    if (get().activeApp === id) {
      patch.activeApp = null;
      patch.phase = 'closed';
    }
    set(patch);
  },
  unlock: () => {
    set({ locked: false, screenOff: false, lockCameraOpen: false, torchOpen: false });
  },
  lock: () => {
    set({
      locked: true,
      screenOff: false,
      lockCameraOpen: false,
      torchOpen: false,
      activeApp: null,
      phase: 'closed',
      switcherOpen: false,
    });
  },
  pressPower: () => {
    const s = get();
    const lockScreen = useSettings.getState().lockConfig.lockScreen;
    if (s.screenOff) {
      // 熄屏 → 亮屏：有锁屏回锁定界面；无锁屏保持原界面
      set(lockScreen ? { screenOff: false, locked: true } : { screenOff: false });
    } else if (lockScreen) {
      // 熄屏并锁定（退出一切前台界面）
      set({
        screenOff: true,
        locked: true,
        lockCameraOpen: false,
        torchOpen: false,
        activeApp: null,
        phase: 'closed',
        switcherOpen: false,
      });
    } else {
      // 无锁屏：仅熄屏，保留当前界面
      set({ screenOff: true });
    }
  },
  setLockCameraOpen: (v) => {
    set({ lockCameraOpen: v });
  },
  setTorchOpen: (v) => {
    set({ torchOpen: v });
  },
  setAlarmRinging: (v) => {
    set({ alarmRinging: v });
  },
  setCallActive: (v) => {
    set({ callActive: v });
  },
}));
