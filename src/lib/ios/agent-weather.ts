'use client';

/**
 * 语音助手天气直查（v1.8）：修「让 TA 查天气只打开天气 App 就没了」——
 *
 * 此前「帮我看河南的天气」走 voiceTurn → task → runAgentTask：Agent 最多 openScreen 天气
 * 就算完成，城市不换、天气不读，机主要自己再看一遍。现在语音会话层前置一条**天气直查链路**：
 * matchWeatherIntent 识别意图 → 省名映射省会（河南→郑州）→ searchCity 定位 → 写入天气 App
 * 的城市选择（IndexedDB weatherCity，App 打开即显示该城市）→ fetchWeather 拉数据 →
 * publishWeatherSync 广播给桌面/锁屏小组件 → 组装口语摘要回会话 + TTS 朗读 + 自动打开天气 App。
 *
 * - 意图识别是纯正则（零 LLM 延迟零 token）：「帮我看河南的天气」「郑州今天多少度」「天气怎么样」；
 * - 地点为空 = 查当前城市（天气 App 已选城市 → 定位 → 北京兜底，与天气 App 同源）；
 * - 播报口径（Siri 式）：地名 + 现在天气 + 温度 + 风力 + 今天温差 + 短语提示，1~2 句可朗读。
 */

import { localDB } from './db';
import {
  fetchWeather,
  publishWeatherSnap,
  resolveCityPick,
  searchCity,
  weatherCodeInfo,
  type CityPick,
  type CitySearchResult,
} from '@/components/apps/weather-core';

// ============================================================
// A. 意图识别（纯正则，零网络零 LLM）
// ============================================================

/** 天气类触发词（命中任一才算天气意图，避免「打开微信」被误伤） */
const WEATHER_TRIGGER_RE =
  /天气|气温|温度|多少度|几度|热不热|冷不冷|冷不热|下不下雨|下雨吗|会下雨|有雨|有雪|下雪|穿什么(?:衣服|外套|裤子)?|带伞|紫外线/;

/** 地名前要剥掉的前缀（客套/动词）——长词在前防截胡（帮我看看 必须先于 帮我、看下 等）；
 *  含打开类动词：「打开天气」剥掉后地点为空 → 调用方按「只开 App 不播报」处理 */
const LOC_PREFIX_RE =
  /^(?:帮我看看|帮我查查|帮我查下|帮我查一下|帮我看下|帮我看一看|帮我看|帮我|帮我打开|给我打开|我想知道|我想看看|我想看|我想听|麻烦你|麻烦|请帮我|切换到|你看下|你看看|你看|我看下|我看|看看|看下|看一下|看一看|查查看|查一下|查查|查看|查下|查询|查|说下|说说|说一下|说下|告诉我|请问|给我看|打开|开启|启动|进入|切到|给说|来个|请|看|听|说)+/;

/** 地名尾部要剥掉的时间/方位/语气词（多轮剥，防「今天晚上」残留） */
const LOC_TAIL_RE = /(?:今天|明天|后天|今天晚上|今晚|明晚|早上|中午|下午|傍晚|晚上|夜里|现在|当前|此刻|实时|外面|室外|外边|的|呢|吗|吧|呀|啊|哦|嘛|了|，|,|。|？|\?|！|!)+$/;

/** 代词/泛指开头 = 没说地点（「你那里天气如何」「这儿冷不冷」）→ 查当前城市 */
const LOC_GENERIC_RE = /^(?:你|我|他|她|它|这|那|咱|大|全)/;

/** 地名长度上限（超长基本不是地名，防整句误吞） */
const LOC_MAX_LEN = 8;

export interface WeatherIntent {
  /** 抽取的地点（空串 = 当前城市） */
  location: string;
}

/**
 * 识别「查天气」意图并抽取地点：
 * - 「帮我看河南的天气」→ { location: '河南' }；
 * - 「郑州今天多少度」→ { location: '郑州' }；
 * - 「今天天气怎么样」→ { location: '' }（查当前城市）；
 * - 「打开天气」→ { location: '' }，但 OPEN_LEAD_RE 命中时调用方直接开 App 不播报。
 * 返回 null = 非天气意图。
 */
export function matchWeatherIntent(text: string): WeatherIntent | null {
  const t = text.trim();
  if (!t || t.length > 30) return null;
  const m = t.match(/^(.*?)(?:的)?(?:天气|气温|温度|多少度|几度|热不热|冷不冷|冷不热|下不下雨|下雨吗|会下雨|有雨|有雪|下雪|穿什么(?:衣服|外套|裤子)?|带伞|紫外线)/);
  if (!m) return null;
  if (!WEATHER_TRIGGER_RE.test(t)) return null;
  let loc = (m[1] ?? '').trim();
  // 多轮剥前缀/尾部（「帮我看看今天河南的天气」两层前缀）
  for (let i = 0; i < 3; i++) {
    const next = loc.replace(LOC_PREFIX_RE, '').replace(LOC_TAIL_RE, '').trim();
    if (next === loc) break;
    loc = next;
  }
  if (LOC_GENERIC_RE.test(loc)) loc = '';
  if (loc.length > LOC_MAX_LEN) return null; // 太长不像地名：宁可交给 LLM 也不硬猜
  return { location: loc };
}

// ============================================================
// B. 省级区划 → 代表城市（「河南的天气」= 查省会天气，符合口语习惯）
// ============================================================

const PROVINCE_CAPITAL: Record<string, string> = {
  北京: '北京',
  上海: '上海',
  天津: '天津',
  重庆: '重庆',
  河南: '郑州',
  河北: '石家庄',
  山西: '太原',
  陕西: '西安',
  山东: '济南',
  江苏: '南京',
  浙江: '杭州',
  安徽: '合肥',
  江西: '南昌',
  福建: '福州',
  广东: '广州',
  广西: '南宁',
  海南: '海口',
  云南: '昆明',
  贵州: '贵阳',
  四川: '成都',
  湖南: '长沙',
  湖北: '武汉',
  黑龙江: '哈尔滨',
  吉林: '长春',
  辽宁: '沈阳',
  内蒙古: '呼和浩特',
  宁夏: '银川',
  甘肃: '兰州',
  青海: '西宁',
  新疆: '乌鲁木齐',
  西藏: '拉萨',
  香港: '香港',
  澳门: '澳门',
  台湾: '台北',
};

/** 查询词规范化：剥「省/市/自治区」等后缀（「河南省」→「河南」） */
function normalizePlace(q: string): string {
  return q
    .replace(/(?:维吾尔|壮族|回族)?自治区$/g, '')
    .replace(/特别行政区$/g, '')
    .replace(/[省市]$/g, '')
    .trim();
}

// ============================================================
// C. 天气查询主流程
// ============================================================

/** CitySearchResult → CityPick（展示名优先县/区 > 地级市 > 城市名；带 admin1 省名备播报） */
function toCityPick(r: CitySearchResult): CityPick | null {
  if (!r.latitude || !r.longitude || !r.name) return null;
  return {
    lat: r.latitude,
    lon: r.longitude,
    name: r.name,
    admin1: r.admin1 || undefined,
    admin2: r.admin2 || undefined,
    admin3: r.admin3 || undefined,
  };
}

/** 风向角 → 中文方位（8 向） */
function windDirLabel(deg: number): string {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return `${dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8]}风`;
}

export interface WeatherReportResult {
  ok: boolean;
  /** 口语摘要（进会话流 + TTS 朗读） */
  reply: string;
  /** 实际查询的城市名（打开天气 App 后展示的就是它） */
  city: string;
}

/**
 * 查天气并落全链路：
 * ① 地点非空 → 省名映射省会 → searchCity 定位（失败回当前城市）；空 → 当前城市；
 * ② fetchWeather 拉数据（与天气 App/小组件共享同一份请求与缓存）；
 * ③ 写入天气 App 的城市选择（IndexedDB settings/weatherCity）——天气 App 打开即显示该城市；
 * ④ publishWeatherSnap 广播（桌面/锁屏小组件即时刷新）；
 * ⑤ 组装口语摘要。全程不抛错（失败返回 ok:false 的兜底话术）。
 */
export async function runWeatherReport(location: string): Promise<WeatherReportResult> {
  try {
    // ① 定位城市
    let pick: CityPick | null = null;
    const q = location.trim();
    if (q) {
      const norm = normalizePlace(q);
      const capital = PROVINCE_CAPITAL[norm] ?? PROVINCE_CAPITAL[q];
      const query = capital || q;
      const results = await searchCity(query).catch(() => []);
      // 只信中国结果；open-meteo 相关度排序取第一个即可（与天气 App 城市搜索同源）
      pick = results.find((r) => r.country === '中国' || r.country === 'China') ?? results[0] ?? null;
      pick = pick ? toCityPick(pick) : null;
    }
    if (!pick) pick = await resolveCityPick();

    // ② 拉天气（共享请求与 localStorage 缓存）
    const data = await fetchWeather(pick.lat, pick.lon, pick.name);

    // ③ 写天气 App 的城市选择 + ④ 广播小组件
    try {
      await localDB.put('settings', { key: 'weatherCity', value: pick });
    } catch {
      /* IndexedDB 不可用：App 仍会显示本次快照（缓存已写） */
    }
    publishWeatherSnap(data);

    // ⑤ 口语摘要（Siri 式 1~2 句）
    const c = data.current;
    const today = data.daily[0];
    const cond = weatherCodeInfo(c.code).label;
    const temp = Math.round(c.temperature);
    const feels = Math.round(c.apparent);
    const dir = windDirLabel(c.windDirection);
    const wind = Math.round(c.windSpeed);
    const parts: string[] = [];
    parts.push(`${data.name}现在${cond}，${temp}度`);
    if (Math.abs(feels - temp) >= 3) parts.push(`体感${feels}度`);
    if (wind >= 12) parts.push(`${dir}${wind}公里每小时，风有点大`);
    if (today) {
      const hi = Math.round(today.max);
      const lo = Math.round(today.min);
      const dayCond = weatherCodeInfo(today.code).label;
      parts.push(`今天${lo}到${hi}度，${dayCond}`);
      if (cond !== '晴' && (today.code >= 51 || c.code >= 51)) parts.push('出门记得带伞');
      else if (hi - lo >= 10) parts.push('早晚温差大，注意添衣');
    }
    return { ok: true, reply: `${parts.join('，')}。天气 App 已经帮你打开了~`, city: data.name };
  } catch {
    return {
      ok: false,
      reply: '天气服务这会儿没连上，稍后再让我看看？',
      city: '',
    };
  }
}
