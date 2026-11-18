'use client';

/**
 * 接入真机微信页（「我」› 接入真机微信）—— 微信官方 iLink Bot 通道（ilinkai.weixin.qq.com）UI。
 * 方向：把 AI 角色带到你的真机微信上——拿一个微信号（建议小号）扫二维码，那个微信号就「变成」
 * 绑定的角色；再用你常用的微信加 TA 为好友，直接在真机微信里和 TA 聊（人设/记忆/世界书与手机一致），
 * 聊天记录双向同步到手机里的微信聊天界面。
 * 未连接：必须先部署云端助手（未部署时阻断卡取代步骤一/二——先部署 → 再接入）；已部署则
 * 说明卡 + 步骤一选角色（CHAR 联系人）+ 步骤二用微信号扫码接入。
 * 已连接：云端未部署黄色警告（仅本机实时回复开着时回消息）+ 状态卡（绑定角色 / Bot ID /
 * 连接时间 + 双向同步说明）+ 测试连接 + 本机实时回复开关（长轮询收发）+ 更换角色 +
 * 真机微信动态（运行日志）+ 断开接入。
 * 通道调用、扫码轮询、长轮询收发、线程双向同步与持久化全在 useWxConnect（weixin-connect.ts）；
 * 云端助手部署状态在 useWxCloud（wx-cloud/store）；本文件只做展示与动作接线。
 */

import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronLeft, ChevronRight, Cloud, CloudOff, Loader2, RefreshCw, X } from 'lucide-react';
import { useWxConnect, type WxQrStatus } from '@/lib/ios/weixin-connect';
import { useWxCloud, PLATFORM_LABELS } from '@/lib/ios/wx-cloud/store';
import { getContact } from '@/lib/ios/contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { Switch } from '@/components/ui/switch';
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

/** HH:MM（轮询检查时间 / 消息时间用） */
function fmtHm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 角色选择器（CHAR 联系人）：头像 + 名字，选中微信绿描边；
 *  scroll = 横滑条（接入流程步骤一），grid = 网格（换绑弹层里空间更大） */
function CharPicker({
  chars,
  selectedId,
  onPick,
  mode = 'scroll',
}: {
  chars: ContactRecord[];
  selectedId: string | null;
  onPick: (c: ContactRecord) => void;
  mode?: 'scroll' | 'grid';
}) {
  if (chars.length === 0) {
    return <p className="mt-2 text-[13px] leading-[1.5] text-black/40 dark:text-white/40">还没有 AI 角色：先在联系人 App 创建一个 AI 角色再来接入</p>;
  }
  const items = chars.map((c) => {
    const name = displayNameOf(c) || c.name;
    const sel = selectedId === c.id;
    return (
      <button
        key={c.id}
        type="button"
        data-testid={`wx-ilink-contact-${c.id}`}
        aria-label={`选择 ${name}`}
        onClick={() => onPick(c)}
        className={mode === 'grid' ? 'flex w-full flex-col items-center gap-1.5' : 'flex w-[62px] shrink-0 flex-col items-center gap-1.5'}
      >
        {/* 选中态：外层绿底 padding 形成描边圈（同微信选中头像高亮） */}
        <span className={`rounded-[13px] p-[2.5px] ${sel ? 'bg-[#07C160]' : 'bg-transparent'}`}>
          <WxAvatar src={avatarFor(c, 'wx')} alt={name} size={54} />
        </span>
        <span className={`w-full truncate text-center text-[12px] ${sel ? 'font-medium text-[#07C160]' : ''}`}>{name}</span>
      </button>
    );
  });
  if (mode === 'grid') return <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-3.5">{items}</div>;
  return <div className="no-scrollbar -mx-1 mt-3 flex gap-3.5 overflow-x-auto px-1 pb-1">{items}</div>;
}

export function WeixinConnectPage({ contacts, onBack }: { contacts: ContactRecord[]; onBack: () => void }) {
  // ---- store 逐项订阅（面板粒度刷新）----
  const ready = useWxConnect((s) => s.ready);
  const login = useWxConnect((s) => s.login);
  const qr = useWxConnect((s) => s.qr);
  const qrLoading = useWxConnect((s) => s.qrLoading);
  const testing = useWxConnect((s) => s.testing);
  const lastTest = useWxConnect((s) => s.lastTest);
  const autoReply = useWxConnect((s) => s.autoReply);
  const loopStatus = useWxConnect((s) => s.loopStatus);
  const loopError = useWxConnect((s) => s.loopError);
  const lastPollAt = useWxConnect((s) => s.lastPollAt);
  const msgs = useWxConnect((s) => s.msgs);
  const boot = useWxConnect((s) => s.boot);
  const startQr = useWxConnect((s) => s.startQr);
  const submitPin = useWxConnect((s) => s.submitPin);
  const cancelQr = useWxConnect((s) => s.cancelQr);
  const rebindContact = useWxConnect((s) => s.rebindContact);
  const disconnect = useWxConnect((s) => s.disconnect);
  const test = useWxConnect((s) => s.test);
  const setAutoReply = useWxConnect((s) => s.setAutoReply);
  const clearMsgs = useWxConnect((s) => s.clearMsgs);

  // 云端助手部署状态（横幅用：none=未部署黄色提示，其余平台绿色就绪小条；boot 前不渲染避免闪黄）
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
  /** 获取二维码失败的错误文案（startQr 抛错时展示） */
  const [qrErr, setQrErr] = useState('');
  /** 换绑角色弹层 */
  const [rebindOpen, setRebindOpen] = useState(false);
  /** 断开二次确认（再点一次才执行） */
  const [confirmOff, setConfirmOff] = useState(false);
  const [offBusy, setOffBusy] = useState(false);
  /** PIN 输入框（need_verifycode 时显示；提交后清空） */
  const [pinInput, setPinInput] = useState('');

  // 打开页面即 boot：读密文凭证 / 消息日志 / 实时回复开关（已在别处 boot 过则幂等）；
  // 云端助手状态一并读取（横幅判断是否已部署，boot 幂等）
  useEffect(() => {
    void boot();
    void useWxCloud.getState().boot();
  }, [boot]);

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
      setConfirmOff(false);
      setPicked(null);
      setQrErr('');
      showToast('已断开真机微信接入');
    }
  };

  /** 真机微信动态（倒序，最多 20 条） */
  const recent = useMemo(() => [...msgs].slice(-20).reverse(), [msgs]);

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
          {/* 云端未部署警告：已接入但云端没部署时，只有本机实时回复开着才回消息（部署后 7x24） */}
          {cloudReady && !cloudDeployed ? (
            <div data-testid="wx-ilink-cloud-banner" className="flex items-start gap-2.5 rounded-[10px] bg-[#FFF6DC] px-3.5 py-3 dark:bg-[#40361A]">
              <CloudOff className="mt-[2px] h-4 w-4 shrink-0 text-[#B77900] dark:text-[#EBC76A]" strokeWidth={2} />
              <p className="text-[12.5px] leading-[1.55] text-[#8A6A00] dark:text-[#EBC76A]">
                云端未部署：只有本机实时回复开着时 TA 才回消息（页面关掉就停）。到 设置 → 云端助手
                部署后 TA 7×24 在线。
              </p>
            </div>
          ) : null}

          {/* 云端自动同步状态行：接入/换绑/断开后后台重推运行包的结果（只有部署过云端才会有值） */}
          {lastAutoSync ? (
            <p
              data-testid="wx-ilink-autosync"
              className={`flex items-start gap-1.5 rounded-[10px] px-3.5 py-2 text-[12px] leading-[1.5] ${
                lastAutoSync.ok ? 'bg-[#07C160]/[0.07] text-[#07C160]' : 'bg-[#FFF6DC] text-[#8A6A00] dark:bg-[#40361A] dark:text-[#EBC76A]'
              }`}
            >
              <Cloud className="mt-[2px] h-[13px] w-[13px] shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 break-words">
                {lastAutoSync.ok
                  ? `${lastAutoSync.msg}（${new Date(lastAutoSync.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）`
                  : lastAutoSync.msg}
              </span>
            </p>
          ) : null}

          {/* 状态卡：绑定角色 + Bot ID + 连接时间 */}
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
            {/* 双向同步说明：真机微信 ↔ 手机微信聊天界面（网页侧继续聊，新回复也会发到微信） */}
            <p className="mt-2.5 text-[12px] leading-[1.5] text-black/35 dark:text-white/35">
              TA 的真机微信聊天会同步到手机里的微信聊天界面；在手机里继续聊，TA 的新回复也会发到微信上。
            </p>
          </div>

          {/* 测试连接：getupdates 打一次，成功绿字 / 失败红字 */}
          <div className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
            <div className="flex items-center justify-between gap-3">
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
              <p className={`mt-2 text-[12.5px] leading-[1.45] ${lastTest.ok ? 'text-[#07C160]' : 'text-[#FA5151]'}`}>{lastTest.msg}</p>
            )}
          </div>

          {/* 本机实时回复开关 + 轮询状态行（关着且已部署云端时由云端接管收发） */}
          <div className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="block text-[15.5px] font-medium">本机实时回复</span>
                <p className="mt-1 text-[12px] leading-[1.45] text-black/40 dark:text-white/40">
                  手机页面开着时立即收发；关闭后由云端接管（已部署云端时）
                </p>
              </div>
              <Switch checked={autoReply} onCheckedChange={setAutoReply} data-testid="wx-ilink-auto" aria-label="本机实时回复" />
            </div>
            {loopStatus === 'running' && (
              <p className="mt-2.5 flex items-center gap-1.5 text-[12px] text-[#07C160]">
                <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-[#07C160]" aria-hidden="true" />
                轮询中{lastPollAt ? ` · 上次检查 ${fmtHm(lastPollAt)}` : ''}
              </p>
            )}
            {loopStatus === 'error' && <p className="mt-2.5 text-[12px] leading-[1.45] text-[#FA5151]">{loopError || '轮询异常'}</p>}
          </div>

          {/* 更换角色：行入口 → 底部弹层选人（选中即 rebind，无需重新扫码） */}
          <div className="rounded-[10px] bg-white dark:bg-[#1A1A1A]">
            <button
              type="button"
              onClick={() => setRebindOpen(true)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="text-[15.5px]">更换角色</span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="max-w-[140px] truncate text-[13px] text-black/40 dark:text-white/40">{boundName}</span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
              </span>
            </button>
          </div>

          {/* 真机微信动态：倒序 20 条（微信好友消息 + TA 的回复 / 红色错误）的运行日志，右上可清空 */}
          <div data-testid="wx-ilink-msgs" className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
            <div className="flex items-center justify-between">
              <span className="text-[15.5px] font-medium">真机微信动态</span>
              {msgs.length > 0 && (
                <button type="button" onClick={clearMsgs} className="text-[12.5px] text-[#576B95] active:opacity-60">
                  清空
                </button>
              )}
            </div>
            {/* 仅运行日志：完整聊天记录（双向同步）在微信聊天界面里 */}
            <p className="mt-0.5 text-[11.5px] leading-[1.5] text-black/35 dark:text-white/35">仅运行日志，完整聊天记录在微信聊天界面里</p>
            {recent.length === 0 ? (
              <p className="py-7 text-center text-[13px] text-black/35 dark:text-white/35">还没有收到真机微信消息</p>
            ) : (
              <div className="mt-1.5 divide-y divide-black/[0.05] dark:divide-white/[0.08]">
                {recent.map((m) => (
                  <div key={m.id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="shrink-0 text-[12px] font-medium text-black/50 dark:text-white/50">{m.fromUserId.slice(0, 6)}…</span>
                      <span className="text-[11px] text-black/30 dark:text-white/30">{fmtHm(m.ts)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-[1.45]">{m.text}</p>
                    {m.replyErr ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-[#FA5151]">回复失败：{m.replyErr}</p>
                    ) : m.reply ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-black/50 dark:text-white/50">已回复：{m.reply}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 断开接入（红色危险操作，二次确认） */}
          {confirmOff ? (
            <div className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
              <p className="text-center text-[12.5px] leading-[1.5] text-black/55 dark:text-white/55">
                断开后那个微信号不再是 TA，微信侧 Token 即废弃；确定断开吗？
              </p>
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmOff(false)}
                  className="h-11 flex-1 rounded-[10px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid="wx-ilink-disconnect"
                  disabled={offBusy}
                  onClick={() => void doDisconnect()}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#FA5151] text-[15px] font-medium text-white active:brightness-95 disabled:opacity-60"
                >
                  {offBusy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
                  {offBusy ? '断开中…' : '确认断开'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="wx-ilink-disconnect"
              onClick={() => setConfirmOff(true)}
              className="w-full rounded-[10px] bg-white py-3 text-center text-[16px] text-[#FA5151] active:bg-black/5 dark:bg-[#1A1A1A]"
            >
              断开接入
            </button>
          )}
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
                云端已就绪（{PLATFORM_LABELS[cloudPlatform]}），TA 7×24 在线
              </p>
            </div>
          ) : null}

          {/* 说明卡：接入方式（小号扫码变成角色 + 常用微信加好友直聊）+ 官方通道小字 */}
          <div className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
            <div className="flex items-center gap-2">
              <Bot className="h-[18px] w-[18px] text-[#07C160]" strokeWidth={2} />
              <span className="text-[15px] font-semibold">把 TA 带到你的真机微信上</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-black/55 dark:text-white/55">
              拿一个微信号（建议小号）扫下方二维码，这个微信号就会变成你选的角色。然后用你常用的微信加 TA
              为好友，就能在真机微信里直接和 TA 聊天——人设、记忆、世界书和手机里完全一致。
            </p>
            <p className="mt-2 text-[11.5px] leading-[1.5] text-black/35 dark:text-white/35">
              官方 iLink 通道（ilinkai.weixin.qq.com），合法、零封号风险；Token 有效期由微信侧控制，过期后回本页重新扫码。
            </p>
            {/* 能力边界（2026-11 调研）：文字已开放；图片/视频/文件走官方接口；语音出站被平台屏蔽；通话/朋友圈协议不开放 */}
            <p className="mt-2 text-[12px] leading-[1.5] text-black/40 dark:text-white/40">
              能发什么：文字（已开放）· 图片、视频、文件（官方通道支持，将逐步开放）·
              语音/视频通话、朋友圈（微信协议不开放，做不到）
            </p>
            <p className="mt-1.5 text-[11.5px] leading-[1.5] text-black/35 dark:text-white/35">
              两侧独立：你在本站聊天界面对话只在网站里显示（不会发到真机微信）；真机微信上和 TA 的聊天由云端自动回复，聊天记录会同步进网站里查看。
            </p>
          </div>

          {cloudReady && !cloudDeployed ? (
            /* ===== 未部署云端 → 阻断接入（先部署云端助手，才能接入真机微信） ===== */
            <div
              data-testid="wx-ilink-cloud-block"
              className="flex items-start gap-2.5 rounded-[10px] bg-[#FFF6DC] px-3.5 py-3.5 dark:bg-[#40361A]"
              role="alert"
            >
              <CloudOff className="mt-[2px] h-[18px] w-[18px] shrink-0 text-[#B77900] dark:text-[#EBC76A]" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-snug text-[#8A6A00] dark:text-[#EBC76A]">先部署云端助手，才能接入真机微信</p>
                <p className="mt-1.5 text-[12.5px] leading-[1.55] text-[#8A6A00] dark:text-[#EBC76A]">
                  未部署云端时无法接入——TA 的消息收发由云端 7×24 接管。路径：设置 → 云端助手
                  （Supabase 一键部署即可），部署完回来这里选角色、扫码接入。
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* 步骤一：选择角色（CHAR；扫码后那个微信号就「变成」TA） */}
              <div className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
                <p className="text-[12.5px] font-semibold text-black/40 dark:text-white/40">步骤一 · 选择角色</p>
                <CharPicker chars={chars} selectedId={picked?.id ?? null} onPick={setPicked} />
              </div>

              {/* 步骤二：用微信号扫码接入 */}
              <div className="rounded-[10px] bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
                <p className="text-[12.5px] font-semibold text-black/40 dark:text-white/40">步骤二 · 用微信号扫码</p>
                {!picked ? (
                  <p className="mt-2 text-[13px] text-black/40 dark:text-white/40">先在上方选择一个角色</p>
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

      {/* 换绑角色弹层（底部半屏：网格选人，选中即生效） */}
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
            <CharPicker chars={chars} selectedId={login.boundContactId} onPick={(c) => void onRebind(c)} mode="grid" />
          </div>
        </div>
      )}

      {/* 页内 toast（换绑/断开等操作反馈） */}
      <LocalToast msg={toast} />
    </div>
  );
}
