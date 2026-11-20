'use client';

/**
 * 接入真机微信页（「我」› 接入真机微信）—— 微信官方 iLink Bot 通道（ilinkai.weixin.qq.com）UI · v4 简约版。
 *
 * v21 精简（用户定调「删无用功能」）：已连接视图只留 测试连接 / 更换角色 / 断开接入 ——
 *  秒回加速、本机实时回复、拉取云端聊天记录、真机微信动态均已下线（真机收发由云端
 *  Supabase 定时任务 7×24 承担；聊天记录由 cloud-history-sync 常驻自动同步；网关加速
 *  由 设置 → 云端助手 统一管理）。
 * 通道调用、扫码轮询、长轮询收发与持久化全在 useWxConnect（weixin-connect.ts）；
 * 云端助手部署状态在 useWxCloud（wx-cloud/store）；本文件只做展示与动作接线。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Info,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useWxConnect, type WxQrStatus } from '@/lib/ios/weixin-connect';
import { useWxCloud, PLATFORM_LABELS } from '@/lib/ios/wx-cloud/store';
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
import { LocalToast, useLocalToast } from '../page-toast';

import { WxAvatar } from './widgets';

/** 扫码状态文案（v3：补 PIN / 换域 / 已绑别处三个新态；官方协议状态机见 weixin-connect.ts） */
const QR_STATUS_TEXT: Record<WxQrStatus, string> = {
  wait: '打开那个微信号 → 扫一扫',
  scaned: '已扫码，请在微信上点确认',
  confirmed: '扫码成功，正在接入…',
  expired: '二维码已过期，点重新获取',
  need_verifycode: '微信要求校验：看看手机微信上显示的数字，在下方输入',
  verify_code_blocked: '数字错太多次，正在自动换一张码…',
  binded_redirect: '这个微信号已连到其它环境，先在那边解绑',
};

/** 角色选择列表（弹窗/底部弹层用）：头像左 + 名字右横排，选中行微信绿高亮——
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
    return <p className="py-4 text-center text-[13px] text-black/40 dark:text-white/40">还没有 AI 角色：先在「联系人」App 创建一个</p>;
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
            className={`flex w-full items-center gap-3 py-2.5 text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.06] ${sel ? 'bg-[#07C160]/[0.08]' : ''}`}
          >
            <WxAvatar src={avatarFor(c, 'wx')} alt={name} size={44} />
            <span className={`min-w-0 flex-1 truncate text-[15px] ${sel ? 'font-medium text-[#07C160]' : ''}`}>{name}</span>
            {sel ? <Check className="h-[18px] w-[18px] shrink-0 text-[#07C160]" strokeWidth={2.5} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 收缩区块外壳（v4 简约版「收缩选择」）：一行触发头 + 展开内容 */
function Fold({
  title,
  hint,
  children,
  testid,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  testid?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-[10px] bg-white dark:bg-[#1A1A1A]">
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

export function WeixinConnectPage({ contacts, onBack }: { contacts: ContactRecord[]; onBack: () => void }) {
  // ---- store 逐项订阅（面板粒度刷新）----
  const ready = useWxConnect((s) => s.ready);
  const login = useWxConnect((s) => s.login);
  const qr = useWxConnect((s) => s.qr);
  const qrLoading = useWxConnect((s) => s.qrLoading);
  const testing = useWxConnect((s) => s.testing);
  const lastTest = useWxConnect((s) => s.lastTest);
  const boot = useWxConnect((s) => s.boot);
  const startQr = useWxConnect((s) => s.startQr);
  const submitPin = useWxConnect((s) => s.submitPin);
  const cancelQr = useWxConnect((s) => s.cancelQr);
  const rebindContact = useWxConnect((s) => s.rebindContact);
  const disconnect = useWxConnect((s) => s.disconnect);
  const test = useWxConnect((s) => s.test);

  // 云端助手部署状态（横幅用：none=未部署提示，其余平台绿色就绪小条；boot 前不渲染避免闪黄）
  const cloudReady = useWxCloud((s) => s.ready);
  const cloudPlatform = useWxCloud((s) => s.platform);
  // 接入/换绑/断开后的后台自动同步结果（非空 = 已部署过云端且刚自动重推过运行包）
  const lastAutoSync = useWxCloud((s) => s.lastAutoSync);
  // 「真部署过」证据：选了平台 ≠ 部署了（Supabase 要跑过一键部署、HF 要建过 Space、ClawCloud 要标过已部署）
  const cloudDeployed = useWxCloud((s) =>
    (s.platform === 'supabase' && !!s.supabase?.deployedAt) ||
    (s.platform === 'hf' && !!s.hf?.deployedAt) ||
    (s.platform === 'clawcloud' && !!s.clawcloudAt),
  );

  // 页内 toast（本页在 App 根提前 return 的分支里，根部 toast 不渲染 → 自带）
  const [toast, showToast] = useLocalToast();

  /** 角色候选（CHAR 联系人；头像/名字按微信槽位解析） */
  const chars = useMemo(() => contacts.filter((c) => c.kind === 'char'), [contacts]);
  /** 步骤一选中的角色（本地态；扫码确认后才写进 store） */
  const [picked, setPicked] = useState<ContactRecord | null>(null);
  /** 步骤一角色选择弹窗（点开底部弹层选人，弹窗里头像名字左右横排） */
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  /** 获取二维码失败的错误文案（startQr 抛错时展示） */
  const [qrErr, setQrErr] = useState('');
  /** 换绑角色弹层 */
  const [rebindOpen, setRebindOpen] = useState(false);
  /** 断开确认弹窗（v4：AlertDialog 弹窗替代原内联二次确认卡） */
  const [offDialog, setOffDialog] = useState(false);
  const [offBusy, setOffBusy] = useState(false);
  /** PIN 输入框（need_verifycode 时显示；提交后清空） */
  const [pinInput, setPinInput] = useState('');

  // 打开页面即 boot：读密文凭证 / 消息日志 / 实时回复开关（已在别处 boot 过则幂等）；
  // 云端助手状态一并读取（横幅判断是否已部署，boot 幂等）
  useEffect(() => {
    void boot();
    void useWxCloud.getState().boot();
  }, [boot]);

  // v21 本机实时回复已下线：清掉历史遗留的开关位（避免本机轮询与云端通道双收双回）
  useEffect(() => {
    if (!ready || !login) return;
    if (useWxConnect.getState().autoReply) useWxConnect.getState().setAutoReply(false);
  }, [ready, login]);

  // binded_redirect（已绑其它环境）自动更新状态：解绑回来后页面自动换新码重试
  //（用户定调「让他可以自动更新状态」）；页面开着期间每 15 秒重取一次，手动「更新状态」按钮兑底
  useEffect(() => {
    if (qr?.status !== 'binded_redirect' || qrLoading || !picked) return;
    const t = window.setTimeout(() => {
      void startQr(picked.id, displayNameOf(picked) || picked.name);
    }, 15_000);
    return () => window.clearTimeout(t);
  }, [qr?.status, qr?.img, qrLoading, picked, startQr]);

  // 绑定角色详情：异步取联系人（联系人被删时为 null；换绑/断开的过渡期派生值兜底为 null）
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
  /** 当前绑定角色（异步取回前 / 已被删除时为 null，UI 用登录快照名兜底） */
  const boundRec = bound && bound.id === boundId ? bound : null;
  const boundName = boundRec ? displayNameOf(boundRec) || boundRec.name : login?.boundContactName ?? '';
  const boundAvatar = boundRec ? avatarFor(boundRec, 'wx') : null;

  /** 获取 / 重新获取二维码（startQr 内部自动轮询扫码状态，confirmed 后切换到已连接视图） */
  const fetchQr = async () => {
    if (!picked || qrLoading) return;
    setQrErr('');
    try {
      await startQr(picked.id, displayNameOf(picked) || picked.name);
    } catch (e) {
      setQrErr(e instanceof Error ? e.message : String(e));
    }
  };

  /** 换绑：选中即生效（不重新扫码，那个微信号即刻「变成」新角色），关弹层并 toast 反馈 */
  const onRebind = async (c: ContactRecord) => {
    setRebindOpen(false);
    const name = displayNameOf(c) || c.name;
    await rebindContact(c.id, name);
    showToast(`已切换为 ${name}`);
  };

  const doDisconnect = async () => {
    setOffBusy(true);
    try {
      await disconnect();
    } finally {
      setOffBusy(false);
      setOffDialog(false);
      setPicked(null);
      setQrErr('');
      showToast('已断开真机微信接入');
    }
  };

  return (
    <div
      data-testid="wx-ilink-page"
      className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white"
    >
      {/* 顶栏（微信灰，同收藏/设置页） */}
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-ilink-back" onClick={onBack} className="flex items-center px-1 active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex flex-1 items-center justify-center pr-9">
            <span className="text-[17px] font-medium">接入真机微信</span>
          </div>
        </div>
      </div>

      {!ready ? (
        /* boot 读取中（短暂）：居中转圈，避免已接入用户先看到未接入表单闪一下 */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-black/35 dark:text-white/35">
          <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
          <p className="text-[13px]">正在读取接入状态…</p>
        </div>
      ) : login ? (
        /* ==================== 已连接 ==================== */
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 pb-10">
          {/* 云端未部署：一行提示 + 详情弹窗（v4 简约版；详情全在弹窗里） */}
          {cloudReady && !cloudDeployed ? (
            <div data-testid="wx-ilink-cloud-banner" className="flex items-center gap-2 rounded-[10px] bg-[#FFF6DC] px-3.5 py-2.5 dark:bg-[#40361A]">
              <CloudOff className="h-4 w-4 shrink-0 text-[#B77900] dark:text-[#EBC76A]" strokeWidth={2} />
              <p className="min-w-0 flex-1 text-[12.5px] leading-[1.4] text-[#8A6A00] dark:text-[#EBC76A]">
                云端未部署：TA 暂不会在真机微信上回复
              </p>
              <Dialog>
                <DialogTrigger asChild>
                  <button type="button" className="shrink-0 text-[12.5px] font-medium text-[#8A6A00] underline underline-offset-2 dark:text-[#EBC76A]">
                    详情
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-[300px] rounded-[16px]">
                  <DialogHeader>
                    <DialogTitle className="text-[16px]">云端未部署会怎样？</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2 text-[13px] leading-[1.6] text-black/70 dark:text-white/75">
                    <p>部署云端后，TA 才会在真机微信上自动回复。</p>
                    <p>路径：设置 → 云端助手，一键部署（免费）即可。</p>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          ) : null}

          {/* 云端自动同步状态行：接入/换绑/断开后后台重推运行包的结果——只看微信渠道
              （QQ 渠道的同步提示只在 QQ 接入页展示，不再串页）。
              v18：失败态不铺长文（机主定调「界面不铺错误长文”）——极简指示器，详情进错误中心弹窗 */}
          {lastAutoSync?.channel === 'wx' ? (
            lastAutoSync.ok ? (
              <p
                data-testid="wx-ilink-autosync"
                className="flex items-start gap-1.5 rounded-[10px] bg-[#07C160]/[0.07] px-3.5 py-2 text-[12px] leading-[1.5] text-[#07C160]"
              >
                <Cloud className="mt-[2px] h-[13px] w-[13px] shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="min-w-0 break-words">
                  {lastAutoSync.msg}（{new Date(lastAutoSync.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）
                </span>
              </p>
            ) : (
              <InlineErrorChip label="云端同步失败" msg={lastAutoSync.msg} scope="sync-wx" />
            )
          ) : null}

          {/* 状态卡：绑定角色 + Bot ID + 连接时间（说明收进「说明」收缩区） */}
          <div className="rounded-[10px] bg-white px-4 py-4 dark:bg-[#1A1A1A]">
            <div className="flex items-center gap-3">
              <WxAvatar src={boundAvatar} alt={boundName} size={54} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[17px] font-medium leading-tight">{boundName || '未知角色'}</span>
                  <span className="shrink-0 rounded-full bg-[#07C160]/12 px-2 py-[2px] text-[10.5px] font-medium text-[#07C160]">已接入</span>
                </div>
                <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">
                  Bot ID：{login.botId.slice(0, 8)}
                  {login.botId.length > 8 ? '…' : ''}
                </p>
                <p className="mt-0.5 text-[12px] text-black/40 dark:text-white/40">连接于 {new Date(login.connectedAt).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* ===== 管理分组列表（v4 简约版：一张卡分行的 iOS 列表） ===== */}
          <div className="divide-y divide-black/[0.05] rounded-[10px] bg-white dark:divide-white/[0.08] dark:bg-[#1A1A1A]">
            {/* 测试连接 */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[15.5px] font-medium">测试连接</span>
              <button
                type="button"
                data-testid="wx-ilink-test"
                disabled={testing}
                onClick={() => void test()}
                className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-[#07C160] px-4 text-[13px] font-medium text-white active:brightness-95 disabled:opacity-60"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
                {testing ? '测试中…' : '测试'}
              </button>
            </div>
            {lastTest && (
              <p className={`px-4 pb-3 pt-0 text-[12.5px] leading-[1.45] ${lastTest.ok ? 'text-[#07C160]' : 'text-[#FA5151]'}`}>{lastTest.msg}</p>
            )}

            {/* 更换角色：行入口 → 底部弹层选人（选中即 rebind，无需重新扫码） */}
            <button
              type="button"
              onClick={() => setRebindOpen(true)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
            >
              <span className="text-[15.5px] font-medium">更换角色</span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="max-w-[140px] truncate text-[13px] text-black/40 dark:text-white/40">{boundName}</span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
              </span>
            </button>

            {/* 断开接入 → AlertDialog 确认弹窗（v4 弹窗化） */}
            <button
              type="button"
              data-testid="wx-ilink-disconnect"
              onClick={() => setOffDialog(true)}
              className="flex w-full items-center justify-center gap-3 px-4 py-3 text-center text-[15.5px] font-medium text-[#FA5151] active:bg-black/[0.03] dark:active:bg-white/[0.05]"
            >
              断开接入
            </button>
          </div>

          {/* 说明收缩区（v5 精简：提示收敛为两行） */}
          <Fold title="说明" testid="wx-ilink-help-fold">
            <div className="space-y-2 text-[12.5px] leading-[1.55] text-black/55 dark:text-white/55">
              <p>TA 的真机微信聊天会同步到手机里的微信聊天界面；官方 iLink 通道，合法、零封号风险。</p>
              <p>断开后 Token 即废弃，重新接入再扫一次码即可。</p>
            </div>
          </Fold>
        </div>
      ) : (
        /* ==================== 未连接 ==================== */
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 pb-10">
          {/* 云端就绪横幅：已部署绿色小条（未部署的阻断卡在说明卡之后，取代步骤一/二） */}
          {cloudReady && cloudDeployed ? (
            <div
              data-testid="wx-ilink-cloud-banner"
              className="flex items-center gap-2 rounded-[10px] bg-[#07C160]/[0.08] px-3.5 py-2.5 dark:bg-[#07C160]/[0.14]"
            >
              <Cloud className="h-[15px] w-[15px] shrink-0 text-[#07C160]" strokeWidth={2} />
              <p className="text-[12.5px] font-medium leading-[1.4] text-[#07C160]">
                云端已就绪（{PLATFORM_LABELS[cloudPlatform]}）
              </p>
            </div>
          ) : null}

          {/* 说明卡（v4 简约版：一句话 + 收缩展开完整接入说明） */}
          <div className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
            <div className="flex items-center gap-2">
              <Bot className="h-[18px] w-[18px] text-[#07C160]" strokeWidth={2} />
              <span className="text-[15px] font-semibold">把 TA 带到你的真机微信上</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-[1.5] text-black/55 dark:text-white/55">
              用一个微信号扫下方二维码，TA 就「住进」那个号里——再用你常用的微信加 TA 为好友直接聊。
            </p>
            <div className="mt-2">
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger
                  data-testid="wx-ilink-help-fold"
                  className="group flex items-center gap-1 text-[12.5px] font-medium text-[#07C160] active:opacity-60"
                >
                  <Info className="h-[14px] w-[14px]" strokeWidth={2} aria-hidden="true" />
                  展开接入说明
                  <ChevronDown className="h-[14px] w-[14px] transition-transform duration-200 group-data-[state=open]:rotate-180" strokeWidth={2} aria-hidden="true" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 space-y-2 text-[12px] leading-[1.55] text-black/45 dark:text-white/45">
                    <p>拿一个微信号（建议小号）扫二维码，这个微信号就会变成你选的角色；用你常用的微信加 TA 为好友直接聊。</p>
                    <p>官方 iLink 通道，合法、零封号风险；Token 过期后回本页重新扫码。</p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          {cloudReady && !cloudDeployed ? (
            /* ===== 未部署云端 → 阻断接入（一行 + 详情弹窗） ===== */
            <div
              data-testid="wx-ilink-cloud-block"
              className="flex items-center gap-2 rounded-[10px] bg-[#FFF6DC] px-3.5 py-3 dark:bg-[#40361A]"
              role="alert"
            >
              <CloudOff className="h-[18px] w-[18px] shrink-0 text-[#B77900] dark:text-[#EBC76A]" strokeWidth={2} />
              <p className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-[#8A6A00] dark:text-[#EBC76A]">
                先部署云端助手，才能接入真机微信
              </p>
              <Dialog>
                <DialogTrigger asChild>
                  <button type="button" className="shrink-0 text-[12.5px] font-medium text-[#8A6A00] underline underline-offset-2 dark:text-[#EBC76A]">
                    详情
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-[300px] rounded-[16px]">
                  <DialogHeader>
                    <DialogTitle className="text-[16px]">为什么要先部署云端？</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2 text-[13px] leading-[1.6] text-black/70 dark:text-white/75">
                    <p>TA 在真机微信上的消息收发由云端 7×24 接管，未部署云端时无法接入。</p>
                    <p>路径：设置 → 云端助手（Supabase 一键部署即可），部署完回来选角色、扫码接入。</p>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <>
              {/* 步骤一：选择角色（点开底部弹层选人；弹窗里头像名字左右横排，扫码后那个微信号就「变成」TA） */}
              <button
                type="button"
                data-testid="wx-ilink-role-entry"
                onClick={() => setRoleSheetOpen(true)}
                className="flex w-full items-center justify-between gap-3 rounded-[10px] bg-white px-4 py-3.5 text-left active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.05]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15.5px] font-medium">步骤一 · 选择角色</span>
                  <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">
                    {picked ? `已选：${displayNameOf(picked) || picked.name}` : '选一个角色，扫码后那个微信号就「变成」TA'}
                  </span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
              </button>

              {/* 步骤二：用微信号扫码接入 */}
              <div className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
                <p className="text-[12.5px] font-semibold text-black/40 dark:text-white/40">步骤二 · 用微信号扫码</p>
                {!picked ? (
                  <p className="mt-2 text-[13px] text-black/40 dark:text-white/40">先选一个角色，再获取二维码</p>
                ) : !qr ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      data-testid="wx-ilink-qr-btn"
                      disabled={qrLoading}
                      onClick={() => void fetchQr()}
                      className="flex h-[42px] w-full items-center justify-center gap-2 rounded-[10px] bg-[#07C160] text-[15px] font-medium text-white active:brightness-95 disabled:opacity-60"
                    >
                      {qrLoading ? <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2} /> : null}
                      {qrLoading ? '正在获取二维码…' : `获取二维码（${displayNameOf(picked) || picked.name}）`}
                    </button>
                    {qrErr && <p className="mt-2 text-[12.5px] leading-[1.45] text-[#FA5151]">{qrErr}</p>}
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col items-center">
                    <img
                      data-testid="wx-ilink-qr-img"
                      src={qr.img}
                      alt="接入二维码"
                      className={`h-[200px] w-[200px] rounded-[10px] bg-white p-1.5 ${
                        qr.status === 'expired' || qr.status === 'binded_redirect' ? 'opacity-35' : ''
                      }`}
                    />
                    <p
                      data-testid="wx-ilink-qr-status"
                      className={`mt-3 text-[13.5px] ${
                        qr.status === 'expired' || qr.status === 'binded_redirect'
                          ? 'text-[#FA5151]'
                          : qr.status === 'need_verifycode'
                            ? 'text-[#B77900]'
                            : 'text-black/55 dark:text-white/55'
                      }`}
                    >
                      {QR_STATUS_TEXT[qr.status]}
                    </p>
                    {/* 已绑别处等终态的引导（qr.hint 由协议状态机带回） */}
                    {qr.hint ? (
                      <p className="mt-1.5 max-w-[300px] text-center text-[12px] leading-[1.5] text-black/45 dark:text-white/45">
                        {qr.hint}
                      </p>
                    ) : null}
                    {/* 微信 PIN 校验：手机上显示数字 → 本页输入 → 下一轮轮询带 verify_code */}
                    {qr.status === 'need_verifycode' ? (
                      <div className="mt-2.5 flex w-full items-center gap-2" data-testid="wx-ilink-pin">
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={8}
                          value={pinInput}
                          onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          placeholder="输入微信上显示的数字"
                          aria-label="微信校验数字"
                          className="h-[40px] min-w-0 flex-1 rounded-[10px] bg-black/[0.04] px-3 text-center text-[16px] tracking-[0.2em] outline-none focus:bg-black/[0.06] dark:bg-white/[0.08] dark:focus:bg-white/[0.12]"
                        />
                        <button
                          type="button"
                          disabled={!pinInput.trim()}
                          onClick={() => {
                            submitPin(pinInput.trim());
                            setPinInput('');
                          }}
                          className="h-[40px] shrink-0 rounded-full bg-[#07C160] px-4 text-[13.5px] font-medium text-white active:brightness-95 disabled:opacity-50"
                        >
                          继续
                        </button>
                      </div>
                    ) : null}
                    {/* PIN 输错提示（输错码时协议状态机带回 pinErr） */}
                    {qr.pinErr ? (
                      <p className="mt-1.5 text-[12px] text-[#FA5151]" role="alert">
                        {qr.pinErr}
                      </p>
                    ) : null}
                    {/* 已绑别处：解绑后自动/手动更新状态（用户定调：自动更新 + 手动按钮兑底） */}
                    {qr.status === 'binded_redirect' && (
                      <div className="mt-3 flex w-full flex-col items-center" data-testid="wx-ilink-bind-redirect">
                        <p className="text-[12px] leading-relaxed text-black/45 dark:text-white/45">已在那边解绑？页面会自动更新，或点下方按钮立即更新</p>
                        <button
                          type="button"
                          data-testid="wx-ilink-status-refresh"
                          disabled={qrLoading}
                          onClick={() => void fetchQr()}
                          className="mt-2 flex h-[38px] items-center justify-center gap-1.5 rounded-full bg-[#07C160] px-5 text-[13.5px] font-medium text-white active:brightness-95 disabled:opacity-60"
                        >
                          {qrLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
                          更新状态
                        </button>
                      </div>
                    )}
                    {/* 更新二维码：随时换一张新码（扫不出来 / 想重扫时用） */}
                    {(qr.status === 'wait' || qr.status === 'scaned' || qr.status === 'need_verifycode') && (
                      <button
                        type="button"
                        data-testid="wx-ilink-qr-refresh"
                        disabled={qrLoading}
                        onClick={() => void fetchQr()}
                        className="mt-2.5 flex h-[34px] items-center justify-center gap-1.5 rounded-full bg-black/[0.05] px-4 text-[12.5px] font-medium text-black/60 active:opacity-70 disabled:opacity-60 dark:bg-white/[0.08] dark:text-white/60"
                      >
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                        更新二维码
                      </button>
                    )}
                    {qr.status === 'expired' && (
                      <button
                        type="button"
                        disabled={qrLoading}
                        onClick={() => void fetchQr()}
                        className="mt-2.5 flex h-[34px] items-center gap-1.5 rounded-full bg-[#07C160] px-4 text-[13px] font-medium text-white active:brightness-95 disabled:opacity-60"
                      >
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                        重新获取
                      </button>
                    )}
                    {(qr.status === 'wait' || qr.status === 'scaned' || qr.status === 'need_verifycode') && (
                      <button type="button" onClick={cancelQr} className="mt-2.5 text-[12.5px] text-black/40 active:opacity-60 dark:text-white/40">
                        取消
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 步骤一 · 选择角色弹窗（底部半屏：头像+名字左右横排；点选即返回步骤二） */}
      {roleSheetOpen && !login && (
        <div
          role="dialog"
          aria-label="步骤一 · 选择角色"
          className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40"
          onClick={() => setRoleSheetOpen(false)}
        >
          <div className="max-h-[72%] overflow-y-auto rounded-t-[14px] bg-[#F7F7F7] px-4 pb-8 pt-4 dark:bg-[#1A1A1A]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium">步骤一 · 选择角色</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setRoleSheetOpen(false)}
                className="rounded-full p-1 text-black/40 active:bg-black/5 dark:text-white/40 dark:active:bg-white/10"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">选一个角色，扫码后那个微信号就「变成」TA</p>
            <RoleRowList
              chars={chars}
              selectedId={picked?.id ?? null}
              onPick={(c) => {
                setPicked(c);
                setRoleSheetOpen(false);
              }}
              testidBase="wx-ilink-contact"
            />
          </div>
        </div>
      )}

      {/* 换绑角色弹层（底部半屏：同款左右横排列表，选中即生效） */}
      {rebindOpen && login && (
        <div
          role="dialog"
          aria-label="更换角色"
          className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40"
          onClick={() => setRebindOpen(false)}
        >
          <div className="max-h-[72%] overflow-y-auto rounded-t-[14px] bg-[#F7F7F7] px-4 pb-8 pt-4 dark:bg-[#1A1A1A]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium">更换角色</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setRebindOpen(false)}
                className="text-black/40 active:opacity-60 dark:text-white/40"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">选中即生效，无需重新扫码</p>
            <RoleRowList chars={chars} selectedId={login.boundContactId} onPick={(c) => void onRebind(c)} testidBase="wx-ilink-contact" />
          </div>
        </div>
      )}

      {/* 断开确认弹窗（v4：AlertDialog 弹窗替代内联二次确认卡） */}
      <AlertDialog open={offDialog} onOpenChange={setOffDialog}>
        <AlertDialogContent className="max-w-[300px] rounded-[16px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[16px]">断开真机微信接入？</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-[1.6]">
              断开后那个微信号不再是 TA，微信侧 Token 即废弃；重新接入再扫一次码即可。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2.5">
            <AlertDialogCancel className="mt-0 h-11 flex-1 rounded-[10px] bg-black/[0.05] text-[15px] dark:bg-white/[0.08]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="wx-ilink-disconnect-confirm"
              disabled={offBusy}
              onClick={(e) => {
                e.preventDefault();
                void doDisconnect();
              }}
              className="h-11 flex-1 rounded-[10px] bg-[#FA5151] text-[15px] font-medium text-white hover:bg-[#FA5151] disabled:opacity-60"
            >
              {offBusy ? '断开中…' : '确认断开'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 页内 toast（换绑/断开等操作反馈） */}
      <LocalToast msg={toast} />
    </div>
  );
}
