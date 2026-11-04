'use client';

/**
 * 角色状态卡（三端共用：微信 / QQ / 信息）——点击聊天界面的对方头像弹出。
 *
 * - 打开即向后端 /api/character-status 实时生成（每次点击 + 「换一换」都重新请求，
 *   依据：联系人人设 + 最近聊天 + 记忆召回块 + 当前时间 + App 场景），内容随近况变化但不脱离人设；
 * - 卡片字段：心情（颜文字）/ 好感度（数值 + 关系阶段短语）/ 心声 / 动作 / 穿着 / 位置（可选）/ 时间；
 * - 状态卡内容默认不写记忆：只有用户点「存入记忆」才经 memAddEventFragment 落一条事件碎片；
 * - 关闭（遮罩 / X）不影响聊天，不产生任何消息或状态副作用。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookmarkPlus,
  Check,
  Clock,
  CloudOff,
  Footprints,
  Loader2,
  MapPin,
  RefreshCw,
  Shirt,
  X,
} from 'lucide-react';

import { addressNameOf, type ContactRecord } from '@/lib/contacts';
import { useSettings } from '@/lib/ios/store';
import { isLiquidTheme } from '@/lib/ios/bubble-style';
import { getActiveAccountIdFor } from '@/lib/ios/accounts';
import { listContacts, ownerProfileFor } from '@/lib/ios/contacts-store';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { getMemSettings, memAddEventFragment, memRecentConvo, memRecallBlock } from '@/lib/memory';
import { anxietyOf, anxietyLabel, anxietyUnansweredLabel, type AnxietyState } from '@/lib/ios/anxiety';
import { DefaultAvatar } from '@/components/apps/default-avatar';

/** 状态卡数据（与 /api/character-status 返回形状一致） */
interface StatusCard {
  mood: string;
  moodText: string;
  affection: number;
  affectionLabel: string;
  innerVoice: string;
  action: string;
  outfit: string;
  location: string;
}

const APP_LABEL: Record<'wx' | 'qq' | 'sms', string> = { wx: '微信', qq: 'QQ', sms: '短信' };

/** 加载中的随机提示文案（避免每次点开都是同一句） */
const LOAD_TIPS = ['正在整理此刻的状态…', '正在感受当下的心情…', '正在回想你们最近的事…', '正在从回忆里找线索…'];

function fmtDate(d: Date): string {
  try {
    const day = new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      timeZone: 'Asia/Shanghai',
    }).format(d);
    const hm = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }).format(d);
    return `${day} ${hm}`;
  } catch {
    return d.toLocaleString('zh-CN');
  }
}

/** 明细行（图标 + 标签 + 值） */
function StatusRow({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-[3px] h-[14px] w-[14px] shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
      <span className="w-8 shrink-0 text-[12px] leading-[18px] text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] leading-[18px]">{value}</span>
    </div>
  );
}

export default function PeerStatusCard({
  open,
  onClose,
  contact,
  app,
  bondHint,
}: {
  /** 弹层开关（三端各自 state 控制；关闭不影响聊天） */
  open: boolean;
  onClose: () => void;
  /** 对方联系人（完整记录：人设/关系/头像；null 时不出卡） */
  contact: ContactRecord | null;
  /** 当前所在 App（生成上下文与来源标注用） */
  app: 'wx' | 'qq' | 'sms';
  /** 好感锚定提示（QQ 端传密友值/好友天数等；wx/sms 不传） */
  bondHint?: string | null;
}) {
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading');
  const [data, setData] = useState<StatusCard | null>(null);
  /** v51 焦虑值（本地焦虑引擎实时计算，随卡片打开/换一换刷新；与好感度同框展示） */
  const [anx, setAnx] = useState<AnxietyState | null>(null);
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  const [saved, setSaved] = useState(false);
  /** 「换一换」/「重试」计数：变化即重新生成 */
  const [nonce, setNonce] = useState(0);
  const [loadTip] = useState(() => LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)]);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  /** 实时生成：前端组装上下文（人设/最近聊天/记忆/时间/场景）→ POST → 归一化展示 */
  const generate = useCallback(async () => {
    if (!contact) return;
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // 让出同步栈再 setState（effect 内不直接触发渲染更新）
    await Promise.resolve();
    if (seq !== seqRef.current) return;
    setPhase('loading');
    setSaved(false);
    setOpenedAt(new Date());
    // v51 焦虑值：本地引擎读即结算（人设倍率同引擎口径）；随请求下发给后端 → 心情/心声自然反映焦虑
    const anxState = anxietyOf(contact.id, { persona: contact.persona || null });
    setAnx(anxState);
    try {
      const st = useSettings.getState();
      // 机主身份 + 配角圈（NPC 场景）：与聊天人设同口径（v2 多账号：按所在 App 当前账号取「我」）
      const [op, allContacts] = await Promise.all([
        ownerProfileFor(app).catch(() => null),
        listContacts().catch(() => [] as ContactRecord[]),
      ]);
      if (seq !== seqRef.current) return;
      // 机主称呼：恒真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传）
      const realName = op?.realName || '';
      const userName = addressNameOf({ name: realName, realName }, st.addressMode);
      // 最近聊天（kv 快照实时；wx/qq 私聊为空时记忆库自带群聊兜底）
      const convo = memRecentConvo(contact.id, app).slice(-10);
      const recentChats = convo.map((t) => ({ role: t.role === 'me' ? ('user' as const) : ('assistant' as const), text: t.text }));
      const memoryBlock = memRecallBlock(contact.id, app, convo.slice(-4).map((t) => t.text).join(' ')) || '';
      const npcExtra = buildNpcPromptExtra(contact, allContacts);
      const res = await fetch('/api/character-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          // 联系人资料直传（联系人存浏览器本地，服务端不查库；与 /api/phone/proactive 同构）
          contact: {
            name: contact.name,
            kind: contact.kind,
            gender: contact.gender || null,
            age: contact.age || null,
            height: contact.height || null,
            weight: contact.weight || null,
            occupation: contact.occupation || null,
            company: contact.company || null,
            region: contact.region || null,
            relation: contact.relation || null,
            relationByAcc: contact.relationByAcc ?? null,
            relationToUser: contact.relationToUser || null,
            birthday: contact.birthday || null,
            persona: contact.persona || null,
            background: contact.background || null,
            expressStyle: contact.expressStyle || null,
            customRules: contact.customRules ?? null,
            nickname: contact.nickname || null,
            realName: contact.realName ?? null,
            ...(npcExtra ?? {}),
          },
          app,
          recentChats,
          memoryBlock,
          now: fmtDate(new Date()),
          userName: userName || null,
          userRealName: realName || null,
          multiApp: getMemSettings(contact.id).share,
          // v51 焦虑值（本地引擎计算值透传：后端注入【你此刻的焦虑值】让心情/心声贴合）
          anxiety: {
            level: Math.round(anxState.level),
            unansweredMinutes: anxState.lastUserAt > 0 ? Math.round((Date.now() - anxState.lastUserAt) / 60_000) : null,
          },
          // 多账号关系感知：小号下生成状态卡读分账号关系（与机主身份同账号口径）
          accountId: getActiveAccountIdFor(app),
          bondHint: bondHint ?? null,
          // 每次点击都换随机种子：同样的人设/近况两次生成的内容也不同
          seed: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          config: st.apiConfig,
        }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (seq !== seqRef.current) return;
      if (!res.ok || !json || typeof json !== 'object') throw new Error('bad-response');
      setData(json as StatusCard);
      setPhase('ok');
    } catch {
      if (seq !== seqRef.current) return;
      setPhase('error');
    }
  }, [app, bondHint, contact]);

  // 打开即生成；「换一换」/「重试」改变 nonce 再生成；关闭时中断在途请求。
  // setTimeout(0) 让出生命周期同步段（generate 内部首行亦有 await 让步）：关闭竞态时取消未启动的生成
  useEffect(() => {
    if (open && contact) {
      const t = window.setTimeout(() => void generate(), 0);
      return () => window.clearTimeout(t);
    }
    seqRef.current += 1;
    abortRef.current?.abort();
  }, [open, contact, generate, nonce]);

  /** 用户主动把这张状态卡存进记忆（一条事件碎片；重复保存会被记忆库去重合并） */
  const saveToMemory = () => {
    if (!contact || !data || !openedAt) return;
    const peerName = contact.nickname || contact.name;
    const bits = [
      `心情${data.moodText}（${data.mood}）`,
      `对机主的好感约 ${data.affection}/100（${data.affectionLabel}）`,
      ...(anx ? [`此刻焦虑值约 ${Math.round(anx.level)}/100（${anxietyLabel(anx.level)}）`] : []),
      `内心独白：「${data.innerVoice}」`,
      `当时正在${data.action}`,
      data.outfit ? `穿着${data.outfit}` : '',
      data.location ? `人在${data.location}` : '',
    ].filter(Boolean);
    const content = `「${peerName}」（AI角色本人）于${fmtDate(openedAt)}在${APP_LABEL[app]}里被机主查看头像时展现出此刻的状态：${bits.join('；')}。`;
    try {
      memAddEventFragment(contact.id, app, content, { eventTime: openedAt.getTime() });
    } catch {
      // 保存失败静默：记忆写入是增强能力，不弹错误打断
    }
    setSaved(true);
  };

  const peerName = contact ? contact.nickname || contact.name : '';
  const avatarShape = app === 'sms' ? 'rounded-full' : 'rounded-[10px]';
  /** 液态玻璃主题（第四十三轮，参考图）：乳白强模糊玻璃卡 + 玻璃按钮（仅 wx/qq 有主题；sms 恒原生）。
   *  useSettings 必须无条件调用（hooks 规则），主题判定只在使用处分流 */
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const liquid = app !== 'sms' && isLiquidTheme(bubbleStyle, app);

  return (
    <AnimatePresence>
      {open && contact && (
        <motion.div
          key="peer-status-mask"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          data-testid="peer-status-card"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 14 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={
              liquid
                ? /* 液态：乳白强模糊玻璃卡（顶缘高光带 + 超大圆角） */ 'lg-sheet w-full max-w-[320px] overflow-hidden rounded-[24px]'
                : 'w-full max-w-[320px] overflow-hidden rounded-[20px] border border-border/60 bg-background/95 shadow-2xl backdrop-blur-xl'
            }
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`${peerName}的状态卡`}
          >
            {/* 头部：头像 + 名字 + 关闭（v51：按用户要求删除「微信/QQ/信息」渠道前缀，只留「此刻状态」） */}
            <div className="flex items-center gap-3 px-4 pt-4">
              {contact.avatar ? (
                <img src={contact.avatar} alt={peerName} className={`h-12 w-12 shrink-0 object-cover ${avatarShape}`} />
              ) : (
                <div className={avatarShape}>
                  <DefaultAvatar size={48} shape={app === 'sms' ? 'circle' : 'square'} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold leading-tight">{peerName}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {liquid && (
                    <span aria-hidden="true" className="relative flex h-[7px] w-[7px]">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[#07C160] opacity-40 animate-ping" />
                      <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-[#07C160]" />
                    </span>
                  )}
                  <span>此刻状态</span>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                data-testid="peer-status-close"
                onClick={onClose}
                className={
                  liquid
                    ? 'lg-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-black/70 active:opacity-60 dark:text-white/70'
                    : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground active:opacity-70'
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 主体：生成中 / 生成失败 / 成功内容 */}
            {phase === 'loading' && (
              <div className="flex min-h-[300px] flex-col items-center justify-center gap-3" data-testid="peer-status-loading">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                <span className="text-[13px] text-muted-foreground">{loadTip}</span>
              </div>
            )}
            {phase === 'error' && (
              <div className="flex min-h-[300px] flex-col items-center justify-center gap-3" data-testid="peer-status-error">
                <CloudOff className="h-7 w-7 text-muted-foreground/70" aria-hidden="true" />
                <span className="text-[13px] text-muted-foreground">状态获取失败，请重试</span>
                <button
                  type="button"
                  data-testid="peer-status-retry"
                  onClick={() => setNonce((n) => n + 1)}
                  className="rounded-full bg-foreground px-4 py-1.5 text-[13px] font-medium text-background active:opacity-80"
                >
                  重试
                </button>
              </div>
            )}
            {phase === 'ok' && data && (
              <>
                <div className="thin-scrollbar max-h-[400px] overflow-y-auto px-4 pb-1 pt-3">
                  {/* 心情：颜文字 + 短评 */}
                  <div className="flex items-center gap-3" data-testid="peer-status-mood">
                    <span className="text-[30px] leading-none">{data.mood}</span>
                    <span className="text-[13px] text-muted-foreground">{data.moodText}</span>
                  </div>
                  {/* 好感度：数值 + 关系阶段 + 进度条 */}
                  <div className="mt-4" data-testid="peer-status-affection">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-medium text-muted-foreground">好感度</span>
                      <span className="text-[12px]">
                        <span className="font-semibold tabular-nums">{data.affection}</span>
                        <span className="text-muted-foreground"> · {data.affectionLabel}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <motion.div
                        className="h-full rounded-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${data.affection}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                  {/* 焦虑值（v51）：本地焦虑引擎实时计算——用户久久未回复，TA 越来越坐立不安；达到阈值会主动发消息 */}
                  {anx && (
                    <div className="mt-3" data-testid="peer-status-anxiety">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[11px] font-medium text-muted-foreground">焦虑值</span>
                        <span className="text-[12px]">
                          <span className="font-semibold tabular-nums">{Math.round(anx.level)}</span>
                          <span className="text-muted-foreground"> · {anxietyLabel(anx.level)}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          className="h-full rounded-full bg-[#FF9500]"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.round(anx.level)}%` }}
                          transition={{ duration: 0.5, ease: 'easeOut' }}
                        />
                      </div>
                      <p className="mt-1 text-[10.5px] leading-none text-muted-foreground/80">{anxietyUnansweredLabel(anx)} · 超过阈值会忍不住主动找你</p>
                    </div>
                  )}
                  {/* 心声（液态 = 内嵌玻璃胶囊） */}
                  <div
                    className={liquid ? 'lg-input mt-4 rounded-[16px] p-3' : 'mt-4 rounded-xl bg-muted/50 p-3'}
                    data-testid="peer-status-inner-voice"
                  >
                    <div className="text-[11px] font-medium text-muted-foreground">心声</div>
                    <p className="mt-1 text-[13px] leading-relaxed">{data.innerVoice}</p>
                  </div>
                  {/* 动作 / 穿着 / 位置（可选）/ 时间 */}
                  <div className="mt-3.5 space-y-2.5 pb-1">
                    <StatusRow icon={Footprints} label="动作" value={data.action} />
                    {data.outfit && <StatusRow icon={Shirt} label="穿着" value={data.outfit} />}
                    {data.location && <StatusRow icon={MapPin} label="位置" value={data.location} />}
                    {openedAt && <StatusRow icon={Clock} label="时间" value={fmtDate(openedAt)} />}
                  </div>
                </div>
                {/* 底部操作：换一换（重新生成）/ 存入记忆（用户主动才写入）；液态 = 玻璃胶囊 + 深色玻璃主钮 */}
                <div className={liquid ? 'flex items-center gap-2.5 px-4 pb-4 pt-1' : 'flex items-center gap-2 border-t border-border/60 px-4 py-3'}>
                  <button
                    type="button"
                    data-testid="peer-status-refresh"
                    onClick={() => setNonce((n) => n + 1)}
                    className={
                      liquid
                        ? 'lg-chip flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-medium text-black/85 transition-transform active:scale-[0.97] dark:text-white/85'
                        : 'flex flex-1 items-center justify-center gap-1.5 rounded-full bg-muted py-2 text-[13px] font-medium active:opacity-70'
                    }
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    换一换
                  </button>
                  <button
                    type="button"
                    data-testid="peer-status-save"
                    disabled={saved}
                    onClick={saveToMemory}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-medium active:opacity-70 ${
                      liquid
                        ? saved
                          ? 'bg-black/10 text-black/45 dark:bg-white/10 dark:text-white/45'
                          : 'bg-black/85 text-white shadow-[0_4px_14px_rgba(0,0,0,0.25)] dark:bg-white/90 dark:text-black'
                        : saved
                          ? 'bg-muted/60 text-muted-foreground'
                          : 'bg-foreground text-background'
                    }`}
                  >
                    {saved ? (
                      <>
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        已存入记忆
                      </>
                    ) : (
                      <>
                        <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        存入记忆
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
