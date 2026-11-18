'use client';

/**
 * 「接入QQ」页（动态页入口）—— QQ 官方机器人平台（q.qq.com）接入 UI · v6。
 *
 * v6（官方扫码连接，用户定调）：「扫码连接」tab 改为 q.qq.com 官方扫码绑定——本页生成
 * 二维码，用户手机 QQ 扫码 → 选择自己创建的机器人 → 确认绑定 → 凭证（AES-256-GCM
 * 加密回传）自动解密接入，无需手动填 AppID/AppSecret，也不碰被腾讯地域拦的 token
 * 验证口。「填写凭证」保留手动方式 + 凭证二维码图片识别（拍照/选图，jsQR）。
 * 接入前置：云端助手必须已部署（未部署时阻断接入——QQ 收发消息走云端 Webhook）。
 *
 * 收发通道：QQ 官方已停止维护 WebSocket，走 Webhook——须先在 设置 → 云端助手 部署；
 * 聊天记录通过云端同步，「拉取云端聊天记录」把云端收到的 QQ 聊天合进手机 App 的 QQ
 * 聊天界面。
 *
 * 底层库 src/lib/ios/qq-connect.ts（zustand store + kv 加密持久化）：凭证保存、双路测试
 * 连接、官方扫码绑定状态机（q.qq.com/lite 协议）、bindContact 角色绑定、
 * pullQqCloudHistory 云端拉取；本文件只做页面展示与动作接线。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCircle2, ChevronLeft, ChevronRight, CloudOff, Eye, EyeOff, ImagePlus, Loader2, RefreshCw, ScanLine, ShieldCheck, X } from 'lucide-react';
import { parseQqQrImage, pullQqCloudHistory, useQqConnect } from '@/lib/ios/qq-connect';
import { useWxCloud, PLATFORM_LABELS } from '@/lib/ios/wx-cloud/store';
import { getContact } from '@/lib/ios/contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { QqAvatar } from './widgets';


/** 接入时间格式化（YYYY-MM-DD HH:mm） */
function fmtConnected(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 扫码识别失败提示（三种支持格式：AppID:AppSecret / JSON / 网址查询串） */
const QR_FAIL_MSG = '没认出这是凭证二维码（支持 AppID:AppSecret / JSON / 网址格式）';

/** 角色选择网格（QQ 版，参考微信接入页 CharPicker）：头像 + 名字，选中 QQ 蓝描边；
 *  点选只做本地暂存，需再按「确认绑定」才写入 store——段二与「更换角色」弹层共用 */
function CharPickerGrid({
  chars,
  selectedId,
  onPick,
}: {
  chars: ContactRecord[];
  selectedId: string | null;
  onPick: (c: ContactRecord) => void;
}) {
  if (chars.length === 0) {
    return <p className="mt-2 text-[13px] leading-[1.5] text-black/40 dark:text-white/40">还没有 AI 角色：先到手机的「联系人」App 创建一个 AI 角色再来接入</p>;
  }
  return (
    <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-3.5">
      {chars.map((c) => {
        const name = displayNameOf(c) || c.name;
        const sel = selectedId === c.id;
        return (
          <button
            key={c.id}
            type="button"
            data-testid={`qq-bot-contact-${c.id}`}
            aria-label={`选择 ${name}`}
            onClick={() => onPick(c)}
            className="flex w-full flex-col items-center gap-1.5"
          >
            {/* 选中态：外层 QQ 蓝底 padding 形成描边圈（同微信选中头像高亮的 QQ 配色版） */}
            <span className={`rounded-[13px] p-[2.5px] ${sel ? 'bg-[#0099FF]' : 'bg-transparent'}`}>
              <QqAvatar src={avatarFor(c, 'qq')} alt={name} size={54} />
            </span>
            <span className={`w-full truncate text-center text-[12px] ${sel ? 'font-medium text-[#0099FF]' : ''}`}>{name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function QqConnectPage({ contacts, onBack }: { contacts: ContactRecord[]; onBack: () => void }) {
  // store：boot 读本地凭证；test 成功（或网络不通兜底）即保存；bindContact 绑定角色；disconnect 清除；
  // qr/startQrBind/stopQrBind：官方扫码绑定会话（页面生成二维码 → 手机 QQ 扫码确认即接入）
  const { ready, login, testing, verifying, lastTest, pulling, boot, test, verifyViaCloud, bindContact, disconnect, qr, startQrBind, stopQrBind } = useQqConnect();
  // 本地 UI 状态：凭证草稿 / Secret 明文开关
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  // 段一视图 tab：扫码连接（官方扫码绑定：页面生成二维码给手机 QQ 扫）/ 填写凭证——只切视图，凭证草稿在父组件不丢
  const [addTab, setAddTab] = useState<'scan' | 'manual'>('scan');
  // 官方扫码绑定：二维码渲染成图（qrcode 库 dataURL；库体积大走动态 import）
  const [qrImg, setQrImg] = useState<string | null>(null);
  // 凭证二维码图片识别（填写凭证 tab 的辅助入口）：转圈 / 结果行 / 两个 file input ref
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // 段二本地选中（确认绑定才写 store）/ 换绑弹层 / 绑定轻提示 / 拉取结果行
  const [picked, setPicked] = useState<ContactRecord | null>(null);
  const [rebindOpen, setRebindOpen] = useState(false);
  const [bindNote, setBindNote] = useState('');
  const [pullMsg, setPullMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  // 云端助手状态：QQ 收发消息必须走云端 Webhook，顶部横幅依据它提示（订阅粒度刷新）
  const cloudReady = useWxCloud((s) => s.ready);
  const cloudPlatform = useWxCloud((s) => s.platform);
  // 接入/换绑/断开后的后台自动同步结果（非空 = 已部署过云端且刚自动重推过运行包）
  const lastAutoSync = useWxCloud((s) => s.lastAutoSync);
  // 「真部署过」证据：选了平台 ≠ 部署了；QQ 必须真部署才能收发 Webhook
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

  // 官方扫码绑定会话生命周期：未接入 + 停在扫码 tab + 云端就绪 → 启动轮询；
  // 切走 tab / 接入成功 / 组件卸载 → 停止（stopQrBind 会话令牌自增，旧循环自动退出）
  const qrActive = !login && addTab === 'scan' && cloudDeployed;
  useEffect(() => {
    if (!qrActive) return;
    void startQrBind();
    return () => {
      stopQrBind();
    };
  }, [qrActive, startQrBind, stopQrBind]);

  // 二维码内容变化 → qrcode 库渲染成图（微信接入同款用法；动态 import 避开主包体积）。
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

  /**
   * 扫码/选图识别凭证二维码：jsQR 解码 → 自动填入输入框 → 直接测试接入（识别即连接）。
   * 网络不通时 store 会兑底保存凭证并切到已连接态（503 = 地域屏蔽不是凭证错误）。
   */
  const pickQrImage = async (file: File) => {
    setScanBusy(true);
    setScanMsg(null);
    try {
      const cred = await parseQqQrImage(file);
      if (cred) {
        setAppId(cred.appId);
        setAppSecret(cred.appSecret);
        setScanMsg({ ok: true, msg: '已识别，正在测试接入…' });
        runTest(cred.appId, cred.appSecret);
      } else {
        setScanMsg({ ok: false, msg: QR_FAIL_MSG });
      }
    } catch {
      setScanMsg({ ok: false, msg: QR_FAIL_MSG });
    } finally {
      setScanBusy(false);
    }
  };

  /** 段二确认绑定：写入 store——从这一刻起，机器人在真机 QQ 里就是这个角色 */
  const doBind = async (c: ContactRecord) => {
    const name = displayNameOf(c) || c.name;
    await bindContact(c.id, name);
    setPicked(null);
    setBindNote(`已绑定「${name}」——TA 就是你 QQ 里创建的那个 AI，打开 QQ 直接聊`);
  };

  /** 更换角色（弹层里点选即生效）：换绑后云端运行包自动重推（cloudAutoSync），新人设即刻生效 */
  const doRebind = async (c: ContactRecord) => {
    setRebindOpen(false);
    const name = displayNameOf(c) || c.name;
    await bindContact(c.id, name);
    setBindNote(`已切换为「${name}」，云端人设已自动同步`);
  };

  /**
   * 拉取云端 QQ 聊天记录：复用 store 的 pulling 状态位转圈（与 pullHistory 动作同一状态、
   * 同一防重入闸），但直接调函数版 pullQqCloudHistory——store 动作版不回传条数与失败原因，
   * 本页要渲染「已同步 N 条到 QQ 聊天界面」的精确文案和失败提示。
   */
  const doPull = async () => {
    if (pulling) return;
    setPullMsg(null);
    useQqConnect.setState({ pulling: true });
    try {
      const r = await pullQqCloudHistory();
      setPullMsg(r.ok ? { ok: true, msg: r.added ? `已同步 ${r.added} 条到 QQ 聊天界面` : '云端暂无新记录' } : { ok: false, msg: r.msg });
    } finally {
      useQqConnect.setState({ pulling: false });
    }
  };

  return (
    <div data-testid="qq-bot-page" className="relative flex h-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      {/* 顶部导航（QQ 子页风格：返回 + 居中标题） */}
      <div className="relative flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">接入QQ</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[44px] pt-2">
        {/* 云端横幅（页面顶部）：已部署绿条；未部署且已接入过 → 黄色警告（新接入的阻断卡在段一位置）；
            boot 完成后再显示，避免读到旧值闪黄 */}
        {cloudReady && cloudDeployed ? (
          <div className="flex items-center gap-2 rounded-[14px] bg-[#34C759]/10 px-3.5 py-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#34C759]" strokeWidth={2.2} aria-hidden="true" />
            <p className="text-[13px] font-medium text-[#34C759]">云端已就绪（{PLATFORM_LABELS[cloudPlatform]}），TA 7x24 在线</p>
          </div>
        ) : cloudReady && !cloudDeployed && login ? (
          <div className="flex items-start gap-2.5 rounded-[14px] bg-[#FFF4D6] px-3.5 py-3 dark:bg-[#3B3113]">
            <AlertTriangle className="mt-[1.5px] h-[18px] w-[18px] shrink-0 text-[#C77700] dark:text-[#F0C24B]" strokeWidth={2} aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-[#8A5A00] dark:text-[#F0C24B]">
              云端未部署：QQ 收发消息已停摆。到 设置 → 云端助手 完成部署（Supabase 一键部署即可）后自动恢复
            </p>
          </div>
        ) : null}

        {/* 说明卡：功能定位——把 TA 带到你的真机 QQ 上（你本人在真机 QQ 里和 TA 聊） */}
        <div className={`${cloudReady ? 'mt-3 ' : ''}rounded-[14px] bg-white px-4 py-3.5 dark:bg-[#1B1C1F]`}>
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
                q.qq.com · 个人开发者免费注册
              </button>
            </div>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-black/50 dark:text-white/50">
            先在 QQ 里创建你自己的 AI（q.qq.com，创建完 TA 就在你的 QQ 里，不用再添加），拿到
            AppID/AppSecret 后在这里扫码连接或手动填入。接入后机器人就是你在手机里选的那个 AI
            角色——打开 QQ 直接聊；收发消息走云端 Webhook（必须先部署云端助手）。
          </p>
          {/* 能力边界：文字/表情包图片/语音条走官方富媒体接口（已接入云端）；通话/QQ空间协议不开放 */}
          <p className="mt-2 text-[12px] leading-relaxed text-black/40 dark:text-white/40">
            能发什么：文字、表情包、语音条（官方富媒体接口，云端部署后可用——语音条需在 设置 → 语音设置 配 OpenAI 兼容 TTS）·
            语音/视频通话、QQ空间（QQ 协议不开放，做不到）
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-black/35 dark:text-white/35">
            两侧独立：你在本站聊天界面对话只在网站里显示（不会发到真机 QQ）；真机 QQ 上和 TA 的聊天由云端自动回复，点「拉取云端聊天记录」同步进来看。
          </p>
        </div>

        {!login ? (
          cloudReady && !cloudDeployed ? (
            /* ===== 未部署云端 → 阻断接入（QQ 收发走云端 Webhook，必须先部署） ===== */
            <div className="mt-4 rounded-[14px] bg-[#FFF4D6] px-4 py-4 dark:bg-[#3B3113]" data-testid="qq-bot-cloud-block">
              <div className="flex items-start gap-2.5">
                <CloudOff className="mt-[2px] h-[18px] w-[18px] shrink-0 text-[#C77700] dark:text-[#F0C24B]" strokeWidth={2} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-medium leading-snug text-[#8A5A00] dark:text-[#F0C24B]">先部署云端助手，才能接入 QQ</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#8A5A00] dark:text-[#F0C24B]">
                    QQ 收发消息走云端 Webhook——不部署云端就无法接入。路径：设置 → 云端助手（Supabase
                    一键部署即可），部署完回来这里扫码连接或填 AppID/AppSecret。
                  </p>
                </div>
              </div>
            </div>
          ) : (
          <>
            {/* ===== 段一 · 接入 QQ 机器人：扫码连接（官方扫码绑定，默认）/ 填写凭证（手动 + 凭证码图片识别） ===== */}
            <p className="mt-4 px-1 text-[12px] font-semibold text-black/40 dark:text-white/40">步骤一 · 接入你创建的 AI</p>

            {/* 接入方式 tab 胶囊：扫码连接（官方扫码绑定：本页生成二维码给手机 QQ 扫）/ 填写凭证（手动填） */}
            <div className="mt-2.5 flex gap-2" role="tablist" aria-label="接入方式">
              <button
                type="button"
                role="tab"
                aria-selected={addTab === 'scan'}
                data-testid="qq-bot-tab-scan"
                onClick={() => setAddTab('scan')}
                className={`flex h-9 flex-1 items-center justify-center rounded-full text-[13.5px] font-medium active:opacity-70 ${
                  addTab === 'scan' ? 'bg-[#0099FF] text-white' : 'bg-black/[0.04] text-black/50 dark:bg-white/[0.06] dark:text-white/50'
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
                className={`flex h-9 flex-1 items-center justify-center rounded-full text-[13.5px] font-medium active:opacity-70 ${
                  addTab === 'manual' ? 'bg-[#0099FF] text-white' : 'bg-black/[0.04] text-black/50 dark:bg-white/[0.06] dark:text-white/50'
                }`}
              >
                填写凭证
              </button>
            </div>

            {addTab === 'scan' ? (
              /* 扫码连接 tab（v6 官方协议）：本页生成二维码 → 手机 QQ 扫码 → 选择你创建的
                 机器人 → 确认绑定 → 凭证加密回传自动解密接入（无需手动填 AppID/AppSecret） */
              <div className="mt-2.5 rounded-[14px] bg-white px-4 py-4 dark:bg-[#1B1C1F]" data-testid="qq-bot-qr-card">
                <p className="text-center text-[15px] font-medium text-black/85 dark:text-white/90">QQ 扫码连接</p>
                <p className="mt-1 text-center text-[11.5px] leading-relaxed text-black/40 dark:text-white/40">
                  本页生成二维码，用手机 QQ 扫码即可连上你创建的机器人
                </p>
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
                    打开手机 QQ 扫上面的码<br />→ 选择你创建的机器人 → 确认绑定
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
                    二维码扫不出来？刷新一下
                  </button>
                )}
                {/* 引导：还没有机器人的用户 */}
                <p className="mt-3 rounded-[10px] bg-black/[0.03] px-3 py-2.5 text-[11.5px] leading-relaxed text-black/40 dark:bg-white/[0.05] dark:text-white/40">
                  还没有机器人？用手机 QQ 扫码登录 q.qq.com → 点「创建机器人」（一分钟搞定，创建完它会在你
                  QQ 里发条消息），然后回来扫上面的码连接。二维码过期会自动刷新，无需手动操作。
                </p>
              </div>
            ) : (
              /* 填写凭证 tab：去哪找凭证（q.qq.com 控制台「开发设置」）+ 凭证二维码图片识别辅助 */
              <div className="mt-2.5 rounded-[14px] bg-white px-4 py-4 dark:bg-[#1B1C1F]">
                <p className="text-[12px] leading-relaxed text-black/35 dark:text-white/35">
                  打开 q.qq.com 控制台「开发设置」即可查看 AppID 与 AppSecret；Secret
                  只在创建时完整展示一次，忘了可随时重置。
                </p>
                {/* 辅助入口：识别凭证二维码图片（拍照 / 相册选图，识别成功自动填入并测试接入） */}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    data-testid="qq-bot-scan-camera"
                    disabled={scanBusy || testing}
                    onClick={() => cameraRef.current?.click()}
                    className="flex h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-black/15 text-[13.5px] text-black/70 active:bg-black/[0.03] disabled:opacity-50 dark:border-white/20 dark:text-white/70 dark:active:bg-white/[0.06]"
                  >
                    {scanBusy ? (
                      <Loader2 className="h-[16px] w-[16px] animate-spin" strokeWidth={2.2} aria-hidden="true" />
                    ) : (
                      <ScanLine className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden="true" />
                    )}
                    {scanBusy ? '识别中…' : '拍照识别凭证码'}
                  </button>
                  <button
                    type="button"
                    data-testid="qq-bot-scan-file"
                    disabled={scanBusy || testing}
                    onClick={() => galleryRef.current?.click()}
                    className="flex h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-black/15 text-[13.5px] text-black/70 active:bg-black/[0.03] disabled:opacity-50 dark:border-white/20 dark:text-white/70 dark:active:bg-white/[0.06]"
                  >
                    <ImagePlus className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden="true" />
                    相册 / 截图识别
                  </button>
                </div>
                {/* 隐藏 file input ①：capture 调相机（手机上直接开摄像头扫凭证码） */}
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) void pickQrImage(f);
                    e.target.value = '';
                  }}
                />
                {/* 隐藏 file input ②：相册选图（选完立即复位 value，同一张图可重复选择） */}
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) void pickQrImage(f);
                    e.target.value = '';
                  }}
                />
                {scanMsg && (
                  <p className={`mt-2.5 text-[13px] leading-relaxed ${scanMsg.ok ? 'text-[#34C759]' : 'text-[#F5455C]'}`} data-testid="qq-bot-scan-result">
                    {scanMsg.msg}
                  </p>
                )}
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-black/35 dark:text-white/35">
                  凭证二维码识别（旧方式）：把 AppID/AppSecret 做成二维码（任意二维码生成器，支持「AppID:AppSecret」、JSON、网址查询串三种格式）再拍——识别后自动填入下方输入框并测试接入。
                </p>
              </div>
            )}

            {/* 凭证输入（填写凭证 tab 用：凭证码识别后自动填到这里，也可手动改；官方扫码绑定不经此输入） */}
            <div className="mt-3 overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
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
              className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-[13px] bg-[#0099FF] text-[16px] font-medium text-white shadow-[0_4px_12px_rgba(0,153,255,0.25)] active:opacity-80 disabled:opacity-60"
            >
              {testing && <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.4} aria-hidden="true" />}
              {testing ? '正在测试连接…' : '测试并接入'}
            </button>
          </>
          )
        ) : (
          <>
            {/* ===== 已连接状态卡：绑定角色（头像+名字）+ 机器人名 + 接入时间 + 已接入徽标 ===== */}
            <div className="mt-4 flex items-center gap-3 rounded-[14px] bg-white px-4 py-4 dark:bg-[#1B1C1F]">
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
                <p className="mt-0.5 text-[12px] leading-relaxed text-black/35 dark:text-white/35">
                  {login.boundContactId
                    ? `在真机 QQ 里，TA 就是「${boundName || login.boundContactName || '绑定的角色'}」`
                    : '在下面选一个角色，机器人在真机 QQ 里就是 TA'}
                </p>
              </div>
            </div>

            {/* 绑定/换绑轻提示（4 秒自动消失） */}
            {bindNote && <p className="mt-2 px-1 text-[12.5px] leading-relaxed text-[#34C759]">{bindNote}</p>}

            {/* 云端自动同步状态行：接入/换绑/断开后后台重推运行包的结果（只有部署过云端才会有值） */}
            {lastAutoSync ? (
              <p
                data-testid="qq-bot-autosync"
                className={`mt-2 rounded-[10px] px-3.5 py-2 text-[12px] leading-[1.5] ${
                  lastAutoSync.ok ? 'bg-[#34C759]/[0.08] text-[#2E9E4F]' : 'bg-[#FFF4D6] text-[#8A5A00] dark:bg-[#3B3113] dark:text-[#F0C24B]'
                }`}
              >
                {lastAutoSync.ok
                  ? `${lastAutoSync.msg}（${new Date(lastAutoSync.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）`
                  : lastAutoSync.msg}
              </p>
            ) : null}

            {!login.boundContactId ? (
              /* ===== 段二 · 选择角色（接入成功但未绑定）：网格点选 + 确认绑定 ===== */
              <div className="mt-3 rounded-[14px] bg-white px-4 py-3.5 dark:bg-[#1B1C1F]">
                <p className="text-[12px] font-semibold text-black/40 dark:text-white/40">步骤二 · 选择角色</p>
                <CharPickerGrid chars={chars} selectedId={picked?.id ?? null} onPick={setPicked} />
                <button
                  type="button"
                  data-testid="qq-bot-bind"
                  disabled={!picked}
                  onClick={() => picked && void doBind(picked)}
                  className="mt-4 flex h-[46px] w-full items-center justify-center rounded-[12px] bg-[#0099FF] text-[15px] font-medium text-white shadow-[0_4px_12px_rgba(0,153,255,0.25)] active:opacity-80 disabled:opacity-50"
                >
                  {picked ? `确认绑定「${displayNameOf(picked) || picked.name}」` : '先在上方选择一个角色'}
                </button>
              </div>
            ) : (
              <>
                {/* 更换角色：行入口 → 底部弹层（同段二网格，点选即 bindContact 生效） */}
                <button
                  type="button"
                  onClick={() => setRebindOpen(true)}
                  className="mt-3 flex w-full items-center justify-between gap-3 rounded-[14px] bg-white px-4 py-3 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
                >
                  <span className="text-[15px]">更换角色</span>
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="max-w-[140px] truncate text-[13px] text-black/40 dark:text-white/40">{boundName || '未设置'}</span>
                    <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
                  </span>
                </button>

                {/* 拉取云端聊天记录：云端 Webhook 收到的 QQ 聊天合进手机 QQ 聊天界面 */}
                <button
                  type="button"
                  data-testid="qq-bot-pull"
                  disabled={pulling}
                  onClick={() => void doPull()}
                  className="mt-3 flex h-[46px] w-full items-center justify-center gap-2 rounded-[13px] bg-white text-[15px] font-medium active:bg-black/[0.03] disabled:opacity-60 dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
                >
                  {pulling ? (
                    <Loader2 className="h-[18px] w-[18px] animate-spin text-[#0099FF]" strokeWidth={2.2} aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-[18px] w-[18px] text-[#0099FF]" strokeWidth={2} aria-hidden="true" />
                  )}
                  {pulling ? '正在拉取…' : '拉取云端聊天记录'}
                </button>
                {pullMsg && (
                  <p className={`mt-2 px-1 text-[13px] leading-relaxed ${pullMsg.ok ? 'text-[#34C759]' : 'text-[#F5455C]'}`} data-testid="qq-bot-pull-result">
                    {pullMsg.msg}
                  </p>
                )}

                {/* 提示行：AI 是你自己在 QQ 创建的，本来就在你的 QQ 里（无需再「添加 TA」）；
                    回调地址到 设置 → 云端助手 → QQ Webhook 配置 里复制现成的 */}
                <p className="mt-3 rounded-[10px] bg-black/[0.03] px-3.5 py-3 text-[12.5px] leading-relaxed text-black/50 dark:bg-white/[0.05] dark:text-white/50">
                  TA 就是你自己在 QQ 创建的那个 AI——打开 QQ 找到 TA 直接聊。QQ 官方机器人需在
                  q.qq.com 控制台配置回调地址（设置 → 云端助手 → QQ Webhook 配置 里有现成的可复制）；
                  沙箱/未发布机器人可能需要把自己加进沙箱测试名单。
                </p>
              </>
            )}

            {/* 云端验证凭证：新取凭证端点（api.bot.qq.com）海外可达，本地两路都不通时由云端助手 verify-qq 代验 */}
            {cloudDeployed ? (
              <button
                type="button"
                data-testid="qq-bot-verify-cloud"
                disabled={verifying}
                onClick={() => void verifyViaCloud()}
                className="mt-4 flex h-[46px] w-full items-center justify-center gap-2 rounded-[13px] bg-white text-[15px] font-medium active:bg-black/[0.03] disabled:opacity-60 dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
              >
                {verifying ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin text-[#0099FF]" strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-[18px] w-[18px] text-[#0099FF]" strokeWidth={2} aria-hidden="true" />
                )}
                {verifying ? '正在验证…' : '云端验证凭证'}
              </button>
            ) : (
              <p className="mt-4 px-1 text-[12.5px] leading-relaxed text-black/35 dark:text-white/35" data-testid="qq-bot-verify-hint">
                当前网络连不上 QQ 平台：部署云端后可在这里验证凭证（也可稍后重试「测试连接」）
              </p>
            )}

            {/* 用已存凭证再测一次（网络恢复后可确认连通） */}
            <button
              type="button"
              data-testid="qq-bot-test"
              disabled={testing}
              onClick={() => runTest(login.appId, login.appSecret)}
              className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-[13px] bg-[#0099FF] text-[16px] font-medium text-white shadow-[0_4px_12px_rgba(0,153,255,0.25)] active:opacity-80 disabled:opacity-60"
            >
              {testing && <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.4} aria-hidden="true" />}
              {testing ? '正在测试连接…' : '测试连接'}
            </button>

            {/* 断开接入：删除本机凭证（重新接入再扫一次码即可） */}
            <button
              type="button"
              data-testid="qq-bot-disconnect"
              disabled={testing}
              onClick={() => void disconnect()}
              className="mt-3 flex h-[46px] w-full items-center justify-center rounded-[13px] bg-white text-[15px] font-medium text-[#F5455C] active:bg-black/[0.03] disabled:opacity-50 dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
            >
              断开接入
            </button>
            <p className="mt-3 px-1 text-[12px] leading-relaxed text-black/30 dark:text-white/30">
              断开后凭证从本机删除；重新接入扫一次码（或填写凭证）即可。
            </p>
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

      {/* 更换角色弹层（底部半屏：同段二的选择网格，点选即 bindContact 生效） */}
      {rebindOpen && login && (
        <div
          role="dialog"
          aria-label="更换角色"
          className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40"
          onClick={() => setRebindOpen(false)}
        >
          <div className="max-h-[72%] overflow-y-auto rounded-t-[14px] bg-[#F6F7F9] px-4 pb-8 pt-4 dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()}>
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
            <p className="mt-1 text-[12px] text-black/40 dark:text-white/40">选中即生效；云端需重新同步运行包才会用新人设代答</p>
            <CharPickerGrid chars={chars} selectedId={login.boundContactId ?? null} onPick={(c) => void doRebind(c)} />
          </div>
        </div>
      )}
    </div>
  );
}
