'use client';

// 语音唤起智能体（C1）：唤醒状态行 WakeStatusRow、设置卡 AgentVoiceCard 与独立页 AgentVoicePage；AutonomySwitch 开关控件。

import { useState } from 'react';

import {
  AudioLines,
  Check,
  ChevronDown,
  CircleDot,
  Ear,
  Fingerprint,
  MessagesSquare,
  Mic,
  RefreshCw,
  Repeat,
  Smile,
  Sparkles,
  Volume2,
} from 'lucide-react';

import { useSettings } from '@/lib/ios/store';

import { Input } from '@/components/ui/input';

import { Textarea } from '@/components/ui/textarea';

import { isNativePerception } from '@/lib/ios/native-perception';

// C1 语音唤起智能体（v1.9.3 独立设置页：唤醒名 / 悬浮球 / 连续监听）
import {
  DEFAULT_WAKE_NAME,
  retryAgentWake,
  updateAgentVoiceCfg,
  useAgentVoice,
  useWakeDiag,
  type WakeDiagChannel,
} from '@/lib/ios/agent-voice';

import { ASSISTANT_PERSONA_TAGLINE } from '@/lib/ios/assistant-persona';

// C4 播报开关提示用：判断 TTS 是否已配置（内置语音恒可用，第三方需 Key+地址）
import {
  isTtsConfigured,
  speakUserTts,
  stopSpeaking,
} from '@/lib/ios/tts-client';

import { useOfflineAsr } from '@/lib/ios/offline-asr';

import {
  BUILTIN_TTS_VOICES,
  isBuiltinVoiceId,
  speakBuiltin,
} from '@/lib/ios/builtin-voices';

import {
  describeVoiceId,
  useMyVoices,
} from '@/lib/ios/my-voices';

import {
  LineIcon,
  DetailShell,
} from './shared';

import { OfflineAsrDownloadInline } from './voice';


// ---------------- AI 动手开关控件（v1.9.38：权限给予页开关组已下线，能力恒开；仅语音唤起智能体等页面复用） ----------------

/** iOS 原生 51×31 大开关（与飞行模式/状态栏同款；开启态 #34C759 绿） */
export function AutonomySwitch({ on, onToggle, label, testId }: { on: boolean; onToggle: () => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={onToggle}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
        on ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/25'
      }`}
    >
      <span
        className={`pointer-events-none absolute left-[2px] top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
          on ? 'translate-x-[20px]' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ---------------- C1 语音唤起智能体（AI 动手页内设置卡） ----------------

/** 唤醒通道 → 人话标签（诊断行展示用） */
export const WAKE_CHANNEL_LABEL: Record<WakeDiagChannel, string> = {
  offline: '端侧离线识别',
  'server-vad': '服务端识别',
  'web-speech': '浏览器实时识别',
  none: '不可用',
};

/**
 * 唤醒监听状态行（v1.8.2 诊断）：喊名没反应时一眼定位卡在哪一环——
 * 监听中显示当前通道 + 最近听到的转写（能看到 TA 到底听见了什么）；
 * 熔断/全不可用显示原因并提供「重试」按钮（清熔断 + 立即重建唤醒循环）；
 * 当前走「服务端识别」且端侧模型未就绪时内嵌一键下载入口（Task 1-a，共用
 * OfflineAsrDownloadInline）：下载完成 useOfflineAsr.status→ready，唤醒循环自动
 * 切回端侧离线识别（零流量零延迟、断网可用），通道标签随之变为「端侧离线识别」。
 */
export function WakeStatusRow({ name }: { name: string }) {
  const diag = useWakeDiag();
  const blocked = useAgentVoice((s) => s.wakeBlocked);
  const asrStatus = useOfflineAsr((s) => s.status);
  let dot = 'bg-emerald-500';
  let text = `正在监听「${name}」· ${WAKE_CHANNEL_LABEL[diag.channel]}`;
  if (blocked) {
    dot = 'bg-[#FF9500]';
    text = '喊名唤醒已暂停 · 每 40 秒自动重试';
  } else if (!diag.listening) {
    dot = 'bg-muted-foreground/40';
    text = diag.lastError || '唤醒监听启动中…';
  } else if (diag.paused) {
    dot = 'bg-muted-foreground/40';
    text = '已暂时静音（会话/通话/朗读中），空闲自动恢复';
  }
  const degraded = diag.listening && diag.server === 'fail';
  // 一键引导：唤醒正走服务端识别（每次说话都要上传、受上游波动影响）且端侧模型未就绪时展示；
  // 下载中/失败重试态也展示（进度条/重试按钮在共用控件内），就绪后随通道切换自然消失
  const showModelGuide =
    diag.channel === 'server-vad' && (asrStatus === 'not-downloaded' || asrStatus === 'downloading' || asrStatus === 'error');
  return (
    <div className="flex min-h-[46px] items-center gap-3 px-4 py-2" data-testid="agent-voice-wake-status">
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${dot} ${diag.listening && !diag.paused && !blocked ? 'animate-pulse' : ''}`}
          />
          <span className="truncate text-[13px] text-foreground/90" data-testid="agent-voice-wake-status-text">
            {text}
          </span>
        </span>
        {diag.lastText ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" data-testid="agent-voice-wake-last-text">
            最近听到：{diag.lastText}
          </span>
        ) : null}
        {degraded && !blocked ? (
          <span className="mt-0.5 block truncate text-[11px] text-[#FF9500]">识别服务波动：已自动换通道重试，喊名可能暂时不灵</span>
        ) : null}
        {showModelGuide ? (
          <div className="mt-1.5 border-t border-black/[0.05] pt-2 dark:border-white/[0.08]">
            <OfflineAsrDownloadInline
              label="下载离线识别模型（喊名零流量零延迟，断网可用）"
              hint="下载完成后喊名自动切回端侧识别，不再上传音频（约 229MB，仅一次）"
            />
          </div>
        ) : null}
      </div>
      {blocked || !diag.listening ? (
        <button
          type="button"
          onClick={retryAgentWake}
          data-testid="agent-voice-wake-retry"
          className="flex h-8 shrink-0 items-center rounded-full bg-foreground/90 px-3 text-[12px] text-background transition active:scale-95"
        >
          重试
        </button>
      ) : null}
    </div>
  );
}

/**
 * 「语音唤起智能体」卡（v1.9.3 起独立成设置页「语音唤起智能体」，不再嵌入 AI 动手页）：
 * 专属人设说明行（小灵，名字跟随唤醒名）/ 唤醒名（≤6 字）/
 * 悬浮球开关 / 连续唤醒监听开关（带耗电提示）/ 唤醒状态诊断行（v1.8.2）/
 * C4 执行结果语音播报开关（默认关）/ C4 任务后追问窗口开关（默认开）/
 * 连续对话开关（Siri 式一问一答：播报完自动续听 + 说话即打断，默认开）。
 * 配置存 agent-voice-wake-v1（localStorage 单键 + zustand 镜像），悬浮球即时生效；
 * 连续监听三通道自愈路由（离线端侧 → VAD+服务端识别 → Web Speech），喊名没反应时
 * 状态行直接给出答案（哪个通道/最近听到什么/为什么暂停）；
 * 播报开着但 TTS 未配置（第三方服务商缺 Key/地址）时下方提示「将静默跳过」。
 */
export function AgentVoiceCard() {
  const cfg = useAgentVoice((s) => s.cfg);
  const wakeBlocked = useAgentVoice((s) => s.wakeBlocked);
  const asrStatus = useOfflineAsr((s) => s.status);
  const ttsCfg = useSettings((s) => s.ttsConfig);
  const nativeMode = isNativePerception();
  // 唤醒名输入草稿：失焦才落盘（≤6 字，清空回默认「小灵」）。
  // 本卡是 cfg.name 的唯一写入方（提交后草稿即等于新值），无需 effect 反向同步草稿
  const [nameDraft, setNameDraft] = useState(cfg.name);
  const commitName = () => {
    const t = nameDraft.trim().slice(0, 6);
    if (t === cfg.name) return;
    updateAgentVoiceCfg({ name: t || DEFAULT_WAKE_NAME });
    setNameDraft(t || DEFAULT_WAKE_NAME);
  };

  // ---- v1.9.13 机主称呼（「你希望 TA 叫你什么」）：失焦落盘（≤8 字，可留空） ----
  const [ownerDraft, setOwnerDraft] = useState(cfg.ownerTitle);
  const commitOwnerTitle = () => {
    const t = ownerDraft.trim().slice(0, 8);
    if (t === cfg.ownerTitle) return;
    updateAgentVoiceCfg({ ownerTitle: t });
    setOwnerDraft(t);
  };

  // ---- v1.9.13 自定义人设（可编辑）：专属人设行点开展开编辑器，保存/恢复默认 ----
  const personaCustom = cfg.persona.trim().length > 0;
  const [personaOpen, setPersonaOpen] = useState(false);
  const [personaDraft, setPersonaDraft] = useState<string | null>(null);
  const savePersona = () => {
    if (personaDraft === null) return;
    updateAgentVoiceCfg({ persona: personaDraft.slice(0, 500) });
    setPersonaDraft(null);
  };

  // ---- 助手音色（v1.8）：TA 说话的声音（跟随全局/内置声线/我的音色），展开式选择器 + 试听 ----
  const myVoices = useMyVoices((s) => s.voices);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  interface AssistantVoiceOpt {
    key: string;
    voiceId: string;
    name: string;
    sub: string;
  }
  const voiceOpts: AssistantVoiceOpt[] = [
    { key: 'follow', voiceId: '', name: '跟随语音 API 默认', sub: '用「语音 API」里设置的默认音色' },
    ...BUILTIN_TTS_VOICES.map((v) => ({ key: v.id, voiceId: v.id, name: `${v.name}（${v.label}）`, sub: '内置声线 · 免费离线' })),
    ...myVoices.map((v) => ({ key: v.id, voiceId: v.voiceId, name: v.name, sub: '我的音色' })),
  ];
  /** 试听：内置声线走本地引擎；其它走当前语音 API（显式 voiceId 优先级最高） */
  const previewAssistantVoice = (voiceId: string) => {
    stopSpeaking();
    if (previewingVoice) {
      setPreviewingVoice(null);
      if (previewingVoice === voiceId) return;
    }
    setPreviewingVoice(voiceId);
    const done = () => setPreviewingVoice(null);
    if (isBuiltinVoiceId(voiceId)) {
      void speakBuiltin({ text: '你好，选这个声音和我聊天吧。', voiceId, onEnd: done, onError: done }).catch(done);
      return;
    }
    void speakUserTts({ text: '你好，选这个声音和我聊天吧。', voiceId }).then(done, done);
  };

  const asrNotReady = asrStatus !== 'ready';

  return (
    <>
      {/* v1.9.3：独立设置页（标题走 DetailShell 导航栏），卡片直接紧跟内容区；
          v1.9.13：卡片左右延伸（mx-4→mx-1，DetailShell px-4 内不再双重缩进），图标改黑白线条 */}
      <div
        className="mx-1 mt-2 overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]"
        data-testid="settings-agent-voice-card"
      >
        {/* 一行说明（v1.9.41 精简） */}
        <div className="flex items-start gap-3 px-4 pt-3">
          <LineIcon icon={Sparkles} />
          <p className="min-w-0 flex-1 pb-1 text-[11.5px] leading-relaxed text-muted-foreground">
            喊唤醒名或点悬浮球，随时唤起 TA——能聊也能帮你办事
          </p>
        </div>
        <div className="mt-1 divide-y divide-black/[0.05] dark:divide-white/[0.06]">
          {/* 专属人设（v1.9.13 可编辑：点开展开编辑器，自定义性格与说话方式；空 = 内置默认） */}
          <div>
            <button
              type="button"
              className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left"
              onClick={() => setPersonaOpen((v) => !v)}
              aria-expanded={personaOpen}
              data-testid="agent-voice-persona-row"
            >
              <LineIcon icon={Fingerprint} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px]">专属人设</span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                  {personaCustom ? cfg.persona.trim().slice(0, 40) : ASSISTANT_PERSONA_TAGLINE}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
                  personaCustom
                    ? 'bg-[#007AFF]/10 text-[#007AFF] dark:text-[#64B5FF]'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                }`}
                data-testid="agent-voice-persona-badge"
              >
                {personaCustom ? '已自定义' : cfg.name || DEFAULT_WAKE_NAME}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform ${personaOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            {personaOpen ? (
              <div className="bg-black/[0.02] px-4 pb-3 dark:bg-white/[0.03]">
                <p className="pt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  写下你想要的性格与说话方式，留空保存 = 恢复默认。
                </p>
                <Textarea
                  value={personaDraft ?? cfg.persona}
                  onChange={(e) => setPersonaDraft(e.target.value)}
                  maxLength={500}
                  placeholder={`留空用内置默认：${ASSISTANT_PERSONA_TAGLINE}`}
                  aria-label="自定义人设"
                  className="mt-2 min-h-28 text-[13px] leading-relaxed"
                  data-testid="agent-voice-persona-input"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={savePersona}
                    disabled={personaDraft === null}
                    className="rounded-full bg-[#007AFF] px-4 py-[6px] text-[11.5px] font-medium text-white transition-colors active:bg-[#0066D6] disabled:opacity-40"
                    data-testid="agent-voice-persona-save"
                  >
                    保存人设
                  </button>
                  {personaDraft !== null ? (
                    <button
                      type="button"
                      onClick={() => setPersonaDraft(null)}
                      className="flex items-center gap-1 rounded-full bg-black/[0.05] px-3 py-[6px] text-[11.5px] font-medium text-foreground/70 transition-colors active:bg-black/[0.08] dark:bg-white/10 dark:text-muted-foreground"
                    >
                      取消编辑
                    </button>
                  ) : null}
                  {personaCustom && personaDraft === null ? (
                    <button
                      type="button"
                      onClick={() => updateAgentVoiceCfg({ persona: '' })}
                      className="flex items-center gap-1 rounded-full bg-black/[0.05] px-3 py-[6px] text-[11.5px] font-medium text-foreground/70 transition-colors active:bg-black/[0.08] dark:bg-white/10 dark:text-muted-foreground"
                      data-testid="agent-voice-persona-reset"
                    >
                      <RefreshCw className="h-3 w-3" />
                      恢复默认
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          {/* 唤醒名 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={Mic} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">唤醒名</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">喊出即唤起，也是 TA 的名字</span>
            </span>
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              maxLength={6}
              placeholder={DEFAULT_WAKE_NAME}
              inputMode="text"
              aria-label="唤醒名"
              className="h-9 w-28 shrink-0 text-right"
              data-testid="agent-voice-name-input"
            />
          </div>
          {/* v1.9.13 机主称呼（「你希望 TA 叫你什么」）：有值时 TA 会这样叫你；留空沿用联系人机主名 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={Smile} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">TA 怎么称呼你</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">对话里 TA 会这样称呼你（可不填）</span>
            </span>
            <Input
              value={ownerDraft}
              onChange={(e) => setOwnerDraft(e.target.value)}
              onBlur={commitOwnerTitle}
              maxLength={8}
              placeholder="随口称呼"
              inputMode="text"
              aria-label="TA 怎么称呼你"
              className="h-9 w-28 shrink-0 text-right"
              data-testid="agent-voice-owner-title-input"
            />
          </div>
          {/* 助手音色（v1.8）：TA 说话用的声音 */}
          <div>
            <button
              type="button"
              className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left"
              onClick={() => setVoiceOpen((v) => !v)}
              aria-expanded={voiceOpen}
              data-testid="agent-voice-voice-row"
            >
              <LineIcon icon={AudioLines} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px]">助手音色</span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">TA 说话用的声音</span>
              </span>
              <span className="shrink-0 text-[13px] text-muted-foreground" data-testid="agent-voice-voice-value">
                {cfg.voice ? describeVoiceId(cfg.voice, myVoices) : '跟随语音 API 默认'}
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform ${voiceOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {voiceOpen ? (
              <div className="bg-black/[0.02] px-4 pb-3 dark:bg-white/[0.03]">
                <p className="pt-1.5 text-[11px] leading-relaxed text-muted-foreground">点选音色 · 点右侧喇叭试听</p>
                <div className="thin-scrollbar mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {voiceOpts.map((opt) => {
                    const active = cfg.voice === opt.voiceId;
                    const canPreview = opt.voiceId !== '';
                    return (
                      <div
                        key={opt.key}
                        role="button"
                        tabIndex={0}
                        aria-pressed={active}
                        data-testid={`agent-voice-opt-${opt.key}`}
                        onClick={() => updateAgentVoiceCfg({ voice: opt.voiceId })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            updateAgentVoiceCfg({ voice: opt.voiceId });
                          }
                        }}
                        className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-[14px] px-3 py-1.5 transition-all ${
                          active ? 'bg-white/85 ring-1 ring-black/[0.06] dark:bg-white/[0.12] dark:ring-white/[0.14]' : 'bg-white/45 ring-1 ring-transparent hover:bg-white/70 dark:bg-white/[0.05] dark:hover:bg-white/[0.09]'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">{opt.name}</span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">{opt.sub}</span>
                        </span>
                        {canPreview ? (
                          <button
                            type="button"
                            aria-label={`试听${opt.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              previewAssistantVoice(opt.voiceId);
                            }}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                              previewingVoice === opt.voiceId ? 'bg-foreground text-background' : 'bg-white/70 text-muted-foreground ring-1 ring-black/[0.05] active:bg-white/90 dark:bg-white/[0.09] dark:ring-white/[0.1]'
                            }`}
                          >
                            <AudioLines className={`h-3.5 w-3.5 ${previewingVoice === opt.voiceId ? 'animate-pulse' : ''}`} aria-hidden="true" />
                          </button>
                        ) : null}
                        {active ? <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" /> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          {/* 悬浮球 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={CircleDot} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">悬浮球</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">屏幕右缘小球，点按说话下发任务</span>
            </span>
            <AutonomySwitch
              on={cfg.ball}
              onToggle={() => updateAgentVoiceCfg({ ball: !cfg.ball })}
              label="悬浮球"
              testId="agent-voice-ball-switch"
            />
          </div>
          {/* 连续唤醒监听 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={Ear} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">连续唤醒监听</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                后台听着唤醒名，喊出即唤起（略增耗电）
              </span>
            </span>
            <AutonomySwitch
              on={cfg.listen}
              onToggle={() => updateAgentVoiceCfg({ listen: !cfg.listen })}
              label="连续唤醒监听"
              testId="agent-voice-listen-switch"
            />
          </div>
          {/* 唤醒状态（v1.8.2 诊断行）：监听开着才展示——通道/最近听到/异常，喊名没反应一眼定位 */}
          {cfg.listen ? <WakeStatusRow name={cfg.name || DEFAULT_WAKE_NAME} /> : null}
          {/* C4 执行结果语音播报 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={Volume2} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">执行结果语音播报</span>
              <span className="mt-0.5 block truncate text-[11.5px] leading-snug text-muted-foreground">
                任务完成后朗读结果
              </span>
            </span>
            <AutonomySwitch
              on={cfg.announce}
              onToggle={() => updateAgentVoiceCfg({ announce: !cfg.announce })}
              label="执行结果语音播报"
              testId="agent-voice-announce-switch"
            />
          </div>
          {/* C4 任务后追问窗口 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={MessagesSquare} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">任务后追问窗口</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                任务说完可接着说下一个，无需再喊名
              </span>
            </span>
            <AutonomySwitch
              on={cfg.followup}
              onToggle={() => updateAgentVoiceCfg({ followup: !cfg.followup })}
              label="任务后追问窗口"
              testId="agent-voice-followup-switch"
            />
          </div>
          {/* 连续对话（Siri 式一问一答）：播报完自动续听 + 播报中说话即打断 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <LineIcon icon={Repeat} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">连续对话</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                回答后自动继续听，说话即打断
              </span>
            </span>
            <AutonomySwitch
              on={cfg.contChat}
              onToggle={() => updateAgentVoiceCfg({ contChat: !cfg.contChat })}
              label="连续对话"
              testId="agent-voice-contchat-switch"
            />
          </div>
        </div>
      </div>
      {/* 状态提示行（v1.9.41 精简：只在异常时给一行短提示） */}
      {!nativeMode ? (
        <p className="mx-4 mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          浏览器里同样能喊名或点球唤起（需允许麦克风）；真机任务只在 APP 内。
        </p>
      ) : null}
      {cfg.listen && nativeMode && asrNotReady ? (
        <p className="mx-4 mt-2 text-[11.5px] leading-relaxed text-[#FF9500]">
          离线识别模型未就绪：喊名暂走在线识别（需联网）——点上方「唤醒状态」一键下载后，断网也能唤醒。
        </p>
      ) : null}
      {/* C4：播报开着但 TTS 未配置（第三方缺 Key/地址）——提醒会静默跳过 */}
      {cfg.announce && !isTtsConfigured(ttsCfg) ? (
        <p className="mx-4 mt-2 text-[11.5px] leading-relaxed text-[#FF9500]">
          未配置语音 API：播报将静默跳过（设置 › 语音 API）。
        </p>
      ) : null}
      {wakeBlocked ? (
        <p className="mx-4 mt-2 text-[11.5px] leading-relaxed text-[#FF3B30]" role="alert">
          {wakeBlocked}
        </p>
      ) : null}
    </>
  );
}

/**
 * 「语音唤起智能体」独立设置页（v1.9.3）：从 AI 动手页拆出，主列表「AI 感知与操控」
 * 分组独立入口直达；页内容复用 AgentVoiceCard（唤醒名/音色/悬浮球/监听/播报等）。
 */
export function AgentVoicePage({ onBack }: { onBack: () => void }) {
  return (
    <DetailShell title="语音助手" onBack={onBack} gray>
      <AgentVoiceCard />
    </DetailShell>
  );
}
