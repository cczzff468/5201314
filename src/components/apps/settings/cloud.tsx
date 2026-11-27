'use client';

// 云端助手 ClawBox 页（Supabase 部署管线 + 内置 IM 网关 + 真机接入两个 nextDynamic tab）。

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import type { ReactNode } from 'react';

import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Cloud,
  CloudOff,
  CloudUpload,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  Smartphone,
  Trash2,
  Wrench,
} from 'lucide-react';

import nextDynamic from 'next/dynamic';

import { Input } from '@/components/ui/input';

import { Switch } from '@/components/ui/switch';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

import { listContactsFor } from '@/lib/ios/contacts-store';

import {
  withDisplayNames,
  type ContactRecord,
} from '@/lib/contacts';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

// 云端助手（微信 7x24 自动回复）：部署到用户自己的 Supabase。
// 状态中心 + 部署管线都在 src/lib/ios/wx-cloud/，凭证只在用户浏览器密文保存。
import {
  PLATFORM_LABELS,
  useWxCloud,
  wipeWxCloud,
} from '@/lib/ios/wx-cloud/store';

// v18 全局错误中心：云端失败态极简指示器（详情进弹窗）
import { InlineErrorChip } from '../error-center';

import {
  checkServiceKey,
  cronStartSql,
  cronStopSql,
  deploySupabase,
  ensureLocalGatewayConfig,
  fetchCloudHeartbeat,
  listProjects,
  pingSupabase,
  saveSupabaseConn,
  startSupabaseCron,
  stopSupabaseCron,
  syncRunPackage,
  type CloudHeartbeat,
  type DeployResult,
  type SupaProject,
} from '@/lib/ios/wx-cloud/supabase';

// 内置 IM 网关（v7：免费·免配置——QQ 走官方 WebSocket 长连接，微信长轮询 7×24；
// 替换旧「腾讯云境内出口」与「云端轮询 pg_cron」两条路）
// v20 网站回复同步真机（每通道独立开关，默认开启）
import {
  ensureImGatewayRunning,
  fetchImGatewayStatus,
  startImGateway,
  stopImGateway,
  type ImGatewayStatus,
} from '@/lib/ios/wx-cloud/gateway';

import {
  IOS_RED,
  TONE_BLUE,
  TONE_GREEN,
  TONE_RED,
  DetailShell,
  FieldLabel,
  SectionLabel,
  GrayCard,
} from './shared';


// ---------------- 云端助手（部署用户自己的 Supabase） ----------------

// v22 真机接入子页（微信/QQ 两个接入界面收拢进云端助手）：动态加载——独立 chunk 不拖重
// 设置页首包，也避开与 weixin-connect / qq-connect 的静态模块环（同 pingAndSync 动态 import 口径）
export const WeixinConnectPage = nextDynamic(() => import('../wx-app/connect').then((m) => m.WeixinConnectPage), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[13px] text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      正在打开真机微信接入…
    </div>
  ),
});
export const QqConnectPage = nextDynamic(() => import('../qq-app/connect').then((m) => m.QqConnectPage), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[13px] text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      正在打开真机 QQ 接入…
    </div>
  ),
});

/** 真机接入登录态（主视图两行的副文案）：null=未接入，''=已接入未绑角色，其余=绑定角色名。
 *  store 动态 import + boot（幂等，接入页挂载会再 boot 无碍）；订阅在卸载时统一退订。 */
export function useRealDeviceLogin(): { wx: string | null; qq: string | null } {
  const [wx, setWx] = useState<string | null>(null);
  const [qq, setQq] = useState<string | null>(null);
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let dead = false;
    void import('@/lib/ios/weixin-connect').then((m) => {
      if (dead) return;
      void m.useWxConnect.getState().boot();
      unsubs.push(m.useWxConnect.subscribe((s) => setWx(s.login ? s.login.boundContactName || '' : null)));
    });
    void import('@/lib/ios/qq-connect').then((m) => {
      if (dead) return;
      void m.useQqConnect.getState().boot();
      unsubs.push(m.useQqConnect.subscribe((s) => setQq(s.login ? s.login.boundContactName || '' : null)));
    });
    return () => {
      dead = true;
      while (unsubs.length) unsubs.pop()?.();
    };
  }, []);
  return { wx, qq };
}

/** 真机接入子页的角色候选（kind==='char' 联系人，App 投影 + 展示名口径同微信/QQ App 内）。
 *  enabled=false（主视图）不拉取——打开子页才读 IndexedDB。 */
export function useConnectContacts(app: 'wx' | 'qq', enabled: boolean): ContactRecord[] {
  const [list, setList] = useState<ContactRecord[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    void listContactsFor(app)
      .then((raw) => {
        if (!dead) setList(withDisplayNames(raw, { social: true, app }));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [app, enabled]);
  return list;
}

/** 云端助手 · 输入框样式（毛玻璃胶囊统一配方 v23：圆角胶囊化 + 内高光） */
export const CLOUD_INPUT_CLS =
  'h-11 rounded-[16px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]';

/** 云端助手 · 白底胶囊按钮（次级动作：读取列表 / 重新同步 / 测试 / 停用定时）——v23 毛玻璃胶囊化
 *  （与真机接入子页按钮同一套配方：圆角胶囊 + 半透明 + 内高光 + 按下微缩） */
export const CLOUD_BTN_CLS =
  'flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white/60 text-[15px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]';

/** 云端助手 · 蓝底胶囊按钮（关键动作：一键部署）——v23 胶囊化（与次级按钮同形） */
export const CLOUD_BTN_BLUE_CLS =
  'flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#007AFF] text-[15px] font-medium text-white shadow-[0_6px_20px_rgba(0,122,255,0.28)] transition-all active:scale-[0.98] active:bg-[#0066D6] disabled:opacity-50';

/** 云端助手 · 表单分组卡（v23 毛玻璃胶囊统一：与 GrayCard 同配方 + 独立行距） */
export const CLOUD_CARD_CLS =
  'flex flex-col gap-4 rounded-[24px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]';

/** 云端助手 · 结果提示框（绿=成功 / 红=失败） */
export const CLOUD_OK_BOX_CLS =
  'rounded-[16px] border border-emerald-500/30 bg-emerald-400/15 px-4 py-3 text-[13px] leading-relaxed text-emerald-700 backdrop-blur-xl dark:bg-emerald-300/[0.08] dark:text-emerald-300';
export const CLOUD_ERR_BOX_CLS =
  'rounded-[12px] border border-[#FF453A]/30 bg-[#FF453A]/10 px-4 py-3 text-[13px] leading-relaxed text-[#FF453A]';

/** 云端助手 · 复制按钮（navigator.clipboard 优先，WebView 里 execCommand 兜底） */
export function CloudCopyButton({
  text,
  label = '复制',
  testId,
  onCopied,
}: {
  text: string;
  label?: string;
  testId?: string;
  onCopied?: (ok: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // WebView 剪贴板兜底：临时 textarea + execCommand 旧接口
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        ok = true;
      } catch {
        ok = false;
      }
    }
    setCopied(ok);
    onCopied?.(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => void copy()}
      disabled={!text}
      className="flex shrink-0 items-center gap-1 rounded-full bg-black/[0.05] px-3 py-[6px] text-[11.5px] font-medium text-foreground/70 transition-colors active:bg-black/[0.08] disabled:opacity-40 dark:bg-white/10 dark:text-muted-foreground"
    >
      <ClipboardList className="h-3.5 w-3.5" />
      {copied ? '已复制' : label}
    </button>
  );
}

/** 云端助手 · 简单结果提示（一键部署/HF 成功框内容多单独写；这里只包「绿/红一行消息」的结果。
 *  v18：失败态改极简指示器——机主定调「界面不铺错误长文」：失败只留可点击小胶囊，
 *  详情（原始错误全文）进全局错误中心弹窗看） */
export function CloudResultBox({ r, mt = false }: { r: { ok: boolean; msg: string } | null; mt?: boolean }) {
  if (!r) return null;
  if (!r.ok) {
    return <InlineErrorChip label="云端操作失败" msg={r.msg} scope="cloud" className={mt ? 'mt-2' : ''} />;
  }
  return (
    <div className={`${CLOUD_OK_BOX_CLS}${mt ? ' mt-2' : ''}`}>
      <span className="flex items-start gap-1.5">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        {r.msg}
      </span>
    </div>
  );
}

/**
 * 云端助手 · 收缩区块（v5 用户定调「要收缩选择」）：一行触发头（标题 + 可选右侧提示字），
 * 点击展开内容——长说明/兜底步骤全部收进来，页面主体只留操作。
 */
export function CloudFold({
  title,
  hint,
  testid,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  testid?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-[16px] bg-white/45 ring-1 ring-white/60 backdrop-blur-xl dark:bg-white/[0.05] dark:ring-white/[0.07]">
      <CollapsibleTrigger
        data-testid={testid}
        className="group flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.06]"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/85">{title}</span>
        {hint ? <span className="shrink-0 truncate text-[11.5px] text-muted-foreground/80">{hint}</span> : null}
        <ChevronDown
          className="h-[16px] w-[16px] shrink-0 text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]:rotate-180"
          strokeWidth={2}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3.5 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** 云端助手页挂载时自动恢复「自动在线」（v7）：服务重启/重连后网关掉线、又没人在接入页
 *  打开过时，进云端助手页即补开（幂等：已在跑则服务端直接返回，不产生副作用）。
 *  dep 变为 true 时执行一次；失败静默（开关/接入页会给出可见反馈）。
 *  v20 402 自愈：网关没跑时先本地直推一次最新运行包（local-config.json 落盘——Storage
 *  受限读不到云端运行包时网关用本地配置即起线），再拉起网关。构建/推送/拉起全静默。 */
export function AutoEnsureGatewayEffect({ dep }: { dep: boolean }) {
  const fired = useRef(false);
  useEffect(() => {
    if (!dep || fired.current) return;
    fired.current = true;
    void (async () => {
      try {
        const st = await fetchImGatewayStatus();
        if (!st?.running) await ensureLocalGatewayConfig();
      } catch {
        /* 直推静默：不影响下方拉起 */
      }
      void ensureImGatewayRunning('自动恢复在线').catch(() => undefined);
    })();
  }, [dep]);
  return null;
}

/**
 * 云端助手页：把「微信/QQ 接入凭证 + 绑定角色人设」打包成运行包，部署到用户自己的免费
 * Supabase 账号（一键部署）。v9 起云端 24 小时收发骨干 = 用户 Supabase 项目里的 pg_cron
 * 定时任务（部署后自动建立，v16 起两档：每 10 秒打 cron-cycle&fast=1 微信短窗单轮 + 每分钟打
 * cron-cycle&qq=1 QQ WebSocket
 * 会话保持/断点续传）——本站关了也在线。本站在线时另有「秒回加速」（内置 IM 网关：QQ
 * 官方 WebSocket 长连接 + 微信即时轮询，回复接近秒回；与云端定时任务并发跑安全——
 * v9 轮询锁 + 认领表）。凭证只在用户浏览器密文保存（wx-cloud/store）。接入/换绑/断开、
 * 改「API 设置」都会自动同步运行包（配置中心仍是 Supabase，云端 60 秒内跟上）。
 * v22 真机接入收拢：原 微信「我」页 / QQ「动态」页的两个接入界面迁到本页「真机接入」
 * 分组；使用顺序（强制）：先在这里部署云端，再到「真机接入」扫码接入真机。
 * v24 ClawBox 统一界面：真机接入不再是单独子页——本页顶部「云端助手 / 真机接入」两个
 * 毛玻璃胶囊页签（tab）切换，真机接入页签里微信/QQ 胶囊切换 + 接入页内嵌（embedded）
 * 同屏完成；入口行更名 ClawBox、下移到语音 API 下方。
 */
export function ClawBoxPage({ onBack }: { onBack: () => void }) {
  // —— 部署状态中心（挂载时 boot 拉取密文持久化状态） ——
  const ready = useWxCloud((s) => s.ready);
  const platform = useWxCloud((s) => s.platform);
  const supa = useWxCloud((s) => s.supabase);
  const lastPing = useWxCloud((s) => s.lastPing);
  // v15 云端运行时代际已下线展示（v21 精简：版本行删除；运行时升级随「重新同步运行包」自动带）
  const boot = useWxCloud((s) => s.boot);
  const setPlatform = useWxCloud((s) => s.setPlatform);
  const clearPlatform = useWxCloud((s) => s.clearPlatform);

  const [toastMsg, showToast] = useLocalToast();

  // —— v24 两个页签：'cloud' 云端助手（部署/开关/测试）；'device' 真机接入（微信/QQ 内嵌）——
  const [tab, setTab] = useState<'cloud' | 'device'>('cloud');
  /** 真机接入页签内的平台胶囊：'wx' / 'qq'（切换即内嵌对应接入页，不再整页跳转） */
  const [device, setDevice] = useState<'wx' | 'qq'>('wx');
  /** 页签两行副文案用的登录态（null=未接入，''=已接入未绑角色，其余=角色名） */
  const deviceLogin = useRealDeviceLogin();
  /** 接入页角色候选（真机接入页签打开才拉取） */
  const subContacts = useConnectContacts(device, tab === 'device');

  useEffect(() => {
    void boot();
  }, [boot]);

  // —— Supabase 连接 ——
  const [supaToken, setSupaToken] = useState('');
  const [showSupaToken, setShowSupaToken] = useState(false);
  /** service_role key 手动兑底（自动读取失败时展开：PAT 无项目权限 / 新式 secret key 不回明文） */
  const [manualKeyOpen, setManualKeyOpen] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [manualKeySaved, setManualKeySaved] = useState(false);
  /** 手动 key 验证中（先调项目 Storage 测写入权限，通过才保存） */
  const [manualKeyChecking, setManualKeyChecking] = useState(false);
  const [manualKeyErr, setManualKeyErr] = useState('');
  const [projects, setProjects] = useState<SupaProject[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  /** 本次会话选中的项目名（saveSupabaseConn 只存 ref，名字仅展示用） */
  const [projName, setProjName] = useState('');
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<DeployResult | null>(null);

  // —— 自动在线（内置 IM 网关，v7）—— QQ WebSocket 长连接 + 微信长轮询；状态靠轮询
  // 网关 /api/im-gateway 拿（服务端是真源）；开关切换中防重入
  const [gatewayStatus, setGatewayStatus] = useState<ImGatewayStatus | null>(null);
  const [gatewayBusy, setGatewayBusy] = useState(false);

  // —— 云端轮询开关（v10：开 = 自动回复，关 = 零配额消耗）——真源是用户 Supabase 里的
  // pg_cron 定时任务（schedule-cron / unschedule-cron 走 Management API SQL）；本地
  // cronOn 只是缓存档位，云端心跳（state/heartbeat.json）拿来验证它真的在跑——用户
  // 不用再手动点「云端测试」才能看到自动回复在工作
  const [cronBusy, setCronBusy] = useState(false);
  /** 云端心跳（函数每轮收发后写入 state/heartbeat.json，经中继读回）：null = 还没拉到/通道不可用 */
  const [cronHb, setCronHb] = useState<CloudHeartbeat | null>(null);

  // 自动读取 service_role 失败（need_manual_key）时自动展开手动粘贴区
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 失败信号驱动的展开（一次性），非渲染期派生
    if (deployResult?.code === 'need_manual_key' || syncResult?.code === 'need_manual_key') setManualKeyOpen(true);
  }, [deployResult, syncResult]);
  const [pingLoading, setPingLoading] = useState(false);
  /** 结果弹窗（部署失败 / 云端测试结果 / 开关失败：标题 + 正文 + 「知道了」） */
  const [resultDialog, setResultDialog] = useState<{ title: string; body: string } | null>(null);

  // —— 危险操作 ——
  const [confirmWipe, setConfirmWipe] = useState(false);

  // boot 完成后把持久化的 token 回填输入框（只回填一次，之后交给用户编辑）
  const backfilled = useRef(false);
  useEffect(() => {
    if (!ready || backfilled.current) return;
    backfilled.current = true;
    const st = useWxCloud.getState();
    // 从密文 store 回填输入框（仅一次）：非级联渲染，是 store → 本地草图的同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (st.supabase?.token) setSupaToken(st.supabase.token);
  }, [ready]);

  // v21 平台收敛迁移：「不使用云端（仅本机）」已下线——存量选中已下架平台（HF/ClawCloud）
  // 或「仅本机」的在页面打开时自动切到 Supabase（云端唯一路径；一次性，不打扰正常用户）
  const legacyPlatformMigrated = useRef(false);
  useEffect(() => {
    if (!ready || legacyPlatformMigrated.current) return;
    if (platform === 'hf' || platform === 'clawcloud') {
      legacyPlatformMigrated.current = true;
      setPlatform('supabase');
      showToast('Hugging Face Spaces / ClawCloud Run 已下架：已切换为 Supabase');
    } else if (platform === 'none') {
      legacyPlatformMigrated.current = true;
      setPlatform('supabase');
    }
  }, [ready, platform, setPlatform, showToast]);

  // —— 派生值（均与 wxCloudSnapshot() 同源：store 变更会触发本组件重渲染） ——
  const cloudOn = platform !== 'none';
  /** Supabase 是否已跑过一键部署（deploySupabase 成功后写入 deployedAt） */
  const supaDeployed = (supa?.deployedAt ?? 0) > 0;
  /** 云端轮询开关档位（v10）：部署成功自动置 true；存量没写这字段的旧状态按「部署过即开着」推导 */
  const cronOn = supaDeployed ? (supa?.cronOn ?? true) : false;
  /** 云端心跳新鲜度：开启中且心跳 ≤3 分钟内 → 正常；>3 分钟/拉不到 → 可能没真跑（提示修复） */
  const hbAgeMs = cronHb?.lastRunAt ? Date.now() - cronHb.lastRunAt : Number.POSITIVE_INFINITY;
  const hbFresh = Number.isFinite(hbAgeMs) && hbAgeMs < 180_000;
  /** 轮询开启但心跳迟滞（>3 分钟没轮到）：开关重开可修复（PAT 权限变过/定时任务被手动删过等） */
  const hbStale = cronOn && supaDeployed && cronHb !== null && !hbFresh;
  // v80 状态卡派生：大图标状态标题/副标 + 测试异常信号（pingBad 置顶优先）
  const pingBad = lastPing?.ok === false;
  /** 自动在线开关态（v7）：真源是网关 /api/im-gateway 的 running（服务端进程内存） */
  const gwOn = !!gatewayStatus?.running;
  /** QQ 通道文案（网关状态卡/开关副文案共用）：ready=已连平台，error=带原因，connecting=连接中 */
  const qqCh = gatewayStatus?.qq;
  const statusTitle = pingBad
    ? '云端异常'
    : !supaDeployed
      ? '已选云端 · 待部署'
      : cronOn
        ? '云端已部署 · 24 小时收发中'
        : '云端已部署 · 自动收发已停';
  const statusSub = !supaDeployed
    ? '填 Token → 选项目 → 一键部署（自动开 24 小时收发）'
    : !cronOn
      ? '云端轮询已关（零配额）；可随时再开启'
      : gwOn
        ? qqCh?.state === 'ready'
          ? '云端 24 小时收发中 · 本站加速在线（TA 秒回）'
          : '云端 24 小时收发中 · 本站加速连接中'
        : '云端 24 小时自动收发（跑在你的 Supabase 里，本站关了也在线）';

  // Token 输入框与已保存值不一致时先回写快照（用户换 token 后免重选项目）
  const ensureTokenSynced = () => {
    const t = supaToken.trim();
    if (supa?.ref && t && t !== supa.token) saveSupabaseConn(t, supa.ref, projName);
  };

  /** 读取项目列表（走 /api/cloud-deploy/supabase 代理，避免 CORS） */
  const loadProjects = async () => {
    const token = supaToken.trim();
    if (!token) {
      setProjectsError('请先填写 Supabase Access Token');
      return;
    }
    setProjectsLoading(true);
    setProjectsError('');
    setProjects(null);
    try {
      const list = await listProjects(token);
      setProjects(list);
      if (list.length === 0) setProjectsError('该账号下没有项目：到 supabase.com 新建一个免费项目再回来读取');
    } catch (e) {
      setProjectsError(e instanceof Error ? e.message : String(e));
    } finally {
      setProjectsLoading(false);
    }
  };

  /** 选中项目：保存连接（token + ref；serviceKey 部署时自动补） */
  const pickProject = (p: SupaProject) => {
    saveSupabaseConn(supaToken.trim() || (supa?.token ?? ''), p.id, p.name);
    setProjName(p.name);
    setDeployResult(null);
    setSyncResult(null);
    setResultDialog(null);
    showToast(`已选择项目 ${p.name}`);
  };

  /** 手动 key 验证并保存：先做格式预检（sbp_/sb_publishable_ 直接本地拦截，不发请求），再调项目 Storage 测写入权限（publishable/anon 会 403），通过才写进密文 store */
  const verifyAndSaveManualKey = async () => {
    const st = useWxCloud.getState();
    const ref = st.supabase?.ref;
    const key = manualKey.trim();
    if (!ref || key.length < 20) return;
    setManualKeyChecking(true);
    setManualKeyErr('');
    setManualKeySaved(false);
    try {
      // 格式预检（用户实测踩坑：把 Access Token / 公开密钥粘进了密钥框）：
      // sbp_ = Access Token（管理项目用，不是项目密钥）；sb_publishable_ = 公开密钥（无写权限）
      if (key.startsWith('sbp_')) {
        setManualKeyErr('这是 Supabase Access Token（sbp_ 开头，管理项目用的）——填错位置了。要用项目密钥：Project Settings → API Keys 里 sb_secret_ 开头的 secret key，或 Legacy API keys 里 eyJ 开头的旧版 service_role');
        return;
      }
      if (key.startsWith('sb_publishable_')) {
        setManualKeyErr('这是公开密钥（sb_publishable_ 开头，权限相当于 anon），不能写 Storage。要用 sb_secret_ 开头的 secret key，或 eyJ 开头的旧版 service_role');
        return;
      }
      if (!key.startsWith('sb_secret_') && !key.startsWith('eyJ')) {
        setManualKeyErr('密钥格式不像 Supabase 项目密钥（应以 sb_secret_ 或 eyJ 开头）。请到 Project Settings → API Keys 重新复制');
        return;
      }
      const r = await checkServiceKey(ref, key);
      if (!r.ok) {
        setManualKeyErr(r.msg);
        return;
      }
      st.saveSupabase({ ...st.supabase!, serviceKey: key });
      setManualKeySaved(true);
    } finally {
      setManualKeyChecking(false);
    }
  };

  /** 一键部署：部署 Edge Function + 同步运行包 + 顺手清旧轮询任务（转圈最长约 3 分钟）。
   *  失败弹「部署失败」弹窗（正文=具体问题）；成功用绿色结果框 + funcUrl。 */
  const runDeploy = async () => {
    ensureTokenSynced();
    setDeployLoading(true);
    setDeployResult(null);
    try {
      const r = await deploySupabase();
      setDeployResult(r);
      if (!r.ok) {
        setResultDialog({ title: '部署失败', body: r.msg });
      } else {
        // v9：云端 24 小时收发已在部署内部自动建立（不依赖本站）；本站加速开不起来
        // 只降体验不降可用性——toast 带真实原因，不再弹「未开启」大弹窗吓人
        const g = await startImGateway('部署完成自动开启');
        if (g.ok) {
          showToast('云端 24 小时收发已开启；本站秒回加速也已启动');
          setGatewayStatus(await fetchImGatewayStatus());
        } else {
          showToast('云端 24 小时收发已开启；本站秒回加速未启动（不影响云端收发）：' + g.msg.slice(0, 90));
          setGatewayStatus(await fetchImGatewayStatus());
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDeployResult({ ok: false, msg });
      setResultDialog({ title: '部署失败', body: msg });
    } finally {
      setDeployLoading(false);
    }
  };

  /** 重新同步运行包：换绑定角色 / 改「API 设置」后用（配置即生效，无需重部署） */
  const runSync = async () => {
    ensureTokenSynced();
    setSyncLoading(true);
    setSyncResult(null);
    try {
      setSyncResult(await syncRunPackage());
    } catch (e) {
      setSyncResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncLoading(false);
    }
  };

  /**
   * 测试云端（含同步闭环，v5）：直接调一次函数——默认分支会真实跑一轮约 100 秒的微信
   * 收发窗口（所以点完测试 TA 真的会在真机微信里回消息）；成功后顺手把云端代答的对话
   * 同步进手机聊天界面（用户实测「点测试后微信有回复、网站里却看不到」的闭环）。
   */
  const pingAndSync = async (): Promise<{ ok: boolean; msg: string }> => {
    const r = await pingSupabase();
    if (r.ok) {
      try {
        // 动态 import 避免与 weixin-connect 的模块环（同 qq-connect cloudAutoSync 模式）
        const { pullWxCloudHistory } = await import('@/lib/ios/weixin-connect');
        const p = await pullWxCloudHistory();
        if (p.ok && p.added) return { ...r, msg: `${r.msg}；已同步 ${p.added} 条微信聊天记录进聊天界面` };
      } catch {
        /* 同步失败不影响测试结果 */
      }
    }
    return r;
  };

  /** 云端测试一次：直接调一次函数（带任务密钥；最长约 130 秒，含 100 秒收发窗口）。
   *  结果弹「云端测试」弹窗（成功 / 失败都弹，正文=具体结果）。 */
  const runPing = async () => {
    setPingLoading(true);
    setResultDialog(null);
    try {
      const r = await pingAndSync();
      setResultDialog({ title: '云端测试', body: r.msg });
    } catch (e) {
      setResultDialog({ title: '云端测试', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setPingLoading(false);
    }
  };

  /** 秒回加速开关（v7→v9 改名）：开 = 内置 IM 网关（免费·免配置）——本站在线时 QQ 走官方
   *  WebSocket 长连接（无需 q.qq.com 回调地址）、微信即时轮询，回复接近秒回；云端 24 小时
   * 收发由用户 Supabase 里的定时任务独立承担（关本开关不影响）——与云端并发跑安全
   * （v9 轮询锁 + 认领表）。失败弹窗展示。 */
  const setGateway = async (on: boolean) => {
    if (gatewayBusy) return;
    setGatewayBusy(true);
    try {
      const r = on ? await startImGateway('') : await stopImGateway();
      if (!r.ok) {
        setResultDialog({ title: on ? '开启秒回加速失败' : '停止秒回加速失败', body: r.msg });
      } else {
        showToast(on ? '秒回加速已开启：本站在线时回复接近秒回（云端 24 小时收发不受影响）' : '秒回加速已停止（云端 24 小时收发不受影响，回复按分钟级）');
      }
      setGatewayStatus(await fetchImGatewayStatus());
    } catch (e) {
      setResultDialog({ title: on ? '开启秒回加速失败' : '停止秒回加速失败', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setGatewayBusy(false);
    }
  };

  // 网关状态轮询 + 看门狗（v7）：部署过的用户 6 秒一拉 /api/im-gateway——开关态、QQ 通道连接
  // 状态、微信循环健康都在这（服务端是真源；挂载即拉一次）。发现掉线自动拉起（限 60s 一次，
  // 服务重启/进程崩溃后自愈——用户打开任一相关页面即恢复在线）
  // v20 402 自愈：拉起前先本地直推一次最新运行包（Storage 受限读不到云端配置时，网关用
  // local-config.json 即可起线——「拉起必失败」的死循环解除）
  const gwLastEnsureRef = useRef(0);
  useEffect(() => {
    if (!ready || !supaDeployed) return;
    let dead = false;
    let timer = 0;
    const tick = async () => {
      const s = await fetchImGatewayStatus();
      if (dead) return;
      setGatewayStatus(s);
      if (!s?.running && Date.now() - gwLastEnsureRef.current > 60000) {
        gwLastEnsureRef.current = Date.now();
        void ensureLocalGatewayConfig().then(() => {
          if (dead) return;
          void ensureImGatewayRunning('检测到掉线自动恢复');
        });
      }
      timer = window.setTimeout(tick, 6000);
    };
    void tick();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [ready, supaDeployed]);

  // 云端心跳监测（v10）：云端轮询开着时每 30 秒读一次 state/heartbeat.json（经云端函数
  // 中继通道，不需要项目密钥）——开关开着 ≠ 真在跑（定时任务可能被手动删/PAT 换过权限），
  // 心跳是最直接证据：用户在设置页就能看到「最近自动收发 X 秒前」，无需手动点「云端测试」
  useEffect(() => {
    if (!ready || !supaDeployed || !cronOn) return;
    const ref = supa?.ref;
    if (!ref) return;
    let dead = false;
    let timer = 0;
    const tick = async () => {
      const hb = await fetchCloudHeartbeat(ref);
      if (dead) return;
      setCronHb(hb);
      timer = window.setTimeout(tick, 30_000);
    };
    void tick();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [ready, supaDeployed, cronOn, supa?.ref]);

  /** 云端轮询开关（v10；v16 升格 10 秒档）：开 = 每 10 秒自动轮询回复（两个 pg_cron 任务：
   *  10 秒微信短窗单轮 + 每分钟 QQ 长连接保持，跑在你的 Supabase 里，免费、本站关了也
   *  在线）；关 = 清掉定时任务（停用立刻生效、零配额消耗——云端不再自动回复，只有页面
   *  开着时 TA 才回复）。幂等（重复点安全）；失败弹窗 + 展开「手动 SQL」兑底复制段。 */
  const [cronFail, setCronFail] = useState<'start' | 'stop' | null>(null);
  const setCron = async (on: boolean) => {
    if (cronBusy) return;
    setCronBusy(true);
    try {
      const r = on ? await startSupabaseCron() : await stopSupabaseCron();
      if (!r.ok) {
        setCronFail(on ? 'start' : 'stop');
        setResultDialog({ title: on ? '开启云端轮询失败' : '停止云端轮询失败', body: r.msg });
      } else {
        setCronFail(null);
        if (!on) setCronHb(null);
        showToast(
          on
            ? '云端轮询已开启：每 10 秒自动轮询回复（免费）'
            : '云端轮询已停用（零配额）；可随时再开启',
        );
      }
    } catch (e) {
      setCronFail(on ? 'start' : 'stop');
      setResultDialog({ title: on ? '开启云端轮询失败' : '停止云端轮询失败', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setCronBusy(false);
    }
  };

  /** 心跳迟滞修复（v10）：重新跑一次 schedule-cron（幂等——先 unschedule 同名再建，
   *  等于重建定时任务；v16 重建为 10 秒轮询档）；多分钟没心跳时出现，一键自愈
   *  「部署后定时任务没建成/被删过」 */
  const repairCron = async () => {
    if (cronBusy) return;
    setCronBusy(true);
    try {
      const r = await startSupabaseCron();
      if (!r.ok) {
        setCronFail('start');
        setResultDialog({ title: '修复失败', body: r.msg });
      } else {
        setCronFail(null);
        setCronHb(null); // 重置心跳，等下一轮读回（10 秒内新心跳就到）
        showToast('已重建云端轮询定时任务：10 秒内恢复 10 秒档自动收发');
      }
    } catch (e) {
      setResultDialog({ title: '修复失败', body: e instanceof Error ? e.message : String(e) });
    } finally {
      setCronBusy(false);
    }
  };

  /** 清除云端配置：平台选择 + Supabase 凭证全部抹掉（二次确认后；本机聊天数据不受影响）。
   *  v16：顺手停掉云端轮询（清定时任务）——用户反馈「删除网站/清除云端后真机还在回」：
   *  定时任务存在用户 Supabase 里，不随配置清除而消失；现在清除前先 stopSupabaseCron。 */
  const doWipe = async () => {
    // 网关一并停掉（云端配置已抹掉，网关没有可读的配置中心了）
    await stopImGateway().catch(() => undefined);
    // 云端轮询定时任务一并清掉（停用立刻生效、零配额消耗；凭证还没抹、先停再清）
    await stopSupabaseCron().catch(() => undefined);
    clearPlatform();
    await wipeWxCloud();
    setProjects(null);
    setProjectsError('');
    setProjName('');
    setDeployResult(null);
    setSyncResult(null);
    setResultDialog(null);
    setSupaToken('');
    setGatewayStatus(null);
    backfilled.current = false;
    setConfirmWipe(false);
    showToast('已清除全部云端配置');
  };

  // —— v24 真机接入不再整页切换：作为本页第二个页签内嵌（cloud-device-wx-page / -qq-page
  //    testid 保留在接入页自身根节点上，E2E 口径不变）——

  return (
    <DetailShell title="云端助手" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* v24 两个页签（毛玻璃胶囊分段控件）——第四十二轮机主定名：云端助手 / ClawBox
            （原「真机接入」页签更名 ClawBox，页题/入口行从 ClawBox 更名云端助手）。
            active 胶囊内高光白底 + 按下微缩，动效 200ms */}
        <div
          role="tablist"
          aria-label="云端助手功能页签"
          className="flex w-full rounded-full bg-white/50 p-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_16px_rgba(17,24,39,0.05)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.1]"
        >
          {(
            [
              { id: 'cloud', icon: Cloud, label: '云端助手' },
              { id: 'device', icon: Smartphone, label: 'ClawBox' },
            ] as const
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`clawbox-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-medium transition-all active:scale-[0.98] ${
                  active
                    ? 'bg-white text-foreground shadow-[0_2px_10px_rgba(17,24,39,0.1)] ring-1 ring-black/[0.04] dark:bg-white/[0.16] dark:ring-white/[0.1]'
                    : 'text-muted-foreground active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                }`}
              >
                <t.icon className={`h-4 w-4 ${active ? 'opacity-90' : 'opacity-60'}`} strokeWidth={2.1} aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'cloud' && (
        <>
        {/* 顶部状态卡（v19 简约重做）：状态点 + 一行标题 + 一行副标 + 极简指标行（label·值
            文本对，无胶囊描边）+ 异常只留「查看」入口（错误详情进弹窗——全站错误提示统一弹窗化）。
            长说明全收「说明」收缩区——页面主体一眼看清当前状态。 */}
        <GrayCard>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={`inline-block h-[9px] w-[9px] shrink-0 rounded-full ${
                  pingBad ? 'bg-[#FF453A]' : cloudOn ? 'bg-[#34C759]' : 'bg-black/25 dark:bg-white/30'
                }`}
              />
              <p className="truncate text-[15.5px] font-semibold leading-tight">{statusTitle}</p>
            </div>
            {cloudOn && (
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground/75">{PLATFORM_LABELS[platform]}</span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{statusSub}</p>

          {/* 关键指标（极简文本对：部署 / 轮询 / 加速 / 测试——一行扫完，无多余视觉噪音） */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px]" aria-label="云端状态概览">
            <span className={supaDeployed ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/70'}>
              部署{supaDeployed ? ' · 已完成' : ' · 未部署'}
            </span>
            {supaDeployed && (
              <span className={cronOn ? (hbStale ? 'text-[#FF453A]' : 'text-emerald-600 dark:text-emerald-400') : 'text-muted-foreground/70'}>
                轮询{cronOn ? (hbStale ? ' · 无心跳' : ' · 运行中') : ' · 已停'}
              </span>
            )}
            {supaDeployed && (
              <span className={gwOn ? (qqCh?.state === 'error' ? 'text-[#FF453A]' : 'text-emerald-600 dark:text-emerald-400') : 'text-muted-foreground/70'}>
                加速{gwOn ? (qqCh?.state === 'error' ? ' · 异常' : ' · 在线') : ' · 未开'}
              </span>
            )}
            {lastPing && (
              <span className={lastPing.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#FF453A]'}>
                测试 · {lastPing.ok ? '正常' : '异常'}
              </span>
            )}
          </div>

          {pingBad && (
            <button
              type="button"
              onClick={() => lastPing && setResultDialog({ title: '云端测试', body: lastPing.msg })}
              className="mt-2.5 flex w-full items-center gap-1.5 rounded-[10px] bg-[#FF453A]/[0.07] px-3 py-1.5 text-left text-[12px] text-[#FF453A] active:opacity-70 dark:bg-[#FF453A]/[0.13]"
            >
              <span className="inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-[#FF453A]" aria-hidden />
              <span className="min-w-0 shrink">最近一次云端测试异常 · 点击查看详情</span>
            </button>
          )}

          <div className="mt-3">
            <CloudFold title="使用说明" testid="cloud-help-fold">
              <div className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
                <p>① 填 Access Token → 读取项目 → 一键部署（自动开 24 小时收发）。</p>
                <p>② 切到上方「真机接入」页签，给微信 / QQ 扫码带上 TA。</p>
                <p>③ 之后云端 24 小时自动收发；换角色 / 改「API 设置」会自动同步，60 秒内生效。</p>
                <p>④ 云端函数、定时任务、聊天记录全在你的 Supabase 里——本站关了 TA 照样在线。</p>
              </div>
            </CloudFold>
          </div>
        </GrayCard>

        {/* 挂载自动恢复在线：服务重启/重连后没人在接入页打开过时，进本页即补开
            （幂等：已在跑则什么都不做） */}
        <AutoEnsureGatewayEffect dep={ready && supaDeployed} />

        {/* 分组一：Supabase 连接（云端配置都存用户自己的 Supabase；v22 平台只此一条路，
            单选项的「运行平台」单选组已删——平台值恒为 supabase，存量迁移在挂载 effect 里） */}
        {cloudOn && (
          <section>
            <SectionLabel icon={Database} tone={TONE_GREEN}>Supabase 连接</SectionLabel>
            <div className={CLOUD_CARD_CLS}>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                云端以你自己的 Supabase 为配置中心（运行包 / 聊天历史 / 心跳都存这里）：填 Token → 读取项目 → 选择项目，再一键部署。
              </p>

              {/* Access Token */}
              <div>
                <FieldLabel>Access Token</FieldLabel>
                <div className="relative">
                  <Input
                    type={showSupaToken ? 'text' : 'password'}
                    value={supaToken}
                    onChange={(e) => setSupaToken(e.target.value)}
                    placeholder="supabase.com 的 Access Token"
                    autoComplete="off"
                    data-testid="cloud-supa-token"
                    className={`${CLOUD_INPUT_CLS} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSupaToken((v) => !v)}
                    aria-label={showSupaToken ? '隐藏 Token' : '显示 Token'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                  >
                    {showSupaToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
                  supabase.com → Account Settings → Access Tokens 生成；只在你自己的浏览器密文保存。
                </p>
                {/* 第四十二轮机主需求：一键打开 Supabase 令牌页（生成/复制 Access Token） */}
                <button
                  type="button"
                  data-testid="cloud-open-supabase-tokens-btn"
                  onClick={() => window.open('https://supabase.com/dashboard/account/tokens', '_blank', 'noopener')}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-black/10 py-2 text-[12.5px] font-medium text-foreground/75 transition-colors active:bg-muted/50 dark:border-white/15"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  打开 Supabase 令牌页（生成 Access Token）
                </button>
              </div>

              {/* 读取项目列表 */}
              <button
                type="button"
                onClick={() => void loadProjects()}
                disabled={projectsLoading}
                className={CLOUD_BTN_CLS}
                data-testid="cloud-supa-projects-btn"
              >
                {projectsLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                读取项目列表
              </button>
              {projectsError && (
                <p className="text-[12px] leading-relaxed" style={{ color: IOS_RED }} role="alert">
                  {projectsError}
                </p>
              )}

              {/* 项目单选列表（名称 + 状态，选中即保存连接） */}
              {projects && projects.length > 0 && (
                <div
                  className="overflow-hidden rounded-[14px] ring-1 ring-black/[0.05] dark:ring-white/[0.08]"
                  role="radiogroup"
                  aria-label="选择 Supabase 项目"
                  data-testid="cloud-supa-proj"
                >
                  {projects.map((p) => {
                    const active = supa?.ref === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => pickProject(p)}
                        className={`flex w-full items-center gap-2.5 border-b border-black/[0.04] px-3.5 py-2.5 text-left transition-colors last:border-b-0 active:bg-muted/50 dark:border-white/[0.06] ${
                          active ? 'bg-black/[0.04] dark:bg-white/[0.08]' : ''
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                            active ? 'border-[#34C759] bg-[#34C759]' : 'border-black/20 dark:border-white/30'
                          }`}
                        >
                          {active ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px]">{p.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {p.id}
                            {p.region ? ` · ${p.region}` : ''}
                            {p.status ? ` · ${p.status}` : ''}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 已连接：一键部署（自动开 24 小时收发 + 秒回加速）/ 云端测试一次 / 重新同步运行包 */}
              {supa?.ref && (
                <div className="rounded-[16px] bg-white/45 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ring-1 ring-black/[0.04] dark:bg-white/[0.05] dark:ring-white/[0.07]">
                  <div className="flex flex-col gap-2">
                    {/* 一键部署（部署 Edge Function + 同步运行包 + 顺手清旧轮询任务；msg 自带模式说明） */}
                    <button
                      type="button"
                      onClick={() => void runDeploy()}
                      disabled={deployLoading}
                      className={CLOUD_BTN_BLUE_CLS}
                      data-testid="cloud-supa-deploy"
                    >
                      {deployLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                      {deployLoading ? '部署中（最长约 3 分钟）…' : '一键部署'}
                    </button>
                    <CloudResultBox r={deployResult} />
                    {deployResult?.ok && deployResult.funcUrl && (
                      <code className="block break-all font-mono text-[11px] text-muted-foreground">{deployResult.funcUrl}</code>
                    )}
                    {/* service_role key 手动兑底（v7）：平时完全不显示；仅当自动读取真失败
                        （need_manual_key）时自动出现并展开，不再常驻「自动读取失败？」提示行。
                        信号置 manualKeyOpen 后以 defaultOpen=true 挂载即自动展开 */}
                    {manualKeyOpen && (
                    <CloudFold
                      key="mk-open"
                      title="自动读取失败，请手动粘贴 service_role key"
                      hint={manualKeySaved ? '已保存' : undefined}
                      testid="cloud-supa-key-fold"
                      defaultOpen
                    >
                      <div className="rounded-[12px] bg-black/[0.03] p-3 dark:bg-white/[0.05]">
                        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                          Supabase 控制台 → Project Settings → API Keys，复制 secret 类 key（sb_secret_ 开头或旧版 service_role）粘贴到下面——先验证可写再保存（publishable / anon 无写入权限不行）。
                        </p>
                        <Input
                          type="password"
                          value={manualKey}
                          onChange={(e) => {
                            setManualKey(e.target.value);
                            setManualKeySaved(false);
                            setManualKeyErr('');
                          }}
                          placeholder="eyJ…（legacy）或 sb_secret_…（新式）"
                          autoComplete="off"
                          data-testid="cloud-supa-manual-key"
                          className={`${CLOUD_INPUT_CLS} mt-2`}
                        />
                        <button
                          type="button"
                          disabled={manualKeyChecking || manualKey.trim().length < 20}
                          onClick={() => void verifyAndSaveManualKey()}
                          className={`${CLOUD_BTN_CLS} mt-2`}
                          data-testid="cloud-supa-manual-key-save"
                        >
                          {manualKeyChecking && <Loader2 className="h-4 w-4 animate-spin" />}
                          {manualKeyChecking ? '正在验证 key…' : manualKeySaved ? '已保存，请重新点上方「一键部署」' : '验证并保存'}
                        </button>
                        {manualKeyErr && (
                          <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: IOS_RED }} role="alert" data-testid="cloud-supa-manual-key-err">
                            {manualKeyErr}
                          </p>
                        )}
                        {manualKeySaved && (
                          <p className="mt-1.5 text-[11.5px] leading-relaxed text-emerald-600 dark:text-emerald-300">
                            key 验证通过，已保存到本机密文存储：现在重新点「一键部署」即可。
                          </p>
                        )}
                      </div>
                    </CloudFold>
                    )}
                    {/* 云端轮询开关（v10；v16 升格 10 秒档）：开 = 你的 Supabase 里每 10 秒
                        自动轮询回复（免费 · 7×24 · 本站关了也在线；停用立刻生效、零配额消耗，
                        随时可再开启，都不用去 Supabase 操作）。副文案带云端心跳
                        （state/heartbeat.json 每 30 秒中继读回）——开着 ≠ 真在跑，心跳是
                        最直接证据，用户无需手动点「云端测试」验证 */}
                    {supaDeployed && (
                      <div
                        className="flex items-center justify-between gap-3 rounded-[16px] bg-white/60 px-4 py-3 ring-1 ring-white/60 backdrop-blur-xl dark:bg-white/[0.06] dark:ring-white/[0.08]"
                        data-testid="cloud-cron-row"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-medium">云端轮询</span>
                          <span
                            className={`mt-0.5 block text-[11px] leading-relaxed ${hbStale ? 'text-[#C77700] dark:text-amber-300' : 'text-muted-foreground'}`}
                            data-testid="cloud-cron-sub"
                          >
                            {cronOn
                              ? cronHb === null
                                ? '云端每 10 秒自动轮询回复——心跳读取中…'
                                : hbFresh
                                  ? `自动收发运行中：最近一轮 ${Math.max(1, Math.round(hbAgeMs / 1000))} 秒前${typeof cronHb.handled === 'number' && cronHb.handled > 0 ? ` · 本轮回复 ${cronHb.handled} 条` : ''}`
                                  : `已开启，但超过 ${Math.max(1, Math.round(hbAgeMs / 60000))} 分钟没有心跳——点「修复」重建`
                              : '已停用（零配额）：云端不再自动回复；可随时再开启'}
                          </span>
                        </span>
                        {cronBusy ? (
                          <Loader2 className="h-[22px] w-[22px] shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <Switch
                            checked={cronOn}
                            onCheckedChange={(v) => void setCron(v)}
                            data-testid="cloud-cron-switch"
                            aria-label="云端轮询"
                          />
                        )}
                      </div>
                    )}
                    {/* 心跳迟滞修复行（开关开着但多分钟没心跳）：幂等重建定时任务 */}
                    {hbStale && !cronBusy && (
                      <div className="flex items-center justify-between gap-2.5 rounded-[14px] border border-[#C77700]/25 bg-[#C77700]/[0.06] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[#8a5b00] dark:border-amber-300/20 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                        <span className="min-w-0 flex-1">
                          云端轮询没有心跳：多半是部署时定时任务没建成、或后来被删过——点「修复」立即重建（跑在你的 Supabase 里，免费）
                        </span>
                        <button
                          type="button"
                          onClick={() => void repairCron()}
                          className="flex shrink-0 items-center gap-1 rounded-full bg-[#C77700]/15 px-3.5 py-[7px] text-[12px] font-medium text-[#8a5b00] transition-colors active:bg-[#C77700]/25 dark:bg-amber-300/15 dark:text-amber-200"
                          data-testid="cloud-cron-repair"
                        >
                          <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                          修复
                        </button>
                      </div>
                    )}
                    {/* 开关失败兜底：手动 SQL 复制段（PAT 无数据库权限时唯一路径） */}
                    {cronFail && (
                      <CloudFold
                        title={cronFail === 'start' ? '开启失败？复制手动 SQL 到 Supabase 执行' : '停止失败？复制手动 SQL 到 Supabase 执行'}
                        testid="cloud-cron-sql-fold"
                        defaultOpen
                      >
                        <div className="rounded-[12px] bg-black/[0.03] p-3 dark:bg-white/[0.05]">
                          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                            {cronFail === 'start'
                              ? '到 Supabase 控制台 → SQL Editor 粘贴执行下面整段：建好 10 秒轮询 + QQ 保持两个定时任务，TA 全天自动回复（免费、零配置）。'
                              : '到 Supabase 控制台 → SQL Editor 粘贴执行下面语句：清掉定时任务，停止后零配额消耗。'}
                          </p>
                          <div className="mt-2 flex items-start justify-between gap-2">
                            <code className="block max-h-40 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                              {cronFail === 'start' ? cronStartSql() : cronStopSql()}
                            </code>
                            <CloudCopyButton
                              text={cronFail === 'start' ? cronStartSql() : cronStopSql()}
                              label="复制 SQL"
                              testId="cloud-cron-sql-copy"
                            />
                          </div>
                        </div>
                      </CloudFold>
                    )}
                    {/* 秒回加速开关（v7→v9 改名）：开 = 内置 IM 网关（免费·免配置）——本站
                        在线时 QQ 官方 WebSocket 长连接（无需 q.qq.com 回调地址）+ 微信即时
                        轮询，回复接近秒回；云端 24 小时收发由用户 Supabase 定时任务独立承担
                        （真源：服务端网关状态，本页 6 秒一轮拉取） */}
                    {supaDeployed && (
                      <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/60 px-4 py-3 ring-1 ring-white/60 backdrop-blur-xl dark:bg-white/[0.06] dark:ring-white/[0.08]">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-medium">秒回加速（本站在线时）</span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                            {gwOn
                              ? qqCh?.state === 'ready'
                                ? `加速中：本站 QQ 长连接 + 微信即时轮询，回复接近秒回${gatewayStatus?.mode === 'relay' ? '（云端函数中继通道）' : ''}`
                                : '加速中：QQ 通道连接中（微信通道不受影响）'
                              : cronOn
                                ? '未开启：云端轮询不受影响（回复按分钟级）；本站在线时开它可秒回'
                                : '未开启：云端轮询已停——本站在线时开它可继续自动回复'}
                          </span>
                        </span>
                        {gatewayBusy ? (
                          <Loader2 className="h-[22px] w-[22px] shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <Switch
                            checked={gwOn}
                            onCheckedChange={(v) => void setGateway(v)}
                            data-testid="cloud-gateway-switch"
                            aria-label="秒回加速"
                          />
                        )}
                      </div>
                    )}
                    {/* 网关通道详情（开关开着时展示）：QQ 通道状态 / 微信循环健康——
                        服务端真源，异常（凭证错/网络断）第一时间在这里可见。
                        v24 文案收敛（机主定调删两条噪音）：QQ 连接中不再显示「正在连接 QQ 平台…」
                        空转文案——连接中/无消息静默就安静（有实质信息才出一行：已连接/异常/未接入）；
                        微信同理删「运行中」空转行——只在异常或有回复量时报数。两行都静默时整块不渲染 */}
                    {supaDeployed && gwOn && (qqCh?.state === 'ready' || qqCh?.state === 'disabled' || qqCh?.lastError || gatewayStatus?.wx?.lastError || gatewayStatus?.wx?.replied) && (
                      <div className="flex flex-col gap-1.5 rounded-[16px] bg-black/[0.03] px-3.5 py-3 text-[11.5px] leading-relaxed text-muted-foreground ring-1 ring-white/40 backdrop-blur-xl dark:bg-white/[0.04] dark:ring-white/[0.06]" data-testid="cloud-gateway-detail">
                        {(qqCh?.state === 'ready' || qqCh?.state === 'disabled' || qqCh?.lastError) && (
                        <p className="flex items-center gap-1.5">
                          {(qqCh?.state === 'ready' && !qqCh.lastError) || qqCh?.state === 'disabled' ? (
                            qqCh?.state === 'ready' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#34C759]" aria-hidden="true" />
                            ) : (
                              <CloudOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                            )
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#C77700]" aria-hidden="true" />
                          )}
                          QQ 通道：
                          {qqCh?.state === 'disabled'
                            ? '未接入（接入 QQ 后凭证自动同步，约半分钟内点亮）'
                            : qqCh?.state === 'ready' && !qqCh.lastError
                              ? `已连接${qqCh.botName ? `「${qqCh.botName}」` : ''}${qqCh.lastEventAt ? ` · 最近消息 ${new Date(qqCh.lastEventAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}`
                              : `${qqCh.state === 'error' ? '连接异常' : '重试中'}：${qqCh.lastError}`}
                        </p>
                        )}
                        {(gatewayStatus?.wx?.lastError || gatewayStatus?.wx?.replied) && (
                        <p className="flex items-center gap-1.5">
                          {gatewayStatus?.wx?.lastError ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#C77700]" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#34C759]" aria-hidden="true" />
                          )}
                          微信通道：
                          {gatewayStatus?.wx?.lastError
                            ? `异常：${gatewayStatus.wx.lastError}`
                            : `自动回复中（累计 ${gatewayStatus.wx.replied} 条）`}
                        </p>
                        )}
                      </div>
                    )}
                    {/* 云端测试一次：用户自己动手跑一轮（结果弹「云端测试」弹窗） */}
                    <button
                      type="button"
                      onClick={() => void runPing()}
                      disabled={pingLoading || !supaDeployed}
                      className={CLOUD_BTN_CLS}
                      data-testid="cloud-supa-ping"
                    >
                      {pingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {pingLoading ? '正在测试（单轮收发，约 40 秒）…' : '云端测试一次'}
                    </button>
                    {/* 重新同步运行包：改动会自动同步——此按钮仅作手动兑底（异常时补推 + 升级运行时） */}
                    <button
                      type="button"
                      onClick={() => void runSync()}
                      disabled={syncLoading}
                      className="flex w-full items-center justify-between gap-2 rounded-[16px] bg-white/60 px-4 py-3 text-left transition-colors active:bg-muted/50 disabled:opacity-50 ring-1 ring-white/60 backdrop-blur-xl dark:bg-white/[0.06] dark:ring-white/[0.08]"
                      data-testid="cloud-supa-sync"
                    >
                      <span className="min-w-0 flex-1 text-[14.5px] font-medium">重新同步运行包</span>
                      {syncLoading ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                      )}
                    </button>
                    <p className="text-[11px] leading-relaxed text-muted-foreground/80">换角色 / 改 API 设置会自动同步；点它可手动兑底并升级云端运行时。</p>
                    <CloudResultBox r={syncResult} />
                  </div>
                </div>
              )}

            </div>
          </section>
        )}

        {/* 底部危险区：清除云端配置（二次确认） */}
        <section>
          <SectionLabel icon={AlertCircle} tone={TONE_RED}>危险操作</SectionLabel>
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => setConfirmWipe(true)}
              className="flex items-center gap-1.5 rounded-full bg-[#FF3B30]/[0.08] px-5 py-2.5 text-[12px] font-medium text-[#FF3B30] ring-1 ring-[#FF3B30]/15 transition-colors active:bg-[#FF3B30]/[0.14]"
              data-testid="cloud-wipe"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清除云端配置
            </button>
          </div>
        </section>

        {/* 云备份与恢复已迁至文件 App › 数据管理（机主规格：存储/备份能力统一收拢到文件 App） */}
        </>
        )}

        {/* ==================== 真机接入页签（v24：不再是单独的界面——微信/QQ 胶囊切换，
             接入页内嵌同屏完成；行状态直读对应接入 store（登录态 + 绑定角色名）） ==================== */}
        {tab === 'device' && (
        <section>
          <SectionLabel icon={Smartphone} tone={TONE_BLUE}>真机接入</SectionLabel>

          {/* 平台胶囊切换（微信 / QQ）：选中高光白底，副状态徽章直读登录态 */}
          <div
            role="tablist"
            aria-label="真机接入平台"
            className="flex w-full rounded-full bg-white/50 p-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_16px_rgba(17,24,39,0.05)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.1]"
          >
            {(
              [
                { id: 'wx', icon: MessageCircle, tone: '#07C160', label: '微信', name: deviceLogin.wx },
                { id: 'qq', icon: Bot, tone: '#0099FF', label: 'QQ', name: deviceLogin.qq },
              ] as const
            ).map((o) => {
              const active = device === o.id;
              const connected = o.name !== null;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`真机${o.label}接入`}
                  data-testid={`cloud-device-${o.id}`}
                  onClick={() => setDevice(o.id)}
                  className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-medium transition-all active:scale-[0.98] ${
                    active
                      ? 'bg-white text-foreground shadow-[0_2px_10px_rgba(17,24,39,0.1)] ring-1 ring-black/[0.04] dark:bg-white/[0.16] dark:ring-white/[0.1]'
                      : 'text-muted-foreground active:bg-black/[0.03] dark:active:bg-white/[0.05]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
                    style={{ backgroundColor: `${o.tone}1F` }}
                  >
                    <o.icon className="h-[12px] w-[12px]" style={{ color: o.tone }} strokeWidth={2.4} />
                  </span>
                  {o.label}
                  <span
                    className={`ml-0.5 inline-flex max-w-[86px] items-center truncate rounded-full px-2 py-[2px] text-[10.5px] font-medium backdrop-blur-xl ${
                      connected
                        ? 'bg-emerald-500/[0.1] text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-400'
                        : 'bg-black/[0.04] text-muted-foreground/85 ring-1 ring-black/[0.03] dark:bg-white/[0.06] dark:ring-white/[0.08]'
                    }`}
                  >
                    {connected ? (o.name === '' ? '已接入' : o.name) : '未接入'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 内嵌接入页（不再整页切换）：微信/QQ 接入界面直接铺在本页签里（embedded 隐藏
              自带顶栏，各自内部滚动）；容器定高 + 圆角裁切，接入完成前未部署提示见页面内横幅 */}
          <div
            className="relative mt-4 h-[560px] overflow-hidden rounded-[22px] ring-1 ring-black/[0.05] dark:ring-white/[0.08]"
            data-testid={device === 'wx' ? 'cloud-device-wx-page' : 'cloud-device-qq-page'}
          >
            {device === 'wx' ? (
              <WeixinConnectPage contacts={subContacts} onBack={() => undefined} embedded />
            ) : (
              <QqConnectPage contacts={subContacts} onBack={() => undefined} embedded />
            )}
          </div>

          {!supaDeployed && (
            <p className="mt-3 rounded-[14px] bg-[#C77700]/[0.07] px-4 py-2.5 text-[12px] leading-relaxed text-[#8a5b00] ring-1 ring-[#C77700]/20 backdrop-blur-xl dark:bg-amber-300/[0.08] dark:text-amber-200/90 dark:ring-amber-300/15">
              云端还没部署：先切到上方「云端助手」页签完成一键部署（免费），再回来扫码接入——否则 TA 不会在真机上回复。
            </p>
          )}
        </section>
        )}
      </div>

      {/* 结果弹窗（部署失败 / 云端测试结果 / 开关失败：标题 + 问题 + 知道了） */}
      <AlertDialog open={!!resultDialog} onOpenChange={(o) => { if (!o) setResultDialog(null); }}>
        <AlertDialogContent className="w-[290px] gap-0 rounded-[14px] p-0 sm:w-[290px] sm:max-w-[290px]">
          <AlertDialogHeader className="gap-2 px-5 pb-4 pt-5">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
              {resultDialog?.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-left text-[13px] leading-relaxed">
              {resultDialog?.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-0 border-t border-border sm:flex-row">
            <AlertDialogAction
              data-testid="cloud-result-dialog-ok"
              className="h-12 w-full flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium text-[#0071E3] shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0"
              onClick={() => setResultDialog(null)}
            >
              知道了
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 清除云端配置 · 二次确认（仿锁屏页关闭确认弹窗） */}
      <AlertDialog open={confirmWipe} onOpenChange={setConfirmWipe}>
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="gap-1.5 px-5 pb-4 pt-5 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
              清除云端配置？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[13px] leading-snug">
              将清除平台选择与 Supabase 凭证（本机聊天数据不受影响）。已部署的云端函数与定时任务都在你自己的 Supabase 项目里，不会自动删除；如需彻底停用，可到 Supabase SQL Editor 执行 select cron.unschedule('wx-assistant');
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-0 border-t border-border sm:flex-row">
            <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-foreground shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0">
              取消
            </AlertDialogCancel>
            <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-border" />
            <AlertDialogAction
              className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0"
              style={{ color: IOS_RED }}
              onClick={() => void doWipe()}
            >
              清除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LocalToast msg={toastMsg} />
    </DetailShell>
  );
}
