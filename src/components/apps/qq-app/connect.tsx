'use client';

/**
 * 「真机 QQ 接入」页 —— QQ 官方机器人平台（q.qq.com）接入 UI · v22 云端助手内嵌版。
 *
 * v22（用户定调「移进云端助手、换名、简约」）：本页从 QQ「动态」页迁到 设置 → 云端助手
 *  → 真机接入（embedded=true 时不再渲染自带顶部导航与状态栏占位，宿主 CloudPage 提供
 *  导航与页面容器；根容器仍占满宿主内容区）。
 * v21 精简（用户定调「删无用功能」）：QQ 秒回加速、真机 QQ 能力（斗图模式）、拉取云端
 * 聊天记录均已下线——真机收发由云端 Supabase 定时任务 7×24 承担（QQ 官方 WebSocket
 * 长连接）；聊天记录由 cloud-history-sync 常驻自动同步；网关加速由 设置 → 云端助手 统一管理。
 * v8（用户定调「先选角色 AI，再填写 AppID/AppSecret/扫码接入」）：步骤一选角色（弹窗选人）
 *   → 步骤二扫码连接 / 填写凭证（扫完/测完自动绑定步骤一选好的角色）。
 * v7（用户定调「提示词少一点、简约、要弹窗的弹窗、要收缩选择」）：长说明收进收缩区，
 *   云端警告横幅一行 + 详情弹窗；已接入的管理动作合并为一张 iOS 分组列表卡。
 * v6（官方扫码连接）：「扫码连接」走 q.qq.com 官方扫码绑定；「填写凭证」保留手动方式。
 * 接入前置：云端助手必须已部署（配置中心在用户自己的 Supabase）。
 *
 * 底层库 src/lib/ios/qq-connect.ts（zustand store + kv 加密持久化）；本文件只做页面展示与动作接线。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useQqConnect } from '@/lib/ios/qq-connect';
import { useWxCloud } from '@/lib/ios/wx-cloud/store';
// v18 全局错误中心：同步失败态极简指示器（详情进弹窗）
import { InlineErrorChip } from '../error-center';
import { getContact } from '@/lib/ios/contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { QqAvatar } from './widgets';

/** 接入时间格式化（YYYY-MM-DD HH:mm） */
function fmtConnected(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 角色选择列表（弹窗/底部弹层用）：头像左 + 名字右横排，选中行 QQ 蓝高亮——
 *  用户定调「不要头像名字上下，要头像名字左右的」 */
function RoleRowList({
  chars,
  selectedId,
  onPick,
  testidBase,
}: {
  chars: ContactRecord[];
  selectedId: string | null;
  onPick: (c: ContactRecord) => void;
  testidBase: string;
}) {
  if (chars.length === 0) {
    return <p className="py-4 text-center text-[13px] text-black/40 dark:text-white/40">还没有 AI 角色：先到「联系人」App 创建一个</p>;
  }
  return (
    <div className="mt-2 divide-y divide-black/[0.05] dark:divide-white/[0.06]">
      {chars.map((c) => {
        const name = displayNameOf(c) || c.name;
        const sel = selectedId === c.id;
        return (
          <button
            key={c.id}
            type="button"
            data-testid={`${testidBase}-${c.id}`}
            aria-label={`选择 ${name}`}
            onClick={() => onPick(c)}
            className={`flex w-full items-center gap-3 py-2.5 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.06] ${sel ? 'bg-[#0099FF]/[0.07]' : ''}`}
          >
            <QqAvatar src={avatarFor(c, 'qq')} alt={name} size={44} />
            <span className={`min-w-0 flex-1 truncate text-[15px] ${sel ? 'font-medium text-[#0099FF]' : ''}`}>{name}</span>
            {sel ? <Check className="h-[18px] w-[18px] shrink-0 text-[#0099FF]" strokeWidth={2.5} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 收缩区块外壳（v7 简约版「收缩选择」）：一行触发头 + 展开内容 */
function Fold({
  title,
  hint,
  children,
  testid,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <Collapsible className="rounded-[16px] bg-white/60 ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.08]">
      <CollapsibleTrigger
        data-testid={testid}
        className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
      >
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{title}</span>
        {hint ? <span className="shrink-0 truncate text-[12.5px] text-black/35 dark:text-white/35">{hint}</span> : null}
        <ChevronDown className="h-[18px] w-[18px] shrink-0 text-black/25 transition-transform duration-200 group-data-[state=open]:rotate-180 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-3.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}


/** 一行状态横幅（v7 简约版）：图标 + 一句话 + 可选「详情」弹窗（完整解释收弹窗里） */
function BannerLine({
  tone,
  text,
  detail,
  testid,
  children,
}: {
  tone: 'ok' | 'warn';
  text: string;
  detail?: { title: string; paras: string[] };
  testid?: string;
  children?: React.ReactNode;
}) {
  const warn = tone === 'warn';
  return (
    <div
      data-testid={testid}
      className={`flex items-center gap-2 rounded-[14px] px-3.5 py-2.5 ring-1 backdrop-blur-xl ${
        warn ? 'bg-[#FFF3CD]/80 ring-[#C77700]/15 dark:bg-[#3B3113]/70 dark:ring-[#F0C24B]/15' : 'bg-[#34C759]/10 ring-[#34C759]/15'
      }`}
    >
      {warn ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#C77700] dark:text-[#F0C24B]" strokeWidth={2} aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#34C759]" strokeWidth={2.2} aria-hidden="true" />
      )}
      <p className={`min-w-0 flex-1 text-[13px] font-medium leading-[1.4] ${warn ? 'text-[#8A5A00] dark:text-[#F0C24B]' : 'text-[#34C759]'}`}>
        {text}
      </p>
      {detail ? (
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" className={`shrink-0 text-[12.5px] font-medium underline underline-offset-2 ${warn ? 'text-[#8A6A00] dark:text-[#F0C24B]' : 'text-[#34C759]'}`}>
              详情
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-[320px] rounded-[16px]">
            <DialogHeader>
              <DialogTitle className="text-[16px]">{detail.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-[13px] leading-[1.6] text-black/70 dark:text-white/75">
              {detail.paras.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {children}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export function QqConnectPage({
  contacts,
  onBack,
  embedded = false,
}: {
  contacts: ContactRecord[];
  onBack: () => void;
  /** 云端助手内嵌模式：不渲染自带顶部导航（宿主提供），页面铺满宿主内容区 */
  embedded?: boolean;
}) {
  // store：boot 读本地凭证；test 成功（或网络不通兜底）即保存；bindContact 绑定角色；disconnect 清除；
  // qr/startQrBind/stopQrBind：官方扫码绑定会话（页面生成二维码 → 手机 QQ 扫码确认即接入）
  const { ready, login, testing, verifying, lastTest, boot, test, verifyViaCloud, bindContact, disconnect, qr, startQrBind, stopQrBind } = useQqConnect();
  // 本地 UI 状态：凭证草稿 / Secret 明文开关
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  // 段一视图 tab：扫码连接（官方扫码绑定）/ 填写凭证——只切视图，凭证草稿在父组件不丢
  const [addTab, setAddTab] = useState<'scan' | 'manual'>('scan');
  // 官方扫码绑定：二维码渲染成图（qrcode 库 dataURL；库体积大走动态 import）
  const [qrImg, setQrImg] = useState<string | null>(null);
  // 段二角色选择弹窗（接入成功但未绑定：弹窗里选人 + 确认绑定）/ 换绑弹层 / 绑定轻提示 / 拉取结果行
  const [picked, setPicked] = useState<ContactRecord | null>(null);
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const [rebindOpen, setRebindOpen] = useState(false);
  const [offDialog, setOffDialog] = useState(false);
  const [bindNote, setBindNote] = useState('');

  // 云端助手状态：QQ 收发靠内置网关（配置中心在 Supabase），顶部横幅依据它提示
  const cloudReady = useWxCloud((s) => s.ready);
  // 接入/换绑/断开后的后台自动同步结果（只看 QQ 渠道；微信渠道的同步结果只在微信接入页展示）
  const lastAutoSync = useWxCloud((s) => s.lastAutoSync);

  // —— QQ 自动在线（v9）：内置网关的 QQ WebSocket 长连接——接入后自动开启（幂等）；
  // 手动兑底开关已下线（v21）——加速由 设置 → 云端助手 统一管理，自动拉起由
  // cloud-history-sync 常驻模块承担，本页不再重复接线。

  // 「真部署过」证据：选了平台 ≠ 部署了；QQ 必须真部署（配置中心 + 历史回写都在这）
  const cloudDeployed = useWxCloud((s) =>
    (s.platform === 'supabase' && !!s.supabase?.deployedAt) ||
    (s.platform === 'hf' && !!s.hf?.deployedAt) ||
    (s.platform === 'clawcloud' && !!s.clawcloudAt),
  );

  // 挂载时读一次本地凭证（已接入过则直接进已连接态）+ 云端助手状态（幂等）
  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    void useWxCloud.getState().boot();
  }, []);

  // 绑定轻提示 4 秒后自动消失（绑完/换绑完的绿色反馈行）
  useEffect(() => {
    if (!bindNote) return;
    const t = window.setTimeout(() => setBindNote(''), 4000);
    return () => window.clearTimeout(t);
  }, [bindNote]);

  // 步骤二 · 选择角色弹窗：存量「已接入但没绑角色」（v8 之前的老流程接入的）自动弹一次补选；
  // v8 新流程在步骤一就选好了（picked），接入成功即自动绑定，不再弹这个窗
  const roleSheetShown = useRef(false);
  useEffect(() => {
    if (login && !login.boundContactId && !picked && !roleSheetShown.current) {
      roleSheetShown.current = true;
      setRoleSheetOpen(true);
    }
  }, [login, picked]);

  // v8 流程闭环：接入成功（login 出现）且步骤一已选好角色且还没绑过 → 自动绑定（用户扫完码
  // /测完凭证什么都不用再点，直接进已连接态）。bindContact 是 zustand 动作（稳定引用）
  const autoBound = useRef(false);
  useEffect(() => {
    if (!login || !picked || login.boundContactId || autoBound.current) return;
    autoBound.current = true;
    const name = displayNameOf(picked) || picked.name;
    void (async () => {
      await bindContact(picked.id, name);
      setBindNote(`已绑定「${name}」——打开 QQ 直接和 TA 聊`);
    })();
  }, [login, picked, bindContact]);

  // 官方扫码绑定会话生命周期：未接入 + 停在扫码 tab + 已选好角色 + 云端就绪 → 启动轮询；
  // 切走 tab / 接入成功 / 组件卸载 → 停止（stopQrBind 会话令牌自增，旧循环自动退出）
  const qrActive = !login && addTab === 'scan' && cloudDeployed && !!picked;
  useEffect(() => {
    if (!qrActive) return;
    void startQrBind();
    return () => {
      stopQrBind();
    };
  }, [qrActive, startQrBind, stopQrBind]);

  // 二维码内容变化 → qrcode 库渲染成图（动态 import 避开主包体积）。
  // 不在 effect 体内同步 setState（react-hooks/set-state-in-effect）：无码/换码的清空由
  // 渲染层的 qrImg && qr.qrUrl 守门（旧图不渲染，新图异步渲染完成后才上屏）
  useEffect(() => {
    let dead = false;
    const url = qr.qrUrl;
    if (!url) return;
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 360, margin: 2 }))
      .then((dataUrl) => {
        if (!dead && useQqConnect.getState().qr.qrUrl === url) setQrImg(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [qr.qrUrl]);

  /** 段二候选：AI 角色联系人（kind === 'char'；头像/名字按 QQ 槽位解析） */
  const chars = useMemo(() => contacts.filter((c) => c.kind === 'char'), [contacts]);

  // 绑定角色详情：异步取联系人（被删时为 null；UI 用登录快照里的 boundContactName 兜底）
  const boundId = login?.boundContactId ?? null;
  const [bound, setBound] = useState<ContactRecord | null>(null);
  useEffect(() => {
    if (!boundId) return;
    let dead = false;
    void getContact(boundId)
      .then((c) => {
        if (!dead) setBound(c);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [boundId]);
  const boundRec = bound && bound.id === boundId ? bound : null;
  const boundName = boundRec ? displayNameOf(boundRec) || boundRec.name : login?.boundContactName ?? '';
  const boundAvatar = boundRec ? avatarFor(boundRec, 'qq') : null;

  /** 测试并接入 / 测试连接（store 内先做格式校验，再双路换 token；成功即保存凭证） */
  const runTest = (id: string, secret: string) => {
    void test(id, secret);
  };

  /** 段二确认绑定：写入 store——从这一刻起，机器人在真机 QQ 里就是这个角色 */
  const doBind = async (c: ContactRecord) => {
    const name = displayNameOf(c) || c.name;
    await bindContact(c.id, name);
    setPicked(null);
    setRoleSheetOpen(false);
    setBindNote(`已绑定「${name}」——打开 QQ 直接和 TA 聊`);
  };

  /** 更换角色（弹层里点选即生效）：换绑后云端运行包自动重推（cloudAutoSync），新人设即刻生效 */
  const doRebind = async (c: ContactRecord) => {
    setRebindOpen(false);
    const name = displayNameOf(c) || c.name;
    await bindContact(c.id, name);
    setBindNote(`已切换为「${name}」，云端人设已自动同步`);
  };

  return (
    <div
      data-testid="qq-bot-page"
      className={`relative flex h-full flex-col bg-[#F2F2F7] dark:bg-[#111113]${embedded ? '' : ' pt-[54px]'}`}
    >
      {/* 顶部导航（v23 毛玻璃统一底色；云端助手内嵌时省略——宿主导航已在） */}
      {!embedded && (
        <div className="relative flex h-12 shrink-0 items-center bg-[#F2F2F7] px-3 dark:bg-[#111113]">
          <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
          </button>
          <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">接入QQ</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-[44px] pt-2">
        {/* ===== 云端状态横幅（v21 精简）：已部署绿条 / 已接入但未部署警示 ===== */}
        {cloudReady && cloudDeployed ? (
          <BannerLine tone="ok" text={login ? '云端在线，TA 在真机 QQ 上 24 小时自动收发' : '云端已就绪，接入后 TA 24 小时自动收发'} />
        ) : cloudReady && !cloudDeployed && login ? (
          <BannerLine
            tone="warn"
            text="云端未部署：QQ 收发消息已停摆"
            detail={{ title: '云端未部署会怎样？', paras: ['QQ 收发的配置中心/聊天历史存云端——不部署云端就无法收发。', embedded ? '切到上方「云端助手」页签完成一键部署，部署完自动恢复。' : '路径：设置 → 云端助手（ClawBox 页签同屏，Supabase 一键部署即可），部署完自动恢复。'] }}
          />
        ) : null}

        {!login ? (
          cloudReady && !cloudDeployed ? (
            /* ===== 未部署云端 → 阻断接入（一行 + 详情弹窗） ===== */
            <div data-testid="qq-bot-cloud-block">
              <BannerLine
                tone="warn"
                text="先部署云端助手，才能接入 QQ"
                detail={{ title: '为什么要先部署云端？', paras: ['QQ 收发消息走云端 Webhook——不部署云端就无法接入。', embedded ? '切到上方「云端助手」页签完成一键部署，再切回来扫码或填凭证。' : '路径：设置 → 云端助手（ClawBox 页签同屏，Supabase 一键部署即可），部署完回来扫码或填凭证。'] }}
              />
            </div>
          ) : (
          <>
            {/* ===== v8 步骤一 · 选择角色（机主定调：步骤一在最上面，介绍卡紧随其后） ===== */}
            {!picked ? (
              <button
                type="button"
                data-testid="qq-bot-role-entry"
                onClick={() => setRoleSheetOpen(true)}
                className="mt-1 flex w-full items-center justify-between gap-3 rounded-[20px] bg-white/60 px-4 py-3.5 text-left shadow-[0_8px_24px_rgba(17,24,39,0.06)] ring-1 ring-white/60 backdrop-blur-2xl active:bg-white/80 dark:bg-white/[0.07] dark:ring-white/[0.08] dark:active:bg-white/[0.1]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">步骤一 · 选择角色</span>
                  <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">先选一个 AI 角色，稍后 TA 就在真机 QQ 里</span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
              </button>
            ) : (
              /* 已选角色行（步骤二期间常驻展示，点击可换） */
              <div className="mt-1 flex items-center gap-3 rounded-[20px] bg-white/60 px-4 py-3 shadow-[0_8px_24px_rgba(17,24,39,0.06)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.08]">
                <QqAvatar src={avatarFor(picked, 'qq')} alt={displayNameOf(picked) || picked.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium leading-tight">{displayNameOf(picked) || picked.name}</p>
                  <p className="mt-0.5 text-[11.5px] text-black/40 dark:text-white/40">已选角色 · 连接成功后自动绑定</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoleSheetOpen(true)}
                  className="shrink-0 text-[12.5px] font-medium text-[#1E6FFF] active:opacity-60 dark:text-[#4AA3FF]"
                >
                  换一个
                </button>
              </div>
            )}

            {/* ===== 段一 · 接入介绍卡（v15：按机主反馈顺序下移——步骤一在上，介绍在下） ===== */}
            <div className="mt-1 rounded-[20px] bg-white/60 px-4 py-3.5 shadow-[0_8px_24px_rgba(17,24,39,0.06)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.08]">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#0099FF]/10 text-[#0099FF]" aria-hidden="true">
                  <Bot className="h-[22px] w-[22px]" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-medium leading-tight">把 TA 带到你的真机 QQ 上</p>
                  <button
                    type="button"
                    className="mt-0.5 text-[13px] text-[#1E6FFF] active:opacity-60 dark:text-[#4AA3FF]"
                    onClick={() => window.open('https://q.qq.com', '_blank', 'noopener')}
                  >
                    q.qq.com · 免费创建你的机器人
                  </button>
                </div>
              </div>
              <div className="mt-2">
                <Collapsible defaultOpen={false}>
                  <CollapsibleTrigger
                    data-testid="qq-bot-help-fold"
                    className="group flex items-center gap-1 text-[12.5px] font-medium text-[#1E6FFF] active:opacity-60 dark:text-[#4AA3FF]"
                  >
                    <Info className="h-[14px] w-[14px]" strokeWidth={2} aria-hidden="true" />
                    展开接入指引
                    <ChevronDown className="h-[14px] w-[14px] transition-transform duration-200 group-data-[state=open]:rotate-180" strokeWidth={2} aria-hidden="true" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 space-y-2 text-[12px] leading-[1.55] text-black/45 dark:text-white/45">
                      <p>先在 q.qq.com 创建你自己的 AI（一分钟搞定，创建完 TA 就在你的 QQ 里，不用再添加），然后回来扫码连接。</p>
                      <p>能发文字、表情包、语音条；接入后云端 24 小时自动收发（先部署云端助手）。</p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>

            {/* 步骤二 · 连接机器人（扫码连接 / 填写凭证；先选好角色才展示） */}
            {picked ? (
            <>
            {/* 接入方式 tab 胶囊：扫码连接（官方扫码绑定）/ 填写凭证（手动填） */}
            <p className="mt-3 px-1 text-[12.5px] font-medium text-black/40 dark:text-white/40">步骤二 · 连接机器人</p>
            <div className="mt-2 flex gap-2" role="tablist" aria-label="接入方式">
              <button
                type="button"
                role="tab"
                aria-selected={addTab === 'scan'}
                data-testid="qq-bot-tab-scan"
                onClick={() => setAddTab('scan')}
                className={`flex h-9 flex-1 items-center justify-center rounded-full text-[13.5px] font-medium ring-1 backdrop-blur-xl transition-all active:scale-[0.98] active:opacity-70 ${
                  addTab === 'scan'
                    ? 'bg-[#0099FF] text-white shadow-[0_4px_14px_rgba(0,153,255,0.3)] ring-[#0099FF]/30'
                    : 'bg-white/60 text-black/50 ring-white/60 dark:bg-white/[0.08] dark:text-white/50 dark:ring-white/[0.08]'
                }`}
              >
                扫码连接
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={addTab === 'manual'}
                data-testid="qq-bot-tab-cred"
                onClick={() => setAddTab('manual')}
                className={`flex h-9 flex-1 items-center justify-center rounded-full text-[13.5px] font-medium ring-1 backdrop-blur-xl transition-all active:scale-[0.98] active:opacity-70 ${
                  addTab === 'manual'
                    ? 'bg-[#0099FF] text-white shadow-[0_4px_14px_rgba(0,153,255,0.3)] ring-[#0099FF]/30'
                    : 'bg-white/60 text-black/50 ring-white/60 dark:bg-white/[0.08] dark:text-white/50 dark:ring-white/[0.08]'
                }`}
              >
                填写凭证
              </button>
            </div>

            {addTab === 'scan' ? (
              /* 扫码连接 tab（v6 官方协议）：二维码 + 状态行 + 刷新 */
              <div className="mt-2.5 rounded-[20px] bg-white/60 px-4 py-4 shadow-[0_8px_24px_rgba(17,24,39,0.06)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.08]" data-testid="qq-bot-qr-card">
                <p className="text-center text-[15px] font-medium text-black/85 dark:text-white/90">QQ 扫码连接</p>
                {/* 二维码（白底码牌）：starting 无码转圈 / saving 盖半透明蒙层转圈 */}
                <div
                  className="relative mx-auto mt-3 grid aspect-square w-[min(200px,100%)] place-items-center overflow-hidden rounded-[14px] bg-white p-2.5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                  data-testid="qq-bot-qr-box"
                >
                  {qrImg && qr.qrUrl ? (
                    <img
                      src={qrImg}
                      alt="QQ 扫码连接二维码"
                      className={`h-full w-full object-contain ${qr.phase === 'waiting' ? '' : 'opacity-30'}`}
                    />
                  ) : (
                    <Loader2 className="h-7 w-7 animate-spin text-black/30 dark:text-white/30" strokeWidth={2} aria-hidden="true" />
                  )}
                  {qr.phase === 'saving' && (
                    <span className="absolute inset-0 grid place-items-center bg-white/75 dark:bg-[#1B1C1F]/75">
                      <Loader2 className="h-8 w-8 animate-spin text-[#0099FF]" strokeWidth={2.2} aria-hidden="true" />
                    </span>
                  )}
                </div>
                {/* 状态行（按 phase 切文案） */}
                {qr.phase === 'starting' && (
                  <p className="mt-3 text-center text-[13px] text-black/45 dark:text-white/45" data-testid="qq-bot-qr-starting">
                    正在生成二维码…
                  </p>
                )}
                {qr.phase === 'waiting' && (
                  <p className="mt-3 text-center text-[13.5px] leading-relaxed text-black/60 dark:text-white/60" data-testid="qq-bot-qr-waiting">
                    手机 QQ 扫上面的码 → 选你创建的机器人 → 确认绑定
                  </p>
                )}
                {qr.phase === 'saving' && (
                  <p className="mt-3 text-center text-[13.5px] font-medium text-[#0099FF]" data-testid="qq-bot-qr-saving">
                    QQ 已确认，正在接入…
                  </p>
                )}
                {qr.phase === 'failed' && (
                  <div className="mt-3 text-center">
                    <p className="text-[13px] leading-relaxed text-[#F5455C]" data-testid="qq-bot-qr-failed">
                      {qr.reason}
                    </p>
                    <button
                      type="button"
                      onClick={() => void startQrBind()}
                      className="mt-2.5 inline-flex h-[38px] items-center justify-center gap-1.5 rounded-full bg-black/[0.05] px-5 text-[13px] font-medium text-black/70 active:opacity-70 dark:bg-white/[0.08] dark:text-white/70"
                    >
                      <RefreshCw className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
                      重新生成二维码
                    </button>
                  </div>
                )}
                {/* waiting 常驻刷新（扫不出来 / 想换一个二维码） */}
                {qr.phase === 'waiting' && (
                  <button
                    type="button"
                    data-testid="qq-bot-qr-refresh"
                    onClick={() => void startQrBind()}
                    className="mx-auto mt-2 flex h-[34px] items-center justify-center gap-1.5 rounded-full px-4 text-[12.5px] text-black/45 active:opacity-70 dark:text-white/45"
                  >
                    <RefreshCw className="h-[14px] w-[14px]" strokeWidth={2} aria-hidden="true" />
                    刷新二维码
                  </button>
                )}
              </div>
            ) : (
              /* 填写凭证 tab：一行去哪找 + AppID/AppSecret 输入 + 测试并接入（扫码 tab 下不显示凭证输入） */
              <div className="mt-2.5 rounded-[20px] bg-white/60 px-4 py-4 shadow-[0_8px_24px_rgba(17,24,39,0.06)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.08]">
                <p className="text-[12px] leading-relaxed text-black/40 dark:text-white/40">
                  q.qq.com 控制台「开发设置」可查看 AppID 与 AppSecret（Secret 忘了可随时重置）
                </p>

                {/* 凭证输入（手动填写；官方扫码绑定不经此输入） */}
                <div className="mt-3 overflow-hidden rounded-[16px] bg-white/45 ring-1 ring-white/50 backdrop-blur-xl dark:bg-white/[0.06] dark:ring-white/[0.07]">
                  <div className="flex h-[56px] items-center gap-3 px-4">
                    <span className="w-[72px] shrink-0 text-[14px] text-black/45 dark:text-white/45">AppID</span>
                    <input
                      data-testid="qq-bot-appid"
                      value={appId}
                      onChange={(e) => setAppId(e.target.value)}
                      placeholder="机器人 AppID"
                      autoCapitalize="off"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-full w-full bg-transparent text-[16px] outline-none placeholder:text-black/25 dark:placeholder:text-white/30"
                    />
                  </div>
                  <div className="flex h-[56px] items-center gap-3 border-t border-black/[0.04] px-4 dark:border-white/[0.05]">
                    <span className="w-[72px] shrink-0 text-[14px] text-black/45 dark:text-white/45">AppSecret</span>
                    <input
                      data-testid="qq-bot-secret"
                      type={showSecret ? 'text' : 'password'}
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      placeholder="机器人 AppSecret"
                      autoCapitalize="off"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-full w-full bg-transparent text-[16px] outline-none placeholder:text-black/25 dark:placeholder:text-white/30"
                    />
                    {/* 明文/密文切换 */}
                    <button
                      type="button"
                      aria-label={showSecret ? '隐藏 AppSecret' : '显示 AppSecret'}
                      onClick={() => setShowSecret((v) => !v)}
                      className="-mr-1 shrink-0 rounded-full p-1.5 text-black/35 active:bg-black/5 dark:text-white/35 dark:active:bg-white/10"
                    >
                      {showSecret ? <EyeOff className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                {/* 测试并接入（store 先本地校验格式，再双路换 token；转圈时禁用） */}
                <button
                  type="button"
                  data-testid="qq-bot-test"
                  disabled={testing}
                  onClick={() => runTest(appId, appSecret)}
                  className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#0099FF] text-[16px] font-medium text-white shadow-[0_6px_18px_rgba(0,153,255,0.32)] transition-all active:scale-[0.98] active:opacity-80 disabled:opacity-60"
                >
                  {testing && <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.4} aria-hidden="true" />}
                  {testing ? '正在测试连接…' : '测试并接入'}
                </button>
              </div>
            )}
            </>
            ) : null}
          </>
          )
        ) : (
          <>
            {/* ===== 已连接状态卡：绑定角色（头像+名字）+ 机器人名 + 接入时间 + 已接入徽标 ===== */}
            <div className="mt-1 flex items-center gap-3 rounded-[20px] bg-white/60 px-4 py-4 shadow-[0_8px_24px_rgba(17,24,39,0.06)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.08]">
              {login.boundContactId ? (
                <QqAvatar src={boundAvatar} alt={boundName || '已绑定的角色'} size={52} />
              ) : (
                <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-[#0099FF]/10 text-[#0099FF]" aria-hidden="true">
                  <Bot className="h-7 w-7" strokeWidth={2} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[17px] font-medium leading-tight">
                    {login.boundContactId ? boundName || '已删除的角色' : '已接入 · 还没绑定角色'}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#34C759]/10 px-2 py-[2px] text-[11px] font-medium text-[#34C759]">
                    <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                    已接入
                  </span>
                </div>
                <p className="mt-1 truncate text-[12.5px] text-black/40 dark:text-white/40">
                  机器人「{login.botName || login.appId}」 · 接入于 {fmtConnected(login.connectedAt)}
                </p>
              </div>
            </div>

            {/* 绑定/换绑轻提示（4 秒自动消失） */}
            {bindNote && <p className="mt-2 px-1 text-[12.5px] leading-relaxed text-[#34C759]">{bindNote}</p>}

            {/* 云端自动同步状态行：接入/换绑/断开后后台重推运行包的结果（只看 QQ 渠道，
                微信渠道的同步提示只在微信接入页展示）。
                v18：失败态不铺长文（机主定调「界面不铺错误长文”）——极简指示器，详情进错误中心弹窗 */}
            {lastAutoSync?.channel === 'qq' ? (
              lastAutoSync.ok ? (
                <p
                  data-testid="qq-bot-autosync"
                  className="mt-2 rounded-[10px] bg-[#34C759]/[0.08] px-3.5 py-2 text-[12px] leading-[1.5] text-[#2E9E4F]"
                >
                  {lastAutoSync.msg}（{new Date(lastAutoSync.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）
                </p>
              ) : (
                <InlineErrorChip label="云端同步失败" msg={lastAutoSync.msg} scope="sync-qq" className="mt-2" />
              )
            ) : null}

            {!login.boundContactId ? (
              /* ===== 补选角色入口卡（存量未绑定时展示；v8 新流程接入时已自动绑定不会走到这） ===== */
              <button
                type="button"
                data-testid="qq-bot-role-entry"
                onClick={() => setRoleSheetOpen(true)}
                className="mt-3 flex w-full items-center justify-between gap-3 rounded-[20px] bg-white/60 px-4 py-3.5 text-left shadow-[0_8px_24px_rgba(17,24,39,0.06)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.08] active:bg-white/80 dark:active:bg-white/[0.1]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">步骤二 · 选择角色</span>
                  <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">选一个角色，机器人在真机 QQ 里就是 TA</span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
              </button>
            ) : (
              <>
                {/* ===== 管理分组列表（v7 简约版：一张卡分行的 iOS 列表） ===== */}
                <div className="mt-3 divide-y divide-black/[0.05] overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_24px_rgba(17,24,39,0.06)] ring-1 ring-white/60 backdrop-blur-2xl dark:bg-white/[0.07] dark:ring-white/[0.08] dark:divide-white/[0.08]">
                  {/* 云端验证凭证：新取凭证端点海外可达，本地两路都不通时由云端助手 verify-qq 代验 */}
                  {cloudDeployed ? (
                    <button
                      type="button"
                      data-testid="qq-bot-verify-cloud"
                      disabled={verifying}
                      onClick={() => void verifyViaCloud()}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-black/[0.03] disabled:opacity-60 dark:active:bg-white/[0.06]"
                    >
                      <span className="min-w-0 flex-1 text-[15px] font-medium">云端验证凭证</span>
                      {verifying ? (
                        <Loader2 className="h-[17px] w-[17px] shrink-0 animate-spin text-[#0099FF]" strokeWidth={2.2} aria-hidden="true" />
                      ) : (
                        <ShieldCheck className="h-[17px] w-[17px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <p className="px-4 py-3 text-[12.5px] leading-relaxed text-black/35 dark:text-white/35" data-testid="qq-bot-verify-hint">
                      当前网络连不上 QQ 平台：部署云端后可验证凭证
                    </p>
                  )}

                  {/* 更换角色：行入口 → 底部弹层（同段二网格，点选即 bindContact 生效） */}
                  <button
                    type="button"
                    onClick={() => setRebindOpen(true)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
                  >
                    <span className="text-[15px] font-medium">更换角色</span>
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="max-w-[140px] truncate text-[13px] text-black/40 dark:text-white/40">{boundName || '未设置'}</span>
                      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
                    </span>
                  </button>

                  {/* 测试连接（用已存凭证再测一次） */}
                  <button
                    type="button"
                    data-testid="qq-bot-test"
                    disabled={testing}
                    onClick={() => runTest(login.appId, login.appSecret)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-black/[0.03] disabled:opacity-60 dark:active:bg-white/[0.06]"
                  >
                    <span className="min-w-0 flex-1 text-[15px] font-medium">测试连接</span>
                    {testing ? (
                      <Loader2 className="h-[17px] w-[17px] shrink-0 animate-spin text-[#0099FF]" strokeWidth={2.2} aria-hidden="true" />
                    ) : (
                      <RefreshCw className="h-[17px] w-[17px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
                    )}
                  </button>

                  {/* 断开接入 → AlertDialog 确认弹窗（v7 弹窗化） */}
                  <button
                    type="button"
                    data-testid="qq-bot-disconnect"
                    disabled={testing}
                    onClick={() => setOffDialog(true)}
                    className="flex w-full items-center justify-center gap-3 px-4 py-3 text-center text-[15px] font-medium text-[#F5455C] active:bg-black/[0.03] disabled:opacity-50 dark:active:bg-white/[0.06]"
                  >
                    断开接入
                  </button>
                </div>
              </>
            )}

            {/* 说明收缩区（v21 精简） */}
            <div className="mt-3">
              <Fold title="说明" testid="qq-bot-help-fold">
                <div className="space-y-2 text-[12.5px] leading-[1.55] text-black/50 dark:text-white/50">
                  <p>接入后云端 24 小时自动收发（QQ 官方 WebSocket 长连接，免费免配置）；聊天记录自动同步进手机 QQ 聊天界面。</p>
                  <p>真机收不到回复时：点「云端验证凭证」验真，或到 q.qq.com 控制台核对 AppID/AppSecret。</p>
                  <p>断开后凭证从本机删除，重新扫一次码即可再接入。</p>
                </div>
              </Fold>
            </div>
          </>
        )}

        {/* 结果行：成功绿 / 失败红。网络不通时凭证仍会保存（已切到已连接态），msg 会说明原因 */}
        {lastTest && (
          <p className={`mt-3 px-1 text-[13px] leading-relaxed ${lastTest.ok ? 'text-[#34C759]' : 'text-[#F5455C]'}`} data-testid="qq-bot-result">
            {lastTest.msg}
          </p>
        )}

        {/* boot 未完成时给一行占位说明（通常一闪而过） */}
        {!ready && <p className="mt-3 px-1 text-center text-[12px] text-black/25 dark:text-white/25">正在读取本机接入状态…</p>}
      </div>

      {/* 角色选择弹窗（底部半屏：头像+名字左右横排；v8 未接入时是步骤一选角色、选中即关窗，
          已接入未绑定时是补选角色、确认后绑定） */}
      {roleSheetOpen && (!login || !login.boundContactId) && (
        <div
          role="dialog"
          aria-label={!login ? '选择 AI 角色' : '选择角色'}
          className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40"
          onClick={() => setRoleSheetOpen(false)}
        >
          <div className="max-h-[72%] overflow-y-auto rounded-t-[20px] bg-[#F2F2F7]/95 px-4 pb-8 pt-4 backdrop-blur-2xl dark:bg-[#1C1C1E]/95" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium">{!login ? '步骤一 · 选择 AI 角色' : '选择角色'}</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setRoleSheetOpen(false)}
                className="rounded-full p-1 text-black/40 active:bg-black/5 dark:text-white/40 dark:active:bg-white/10"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">{!login ? '选好后再扫码/填凭证，连接成功自动绑定为 TA' : '选一个角色，机器人在真机 QQ 里就是 TA'}</p>
            <RoleRowList chars={chars} selectedId={picked?.id ?? login?.boundContactId ?? null} onPick={setPicked} testidBase="qq-bot-contact" />
            {!login ? (
              <button
                type="button"
                data-testid="qq-bot-pick-role"
                disabled={!picked}
                onClick={() => picked && setRoleSheetOpen(false)}
                className="mt-4 flex h-[46px] w-full items-center justify-center rounded-full bg-[#0099FF] text-[15px] font-medium text-white shadow-[0_6px_18px_rgba(0,153,255,0.32)] transition-all active:scale-[0.98] active:opacity-80 disabled:opacity-50"
              >
                {picked ? `就用「${displayNameOf(picked) || picked.name}」` : '先选一个角色'}
              </button>
            ) : (
              <button
                type="button"
                data-testid="qq-bot-bind"
                disabled={!picked}
                onClick={() => picked && void doBind(picked)}
                className="mt-4 flex h-[46px] w-full items-center justify-center rounded-full bg-[#0099FF] text-[15px] font-medium text-white shadow-[0_6px_18px_rgba(0,153,255,0.32)] transition-all active:scale-[0.98] active:opacity-80 disabled:opacity-50"
              >
                {picked ? `确认绑定「${displayNameOf(picked) || picked.name}」` : '先选一个角色'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 更换角色弹层（底部半屏：同款左右横排列表，点选即 bindContact 生效） */}
      {rebindOpen && login && (
        <div
          role="dialog"
          aria-label="更换角色"
          className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40"
          onClick={() => setRebindOpen(false)}
        >
          <div className="max-h-[72%] overflow-y-auto rounded-t-[20px] bg-[#F2F2F7]/95 px-4 pb-8 pt-4 backdrop-blur-2xl dark:bg-[#1C1C1E]/95" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium">更换角色</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setRebindOpen(false)}
                className="rounded-full p-1 text-black/40 active:bg-black/5 dark:text-white/40 dark:active:bg-white/10"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">选中即生效；云端会自动同步运行包用新人设代答</p>
            <RoleRowList chars={chars} selectedId={login.boundContactId ?? null} onPick={(c) => void doRebind(c)} testidBase="qq-bot-contact" />
          </div>
        </div>
      )}

      {/* 断开确认弹窗（v7：AlertDialog 弹窗替代直接断开） */}
      <AlertDialog open={offDialog} onOpenChange={setOffDialog}>
        <AlertDialogContent className="max-w-[300px] rounded-[16px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[16px]">断开 QQ 接入？</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-[1.6]">
              断开后凭证从本机删除，真机 QQ 上 TA 不再回复；重新接入扫一次码（或填写凭证）即可。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2.5">
            <AlertDialogCancel className="mt-0 h-11 flex-1 rounded-[10px] bg-black/[0.05] text-[15px] dark:bg-white/[0.08]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="qq-bot-disconnect-confirm"
              disabled={testing}
              onClick={(e) => {
                e.preventDefault();
                setOffDialog(false);
                void disconnect();
              }}
              className="h-11 flex-1 rounded-[10px] bg-[#F5455C] text-[15px] font-medium text-white hover:bg-[#F5455C] disabled:opacity-50"
            >
              确认断开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
