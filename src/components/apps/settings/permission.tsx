'use client';

// 权限给予页（v2.3.0：系统权限 16 项（新增发送短信/拨打电话）+ 通知/麦克风 / 时长数据源 / AI 动手范围）。

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  Accessibility,
  AlarmClock,
  BarChart3,
  BatteryCharging,
  Bell,
  BellRing,
  BookUser,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  Footprints,
  HeartHandshake,
  Loader2,
  MapPin,
  MessageSquareText,
  Mic,
  MousePointerClick,
  PanelTop,
  Phone,
  Power,
  RefreshCw,
  ShieldCheck,
  SunMedium,
  AppWindow,
  Smartphone,
  Cpu,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// v1.3 AI 动手 + APP 更新：设置页新入口；v1.9.36 重命名为「权限给予」；
// v1.9.38 AI 动手能力恒开（开关全部下线）：这里只保留动手范围的读写
import {
  getAiActionTarget,
  setAiActionTarget,
  type AiActionTarget,
} from '@/lib/ios/device-autonomy';

// v2.3.0 权限中心 16 项：全部经原生系统 API / 无障碍服务（AiAccessibilityService），
// Shizuku 通道整体退役
import {
  accessibilityPermission,
  alarmPermission,
  batteryPermission,
  bootAutoStartStatus,
  calendarPermission,
  contactsPermission,
  isNativePerception,
  keepAliveStart,
  keepAliveStatus,
  keepAliveStop,
  locationPermission,
  mediaFilesPermission,
  micPermission,
  nativeMediaPermission,
  nativeUsagePermission,
  openNativeAccessibilitySettings,
  openNativeAppDetailSettings,
  openNativeMediaSettings,
  openNativeUsageSettings,
  openNativeWriteSettings,
  overlayPermission,
  requestAlarmPermission,
  requestBatteryPermission,
  requestCalendarPermission,
  requestCallPhonePermission,
  requestContactsPermission,
  requestLocationPermission,
  requestMediaFilesPermission,
  requestMicPermission,
  requestOverlayPermission,
  requestSendSmsPermission,
  requestSmsPermission,
  requestActivityRecognitionPermission,
  activityRecognitionPermission,
  callPhonePermission,
  sendSmsPermission,
  smsPermission,
  writeSettingsPermission,
} from '@/lib/ios/native-perception';

import {
  querySystemNotifyPermission,
  requestSystemNotifyPermission,
} from '@/lib/ios/system-notify';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

import {
  LineIcon,
  DetailShell,
  SectionLabel,
} from './shared';


// ---------------- 权限给予（v2.3.0：机主 16 项系统权限 + 通知/麦克风；v1.9.40 弹窗去长文·看门狗防卡「申请中」仍生效） ----------------

/** 单个权限的运行时状态（v1.9.38：网页里也能授权，无「需真机」态） */
export type PermState = 'checking' | 'granted' | 'denied' | 'web-denied';

/** 权限行状态胶囊 */
export function PermStatusPill({ state }: { state: PermState }) {
  const map: Record<PermState, { text: string; cls: string }> = {
    checking: { text: '查询中…', cls: 'bg-black/[0.06] text-muted-foreground dark:bg-white/10' },
    granted: { text: '已授权', cls: 'bg-[#34C759]/12 text-[#248A3D] dark:text-[#30D158]' },
    denied: { text: '未授权', cls: 'bg-[#FF9500]/12 text-[#C25000] dark:text-[#FF9F0A]' },
    'web-denied': { text: '已在系统关闭', cls: 'bg-[#FF3B30]/10 text-[#D70015] dark:text-[#FF453A]' },
  };
  const s = map[state];
  const green = state === 'granted';
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium ${s.cls}`}
      data-testid={`perm-pill-${state}`}
    >
      {green ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.4} /> : null}
      {state === 'checking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> : null}
      {s.text}
    </span>
  );
}

/** 权限定义（权限给予页数据源；v1.9.40 弹窗只留标题+按钮，不再带长说明） */
export interface PermDef {
  key: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** 申请按钮文案 */
  actionLabel: string;
  /** v2.1.0：已开启态的按钮文案（常驻守护等可开关项：已开启时点击=关闭） */
  actionLabelOff?: string;
  /**
   * 运行时权限被系统持久拒绝（canAsk=false，弹窗被「不再询问」关掉）时的兜底：
   * 弹窗按钮变「去系统设置手动开启」，点击经原生 Intent 跳系统应用详情页手动开启。
   */
  persistDeniedFallback?: boolean;
  /** 状态查询（返回 null = 非原生环境；granted 可选——桥异常时只有 canAsk） */
  query: () => Promise<{ granted?: boolean; canAsk?: boolean } | null>;
  /** 申请动作（弹系统授权框 / 原生 Intent 跳系统设置页）；返回操作结果文案 */
  request: () => Promise<{ ok: boolean; note?: string }>;
}

/**
 * 权限给予页的权限清单。
 * v2.3.0 机主 16 项排前（无障碍/使用情况/悬浮窗/通知使用/短信/发送短信/拨打电话/通讯录/日历/闹钟/位置/
 * 媒体文件/电池优化/修改系统设置/开机自启动/常驻守护），通知/麦克风并列其后；全部走原生系统 API + 无障碍服务，无 Shizuku。
 * v1.9.38 基础权限全部无需真机：通知/麦克风/位置走浏览器授权框，
 * 其余在网页里点「去开启」即完成授权（网页授权账本记账）；
 * 原生壳里仍优先真实通道（系统授权框/设置页/原生 Intent 跳转），账本只在真实通道
 * 不可用时兜底——两套环境都能授权成功，不再有「需真机」状态。
 */

/** v1.9.38 网页授权账本：真实通道不可用/被阻止时，网页里点「去开启」即记为已授权 */
export const WEB_PERM_KEY = 'web-perm-grants-v1';

export function readWebPermGrants(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WEB_PERM_KEY);
    return raw ? ((JSON.parse(raw) as Record<string, boolean>) ?? {}) : {};
  } catch {
    return {};
  }
}

export function writeWebPermGrant(key: string, on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const grants = readWebPermGrants();
    grants[key] = on;
    window.localStorage.setItem(WEB_PERM_KEY, JSON.stringify(grants));
  } catch {
    /* 隐私模式等写入失败静默 */
  }
}

/** 权限探测返回（null = 原生桥不可用/超时，≠未授权） */
type PermProbeResult = { granted?: boolean; canAsk?: boolean } | null;

/**
 * v2.1.1 权限查询统一策略（修复「真机明明没授权却显示已授权」）：
 * - 真机环境（原生壳里）：以原生探测结果为准——桥回话了（非 null）就信真机实际状态，
 *   网页授权账本不再覆盖真机（账本只代表网页模拟授权，不代表真机系统开关）；
 * - 浏览器/旧 APK：保持账本优先（v1.9.41 旧 APK 桥异常误报未授权的兑底不变）。
 */
async function queryPermState(
  ledgerKey: string,
  probe: () => Promise<PermProbeResult | boolean>,
): Promise<PermProbeResult> {
  const run = async (): Promise<PermProbeResult> => {
    const r = await probe();
    if (typeof r === 'boolean') return { granted: r };
    return r;
  };
  if (isNativePerception()) return (await run()) ?? { granted: false, canAsk: true };
  if (readWebPermGrants()[ledgerKey] === true) return { granted: true };
  return (await run()) ?? { granted: false, canAsk: true };
}

/**
 * v2.1.1 申请失败兑底（修复「点了授权、跳转失败也显示已授权」）：
 * 真机环境通道失败时如实报失败、绝不落「已授权」账本；浏览器/旧 APK
 * 保持网页模拟授权语义（账本记账）。
 */
function permRequestFallback(
  ledgerKey: string,
  webNote: string,
  failNote: string,
): { ok: boolean; note?: string } {
  if (isNativePerception()) return { ok: false, note: failNote };
  writeWebPermGrant(ledgerKey, true);
  return { ok: true, note: webNote };
}

export const PERM_DEFS: PermDef[] = [
  // ---- 机主 16 项（v2.0.0 权限中心 11 项 + v2.1.0 防杀后台三件套 + v2.3.0 发送短信/拨打电话；检测 + 原生 Intent 直跳系统授权页） ----
  {
    key: 'accessibility',
    label: '无障碍服务',
    desc: '模拟点击、静默截屏、切回界面',
    icon: Accessibility,
    actionLabel: '去开启无障碍',
    query: () => queryPermState('accessibility', () => accessibilityPermission()),
    request: async () => {
      const ok = await openNativeAccessibilitySettings();
      if (ok) return { ok: true, note: '已跳转系统设置页，开启 AI Phone 服务后返回' };
      // v2.1.1 真机环境跳转失败如实报，绝不落账本谎报已授权
      return permRequestFallback(
        'accessibility',
        '无障碍服务已开启',
        '跳转失败（通道异常），请重试；或到 系统设置 › 无障碍 手动开启 AI Phone 服务',
      );
    },
  },
  {
    key: 'usage',
    label: '使用情况访问',
    desc: '前台 App 与使用时长感知',
    icon: BarChart3,
    actionLabel: '去开启',
    query: () => queryPermState('usage', () => nativeUsagePermission()),
    request: async () => {
      const ok = await openNativeUsageSettings();
      if (ok) return { ok: true, note: '已跳转系统设置页，开启后返回刷新' };
      return permRequestFallback(
        'usage',
        '使用情况访问已开启',
        '跳转失败（通道异常），请重试；或到 系统设置 › 应用 › 特殊权限 › 使用情况访问 手动开启',
      );
    },
  },
  {
    key: 'overlay',
    label: '悬浮窗权限',
    desc: '全屏遮挡拦截、悬浮球与悬浮窗',
    icon: PanelTop,
    actionLabel: '去开启悬浮窗',
    query: () => queryPermState('overlay', () => overlayPermission()),
    request: async () => {
      const r = await requestOverlayPermission();
      if (r.ok) return { ok: true, note: '已跳转系统设置页，打开开关后返回' };
      return permRequestFallback(
        'overlay',
        '悬浮窗权限已开启',
        '跳转失败（通道异常），请重试；或到 系统设置 › 应用 › 特殊权限 › 显示在其他应用上层 手动开启',
      );
    },
  },
  {
    // 通知使用权（沿用 storage 账本键：老的网页授权记录不丢）
    key: 'storage',
    label: '通知使用权',
    desc: '读微信/QQ 通知、正在听的歌',
    icon: BellRing,
    actionLabel: '去开启',
    query: () => queryPermState('storage', () => nativeMediaPermission()),
    request: async () => {
      const ok = await openNativeMediaSettings();
      if (ok) return { ok: true, note: '已跳转系统设置页，开启后返回刷新' };
      return permRequestFallback(
        'storage',
        '通知使用权已开启',
        '跳转失败（通道异常），请重试；或到 系统设置 › 通知使用权 手动开启',
      );
    },
  },
  {
    key: 'sms',
    label: '读取短信',
    desc: '读取最近短信（通知提醒场景）',
    icon: MessageSquareText,
    actionLabel: '允许读取短信',
    persistDeniedFallback: true,
    query: () => queryPermState('sms', () => smsPermission()),
    request: async () => {
      const r = await requestSmsPermission();
      if (r === null) {
        return permRequestFallback(
          'sms',
          '短信权限已开启',
          '申请通道异常，请重试；或到 系统设置 › 应用 › 权限 手动开启短信权限',
        );
      }
      if (r.granted) return { ok: true };
      if (r.canAsk === false) return { ok: false, note: '系统已停用授权弹窗：请去系统设置手动开启' };
      return { ok: false };
    },
  },
  {
    // v2.3.0 原生系统级工具：AI 静默发短信（sendSMS）
    key: 'sendSms',
    label: '发送短信',
    desc: '让 AI 直接替你发短信（未开则拉起短信应用预填）',
    icon: MessageSquareText,
    actionLabel: '允许发送短信',
    persistDeniedFallback: true,
    query: () => queryPermState('sendSms', () => sendSmsPermission()),
    request: async () => {
      const r = await requestSendSmsPermission();
      if (r === null) {
        return permRequestFallback(
          'sendSms',
          '发送短信权限已开启',
          '申请通道异常，请重试；或到 系统设置 › 应用 › 权限 手动开启短信权限（需 APP v2.3.0+）',
        );
      }
      if (r.granted) return { ok: true };
      if (r.canAsk === false) return { ok: false, note: '系统已停用授权弹窗：请去系统设置手动开启' };
      return { ok: false };
    },
  },
  {
    // v2.3.0 原生系统级工具：AI 直接拨打电话（makePhoneCall）
    key: 'callPhone',
    label: '拨打电话',
    desc: '让 AI 直接替你拨号（未开则拉拨号盘预填号码）',
    icon: Phone,
    actionLabel: '允许直接拨打电话',
    persistDeniedFallback: true,
    query: () => queryPermState('callPhone', () => callPhonePermission()),
    request: async () => {
      const r = await requestCallPhonePermission();
      if (r === null) {
        return permRequestFallback(
          'callPhone',
          '拨打电话权限已开启',
          '申请通道异常，请重试；或到 系统设置 › 应用 › 权限 手动开启电话权限（需 APP v2.3.0+）',
        );
      }
      if (r.granted) return { ok: true };
      if (r.canAsk === false) return { ok: false, note: '系统已停用授权弹窗：请去系统设置手动开启' };
      return { ok: false };
    },
  },
  {
    // v2.4.2 健康运动工具（getStepCount / getCurrentActivity）前置权限
    key: 'activityRecognition',
    label: '身体活动（步数/运动）',
    desc: '让 AI 看你的今日步数、识别走路/跑步状态',
    icon: Footprints,
    actionLabel: '允许身体活动识别',
    persistDeniedFallback: true,
    query: () => queryPermState('activityRecognition', () => activityRecognitionPermission()),
    request: async () => {
      const r = await requestActivityRecognitionPermission();
      if (r === null) {
        return permRequestFallback(
          'activityRecognition',
          '身体活动权限已开启',
          '申请通道异常，请重试；或到 系统设置 › 应用 › 权限 › 身体活动 手动开启（需 APP v2.4.2+）',
        );
      }
      if (r.granted) return { ok: true };
      if (r.canAsk === false) return { ok: false, note: '系统已停用授权弹窗：请去系统设置手动开启' };
      return { ok: false };
    },
  },
  {
    key: 'contacts',
    label: '通讯录读写',
    desc: '读写在意的联系人',
    icon: BookUser,
    actionLabel: '允许访问通讯录',
    persistDeniedFallback: true,
    query: () => queryPermState('contacts', () => contactsPermission()),
    request: async () => {
      const r = await requestContactsPermission();
      if (r === null) {
        return permRequestFallback(
          'contacts',
          '通讯录权限已开启',
          '申请通道异常，请重试；或到 系统设置 › 应用 › 权限 手动开启通讯录权限',
        );
      }
      if (r.granted) return { ok: true };
      if (r.canAsk === false) return { ok: false, note: '系统已停用授权弹窗：请去系统设置手动开启' };
      return { ok: false };
    },
  },
  {
    key: 'calendar',
    label: '日历读写',
    desc: '读写日程与纪念日',
    icon: CalendarDays,
    actionLabel: '允许访问日历',
    persistDeniedFallback: true,
    query: () => queryPermState('calendar', () => calendarPermission()),
    request: async () => {
      const r = await requestCalendarPermission();
      if (r === null) {
        return permRequestFallback(
          'calendar',
          '日历权限已开启',
          '申请通道异常，请重试；或到 系统设置 › 应用 › 权限 手动开启日历权限',
        );
      }
      if (r.granted) return { ok: true };
      if (r.canAsk === false) return { ok: false, note: '系统已停用授权弹窗：请去系统设置手动开启' };
      return { ok: false };
    },
  },
  {
    key: 'alarm',
    label: '闹钟与计时器',
    desc: '精确闹钟与倒计时提醒',
    icon: AlarmClock,
    actionLabel: '允许精确闹钟',
    query: () => queryPermState('alarm', () => alarmPermission()),
    request: async () => {
      const r = await requestAlarmPermission();
      if (r.ok) return { ok: true, note: '已跳转系统「闹钟和提醒」授权页' };
      return permRequestFallback(
        'alarm',
        '闹钟权限已开启',
        '跳转失败（通道异常），请重试；或到 系统设置 › 应用 › 闹钟和提醒 手动开启',
      );
    },
  },
  {
    key: 'location',
    label: '位置信息',
    desc: '天气定位、地图、外卖/打车场景',
    icon: MapPin,
    actionLabel: '允许定位',
    query: () => queryPermState('location', () => locationPermission()),
    request: async () => {
      const r = await requestLocationPermission();
      if (r.ok) return { ok: true, note: r.via === 'web' ? '已经浏览器授权' : undefined };
      return permRequestFallback(
        'location',
        '定位已开启',
        '定位申请失败，请重试；或到 系统设置 › 位置信息 手动开启',
      );
    },
  },
  {
    key: 'mediafiles',
    label: '文件读写与媒体访问',
    desc: '媒体库与文件读写（相册等）',
    icon: FolderOpen,
    actionLabel: '允许访问文件与媒体',
    persistDeniedFallback: true,
    query: () => queryPermState('mediafiles', () => mediaFilesPermission()),
    request: async () => {
      const r = await requestMediaFilesPermission();
      if (r === null) {
        return permRequestFallback(
          'mediafiles',
          '文件与媒体权限已开启',
          '申请通道异常，请重试；或到 系统设置 › 应用 › 权限 手动开启文件与媒体权限',
        );
      }
      if (r.granted) return { ok: true };
      if (r.canAsk === false) return { ok: false, note: '系统已停用授权弹窗：请去系统设置手动开启' };
      return { ok: false };
    },
  },
  {
    key: 'battery',
    label: '忽略电池优化',
    desc: '息屏后保持监听/常驻通知不被系统限制',
    icon: BatteryCharging,
    actionLabel: '允许忽略电池优化',
    query: () => queryPermState('battery', () => batteryPermission()),
    request: async () => {
      const r = await requestBatteryPermission();
      if (r.ok) return { ok: true, note: '已弹出系统确认框' };
      return permRequestFallback(
        'battery',
        '电池优化豁免已开启',
        '申请通道异常，请重试；或到 系统设置 › 电池 手动允许本应用不受限制',
      );
    },
  },
  // ---- v2.1.0 防杀后台三件套（修改系统设置 / 开机自启动 / 常驻守护） ----
  {
    key: 'writesettings',
    label: '修改系统设置',
    desc: 'AI 调屏幕亮度、设静音等系统级操作',
    icon: SunMedium,
    actionLabel: '去开启修改系统设置',
    query: () => queryPermState('writesettings', () => writeSettingsPermission()),
    request: async () => {
      const ok = await openNativeWriteSettings();
      if (ok) return { ok: true, note: '已跳转系统开关页，打开开关后返回' };
      return permRequestFallback(
        'writesettings',
        '修改系统设置已开启',
        '跳转失败（通道异常），请重试；或到 系统设置 › 应用 › 特殊权限 › 修改系统设置 手动开启',
      );
    },
  },
  {
    key: 'boot',
    label: '开机自启动',
    desc: '手机重启后自动拉起守护服务（需开启常驻守护）',
    icon: Power,
    actionLabel: '开启开机自启动',
    query: async () => {
      const r = await bootAutoStartStatus();
      if (r?.granted && r.enabled) return { granted: true };
      if (readWebPermGrants().boot === true && readWebPermGrants().keepalive === true) return { granted: true };
      return { granted: false, canAsk: true };
    },
    request: async () => {
      // 权限本身安装即授予；这里拉起常驻守护（开关持久化，BootReceiver 据此自启）
      const r = await keepAliveStart();
      if (r.ok) {
        writeWebPermGrant('keepalive', true);
        writeWebPermGrant('boot', true);
        return { ok: true, note: '已就绪：重启后自动拉起守护（国产 ROM 需在系统设置允许本应用自启动）' };
      }
      // v2.1.1 真机环境拉起失败如实报（账本谎报会被原生查询拆穿还误导）；
      // 浏览器/旧 APK 保持账本记账
      if (isNativePerception()) {
        return { ok: false, note: '常驻守护拉起失败，请重试；部分 ROM 需先在系统设置允许本应用自启动/后台运行' };
      }
      writeWebPermGrant('keepalive', true);
      writeWebPermGrant('boot', true);
      return { ok: true, note: '开机自启动已就绪' };
    },
  },
  {
    key: 'keepalive',
    label: '常驻守护（前台服务）',
    desc: '状态栏常驻「AI Phone 正在守候」防杀后台',
    icon: HeartHandshake,
    actionLabel: '开启常驻守护',
    actionLabelOff: '停止常驻守护',
    query: async () => {
      if (readWebPermGrants().keepalive === true) {
        // 账本说开着：真机再核对一次（用户可能从系统里杀过）
        const r = await keepAliveStatus();
        if (r === null || r.running) return { granted: true };
        return { granted: false, canAsk: true };
      }
      const r = await keepAliveStatus();
      if (r?.running) return { granted: true };
      return { granted: false, canAsk: true };
    },
    request: async () => {
      // 已开启 → 停止；未开启 → 拉起前台服务（v2.1.0 开关语义）
      // 运行判定：真机看服务实例（keepAliveStatus.running）；浏览器/旧 APK 桥为 null
      // 时落网页账本（账本记着开启就视为在守护——真机账本与实例不一致时 query 已如实降级）
      const st = await keepAliveStatus();
      const runningNow = st ? st.running === true : readWebPermGrants().keepalive === true;
      if (runningNow) {
        await keepAliveStop();
        writeWebPermGrant('keepalive', false);
        writeWebPermGrant('boot', false);
        return { ok: true, note: '已停止常驻守护（开机不再自启）' };
      }
      const r = await keepAliveStart();
      if (r.ok) {
        writeWebPermGrant('keepalive', true);
        return { ok: true, note: '常驻守护已开启（状态栏显示「AI Phone 正在守候」）' };
      }
      if (isNativePerception()) return { ok: false, note: '常驻守护拉起失败，请重试' };
      writeWebPermGrant('keepalive', true); // 浏览器/旧 APK：账本记账
      return { ok: true, note: '常驻守护已开启' };
    },
  },
  // ---- 既有权限（与 16 项并列展示） ----
  {
    key: 'mic',
    label: '麦克风权限',
    desc: '语音聊天、按住说话、喊名唤醒',
    icon: Mic,
    actionLabel: '允许麦克风',
    query: () => queryPermState('mic', () => micPermission()),
    request: async () => {
      const r = await requestMicPermission();
      if (r?.granted) return { ok: true };
      return permRequestFallback(
        'mic',
        '麦克风已开启',
        '麦克风申请失败，请重试；或到 系统设置 › 应用 › 权限 手动开启麦克风',
      );
    },
  },
  {
    key: 'notify',
    label: '通知权限',
    desc: '系统通知栏弹消息、后台离线推送',
    icon: Bell,
    actionLabel: '允许通知',
    query: async () => {
      const p = await querySystemNotifyPermission();
      if (p === 'granted') return { granted: true };
      // v2.1.1 真机环境：通知开关以系统查询为准，账本不再覆盖真机实际状态
      if (isNativePerception()) return { granted: false, canAsk: p === 'denied' };
      if (readWebPermGrants().notify === true) return { granted: true };
      if (p === 'denied') return { granted: false, canAsk: false };
      return { granted: false, canAsk: true };
    },
    request: async () => {
      const r = await requestSystemNotifyPermission();
      if (r === 'granted') return { ok: true };
      return permRequestFallback(
        'notify',
        '通知已开启',
        '通知申请失败，请重试；或到 系统设置 › 通知 手动开启',
      );
    },
  },
];

/** 单行权限（点击弹授权说明框） */
export function PermissionRow({
  def,
  state,
  onClick,
}: {
  def: PermDef;
  state: PermState;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`perm-row-${def.key}`}
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
    >
      <LineIcon icon={def.icon} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px]">{def.label}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{def.desc}</span>
      </span>
      <PermStatusPill state={state} />
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

/** 模式单选行（AI 动手范围选择器用） */
export function ModeRadioRow({
  icon: Icon,
  label,
  desc,
  selected,
  onSelect,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  desc: string;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onSelect}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
    >
      <LineIcon icon={Icon} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px]">{label}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{desc}</span>
      </span>
      <span
        aria-hidden="true"
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
          selected ? 'border-[#34C759] bg-[#34C759]' : 'border-black/20 dark:border-white/30'
        }`}
      >
        {selected ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

export function PermissionHubPage({ onBack }: { onBack: () => void }) {
  // 惰性初始化（页面仅在用户交互后挂载 = 纯客户端，可安全读 localStorage）
  const [target, setTarget] = useState<AiActionTarget>(() => getAiActionTarget());
  const [toastMsg, showToast] = useLocalToast();

  const native = isNativePerception();

  // ---- 基础权限状态（挂载时逐项查询；网页/真机全可授权，v1.9.38 无「需真机」态） ----
  const [permStates, setPermStates] = useState<Record<string, PermState>>(() => {
    const init: Record<string, PermState> = {};
    for (const d of PERM_DEFS) init[d.key] = 'checking';
    return init;
  });
  const refreshPerm = useCallback(async (key: string) => {
    const def = PERM_DEFS.find((d) => d.key === key);
    if (!def) return;
    try {
      const r = await def.query();
      setPermStates((prev) => ({
        ...prev,
        [key]: r && r.granted === true ? 'granted' : r && r.canAsk === false ? 'web-denied' : 'denied',
      }));
    } catch {
      setPermStates((prev) => ({ ...prev, [key]: 'denied' }));
    }
  }, []);
  const refreshAllPerms = useCallback(() => {
    for (const d of PERM_DEFS) void refreshPerm(d.key);
  }, [refreshPerm]);
  // 初始查询经 setTimeout 调度（setState 全部发生在定时器回调里，避免 effect 体内同步级联渲染）
  useEffect(() => {
    const t = window.setTimeout(() => refreshAllPerms(), 0);
    return () => window.clearTimeout(t);
  }, [refreshAllPerms]);

  // v2.1.1 从系统授权页返回时立即重查（真机跳系统设置开权限 → 返回 APP，
  // 状态必须自动跟上——原来只有 800ms 定时器，用户还没回来它就跑完了；
  // visibilitychange 覆盖 Android WebView 前后台切换，focus/pageshow 覆盖焦点恢复）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAllPerms();
    };
    const onFocus = () => refreshAllPerms();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [refreshAllPerms]);

  // ---- 授权弹窗（当前选中的权限） ----
  const [dialogPerm, setDialogPerm] = useState<PermDef | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);
  /**
   * 持久拒绝态（运行时权限被系统「不再询问」关掉弹窗，canAsk=false）：
   * 弹窗按钮切换为「去系统设置手动开启」，点击经原生 Intent 跳应用详情页。
   */
  const dialogPersistDenied =
    !!dialogPerm && dialogPerm.persistDeniedFallback === true && permStates[dialogPerm.key] === 'web-denied';
  /** v2.1.0 开关语义（常驻守护等）：已开启时按钮变 actionLabelOff、点击=关闭 */
  const dialogActionOn =
    !!dialogPerm && !(dialogPerm.actionLabelOff !== undefined && permStates[dialogPerm.key] === 'granted');
  const dialogActionLabel =
    dialogPerm && !dialogActionOn ? dialogPerm.actionLabelOff : (dialogPerm?.actionLabel ?? '去开启');
  /** 从系统设置页返回（无障碍/使用情况/悬浮窗等）后重新核对 */
  useEffect(() => {
    if (dialogPerm) return;
    // 弹窗关闭后延迟 800ms 刷新（用户可能刚从系统设置返回）
    const t = window.setTimeout(() => {
      refreshAllPerms();
    }, 800);
    return () => window.clearTimeout(t);
  }, [dialogPerm, refreshAllPerms]);

  const doGrant = async () => {
    if (!dialogPerm) return;
    setGrantBusy(true);
    try {
      // v1.9.40 看门狗（仅网页环境）：浏览器授权框不弹/不响应（微信·小红书等内嵌 WebView、被 iframe 策略拦截）时
      // Promise.race 9 秒强制完成并落网页授权账本——按钮绝不再永远卡在「申请中…」；
      // 真机保持原行为（系统授权框等待用户点选属正常态）。
      let r: { ok: boolean; note?: string };
      if (dialogPersistDenied) {
        // 系统弹窗已被持久关掉：跳应用详情页让用户手动开（v2.0.0 兜底）
        const jumped = await openNativeAppDetailSettings();
        r = jumped
          ? { ok: true, note: '已跳转应用详情页，手动开启后返回刷新' }
          : { ok: false, note: '跳转失败（通道异常）' };
      } else if (native) {
        r = await dialogPerm.request();
      } else {
        r = await Promise.race([
          dialogPerm.request(),
          new Promise<{ ok: boolean; note?: string }>((res) => {
            window.setTimeout(() => {
              writeWebPermGrant(dialogPerm.key, true);
              res({ ok: true, note: '已开启' });
            }, 9000);
          }),
        ]);
      }
      // v1.9.41：授权请求结束（成功/失败/看门狗兑底）弹窗才关闭——按钮不再点击即关。
      // Radix AlertDialogAction 默认点击自动关窗，onClick 里 preventDefault 拦住；
      // 期间按钮显示「申请中…」，用户能清楚看到授权正在进行。
      setDialogPerm(null);
      showToast(r.ok ? (r.note ?? '已授权') : (r.note ?? '未完成授权'));
    } catch {
      setDialogPerm(null);
      showToast('申请失败（通道异常）');
    } finally {
      setGrantBusy(false);
      // 授权动作完成即刷新对应项（系统框当场出结果；跳设置页的等返回后刷新）
      if (dialogPerm) void refreshPerm(dialogPerm.key);
    }
  };

  const pickTarget = (t: AiActionTarget) => {
    setTarget(t);
    setAiActionTarget(t);
  };

  return (
    <DetailShell title="权限给予" onBack={onBack} gray>
      <div className="no-scrollbar flex-1 overflow-y-auto pb-8">
        {/* 说明卡（v1.9.40 精简为一行） */}
        <div className="mx-1 mt-4 rounded-[22px] bg-white/55 p-4 text-[13px] leading-relaxed ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <p className="text-muted-foreground">
            点权限行即可开启（真机自动跳系统授权页，浏览器里记网页授权）；AI 动手能力始终开启——你让 TA 做什么就做什么，TA 也会按人设与记忆主动帮你。
          </p>
        </div>

        {/* ===== 基础权限（机主 16 项 + 通知/麦克风） ===== */}
        <SectionLabel icon={ShieldCheck} tone="#34C759" right={
          <button
            type="button"
            onClick={() => { refreshAllPerms(); }}
            className="flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-1 text-[12px] text-muted-foreground transition-colors active:bg-black/10 dark:bg-white/10 dark:active:bg-white/20"
            data-testid="perm-refresh"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={2.4} />
            刷新状态
          </button>
        }>
          基础权限
        </SectionLabel>
        <div className="mx-1 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          {PERM_DEFS.map((d) => (
            <PermissionRow key={d.key} def={d} state={permStates[d.key] ?? 'checking'} onClick={() => setDialogPerm(d)} />
          ))}
        </div>

        {/* ===== 时长数据源（v2.0.0 去 Shizuku：UsageStats 恒走原生系统账本，无模式可选，纯展示） ===== */}
        <SectionLabel icon={Cpu} tone="#FF9500">时长数据源</SectionLabel>
        <div className="mx-1 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={Cpu} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">原生 UsageStats</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">使用时长直读系统账本（自动启用，无需选择）</span>
            </span>
            <span className="shrink-0 rounded-full bg-[#34C759]/12 px-2.5 py-1 text-[12px] font-medium text-[#248A3D] dark:text-[#30D158]">
              自动
            </span>
          </div>
        </div>

        {/* ===== AI 动手范围 ===== */}
        <SectionLabel icon={MousePointerClick} tone="#FF2D55">AI 动手范围</SectionLabel>
        <div className="mx-1 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]" role="radiogroup" aria-label="AI 动手范围">
          <ModeRadioRow
            icon={AppWindow}
            label="网站里面"
            desc="AI 只操作手机里的网页应用"
            selected={target === 'web'}
            onSelect={() => pickTarget('web')}
            testId="target-web"
          />
          <ModeRadioRow
            icon={Smartphone}
            label="真机"
            desc="AI 经原生+无障碍操作真实手机"
            selected={target === 'device'}
            onSelect={() => pickTarget('device')}
            testId="target-device"
          />
        </div>
        <p className="mx-1 mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {target === 'device' ? '真机命令会真实作用在你的手机上（经原生系统 API 与无障碍服务）。' : '动手只作用在手机里的网页应用，不碰真实手机。'}
        </p>
      </div>

      {/* 权限授权确认弹窗（v1.9.40 iOS 式：标题 + 暂不/开启，无长说明；持久拒绝时按钮变「去系统设置手动开启」） */}
      <AlertDialog open={!!dialogPerm} onOpenChange={(o) => { if (!o) setDialogPerm(null); }}>
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="px-5 pb-5 pt-6 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
              {dialogPerm ? `${dialogActionOn ? '开启' : '管理'}${dialogPerm.label}？` : ''}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row border-t border-black/[0.08] dark:border-white/[0.12]">
            <AlertDialogCancel className="mt-0 flex-1 border-0 border-r border-black/[0.08] py-3 text-[16px] dark:border-white/[0.12]">暂不</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // v1.9.41：拦住 Radix 默认的点击即关窗——弹窗保持到授权请求结束（申请中…）
                // 才由 doGrant 手动关闭，机主能清楚看到授权过程而非点完就无声消失
                e.preventDefault();
                void doGrant();
              }}
              disabled={grantBusy}
              className="mt-0 flex-1 border-0 bg-transparent py-3 text-[16px] font-semibold text-[#007AFF] hover:bg-transparent disabled:opacity-50"
              data-testid="perm-grant-confirm"
            >
              {grantBusy ? '申请中…' : dialogPersistDenied ? '去系统设置手动开启' : dialogActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocalToast msg={toastMsg} />
    </DetailShell>
  );
}
