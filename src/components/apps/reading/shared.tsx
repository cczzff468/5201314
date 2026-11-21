'use client';

/**
 * 阅读 App · 共享常量与工具（客户端）
 * - App 主题（蓝色玻璃毛玻璃主调 + 可切换）
 * - 阅读背景（内置 + 自定义上传）
 * - 内置字体（+ 自定义上传）
 * - 精选书单（首页分类推荐）
 * - API 薄封装
 */
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// 全局常量：手机状态栏高度（StatusBar 覆盖层高 54px，页面顶部需预留）
// ---------------------------------------------------------------------------
export const SB_H = 54;

// ---------------------------------------------------------------------------
// 排版设置类型（与 /api/reading/settings 对齐）
// ---------------------------------------------------------------------------
export interface ReaderSettings {
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold' | 'light';
  bgTheme: string;
  bgCustom: string | null;
  fontCustom: string | null;
  appTheme: string;
  letterSpacing: number;
  lineSpacing: number;
  paraSpacing: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  titlePosition: 'left' | 'center' | 'hidden';
  justify: boolean;
  bottomAlign: boolean;
  underline: boolean;
  /** 阅读页脚：显示时间 */
  showTime: boolean;
  /** 阅读页脚：显示电量 */
  showBattery: boolean;
  /** 翻页动画：slide 平移 | cover 覆盖 | none 无动画 | fade 淡入 | curl 仿真 | scroll 滚动 */
  pageAnim: 'slide' | 'cover' | 'none' | 'fade' | 'curl' | 'scroll';
  /** 音量键翻页（APK 原生壳生效；预览里等价方向键/PageUp/Down） */
  keyTurn: boolean;
  /** 全屏点击翻页（左右1/3翻页·中丨1/3菜单；关闭后点屏幕只弹菜单） */
  clickTurn: boolean;
  /** 段首缩进（字数：0~4；默认 2） */
  textIndent: number;
  /** 中文排版优化（两端对齐时标点挤压更整齐） */
  cjkOptimize: boolean;
  /** 适配特殊样式（识别正文里 [newpage] 等特殊标记并优化排版） */
  specialTags: boolean;
  /** 繁简转换：off 关闭 | s2t 简转繁 | t2s 繁转简 */
  s2t: 'off' | 's2t' | 't2s';
  /** 屏幕亮度 0-100（100=最亮不遮罩；跟随系统亮度时不生效） */
  brightness: number;
  /** 亮度跟随系统（关闭后应用自定义亮度遮罩） */
  brightnessAuto: boolean;
  /** 屏幕常亮（阅读时保持亮屏） */
  keepScreenOn: boolean;
  /** 自动阅读：每 N 秒自动翻一页（0=关；建议 10-30） */
  autoReadSec: number;
  /** 排版预设（保存的排版方案） */
  presets: ReaderPreset[];
  /** 我的资料：昵称 / 自定义 ID / 头像 */
  profileName: string | null;
  profileId: string | null;
  profileAvatar: string | null;
  /** 书架自定义分组名列表 */
  customGroups: string[];
}

/** 排版预设（「保存排版」一键回切） */
export interface ReaderPreset {
  id: string;
  name: string;
  data: Pick<
    ReaderSettings,
    | 'fontSize'
    | 'fontFamily'
    | 'fontWeight'
    | 'letterSpacing'
    | 'lineSpacing'
    | 'paraSpacing'
    | 'marginLeft'
    | 'marginRight'
    | 'marginTop'
    | 'marginBottom'
    | 'titlePosition'
    | 'justify'
    | 'underline'
    | 'textIndent'
    | 'cjkOptimize'
  >;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 20,
  fontFamily: 'system',
  fontWeight: 'normal',
  bgTheme: 'paper',
  bgCustom: null,
  fontCustom: null,
  appTheme: 'ocean',
  letterSpacing: 0,
  lineSpacing: 1.9,
  paraSpacing: 0.9,
  marginLeft: 5,
  marginRight: 5,
  marginTop: 4,
  marginBottom: 4,
  titlePosition: 'left',
  justify: true,
  bottomAlign: false,
  underline: false,
  showTime: true,
  showBattery: true,
  pageAnim: 'slide',
  keyTurn: false,
  clickTurn: true,
  textIndent: 2,
  cjkOptimize: false,
  specialTags: true,
  s2t: 'off',
  brightness: 100,
  brightnessAuto: true,
  keepScreenOn: false,
  autoReadSec: 0,
  presets: [],
  profileName: null,
  profileId: null,
  profileAvatar: null,
  customGroups: [],
};

// ---------------------------------------------------------------------------
// App 主题（玻璃毛玻璃风格：磨砂胶囊 + 主色点缀）
// ---------------------------------------------------------------------------
export interface AppTheme {
  key: string;
  name: string;
  /** 主色 */
  accent: string;
  /** 主色浅底（图标容器/胶囊选中底） */
  accentSoft: string;
  /** 渐变（banner/按钮） */
  gradFrom: string;
  gradTo: string;
  /** 页面底色 */
  pageBg: string;
  /** 卡片底（半透玻璃） */
  cardBg: string;
  /** 卡片描边 */
  cardRing: string;
  /** TabBar 玻璃底 */
  barBg: string;
  /** 文本主色 */
  textMain: string;
  /** 文本次色 */
  textSub: string;
}

export const APP_THEMES: Record<string, AppTheme> = {
  ocean: {
    key: 'ocean',
    name: '海洋蓝',
    accent: '#2274F0',
    accentSoft: 'rgba(34,116,240,0.12)',
    gradFrom: '#7EC3FF',
    gradTo: '#2274F0',
    pageBg: '#F2F5FA',
    cardBg: 'rgba(255,255,255,0.58)',
    cardRing: 'rgba(34,116,240,0.10)',
    barBg: 'rgba(255,255,255,0.62)',
    textMain: '#1A1D26',
    textSub: '#8A909C',
  },
  aurora: {
    key: 'aurora',
    name: '极光紫',
    accent: '#7C5CFC',
    accentSoft: 'rgba(124,92,252,0.12)',
    gradFrom: '#B9A4FF',
    gradTo: '#7C5CFC',
    pageBg: '#F4F2FB',
    cardBg: 'rgba(255,255,255,0.58)',
    cardRing: 'rgba(124,92,252,0.10)',
    barBg: 'rgba(255,255,255,0.62)',
    textMain: '#1B1A26',
    textSub: '#8B889C',
  },
  midnight: {
    key: 'midnight',
    name: '暗夜黑',
    accent: '#5B8DEF',
    accentSoft: 'rgba(91,141,239,0.16)',
    gradFrom: '#3A4A6B',
    gradTo: '#1E2740',
    pageBg: '#12141C',
    cardBg: 'rgba(30,33,46,0.66)',
    cardRing: 'rgba(255,255,255,0.07)',
    barBg: 'rgba(22,24,34,0.72)',
    textMain: '#E8EAF2',
    textSub: '#7A7F90',
  },
  sakura: {
    key: 'sakura',
    name: '樱花粉',
    accent: '#EC5E9C',
    accentSoft: 'rgba(236,94,156,0.12)',
    gradFrom: '#FFB6D2',
    gradTo: '#EC5E9C',
    pageBg: '#FBF3F7',
    cardBg: 'rgba(255,255,255,0.58)',
    cardRing: 'rgba(236,94,156,0.10)',
    barBg: 'rgba(255,255,255,0.62)',
    textMain: '#261A22',
    textSub: '#9C8894',
  },
  jade: {
    key: 'jade',
    name: '翡翠绿',
    accent: '#10A37F',
    accentSoft: 'rgba(16,163,127,0.12)',
    gradFrom: '#7DDFC0',
    gradTo: '#10A37F',
    pageBg: '#F1F8F5',
    cardBg: 'rgba(255,255,255,0.58)',
    cardRing: 'rgba(16,163,127,0.10)',
    barBg: 'rgba(255,255,255,0.62)',
    textMain: '#182521',
    textSub: '#87968F',
  },
};

export function themeOf(key: string): AppTheme {
  return APP_THEMES[key] || APP_THEMES.ocean;
}

// ---------------------------------------------------------------------------
// 阅读背景（内置 + 自定义）
// ---------------------------------------------------------------------------
export interface ReadBg {
  key: string;
  name: string;
  bg: string;
  text: string;
  sub: string;
  dark?: boolean;
}

export const READ_BGS: ReadBg[] = [
  { key: 'paper', name: '纸张', bg: '#F7F3E8', text: '#3B3A36', sub: '#8A867A' },
  { key: 'white', name: '纯白', bg: '#FFFFFF', text: '#26262A', sub: '#8A8A90' },
  { key: 'green', name: '护眼', bg: '#CBE6C7', text: '#2D3B2E', sub: '#6E8470' },
  { key: 'cream', name: '米黄', bg: '#F5E9D0', text: '#4A4234', sub: '#94886E' },
  { key: 'gray', name: '浅灰', bg: '#E8E8EC', text: '#33343A', sub: '#82838C' },
  { key: 'night', name: '夜间', bg: '#15161B', text: '#B8BAC4', sub: '#63656F', dark: true },
];

export function bgOf(s: ReaderSettings): { bg: string; text: string; sub: string; dark: boolean } {
  if (s.bgTheme === 'custom' && s.bgCustom) {
    // 自定义背景按亮度猜文字色（dataURL 图片无法同步取亮度，默认深字）
    return { bg: `center/cover no-repeat url(${s.bgCustom}) #f3f3f3`, text: '#333', sub: '#888', dark: false };
  }
  const b = READ_BGS.find((x) => x.key === s.bgTheme) || READ_BGS[0];
  return { bg: b.bg, text: b.text, sub: b.sub, dark: !!b.dark };
}

// ---------------------------------------------------------------------------
// 字体
// ---------------------------------------------------------------------------
export interface FontOpt {
  key: string;
  name: string;
  css: string;
}

export const BUILTIN_FONTS: FontOpt[] = [
  { key: 'system', name: '默认', css: 'inherit' },
  { key: 'songti', name: '宋体', css: '"Songti SC","STSong","SimSun",serif' },
  { key: 'kaiti', name: '楷体', css: '"Kaiti SC","STKaiti","KaiTi",serif' },
  { key: 'heiti', name: '黑体', css: '"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif' },
  { key: 'fangsong', name: '仿宋', css: '"Fangsong","STFangsong","FangSong",serif' },
];

export function fontCss(s: ReaderSettings): string {
  if (s.fontFamily === 'custom' && s.fontCustom) return `"ReadingCustomFont","${s.fontFamily}"`;
  return (BUILTIN_FONTS.find((f) => f.key === s.fontFamily) || BUILTIN_FONTS[0]).css;
}

export const FONT_WEIGHTS: { key: ReaderSettings['fontWeight']; name: string; css: number }[] = [
  { key: 'light', name: '细体', css: 300 },
  { key: 'normal', name: '常规', css: 400 },
  { key: 'bold', name: '粗体', css: 700 },
];

// ---------------------------------------------------------------------------
// 精选书单（首页/分类页推荐：点击直达聚合搜索）—— 每分类 50+ 本精选好书
// ---------------------------------------------------------------------------
export interface FeaturedBook {
  name: string;
  author: string;
  tag: string;
}
export const FEATURED: Record<string, FeaturedBook[]> = {
  热门: [
    { name: '诡秘之主', author: '爱潜水的乌贼', tag: '玄幻' },
    { name: '斗破苍穹', author: '天蚕土豆', tag: '玄幻' },
    { name: '凡人修仙传', author: '忘语', tag: '仙侠' },
    { name: '庆余年', author: '猫腻', tag: '古装' },
    { name: '盗墓笔记', author: '南派三叔', tag: '悬疑' },
    { name: '三体', author: '刘慈欣', tag: '科幻' },
    { name: '赘婿', author: '愤怒的香蕉', tag: '都市' },
    { name: '全职高手', author: '蝴蝶蓝', tag: '都市' },
    { name: '遮天', author: '辰东', tag: '玄幻' },
    { name: '完美世界', author: '辰东', tag: '玄幻' },
    { name: '天官赐福', author: '墨香铜臭', tag: '耽美' },
    { name: '魔道祖师', author: '墨香铜臭', tag: '耽美' },
    { name: '撒野', author: '巫哲', tag: '耽美' },
    { name: '默读', author: 'priest', tag: '耽美' },
    { name: '杀破狼', author: 'priest', tag: '耽美' },
    { name: '长安的荔枝', author: '马伯庸', tag: '都市' },
    { name: '活着', author: '余华', tag: '现实' },
    { name: '白夜行', author: '东野圭吾', tag: '悬疑' },
    { name: '嫌疑人X的献身', author: '东野圭吾', tag: '悬疑' },
    { name: '风声', author: '麦家', tag: '谍战' },
    { name: '人世间', author: '梁晓声', tag: '现实' },
    { name: '平凡的世界', author: '路遥', tag: '现实' },
    { name: '沙丘', author: '弗兰克·赫伯特', tag: '科幻' },
    { name: '银河帝国', author: '艾萨克·阿西莫夫', tag: '科幻' },
    { name: '安德的游戏', author: '奥森·斯科特·卡德', tag: '科幻' },
    { name: '刀剑神域', author: '川原砾', tag: '轻小说' },
    { name: '无职转生', author: '理不尽な孙の手', tag: '轻小说' },
    { name: 'Re:从零开始的异世界生活', author: '長月達平', tag: '轻小说' },
    { name: '关于我转生变成史莱姆这件事', author: '伏濑', tag: '轻小说' },
    { name: '斗罗大陆', author: '唐家三少', tag: '玄幻' },
    { name: '雪中悍刀行', author: '烽火戏诸侯', tag: '武侠' },
    { name: '大奉打更人', author: '卖报小郎君', tag: '玄幻' },
    { name: '剑来', author: '烽火戏诸侯', tag: '仙侠' },
    { name: '圣墟', author: '辰东', tag: '玄幻' },
    { name: '武动乾坤', author: '天蚕土豆', tag: '玄幻' },
    { name: '大主宰', author: '天蚕土豆', tag: '玄幻' },
    { name: '元尊', author: '天蚕土豆', tag: '玄幻' },
    { name: '一念永恒', author: '耳根', tag: '仙侠' },
    { name: '仙逆', author: '耳根', tag: '仙侠' },
    { name: '诛仙', author: '萧鼎', tag: '仙侠' },
    { name: '牧神记', author: '宅猪', tag: '玄幻' },
    { name: '十宗罪', author: '蜘蛛', tag: '悬疑' },
    { name: '法医秦明', author: '秦明', tag: '悬疑' },
    { name: '鬼吹灯', author: '天下霸唱', tag: '悬疑' },
    { name: '坏小孩', author: '紫金陈', tag: '悬疑' },
    { name: '长夜难明', author: '紫金陈', tag: '悬疑' },
    { name: '心理罪', author: '雷米', tag: '悬疑' },
    { name: '暗算', author: '麦家', tag: '谍战' },
    { name: '二哈和他的白猫师尊', author: '肉包不吃肉', tag: '耽美' },
    { name: '伪装学渣', author: '木瓜黄', tag: '耽美' },
    { name: '某某', author: '木苏里', tag: '耽美' },
    { name: '全球高考', author: '木苏里', tag: '耽美' },
    { name: '药屋少女的呢喃', author: '日向夏', tag: '轻小说' },
    { name: '我的青春恋爱物语果然有问题', author: '渡航', tag: '轻小说' },
    { name: '流浪地球', author: '刘慈欣', tag: '科幻' },
    { name: '球状闪电', author: '刘慈欣', tag: '科幻' },
    { name: '无人生还', author: '阿加莎·克里斯蒂', tag: '悬疑' },
    { name: '福尔摩斯探案全集', author: '阿瑟·柯南·道尔', tag: '悬疑' },
    { name: '克拉拉与太阳', author: '石黑一雄', tag: '科幻' },
  ],
  玄幻: [
    { name: '斗破苍穹', author: '天蚕土豆', tag: '玄幻' },
    { name: '遮天', author: '辰东', tag: '玄幻' },
    { name: '完美世界', author: '辰东', tag: '玄幻' },
    { name: '圣墟', author: '辰东', tag: '玄幻' },
    { name: '长生界', author: '辰东', tag: '玄幻' },
    { name: '斗罗大陆', author: '唐家三少', tag: '玄幻' },
    { name: '绝世唐门', author: '唐家三少', tag: '玄幻' },
    { name: '龙王传说', author: '唐家三少', tag: '玄幻' },
    { name: '终极斗罗', author: '唐家三少', tag: '玄幻' },
    { name: '神印王座', author: '唐家三少', tag: '玄幻' },
    { name: '一念永恒', author: '耳根', tag: '仙侠' },
    { name: '仙逆', author: '耳根', tag: '仙侠' },
    { name: '求魔', author: '耳根', tag: '仙侠' },
    { name: '我欲封天', author: '耳根', tag: '仙侠' },
    { name: '三寸人间', author: '耳根', tag: '仙侠' },
    { name: '剑来', author: '烽火戏诸侯', tag: '仙侠' },
    { name: '雪中悍刀行', author: '烽火戏诸侯', tag: '武侠' },
    { name: '大道朝天', author: '烽火戏诸侯', tag: '仙侠' },
    { name: '大奉打更人', author: '卖报小郎君', tag: '玄幻' },
    { name: '万相之王', author: '天蚕土豆', tag: '玄幻' },
    { name: '武动乾坤', author: '天蚕土豆', tag: '玄幻' },
    { name: '大主宰', author: '天蚕土豆', tag: '玄幻' },
    { name: '元尊', author: '天蚕土豆', tag: '玄幻' },
    { name: '凡人修仙传', author: '忘语', tag: '仙侠' },
    { name: '魔天记', author: '忘语', tag: '仙侠' },
    { name: '玄界之门', author: '忘语', tag: '仙侠' },
    { name: '莽荒纪', author: '我吃西红柿', tag: '玄幻' },
    { name: '吞噬星空', author: '我吃西红柿', tag: '科幻' },
    { name: '盘龙', author: '我吃西红柿', tag: '玄幻' },
    { name: '星辰变', author: '我吃西红柿', tag: '玄幻' },
    { name: '九鼎记', author: '我吃西红柿', tag: '玄幻' },
    { name: '佛本是道', author: '梦入神机', tag: '玄幻' },
    { name: '阳神', author: '梦入神机', tag: '玄幻' },
    { name: '圣王', author: '梦入神机', tag: '玄幻' },
    { name: '诛仙', author: '萧鼎', tag: '仙侠' },
    { name: '搜神记', author: '树下野狐', tag: '玄幻' },
    { name: '蛮荒记', author: '树下野狐', tag: '玄幻' },
    { name: '尘缘', author: '烟雨江南', tag: '仙侠' },
    { name: '亵渎', author: '烟雨江南', tag: '玄幻' },
    { name: '永夜君王', author: '烟雨江南', tag: '玄幻' },
    { name: '牧神记', author: '宅猪', tag: '玄幻' },
    { name: '人道至尊', author: '宅猪', tag: '玄幻' },
    { name: '武炼巅峰', author: '莫默', tag: '玄幻' },
    { name: '傲世九重天', author: '风凌天下', tag: '玄幻' },
    { name: '异世邪君', author: '风凌天下', tag: '玄幻' },
    { name: '天域苍穹', author: '风凌天下', tag: '玄幻' },
    { name: '万古神帝', author: '飞天鱼', tag: '玄幻' },
    { name: '武神主宰', author: '暗魔师', tag: '玄幻' },
    { name: '太古神王', author: '净无痕', tag: '玄幻' },
    { name: '绝世武神', author: '净无痕', tag: '玄幻' },
    { name: '逆天邪神', author: '火星引力', tag: '玄幻' },
    { name: '修罗武神', author: '善良的蜜蜂', tag: '玄幻' },
    { name: '一剑独尊', author: '青鸾峰上', tag: '玄幻' },
    { name: '诡秘之主', author: '爱潜水的乌贼', tag: '玄幻' },
    { name: '长夜余火', author: '爱潜水的乌贼', tag: '玄幻' },
    { name: '庆余年', author: '猫腻', tag: '古装' },
    { name: '将夜', author: '猫腻', tag: '古装' },
    { name: '择天记', author: '猫腻', tag: '古装' },
  ],
  都市: [
    { name: '赘婿', author: '愤怒的香蕉', tag: '都市' },
    { name: '大医凌然', author: '志鸟村', tag: '都市' },
    { name: '全职高手', author: '蝴蝶蓝', tag: '都市' },
    { name: '校花的贴身高手', author: '鱼人二代', tag: '都市' },
    { name: '都市极品医神', author: '风会笑', tag: '都市' },
    { name: '大江东去', author: '阿耐', tag: '现实' },
    { name: '欢乐颂', author: '阿耐', tag: '都市' },
    { name: '都挺好', author: '阿耐', tag: '现实' },
    { name: '人世间', author: '梁晓声', tag: '现实' },
    { name: '平凡的世界', author: '路遥', tag: '现实' },
    { name: '白鹿原', author: '陈忠实', tag: '现实' },
    { name: '围城', author: '钱钟书', tag: '现实' },
    { name: '活着', author: '余华', tag: '现实' },
    { name: '许三观卖血记', author: '余华', tag: '现实' },
    { name: '兄弟', author: '余华', tag: '现实' },
    { name: '文城', author: '余华', tag: '现实' },
    { name: '城南旧事', author: '林海音', tag: '现实' },
    { name: '骆驼祥子', author: '老舍', tag: '现实' },
    { name: '四世同堂', author: '老舍', tag: '现实' },
    { name: '边城', author: '沈从文', tag: '现实' },
    { name: '长安的荔枝', author: '马伯庸', tag: '历史' },
    { name: '大医', author: '马伯庸', tag: '历史' },
    { name: '两京十五日', author: '马伯庸', tag: '历史' },
    { name: '显微镜下的大明', author: '马伯庸', tag: '历史' },
    { name: '何以笙箫默', author: '顾漫', tag: '言情' },
    { name: '微微一笑很倾城', author: '顾漫', tag: '言情' },
    { name: '杉杉来吃', author: '顾漫', tag: '言情' },
    { name: '骄阳似我', author: '顾漫', tag: '言情' },
    { name: '最好的我们', author: '八月长安', tag: '青春' },
    { name: '你好，旧时光', author: '八月长安', tag: '青春' },
    { name: '橘生淮南', author: '八月长安', tag: '青春' },
    { name: '这么多年', author: '八月长安', tag: '青春' },
    { name: '十年一品温如言', author: '书海沧生', tag: '言情' },
    { name: '亲爱的阿基米德', author: '玖月晞', tag: '言情' },
    { name: '他来了请闭眼', author: '丁墨', tag: '言情' },
    { name: '如果蜗牛有爱情', author: '丁墨', tag: '言情' },
    { name: '美人为馅', author: '丁墨', tag: '言情' },
    { name: '你和我的倾城时光', author: '丁墨', tag: '言情' },
    { name: '余罪', author: '常书欣', tag: '刑侦' },
    { name: '黑锅', author: '常书欣', tag: '刑侦' },
    { name: '三叉戟', author: '吕铮', tag: '刑侦' },
    { name: '小欢喜', author: '鲁引弓', tag: '现实' },
    { name: '小舍得', author: '鲁引弓', tag: '现实' },
    { name: '装台', author: '陈彦', tag: '现实' },
    { name: '主角', author: '陈彦', tag: '现实' },
    { name: '人民的名义', author: '周梅森', tag: '现实' },
    { name: '突围', author: '周梅森', tag: '现实' },
    { name: '大博弈', author: '周梅森', tag: '现实' },
    { name: '半生缘', author: '张爱玲', tag: '言情' },
    { name: '红玫瑰与白玫瑰', author: '张爱玲', tag: '言情' },
    { name: '倾城之恋', author: '张爱玲', tag: '言情' },
    { name: '京华烟云', author: '林语堂', tag: '历史' },
    { name: '穆斯林的葬礼', author: '霍达', tag: '现实' },
    { name: '繁花', author: '金宇澄', tag: '现实' },
    { name: '应物兄', author: '李洱', tag: '现实' },
  ],
  悬疑: [
    { name: '盗墓笔记', author: '南派三叔', tag: '悬疑' },
    { name: '鬼吹灯', author: '天下霸唱', tag: '悬疑' },
    { name: '尸语者', author: '秦明', tag: '法医' },
    { name: '清道夫', author: '秦明', tag: '法医' },
    { name: '幸存者', author: '秦明', tag: '法医' },
    { name: '守夜者', author: '秦明', tag: '法医' },
    { name: '十宗罪', author: '蜘蛛', tag: '犯罪' },
    { name: '白夜追凶', author: '指纹', tag: '犯罪' },
    { name: '坏小孩', author: '紫金陈', tag: '推理' },
    { name: '无证之罪', author: '紫金陈', tag: '推理' },
    { name: '长夜难明', author: '紫金陈', tag: '推理' },
    { name: '高智商犯罪', author: '紫金陈', tag: '推理' },
    { name: '心理罪', author: '雷米', tag: '犯罪' },
    { name: '教化场', author: '雷米', tag: '犯罪' },
    { name: '暗河', author: '雷米', tag: '犯罪' },
    { name: '死亡通知单', author: '周浩晖', tag: '推理' },
    { name: '暗黑者', author: '周浩晖', tag: '推理' },
    { name: '凶画', author: '周浩晖', tag: '推理' },
    { name: '鬼望坡', author: '周浩晖', tag: '推理' },
    { name: '风声', author: '麦家', tag: '谍战' },
    { name: '暗算', author: '麦家', tag: '谍战' },
    { name: '解密', author: '麦家', tag: '谍战' },
    { name: '刀尖', author: '麦家', tag: '谍战' },
    { name: '人生海海', author: '麦家', tag: '谍战' },
    { name: '白夜行', author: '东野圭吾', tag: '推理' },
    { name: '嫌疑人X的献身', author: '东野圭吾', tag: '推理' },
    { name: '恶意', author: '东野圭吾', tag: '推理' },
    { name: '幻夜', author: '东野圭吾', tag: '推理' },
    { name: '放学后', author: '东野圭吾', tag: '推理' },
    { name: '秘密', author: '东野圭吾', tag: '推理' },
    { name: '新参者', author: '东野圭吾', tag: '推理' },
    { name: '红手指', author: '东野圭吾', tag: '推理' },
    { name: '圣女的救济', author: '东野圭吾', tag: '推理' },
    { name: '谁杀了她', author: '东野圭吾', tag: '推理' },
    { name: '杀人之门', author: '东野圭吾', tag: '推理' },
    { name: '天才在左疯子在右', author: '高铭', tag: '纪实' },
    { name: '消失的十三级台阶', author: '高野和明', tag: '推理' },
    { name: '占星术杀人魔法', author: '岛田庄司', tag: '推理' },
    { name: '斜屋犯罪', author: '岛田庄司', tag: '推理' },
    { name: '绝叫', author: '叶真中显', tag: '推理' },
    { name: '无人生还', author: '阿加莎·克里斯蒂', tag: '推理' },
    { name: '东方快车谋杀案', author: '阿加莎·克里斯蒂', tag: '推理' },
    { name: '尼罗河上的惨案', author: '阿加莎·克里斯蒂', tag: '推理' },
    { name: 'ABC谋杀案', author: '阿加莎·克里斯蒂', tag: '推理' },
    { name: '罗杰疑案', author: '阿加莎·克里斯蒂', tag: '推理' },
    { name: '福尔摩斯探案全集', author: '阿瑟·柯南·道尔', tag: '推理' },
    { name: '达·芬奇密码', author: '丹·布朗', tag: '悬疑' },
    { name: '天使与魔鬼', author: '丹·布朗', tag: '悬疑' },
    { name: '地狱', author: '丹·布朗', tag: '悬疑' },
    { name: '龙纹身的女孩', author: '斯蒂格·拉森', tag: '犯罪' },
    { name: '沉默的羔羊', author: '托马斯·哈里斯', tag: '犯罪' },
    { name: '火车', author: '宫部美雪', tag: '推理' },
    { name: '模仿犯', author: '宫部美雪', tag: '推理' },
    { name: '19年间谋杀小叙', author: '那多', tag: '推理' },
    { name: '夜行观览车', author: '湊佳苗', tag: '推理' },
  ],
  科幻: [
    { name: '三体', author: '刘慈欣', tag: '科幻' },
    { name: '球状闪电', author: '刘慈欣', tag: '科幻' },
    { name: '超新星纪元', author: '刘慈欣', tag: '科幻' },
    { name: '流浪地球', author: '刘慈欣', tag: '科幻' },
    { name: '全频带阻塞干扰', author: '刘慈欣', tag: '科幻' },
    { name: '乡村教师', author: '刘慈欣', tag: '科幻' },
    { name: '朝闻道', author: '刘慈欣', tag: '科幻' },
    { name: '中国太阳', author: '刘慈欣', tag: '科幻' },
    { name: '微纪元', author: '刘慈欣', tag: '科幻' },
    { name: '吞噬者', author: '刘慈欣', tag: '科幻' },
    { name: '诗云', author: '刘慈欣', tag: '科幻' },
    { name: '镜子', author: '刘慈欣', tag: '科幻' },
    { name: '白垩纪往事', author: '刘慈欣', tag: '科幻' },
    { name: '银河帝国', author: '艾萨克·阿西莫夫', tag: '科幻' },
    { name: '我，机器人', author: '艾萨克·阿西莫夫', tag: '科幻' },
    { name: '永恒的终结', author: '艾萨克·阿西莫夫', tag: '科幻' },
    { name: '2001太空漫游', author: '阿瑟·克拉克', tag: '科幻' },
    { name: '与拉玛相会', author: '阿瑟·克拉克', tag: '科幻' },
    { name: '童年的终结', author: '阿瑟·克拉克', tag: '科幻' },
    { name: '沙丘', author: '弗兰克·赫伯特', tag: '科幻' },
    { name: '沙丘救世主', author: '弗兰克·赫伯特', tag: '科幻' },
    { name: '安德的游戏', author: '奥森·斯科特·卡德', tag: '科幻' },
    { name: '安德的影子', author: '奥森·斯科特·卡德', tag: '科幻' },
    { name: '死者代言人', author: '奥森·斯科特·卡德', tag: '科幻' },
    { name: '海伯利安', author: '丹·西蒙斯', tag: '科幻' },
    { name: '海伯利安的陨落', author: '丹·西蒙斯', tag: '科幻' },
    { name: '神经漫游者', author: '威廉·吉布森', tag: '赛博' },
    { name: '雪崩', author: '尼尔·斯蒂芬森', tag: '赛博' },
    { name: '真名实姓', author: '弗诺·文奇', tag: '赛博' },
    { name: '深渊上的火', author: '弗诺·文奇', tag: '科幻' },
    { name: '你一生的故事', author: '特德·姜', tag: '科幻' },
    { name: '呼吸', author: '特德·姜', tag: '科幻' },
    { name: '软件体的生命周期', author: '特德·姜', tag: '科幻' },
    { name: '火星救援', author: '安迪·威尔', tag: '科幻' },
    { name: '挽救计划', author: '安迪·威尔', tag: '科幻' },
    { name: '仿生人会梦见电子羊吗', author: '菲利普·K·迪克', tag: '科幻' },
    { name: '高堡奇人', author: '菲利普·K·迪克', tag: '科幻' },
    { name: '尤比克', author: '菲利普·K·迪克', tag: '科幻' },
    { name: '美丽新世界', author: '阿道司·赫胥黎', tag: '反乌托邦' },
    { name: '1984', author: '乔治·奥威尔', tag: '反乌托邦' },
    { name: '动物农场', author: '乔治·奥威尔', tag: '反乌托邦' },
    { name: '我们', author: '叶夫根尼·扎米亚京', tag: '反乌托邦' },
    { name: '华氏451', author: '雷·布拉德伯里', tag: '反乌托邦' },
    { name: '火星编年史', author: '雷·布拉德伯里', tag: '科幻' },
    { name: '克拉拉与太阳', author: '石黑一雄', tag: '科幻' },
    { name: '别让我走', author: '石黑一雄', tag: '科幻' },
    { name: '荒潮', author: '陈楸帆', tag: '科幻' },
    { name: '机器之门', author: '江波', tag: '科幻' },
    { name: '银河之心', author: '江波', tag: '科幻' },
    { name: '天年', author: '何夕', tag: '科幻' },
    { name: '六道众生', author: '何夕', tag: '科幻' },
    { name: '伤心者', author: '何夕', tag: '科幻' },
    { name: '北京折叠', author: '郝景芳', tag: '科幻' },
    { name: '去远方', author: '郝景芳', tag: '科幻' },
    { name: '献给阿尔吉侬的花束', author: '丹尼尔·凯斯', tag: '科幻' },
    { name: '索拉里斯星', author: '斯坦尼斯瓦夫·莱姆', tag: '科幻' },
    { name: '其主之声', author: '斯坦尼斯瓦夫·莱姆', tag: '科幻' },
    { name: '一无所有', author: '厄休拉·勒古恩', tag: '科幻' },
    { name: '黑暗的左手', author: '厄休拉·勒古恩', tag: '科幻' },
  ],
  耽美: [
    { name: '天官赐福', author: '墨香铜臭', tag: '耽美' },
    { name: '魔道祖师', author: '墨香铜臭', tag: '耽美' },
    { name: '人渣反派自救系统', author: '墨香铜臭', tag: '耽美' },
    { name: '二哈和他的白猫师尊', author: '肉包不吃肉', tag: '耽美' },
    { name: '余污', author: '肉包不吃肉', tag: '耽美' },
    { name: '病案本', author: '肉包不吃肉', tag: '耽美' },
    { name: '默读', author: 'priest', tag: '耽美' },
    { name: '杀破狼', author: 'priest', tag: '耽美' },
    { name: '残次品', author: 'priest', tag: '耽美' },
    { name: '镇魂', author: 'priest', tag: '耽美' },
    { name: '六爻', author: 'priest', tag: '耽美' },
    { name: '大哥', author: 'priest', tag: '耽美' },
    { name: '七爷', author: 'priest', tag: '耽美' },
    { name: '无污染无公害', author: 'priest', tag: '耽美' },
    { name: '烈火浇愁', author: 'priest', tag: '耽美' },
    { name: '营业悖论', author: 'priest', tag: '耽美' },
    { name: '太岁', author: 'priest', tag: '耽美' },
    { name: '撒野', author: '巫哲', tag: '耽美' },
    { name: '过门', author: '巫哲', tag: '耽美' },
    { name: '解药', author: '巫哲', tag: '耽美' },
    { name: '轻狂', author: '巫哲', tag: '耽美' },
    { name: '伪装学渣', author: '木瓜黄', tag: '耽美' },
    { name: '某某', author: '木苏里', tag: '耽美' },
    { name: '全球高考', author: '木苏里', tag: '耽美' },
    { name: '判官', author: '木苏里', tag: '耽美' },
    { name: '铜钱龛世', author: '木苏里', tag: '耽美' },
    { name: '死亡万花筒', author: '西子绪', tag: '耽美' },
    { name: '我五行缺你', author: '西子绪', tag: '耽美' },
    { name: '破云', author: '淮上', tag: '耽美' },
    { name: '提灯映桃花', author: '淮上', tag: '耽美' },
    { name: '不死者', author: '淮上', tag: '耽美' },
    { name: '小蘑菇', author: '一十四洲', tag: '耽美' },
    { name: '千秋', author: '梦溪石', tag: '耽美' },
    { name: '山河表里', author: '梦溪石', tag: '耽美' },
    { name: '成化十四年', author: '梦溪石', tag: '耽美' },
    { name: '天下', author: '梦溪石', tag: '耽美' },
    { name: '娘娘腔', author: '水千丞', tag: '耽美' },
    { name: '职业替身', author: '水千丞', tag: '耽美' },
    { name: '附加遗产', author: '水千丞', tag: '耽美' },
    { name: '一醉经年', author: '水千丞', tag: '耽美' },
    { name: '谁把谁当真', author: '水千丞', tag: '耽美' },
    { name: '桃花债', author: '大风刮过', tag: '耽美' },
    { name: '又一春', author: '大风刮过', tag: '耽美' },
    { name: '张公案', author: '大风刮过', tag: '耽美' },
    { name: '皇叔', author: '大风刮过', tag: '耽美' },
    { name: '当年万里觅封侯', author: '漫漫何其多', tag: '耽美' },
    { name: '犯罪心理', author: '长洱', tag: '耽美' },
    { name: '相见欢', author: '非天夜翔', tag: '耽美' },
    { name: '二零一三', author: '非天夜翔', tag: '耽美' },
    { name: '鹰奴', author: '非天夜翔', tag: '耽美' },
    { name: '将进酒', author: '唐酒卿', tag: '耽美' },
    { name: '南禅', author: '唐酒卿', tag: '耽美' },
    { name: '上瘾', author: '柴鸡蛋', tag: '耽美' },
    { name: '逆袭', author: '柴鸡蛋', tag: '耽美' },
  ],
  轻小说: [
    { name: '刀剑神域', author: '川原砾', tag: '轻小说' },
    { name: '无职转生', author: '理不尽な孙の手', tag: '轻小说' },
    { name: '为美好的世界献上祝福', author: '晓夏目', tag: '轻小说' },
    { name: '关于我转生变成史莱姆这件事', author: '伏濑', tag: '轻小说' },
    { name: 'OVERLORD不死者之王', author: '丸山くがね', tag: '轻小说' },
    { name: '幼女战记', author: 'カルロ・ゼン', tag: '轻小说' },
    { name: 'Re:从零开始的异世界生活', author: '長月達平', tag: '轻小说' },
    { name: '漆黑的子弹', author: '神崎紫电', tag: '轻小说' },
    { name: '魔法禁书目录', author: '镰池和马', tag: '轻小说' },
    { name: '某科学的超电磁炮', author: '镰池和马', tag: '轻小说' },
    { name: '约会大作战', author: '橘公司', tag: '轻小说' },
    { name: '龙王的工作', author: '白鸟士郎', tag: '轻小说' },
    { name: '落第骑士英雄谭', author: '海空陆', tag: '轻小说' },
    { name: '凉宫春日的忧郁', author: '谷川流', tag: '轻小说' },
    { name: '全金属狂潮', author: '贺东招二', tag: '轻小说' },
    { name: '狼与香辛料', author: '支仓冻砂', tag: '轻小说' },
    { name: '灼眼的夏娜', author: '高桥弥七郎', tag: '轻小说' },
    { name: '零之使魔', author: '山口升', tag: '轻小说' },
    { name: '空之境界', author: '奈须蘑菇', tag: '轻小说' },
    { name: '文豪野犬', author: '朝雾卡夫卡', tag: '轻小说' },
    { name: '游戏人生', author: '榎宫祐', tag: '轻小说' },
    { name: '问题儿童都来自异世界', author: '龙之湖太郎', tag: '轻小说' },
    { name: '织田信奈的野望', author: '春日御影', tag: '轻小说' },
    { name: '我的青春恋爱物语果然有问题', author: '渡航', tag: '轻小说' },
    { name: '笨蛋测验召唤兽', author: '井上坚二', tag: '轻小说' },
    { name: '我的朋友很少', author: '平坂读', tag: '轻小说' },
    { name: 'EROMANGA老师', author: '伏濑', tag: '轻小说' },
    { name: '路人女主的养成方法', author: '丸户史明', tag: '轻小说' },
    { name: '我的妹妹哪有这么可爱', author: '伏濑', tag: '轻小说' },
    { name: '中二病也要谈恋爱', author: '虎虎', tag: '轻小说' },
    { name: '冰菓', author: '米泽穗信', tag: '轻小说' },
    { name: '古书堂事件手帖', author: '三上延', tag: '轻小说' },
    { name: '不吉波普不笑', author: '上远野浩平', tag: '轻小说' },
    { name: '伊里野的天空', author: '秋山瑞人', tag: '轻小说' },
    { name: '你与我的最后战场', author: '细音启', tag: '轻小说' },
    { name: '世界尽头的圣骑士', author: '柳野かなた', tag: '轻小说' },
    { name: '想要成为影之实力者', author: '逢泽大介', tag: '轻小说' },
    { name: '转生成蜘蛛又怎样', author: '马场翁', tag: '轻小说' },
    { name: '盾之勇者成名录', author: 'アネコユサギ', tag: '轻小说' },
    { name: '回复术士的重来人生', author: '月夜泪', tag: '轻小说' },
    { name: '药屋少女的呢喃', author: '日向夏', tag: '轻小说' },
    { name: '魔女之旅', author: '白石定规', tag: '轻小说' },
    { name: '灰与幻想的格林姆迦尔', author: '十文字青', tag: '轻小说' },
    { name: '樱花庄的宠物女孩', author: '鸭志田一', tag: '轻小说' },
    { name: '青春猪头少年不会梦到兔女郎学姐', author: '鸭志田一', tag: '轻小说' },
    { name: '末日时在做什么', author: '枯野瑛', tag: '轻小说' },
    { name: '86不存在的战区', author: '安里アサト', tag: '轻小说' },
    { name: '学战都市Asterisk', author: '三屋咲悠', tag: '轻小说' },
    { name: '弱角友崎君', author: '屋久ユウキ', tag: '轻小说' },
    { name: '无头骑士异闻录', author: '成田良悟', tag: '轻小说' },
    { name: '永生之酒', author: '成田良悟', tag: '轻小说' },
    { name: '罗德斯岛战记', author: '水野良', tag: '轻小说' },
    { name: '秀逗魔导士', author: '神坂一', tag: '轻小说' },
    { name: 'overlord不死者之王', author: '丸山くがね', tag: '轻小说' },
  ],
};

/** 搜索页 · 热门搜索（取热门书单头部 + 轮换） */
export const HOT_SEARCHES: string[] = [
  '诡秘之主',
  '天官赐福',
  '三体',
  '盗墓笔记',
  '魔道祖师',
  '斗破苍穹',
  '撒野',
  '白夜行',
  '庆余年',
  '全职高手',
  '长夜难明',
  '默读',
  '沙丘',
  '凡人修仙传',
  '嫌疑人X的献身',
  '伪装学渣',
  '刀剑神域',
  '雪中悍刀行',
  '大奉打更人',
  '二哈和他的白猫师尊',
];

// ---------------------------------------------------------------------------
// 数据类型
// ---------------------------------------------------------------------------
export interface SourceItem {
  id: string;
  name: string;
  url: string;
  group: string;
  enabled: boolean;
  isBuiltin: boolean;
  checkStatus: string | null;
}
export interface SearchBookItem {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  sourceName: string;
  sourceUrl: string;
  sourceId?: string;
}
export interface ShelfBookItem {
  id: string;
  name: string;
  author: string | null;
  coverUrl: string | null;
  intro: string | null;
  sourceId: string;
  sourceName: string | null;
  bookUrl: string;
  /** 自定义分组（空 = 未分组） */
  customGroup: string | null;
  totalChapters: number;
  lastChapterTitle: string | null;
  lastReadChapter: number;
  /** 章内页码（分页模式记忆） */
  lastPage: number;
  lastReadAt: string;
}
/** 阅读历史条目（历史 Tab） */
export interface ReadHistoryItem {
  id: string;
  name: string;
  author: string | null;
  coverUrl: string | null;
  sourceId: string;
  sourceName: string | null;
  bookUrl: string;
  totalChapters: number;
  lastReadChapter: number;
  lastPage: number;
  lastChapterTitle: string | null;
  lastReadAt: string;
}
export interface TocItem {
  title: string;
  url: string;
}
/** 阅读批注：书签 / 划线笔记（与 ReaderNote 表对齐） */
export interface ReaderNoteItem {
  id: string;
  bookUrl: string;
  name: string;
  kind: 'bookmark' | 'highlight' | string;
  chapterIndex: number;
  chapterTitle: string | null;
  pageIndex: number;
  paraIndex: number;
  startOff: number;
  endOff: number;
  text: string;
  style: 'line' | 'wavy' | 'box' | string | null;
  note: string | null;
  createdAt: string;
}
export interface BookDetailData {
  name: string;
  author: string;
  coverUrl: string;
  intro: string;
  lastChapter: string;
  chapters: TocItem[];
  total: number;
  inShelf: boolean;
  lastReadChapter: number;
  /** 章内页码（分页模式续读） */
  lastPage: number;
}

// ---------------------------------------------------------------------------
// API 薄封装（非 JSON 响应——如网关超时 HTML——给出友好报错而不是裸解析错误）
// ---------------------------------------------------------------------------
async function j<T>(res: Response): Promise<T> {
  const text = await res.text();
  let d: (T & { error?: string }) | null = null;
  try {
    d = JSON.parse(text) as T & { error?: string };
  } catch {
    // 拿到 HTML/空响应（常见：网关超时 / 服务异常），给出可读错误
    throw new Error('网络超时或服务异常，请稍后重试');
  }
  if (!res.ok && d && typeof d === 'object' && 'error' in d && d.error) throw new Error(String(d.error));
  return d as T;
}

export const api = {
  listSources: (enabledOnly = false) =>
    fetch(`/api/reading/sources${enabledOnly ? '?enabled=1' : ''}`).then((r) => j<{ sources: SourceItem[] }>(r)),
  sourceAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
  searchOne: (keyword: string, sourceId: string, signal?: AbortSignal) =>
    fetch('/api/reading/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, sourceId }),
      signal,
    }).then((r) => j<{ books?: SearchBookItem[]; ms?: number; sourceName?: string }>(r)),
  bookDetail: (sourceId: string, bookUrl: string, name: string, author: string) =>
    fetch(
      `/api/reading/book?${new URLSearchParams({ sourceId, bookUrl, name, author })}`,
    ).then((r) => j<BookDetailData>(r)),
  chapter: (sourceId: string, chapterUrl: string, bookUrl: string, index: number, title: string, refresh = false) =>
    fetch(
      `/api/reading/chapter?${new URLSearchParams({ sourceId, chapterUrl, bookUrl, index: String(index), title, ...(refresh ? { refresh: '1' } : {}) })}`,
    ).then((r) => j<{ title: string; content: string; summary: string; cached: boolean }>(r)),
  shelfList: () => fetch('/api/reading/shelf').then((r) => j<{ books: ShelfBookItem[] }>(r)),
  shelfAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/shelf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
  getSettings: () => fetch('/api/reading/settings').then((r) => j<{ settings: ReaderSettings }>(r)),
  saveSettings: (patch: Partial<ReaderSettings>) =>
    fetch('/api/reading/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => j<{ ok: boolean }>(r)),
  chat: (body: Record<string, unknown>) =>
    fetch('/api/reading/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<{ reply: string }>(r)),
  history: (bookUrl?: string) =>
    fetch(`/api/reading/history${bookUrl ? `?bookUrl=${encodeURIComponent(bookUrl)}` : ''}`).then((r) =>
      j<Record<string, unknown>>(r),
    ),
  historyAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
  /** 阅读历史（历史 Tab）：读过书的列表 / 移除 / 清空 */
  readlogList: () => fetch('/api/reading/readlog').then((r) => j<{ reads: ReadHistoryItem[] }>(r)),
  readlogAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/readlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
  /** 阅读时长（秒）：获取累计 / 阅读中每 15s 上报 */
  readTimeGet: () => fetch('/api/reading/readtime').then((r) => j<{ seconds: number }>(r)),
  readTimeAdd: (seconds: number) =>
    fetch('/api/reading/readtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }),
    }).then((r) => j<{ ok: boolean; seconds: number }>(r)),
  /** 本地导入（txt / epub）：上传解析入库并自动入书架 */
  localUpload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/reading/local', { method: 'POST', body: fd }).then((r) =>
      j<{ ok: boolean; id: string; name: string; chapters: number }>(r),
    );
  },
  /** 批注：某本书的书签 + 划线列表 */
  notesList: (bookUrl: string) =>
    fetch(`/api/reading/notes?bookUrl=${encodeURIComponent(bookUrl)}`).then((r) =>
      j<{ notes: ReaderNoteItem[] }>(r),
    ),
  notesAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
};

/** 秒数 → 「x小时y分钟 / y分钟」展示 */
export function formatReadTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0分钟';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h <= 0) return `${m}分钟`;
  if (m <= 0) return `${h}小时`;
  return `${h}小时${m}分钟`;
}

/** 封面代理：防盗链/跨域封面统一走服务端抓取（/api/reading/cover），带书源头 Referer */
export function coverSrc(url?: string | null, sid?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:') || url.startsWith('/')) return url;
  const q = new URLSearchParams({ u: url });
  if (sid) q.set('sid', sid);
  return `/api/reading/cover?${q.toString()}`;
}

/** 封面占位（书脊风：渐变底 + 书脊高光 + 书名竖排区） */
export function CoverPlaceholder({ name, author, className, radius = 'rounded-[10px]' }: { name: string; author?: string | null; className?: string; radius?: string }) {
  return (
    <div
      className={clsx('relative flex overflow-hidden bg-gradient-to-br from-[#9CC3F8] via-[#6E9BEE] to-[#3E6FD9]', radius, className)}
      aria-hidden="true"
    >
      {/* 书脊高光 */}
      <span className="absolute inset-y-0 left-0 w-[14%] bg-gradient-to-r from-black/25 to-transparent" />
      <span className="absolute inset-y-0 left-[14%] w-px bg-white/30" />
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 py-2">
        <span className="line-clamp-3 text-center text-[13px] font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
          {name}
        </span>
        {author && <span className="line-clamp-1 text-center text-[10px] font-medium text-white/80">{author}</span>}
      </div>
      <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/25 to-transparent" />
    </div>
  );
}

/** 智能定位第一章（目录头部可能有公告/最新块） */
export function findStartIndex(chapters: TocItem[]): number {
  const re = /^第\s*[一1]\s*章|^[楔序]章|^[楔序]言|^正文/;
  for (let i = 0; i < Math.min(chapters.length, 25); i++) {
    if (re.test(chapters[i].title.trim())) return i;
  }
  return 0;
}

/** 章节标题归一化（去空格/全角符号，用于换源后的进度映射） */
function normTitle(t: string): string {
  return t.replace(/[\s·、，。：:，·\-—_=+*/\\|.,!?！？"'“”‘’()（）\[\]【】<>《》~～#@%^&$]/g, '').toLowerCase();
}

/** 换源后进度映射：旧章节标题 → 新目录下标（精确 → 包含 → 原下标截断） */
export function matchChapterIndex(newChapters: TocItem[], oldTitle: string | null | undefined, oldIdx: number): number {
  if (!newChapters.length) return 0;
  if (!oldTitle) return Math.min(oldIdx, newChapters.length - 1);
  const nt = normTitle(oldTitle);
  let hit = newChapters.findIndex((c) => normTitle(c.title) === nt);
  if (hit < 0) hit = newChapters.findIndex((c) => normTitle(c.title).includes(nt) || nt.includes(normTitle(c.title)));
  return hit >= 0 ? hit : Math.min(oldIdx, newChapters.length - 1);
}

// ---------------------------------------------------------------------------
// 相似书推荐（基于书架 / 当前书：同作者 > 书名相似 > 同分类）
// ---------------------------------------------------------------------------

/** 归一化书名（去书名号/空格/标点） */
function normBookName(n: string): string {
  return n.replace(/[\s《》“”"'·、,，.。！!？?：:（）()\[\]【】]/g, '').toLowerCase();
}

/** 两书名相似度：最长公共子串长度 / 较短串长度（粗粒度够用） */
function nameSimilarity(a: string, b: string): number {
  const s = normBookName(a);
  const t = normBookName(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  let best = 0;
  const m = s.length;
  const n = t.length;
  let prev = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      if (s[i - 1] === t[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best / Math.min(m, n);
}

/** 书名 → 精选书单里的分类（找不到返回 null） */
export function featuredCategoryOf(name: string): string | null {
  const n = normBookName(name);
  for (const [cat, list] of Object.entries(FEATURED)) {
    if (list.some((b) => normBookName(b.name) === n)) return cat;
  }
  return null;
}

/** 某分类下的精选书（排除指定书名） */
export function featuredOfCategory(cat: string, exclude: string[] = [], limit = 8) {
  const ex = new Set(exclude.map(normBookName));
  return (FEATURED[cat] || [])
    .filter((b) => !ex.has(normBookName(b.name)))
    .slice(0, limit)
    .map((b) => ({ name: b.name, author: b.author, tag: b.tag, reason: `同分类 ${b.tag}` }));
}

/**
 * 相似书推荐：基于一组「种子书」（书架在架书 / 当前书），
 * 从内置精选书单里打分排序（同作者 > 书名相似 > 同分类），排除种子与黑名单。
 */
export function recommendBooks(
  seeds: { name: string; author?: string | null; tag?: string | null }[],
  exclude: string[] = [],
  limit = 8,
): { name: string; author: string; tag: string; reason: string }[] {
  const excluded = new Set([...exclude, ...seeds.map((s) => s.name)].map(normBookName));
  const score = new Map<
    string,
    { name: string; author: string; tag: string; score: number; reason: string }
  >();
  const seedAuthors = new Set(
    seeds.map((s) => (s.author || '').replace(/\s+/g, '')).filter(Boolean),
  );
  const seedTags = new Set(seeds.map((s) => s.tag).filter(Boolean) as string[]);
  for (const [cat, list] of Object.entries(FEATURED)) {
    for (const b of list) {
      const k = normBookName(b.name);
      if (excluded.has(k)) continue;
      let sc = 0;
      let reason = '';
      if (b.author && seedAuthors.has(b.author.replace(/\s+/g, ''))) {
        sc += 5;
        reason = `同作者 ${b.author}`;
      }
      for (const s of seeds) {
        const sim = nameSimilarity(s.name, b.name);
        if (sim > 0.34 && sim < 1) {
          sc += 3;
          if (!reason) reason = `与《${s.name}》相似`;
        }
      }
      if (seedTags.has(cat) || seedTags.has(b.tag)) {
        sc += 2;
        if (!reason) reason = `同分类 ${b.tag}`;
      }
      if (sc <= 0) continue;
      const prev = score.get(k);
      if (!prev || prev.score < sc)
        score.set(k, { name: b.name, author: b.author, tag: b.tag, score: sc, reason });
    }
  }
  return [...score.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ name, author, tag, reason }) => ({ name, author, tag, reason }));
}

// ---------------------------------------------------------------------------
// 精选书单 · 真实封面（服务端 FeaturedCover 表永久缓存：
// GET /api/reading/featured-covers 命中秒回，未命中服务端并发搜源补齐）
// ---------------------------------------------------------------------------

/** 请求一批书名封面（fill=1 时服务端限时补齐缺失） */
export function fetchFeaturedCovers(names: string[], fill = true, signal?: AbortSignal) {
  const q = new URLSearchParams({ names: names.join(','), ...(fill ? { fill: '1' } : {}) });
  return fetch(`/api/reading/featured-covers?${q.toString()}`, { signal }).then(
    (r) =>
      r.json() as Promise<{
        covers: Record<string, { url: string; sid: string }>;
        pending: number;
      }>,
  );
}

/**
 * 精选封面 Hook：给一组书名，返回「书名 → 代理后的封面地址」映射。
 * 服务端有缓存的部分立即返回；缺失的书后台轮询补齐（pending>0 时每 3s 再拉），
 * 全部到位或组件卸载后停止。
 */
export function useFeaturedCovers(names: string[]): Record<string, string> {
  const [covers, setCovers] = useState<Record<string, string>>({});
  const key = names.join('|');
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const list = key.split('|').filter(Boolean);
    if (!list.length) return;
    const run = async (fill: boolean, round: number) => {
      try {
        const d = await fetchFeaturedCovers(list, fill);
        if (!alive) return;
        const next: Record<string, string> = {};
        for (const [n, c] of Object.entries(d.covers)) next[n] = coverSrc(c.url, c.sid) as string;
        setCovers((prev) => ({ ...prev, ...next }));
        // 还有缺口 → 3s 后再补一轮（最多 14 轮 ≈ 40s，避免无限轮询）
        if (d.pending > 0 && round < 14) {
          timer = setTimeout(() => void run(true, round + 1), 3000);
        }
      } catch {
        /* 网络错误：静默（下轮刷新重试） */
      }
    };
    void run(true, 0);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [key]);
  return covers;
}

/** 压缩图片为 dataURL（自定义背景上传用） */
export function fileToDataUrl(file: File, maxSize = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('图片解析失败'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
