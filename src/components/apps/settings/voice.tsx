'use client';

// 语音 API（TTS）页 VoicePage + TTS_PROVIDER_PRESETS + 离线识别下载组件（OfflineAsrDownloadInline / OfflineAsrSection，唤醒状态行复用）。

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  AlertCircle,
  AudioLines,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  MessageSquareText,
  Plus,
  Trash2,
  Type,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';

import { useSettings } from '@/lib/ios/store';

import { Input } from '@/components/ui/input';

import { Switch } from '@/components/ui/switch';

import {
  directFetchModels,
  isPrivateApiUrl,
} from '@/lib/ios/direct-api';

import { isWebSpeechSupported } from '@/lib/ios/web-speech';

import {
  deleteOfflineModel,
  initOfflineAsr,
  useOfflineAsr,
} from '@/lib/ios/offline-asr';

import {
  LocalToast,
  useLocalToast,
} from '../page-toast';

import {
  BUILTIN_TTS_VOICES,
  isBuiltinVoiceId,
  isBuiltinVoiceSupported,
  speakBuiltin,
  stopBuiltinSpeech,
} from '@/lib/ios/builtin-voices';

import { useMyVoices } from '@/lib/ios/my-voices';

import {
  IOS_RED,
  TONE_ORANGE,
  TONE_BLUE,
  TONE_GREEN,
  TONE_CYAN,
  DetailShell,
  FieldLabel,
  SectionLabel,
} from './shared';


// ---------------- 语音 API（TTS） ----------------

/** 服务商预设值（切换服务商时地址/模型名联动，用户仍可改）；模型 chips 含常见第三方 OpenAI 兼容 TTS 模型，拉不到列表时也可直接点选；
 *  Fish Audio 无需模型名（reference_id 即音色），modelChips 留空 */
export const TTS_PROVIDER_PRESETS = {
  minimax: { baseUrl: 'https://api.minimax.chat', model: 'speech-01-turbo', modelChips: ['speech-01-turbo', 'speech-01-hd', 'speech-02-turbo', 'speech-02-hd'] },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'tts-1', modelChips: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'qwen-tts-latest', 'FunAudioLLM/CosyVoice2-0.5B'] },
  fishaudio: { baseUrl: 'https://fishaudio.org/v1', model: '', modelChips: [] as readonly string[] },
} as const;

/** 拉取不到模型列表时的降级提示（语音合成语境，区别于聊天 API 的提示文案） */
export const TTS_MODEL_MANUAL_HINT = '该服务商未提供模型列表接口；不需要模型的服务商留空即可，需要的可从下方常用模型点选或手动填写。';

/**
 * 语音 API 设置页（与聊天 API / 识图 API 相互独立、互不覆盖）：
 * - 服务商：内置语音（免费）/ MiniMax / OpenAI 兼容 / Fish Audio；连接配置即改即存（更改自动保存，下一次播放即生效，无需重启）
 * - 多服务商分槽（Task 29）：切换服务商时快照当前家、恢复目标家（MiniMax 等已有 Key/GroupId/模型/默认音色互不覆盖）
 * - 内置语音：浏览器本地引擎（Web Speech），内置 3 女 3 男共 6 个声线，零配置免 API、离线可用，逐个可试听
 * - 全局默认音色（并入连接配置卡片，无独立区块）：角色未设独立 voiceId 时使用（聊天设置「他的声音」可给角色单独设音色；音色 ID 手动填写）
 * - 试听：用当前配置合成一句样例直接播放
 */
export function VoicePage({ onBack }: { onBack: () => void }) {
  const ttsConfig = useSettings((s) => s.ttsConfig);
  const updateTtsConfig = useSettings((s) => s.updateTtsConfig);
  const switchTtsProvider = useSettings((s) => s.switchTtsProvider);
  // 语音识别（STT）独立配置：与 TTS 互不覆盖
  const sttConfig = useSettings((s) => s.sttConfig);
  const updateSttConfig = useSettings((s) => s.updateSttConfig);
  // Web Speech API 支持检测：只在客户端测一次（避免 SSR 水合不一致）
  const [wsSupport, setWsSupport] = useState<boolean | null>(null);
  useEffect(() => {
    // 客户端能力检测（SSR 无 window，只能挂载后测）：一次性回填，非级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWsSupport(isWebSpeechSupported());
  }, []);

  const [showKey, setShowKey] = useState(false);
  const [showSttKey, setShowSttKey] = useState(false);

  // 模型列表拉取（与聊天/识图 API 的「拉取模型」同款体验）
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');
  const [ttsModels, setTtsModels] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [modelPanelOpen, setModelPanelOpen] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  /** 试听 ObjectURL 回收（内存：原先每次试听都 new Audio(URL.createObjectURL(blob))
   *  且从不 revoke——听一次泄漏一个 blob URL；改从 audio.src 取回统一回收） */
  const revokePreviewSrc = (audio: HTMLAudioElement | null): void => {
    const src = audio?.src;
    if (src && src.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(src);
      } catch {
        /* 忽略 */
      }
    }
  };

  const isMinimax = ttsConfig.provider === 'minimax';
  const isFish = ttsConfig.provider === 'fishaudio';
  const isTtsOpenai = ttsConfig.provider === 'openai';
  const isBuiltin = ttsConfig.provider === 'builtin';
  const preset = TTS_PROVIDER_PRESETS[ttsConfig.provider as 'minimax' | 'openai' | 'fishaudio'];

  // 内置声线逐个试听状态（在播的声线 id）
  const [previewingBuiltinId, setPreviewingBuiltinId] = useState<string | null>(null);
  // 内置引擎支持检测（客户端一次性）
  const [builtinSupport, setBuiltinSupport] = useState<boolean | null>(null);
  useEffect(() => {
    // 客户端能力检测（SSR 无 window，只能挂载后测）：一次性回填，非级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBuiltinSupport(isBuiltinVoiceSupported());
  }, []);

  // 页面卸载：停掉试听音频并释放
  useEffect(
    () => () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        revokePreviewSrc(previewAudioRef.current);
        previewAudioRef.current = null;
      }
      stopBuiltinSpeech();
    },
    []
  );

  const switchProvider = (p: 'builtin' | 'minimax' | 'openai' | 'fishaudio') => {
    if (p === ttsConfig.provider) return;
    // 多服务商分槽（Task 29）：store 内快照当前家连接配置进本家槽位 → 恢复目标家槽位
    // （MiniMax 等已有 Key/GroupId/模型/默认音色互不覆盖；首次切换填该家默认值）
    switchTtsProvider(p);
    stopBuiltinSpeech();
    setPreviewingBuiltinId(null);
    setModelsError('');
    setModelsHint('');
    setModelPanelOpen(false);
    setProviderTestError('');
    setProviderTestOk(false);
  };

  /** TTS 相关模型排前（tts/speech/audio/voice 命中），其余模型排后仍可选 */
  const applyTtsModels = (list: string[]) => {
    const isTts = (m: string) => /tts|speech|audio|voice/i.test(m);
    const sorted = [...list].sort((a, b) => Number(isTts(b)) - Number(isTts(a)) || a.localeCompare(b));
    setTtsModels(sorted);
    setModelQuery('');
    setModelPanelOpen(true);
  };

  const fetchTtsModels = async () => {
    if (!ttsConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: ttsConfig.baseUrl, apiKey: ttsConfig.apiKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | { models?: string[]; hint?: string; error?: string; url?: string; directOnly?: boolean }
        | null;
      // 内网地址或服务器不可达/地区限制（directOnly）：改用浏览器直连拉取
      if (!data || data.directOnly || (data.error && isPrivateApiUrl(ttsConfig.baseUrl))) {
        const direct = await directFetchModels(ttsConfig.baseUrl, ttsConfig.apiKey);
        if (direct.error) {
          const serverMsg = typeof data?.error === 'string' ? data.error : '';
          setModelsError(
            serverMsg && !isPrivateApiUrl(ttsConfig.baseUrl)
              ? `${serverMsg}；浏览器直连也不可用：${direct.error}`
              : direct.error
          );
          return;
        }
        if (direct.hint && direct.models.length === 0) {
          setModelsHint(TTS_MODEL_MANUAL_HINT);
          return;
        }
        applyTtsModels(direct.models);
        return;
      }
      if (!res.ok || !data || data.error) {
        const base = data?.error ?? '拉取模型失败，请稍后重试';
        setModelsError(data?.url ? `${base}（实际请求：${data.url}）` : base);
      } else if (data.hint && (data.models ?? []).length === 0) {
        // MiniMax 等无模型列表接口：优雅降级，可用常用模型 chips 或手动填写
        setModelsHint(TTS_MODEL_MANUAL_HINT);
      } else {
        applyTtsModels(data.models ?? []);
      }
    } catch {
      setModelsError('无法连接到服务器');
    } finally {
      setFetchingModels(false);
    }
  };

  /** 内置声线逐个试听 */
  const previewBuiltinVoice = (voiceId: string) => {
    if (previewingBuiltinId) {
      stopBuiltinSpeech();
      stopPreviewAudio();
      setPreviewingBuiltinId(null);
      if (previewingBuiltinId === voiceId) return;
    }
    stopBuiltinSpeech();
    setPreviewingBuiltinId(voiceId);
    void speakBuiltin({
      text: '你好，这是内置声线，很高兴认识你。',
      voiceId,
      onStart: () => setPreviewingBuiltinId(voiceId),
      onEnd: () => setPreviewingBuiltinId(null),
      onError: () => setPreviewingBuiltinId(null),
    }).catch(() => setPreviewingBuiltinId(null));
  };

  /** 停掉试听中的 Audio（云端/我的音色试听用） */
  const stopPreviewAudio = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      revokePreviewSrc(previewAudioRef.current);
      previewAudioRef.current = null;
    }
  };

  const runPreview = async () => {
    if (previewLoading) return;
    setPreviewLoading(true);
    setPreviewError('');
    // 内置语音：浏览器本地引擎直接朗读，不走 API
    if (isBuiltin) {
      stopBuiltinSpeech();
      try {
        await speakBuiltin({
          text: '你好，这是当前的语音音色，很高兴见到你。',
          voiceId: ttsConfig.defaultVoiceId,
          onStart: () => setPreviewingBuiltinId('preview'),
        });
      } catch (e) {
        setPreviewError(e instanceof Error ? e.message : '内置语音播放失败');
      } finally {
        setPreviewingBuiltinId(null);
        setPreviewLoading(false);
      }
      return;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      revokePreviewSrc(previewAudioRef.current);
      previewAudioRef.current = null;
    }
    try {
      const voiceId = ttsConfig.defaultVoiceId.trim() || (isMinimax ? 'female-shaonv' : isFish ? '' : 'alloy');
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: ttsConfig, voiceId, text: '你好，这是当前的语音音色，很高兴见到你。' }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setPreviewError(data?.error ?? '语音生成失败');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        revokePreviewSrc(audio);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
      };
      await audio.play().catch(() => {
        revokePreviewSrc(audio);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
      });
    } catch {
      setPreviewError('语音生成失败，请检查配置');
    } finally {
      setPreviewLoading(false);
    }
  };

  // ---- 服务商连接测试（测试填写的语音服务商是否可用：按当前连接配置合成一句样例验证连通性并播放） ----
  const [testingProvider, setTestingProvider] = useState(false);
  const [providerTestError, setProviderTestError] = useState('');
  const [providerTestOk, setProviderTestOk] = useState(false);

  /** 测试服务商：合成一句样例；成功播放音频并标记可用，失败展示服务端返回的错误信息 */
  const testProvider = async () => {
    if (testingProvider) return;
    setTestingProvider(true);
    setProviderTestError('');
    setProviderTestOk(false);
    try {
      const voiceId = ttsConfig.defaultVoiceId.trim() || (isMinimax ? 'female-shaonv' : isFish ? '' : 'alloy');
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: ttsConfig, voiceId, text: '你好，这是服务商连接测试。' }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setProviderTestError(data?.error ?? `测试失败（HTTP ${res.status}）`);
        return;
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        setProviderTestError('服务商返回了空音频，请检查模型名与音色 ID');
        return;
      }
      setProviderTestOk(true);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        revokePreviewSrc(previewAudioRef.current);
        previewAudioRef.current = null;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        revokePreviewSrc(audio);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
      };
      await audio.play().catch(() => {});
    } catch {
      setProviderTestError('无法连接到服务器');
    } finally {
      setTestingProvider(false);
    }
  };

  const mq = modelQuery.trim().toLowerCase();
  const filteredTtsModels = mq ? ttsModels.filter((m) => m.toLowerCase().includes(mq)) : ttsModels;

  // ---- 我的音色（用户自建音色库，永久保存在本机；联系人/聊天设置「他的声音」可选用） ----
  const myVoices = useMyVoices((s) => s.voices);
  const addMyVoice = useMyVoices((s) => s.add);
  const removeMyVoice = useMyVoices((s) => s.remove);
  const [myVoiceName, setMyVoiceName] = useState('');
  const [myVoiceId, setMyVoiceId] = useState('');
  const [myVoiceError, setMyVoiceError] = useState('');
  const [previewingMyId, setPreviewingMyId] = useState<string | null>(null);

  const submitMyVoice = () => {
    setMyVoiceError('');
    const rec = addMyVoice(myVoiceName, myVoiceId);
    if (!rec) {
      setMyVoiceError('请填写音色名字与音色 ID（完全重复的音色不会重复保存）');
      return;
    }
    setMyVoiceName('');
    setMyVoiceId('');
  };

  /** 我的音色试听：内置声线 id / 内置服务商 → 浏览器引擎本地朗读；其它走当前语音 API */
  const previewMyVoice = async (v: { id: string; voiceId: string }) => {
    if (previewingMyId) {
      stopBuiltinSpeech();
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setPreviewingMyId(null);
      if (previewingMyId === v.id) return;
    }
    if (isBuiltinVoiceId(v.voiceId) || isBuiltin) {
      setPreviewingMyId(v.id);
      void speakBuiltin({
        text: '你好，这是保存的音色，很高兴认识你。',
        voiceId: isBuiltinVoiceId(v.voiceId) ? v.voiceId : undefined,
        onEnd: () => setPreviewingMyId(null),
        onError: () => setPreviewingMyId(null),
      }).catch(() => setPreviewingMyId(null));
      return;
    }
    setPreviewingMyId(v.id);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: ttsConfig, voiceId: v.voiceId, text: '你好，这是保存的音色，很高兴认识你。' }),
      });
      if (!res.ok) {
        setPreviewingMyId(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        revokePreviewSrc(audio);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
        setPreviewingMyId(null);
      };
      audio.onerror = () => {
        revokePreviewSrc(audio);
        setPreviewingMyId(null);
      };
      await audio.play().catch(() => setPreviewingMyId(null));
    } catch {
      setPreviewingMyId(null);
    }
  };

  return (
    <DetailShell title="语音 API" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 服务商 */}
        <section>
          <SectionLabel icon={Volume2} tone={TONE_CYAN}>服务商</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="tts-provider-builtin"
              onClick={() => switchProvider('builtin')}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                isBuiltin ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]' : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
              }`}
            >
              内置语音（免费）
            </button>
            <button
              type="button"
              data-testid="tts-provider-minimax"
              onClick={() => switchProvider('minimax')}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                isMinimax ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]' : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
              }`}
            >
              MiniMax
            </button>
            <button
              type="button"
              data-testid="tts-provider-openai"
              onClick={() => switchProvider('openai')}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                isTtsOpenai ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]' : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
              }`}
            >
              OpenAI 兼容
            </button>
            <button
              type="button"
              data-testid="tts-provider-fishaudio"
              onClick={() => switchProvider('fishaudio')}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                isFish ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]' : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
              }`}
            >
              Fish Audio
            </button>
          </div>
        </section>

        {/* 内置语音：免费零配置，男女声线网格 + 逐个试听（提示精简：一行说明 + 不支持时一行警告） */}
        {isBuiltin && (
          <>
            <section>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[12px] text-muted-foreground">本地合成 · 免费 · 离线可用 · 点卡片设为默认</p>
                {builtinSupport === false && (
                  <p className="flex shrink-0 items-center gap-1 text-[12px] text-[#FF3B30]">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    浏览器不支持，将回退服务端语音
                  </p>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {BUILTIN_TTS_VOICES.map((v) => {
                  const active = ttsConfig.defaultVoiceId.trim() === v.id;
                  const playing = previewingBuiltinId === v.id;
                  return (
                    <div
                      key={v.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={active}
                      data-testid={`builtin-voice-${v.id}`}
                      onClick={() => updateTtsConfig({ defaultVoiceId: v.id })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          updateTtsConfig({ defaultVoiceId: v.id });
                        }
                      }}
                      className={`flex flex-col gap-1.5 rounded-[18px] p-3 backdrop-blur-2xl transition-all ${
                        active
                          ? 'bg-white/85 shadow-[0_8px_22px_rgba(17,24,39,0.1)] ring-1 ring-white/80 dark:bg-white/[0.14] dark:ring-white/[0.16]'
                          : 'bg-white/45 shadow-[0_2px_10px_rgba(17,24,39,0.04)] ring-1 ring-white/60 dark:bg-white/[0.05] dark:ring-white/[0.08]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[15px] font-medium">{v.name}</span>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              v.gender === 'female' ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            }`}
                          >
                            {v.gender === 'female' ? '女' : '男'}
                          </span>
                        </span>
                        {active && <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
                      </div>
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-[11px] text-muted-foreground">{v.label}</span>
                        <button
                          type="button"
                          aria-label={`试听声线${v.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            previewBuiltinVoice(v.id);
                          }}
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${
                            playing ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.22]' : 'bg-white/60 text-muted-foreground ring-1 ring-black/[0.05] active:bg-white/85 dark:bg-white/[0.08] dark:ring-white/[0.1]'
                          }`}
                        >
                          <AudioLines className={`h-3.5 w-3.5 ${playing ? 'animate-pulse' : ''}`} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 试听（提示精简：去掉页尾长说明） */}
            <section>
              <button
                type="button"
                onClick={() => void runPreview()}
                disabled={previewLoading}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                试听当前声线
              </button>
              {previewError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {previewError}
                </p>
              )}
            </section>
          </>
        )}

        {/* 连接配置 + 全局默认音色（更改自动保存；内置语音无连接配置） */}
        {!isBuiltin && (
        <>
        <section>
          <SectionLabel
            icon={Wrench}
            tone={TONE_BLUE}
            right={<span className="text-[11px] text-muted-foreground/70">更改自动保存 · 即时生效</span>}
          >
            连接配置
          </SectionLabel>
          <div className="flex flex-col gap-4 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            <div>
              <FieldLabel>API 地址</FieldLabel>
              <Input
                value={ttsConfig.baseUrl}
                onChange={(e) => updateTtsConfig({ baseUrl: e.target.value })}
                placeholder={preset.baseUrl}
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            <div>
              <FieldLabel>API Key</FieldLabel>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={ttsConfig.apiKey}
                  onChange={(e) => updateTtsConfig({ apiKey: e.target.value })}
                  placeholder={isMinimax ? 'eyJhbGciOi...' : isFish ? 'Fish Audio 的 API Key（fishaudio.org 控制台获取）' : 'sk-...'}
                  autoComplete="off"
                  className={`h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)] ${ttsConfig.apiKey ? 'pr-16' : 'pr-10'}`}
                />
                {ttsConfig.apiKey && (
                  <button
                    type="button"
                    onClick={() => updateTtsConfig({ apiKey: '' })}
                    aria-label="清空 API Key"
                    className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {isMinimax && (
              <div>
                <FieldLabel>GroupId</FieldLabel>
                <Input
                  value={ttsConfig.groupId}
                  onChange={(e) => updateTtsConfig({ groupId: e.target.value })}
                  placeholder="MiniMax 控制台「账户管理」里的 GroupId"
                  autoComplete="off"
                  className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                />
              </div>
            )}

            <div className="relative">
              <FieldLabel>
                模型名{!isMinimax && <span className="ml-1 font-normal text-muted-foreground/70">（选填{isFish ? '，Fish Audio 以音色 ID 定位声线' : ''}）</span>}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={ttsConfig.model}
                  onChange={(e) => updateTtsConfig({ model: e.target.value })}
                  placeholder={isMinimax ? preset.model : isFish ? 'Fish Audio 无需模型名，留空即可' : `如 ${preset.model}，不需要模型可留空`}
                  className="h-11 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                />
                {!isFish && (
                  <button
                    type="button"
                    onClick={() => void fetchTtsModels()}
                    disabled={fetchingModels}
                    className="flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-white/60 px-4 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                  >
                    {fetchingModels && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    拉取模型
                  </button>
                )}
              </div>
              {modelsError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {modelsError}
                </p>
              )}
              {modelsHint && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{modelsHint}</p>
              )}

              {/* 模型列表面板（拉取成功后展开；TTS 相关模型排前） */}
              {modelPanelOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setModelPanelOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-2xl ring-1 ring-black/[0.05] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-[#1C1C1E]/85">
                    <div className="border-b border-black/[0.05] p-2 dark:border-white/[0.06]">
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="搜索模型，如 tts / speech"
                        autoFocus
                        className="h-10 rounded-[12px] border-black/[0.05] bg-white/70 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.09]"
                      />
                    </div>
                    <div className="thin-scrollbar max-h-64 overflow-y-auto">
                      {filteredTtsModels.length === 0 ? (
                        <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">没有匹配的模型</div>
                      ) : (
                        filteredTtsModels.map((m) => {
                          const isTts = /tts|speech|audio|voice/i.test(m);
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                updateTtsConfig({ model: m });
                                setModelPanelOpen(false);
                              }}
                              className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[14px]">{m}</span>
                                {isTts && (
                                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    语音
                                  </span>
                                )}
                              </span>
                              {ttsConfig.model.trim() === m && (
                                <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {!isMinimax && !isFish && (
                  <button
                    type="button"
                    onClick={() => updateTtsConfig({ model: '' })}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                      !ttsConfig.model.trim()
                        ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                        : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                    }`}
                  >
                    不需要模型（留空）
                  </button>
                )}
                {preset.modelChips.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateTtsConfig({ model: m })}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                      ttsConfig.model.trim() === m
                        ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                        : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* 全局默认音色（并入连接配置卡片：角色未设独立音色时使用，音色 ID 手动填写） */}
            <div>
              <FieldLabel>全局默认音色</FieldLabel>
              <Input
                value={ttsConfig.defaultVoiceId}
                onChange={(e) => updateTtsConfig({ defaultVoiceId: e.target.value })}
                placeholder={isMinimax ? '如 female-shaonv（留空用系统默认）' : isFish ? '如 Fish Audio 音色 ID（留空用平台默认音色）' : '如 alloy（留空用系统默认）'}
                className="h-11 w-full rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            {/* 试听 */}
            <div>
              <button
                type="button"
                onClick={runPreview}
                disabled={previewLoading}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                试听当前音色
              </button>
              {previewError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {previewError}
                </p>
              )}
            </div>

            {/* 测试服务商连接：按当前连接配置合成一句样例，验证填写的服务商能不能用（紧跟试听按钮下方） */}
            <div>
              <button
                type="button"
                data-testid="tts-provider-test"
                onClick={() => void testProvider()}
                disabled={testingProvider}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                {testingProvider ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                {testingProvider ? '测试中…' : '测试服务商连接'}
              </button>
              {providerTestOk && !providerTestError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-green-600 dark:text-green-400">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  服务商可用，测试音频已播放。
                </p>
              )}
              {providerTestError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {providerTestError}
                </p>
              )}
            </div>
          </div>
        </section>
        </>
        )}

        {/* 我的音色：自建音色库（名字 + 音色 ID，永久保存；联系人/聊天设置「他的声音」可选用）；紧跟连接配置下方 */}
        <section>
          <SectionLabel icon={AudioLines} tone={TONE_ORANGE}>我的音色</SectionLabel>
          <div className="flex flex-col gap-3 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            <p className="text-[12px] leading-relaxed text-muted-foreground/80">
              常用音色存成 preset（名字 + 音色 ID），联系人/聊天设置「他的声音」可点选使用。
            </p>
            {myVoices.length > 0 && (
              <div className="flex flex-col gap-2">
                {myVoices.map((v) => (
                  <div
                    key={v.id}
                    data-testid={`my-voice-item-${v.id}`}
                    className="flex items-center gap-2 rounded-[14px] border border-white/60 bg-white/50 px-4 py-2.5 shadow-[0_3px_12px_rgba(17,24,39,0.05)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.06]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{v.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{v.voiceId}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`试听音色${v.name}`}
                      data-testid={`my-voice-preview-${v.id}`}
                      onClick={() => void previewMyVoice(v)}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                        previewingMyId === v.id ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.22]' : 'bg-white/60 text-muted-foreground ring-1 ring-black/[0.05] active:bg-white/85 dark:bg-white/[0.08] dark:ring-white/[0.1]'
                      }`}
                    >
                      <AudioLines className={`h-4 w-4 ${previewingMyId === v.id ? 'animate-pulse' : ''}`} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除音色${v.name}`}
                      data-testid={`my-voice-delete-${v.id}`}
                      onClick={() => removeMyVoice(v.id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-[#FF3B30]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Input
                value={myVoiceName}
                onChange={(e) => setMyVoiceName(e.target.value)}
                placeholder="音色名字，如 温柔御姐"
                maxLength={20}
                data-testid="my-voice-name"
                aria-label="我的音色名字"
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
              <Input
                value={myVoiceId}
                onChange={(e) => setMyVoiceId(e.target.value)}
                placeholder="音色 ID，如 female-shaonv / alloy / builtin:xiaoyue"
                data-testid="my-voice-id"
                aria-label="我的音色 ID"
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
              <div className="flex flex-wrap gap-1.5">
                {BUILTIN_TTS_VOICES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setMyVoiceId(b.id)}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition-all active:scale-[0.97] ${
                      myVoiceId.trim() === b.id
                        ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                        : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                    }`}
                  >
                    {b.name}·{b.gender === 'female' ? '女' : '男'}
                  </button>
                ))}
              </div>
              {myVoiceError && (
                <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {myVoiceError}
                </p>
              )}
              <div className="flex gap-2">
                {/* 测试：不保存直接试听当前填写的音色（内置声线本地朗读，其它走当前语音 API） */}
                <button
                  type="button"
                  data-testid="my-voice-test"
                  aria-label="测试当前填写的音色"
                  onClick={() => void previewMyVoice({ id: '__draft__', voiceId: myVoiceId.trim() })}
                  disabled={!myVoiceId.trim()}
                  className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16] ${
                    previewingMyId === '__draft__' ? 'ring-2 ring-black/[0.15] dark:ring-white/[0.25]' : ''
                  }`}
                >
                  {previewingMyId === '__draft__' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                  {previewingMyId === '__draft__' ? '测试中…' : '测试'}
                </button>
                <button
                  type="button"
                  data-testid="my-voice-add"
                  onClick={submitMyVoice}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  保存音色
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 语音识别 STT（转文字）：识别主通道 = Web Speech（浏览器原生实时识别）；内置识别模型已移除，
            服务端仅作可选兑底（OpenAI 兼容，配置后启用） */}
        <section>
          <SectionLabel icon={MessageSquareText} tone={TONE_GREEN}>语音识别 STT（转文字）</SectionLabel>
          <div className="flex flex-col gap-3 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {/* 识别主通道：Web Speech（浏览器原生实时识别）——提示精简为一行 */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">浏览器实时识别（Web Speech）</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                  通话免提与语音消息转写的主通道（免配置）；关闭后直发语音只有音频。
                  {wsSupport === null ? '' : wsSupport ? '当前浏览器：支持。' : '当前浏览器：不支持。'}
                </p>
              </div>
              <Switch
                checked={sttConfig.webSpeech}
                onCheckedChange={(v) => updateSttConfig({ webSpeech: v })}
                aria-label="浏览器实时识别（Web Speech）"
              />
            </div>

            {/* 离线识别（端侧模型，可选）：SenseVoice WASM 本地推理，下载后断网可用，
                按住说话/转文字优先本地，失败静默降级云端 */}
            <OfflineAsrSection />

            {/* 服务端兑底（可选）：提示精简为一行 */}
            <div className="border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
              <div className="text-[14px] font-medium text-foreground">服务端兑底（OpenAI 兼容，可选）</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                浏览器识别不可用时的兑底；留空则只用浏览器实时识别。
                {sttConfig.provider === 'openai' && sttConfig.apiKey.trim() && sttConfig.baseUrl.trim()
                  ? '当前：已启用。'
                  : '当前：未启用。'}
              </p>
            </div>
            <>
                <div>
                  <FieldLabel>API 地址</FieldLabel>
                  <Input
                    value={sttConfig.baseUrl}
                    onChange={(e) => updateSttConfig({ provider: 'openai', baseUrl: e.target.value })}
                    placeholder="如 https://api.openai.com/v1"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                  />
                </div>
                <div>
                  <FieldLabel>API Key</FieldLabel>
                  <div className="relative">
                    <Input
                      type={showSttKey ? 'text' : 'password'}
                      value={sttConfig.apiKey}
                      onChange={(e) => updateSttConfig({ provider: 'openai', apiKey: e.target.value })}
                      placeholder="sk-…"
                      className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 pr-16 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSttKey((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground"
                    >
                      {showSttKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                </div>
                <div>
                  <FieldLabel>识别模型（选填）</FieldLabel>
                  <Input
                    value={sttConfig.model}
                    onChange={(e) => updateSttConfig({ provider: 'openai', model: e.target.value })}
                    placeholder="如 whisper-1（留空用默认 whisper-1）"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['whisper-1', 'whisper-large-v3', 'SenseVoiceSmall'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateSttConfig({ provider: 'openai', model: m })}
                        className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                          sttConfig.model.trim() === m
                            ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                            : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                        }`
                      }
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </>
          </div>
        </section>

      </div>
    </DetailShell>
  );
}

/**
 * 离线识别模型下载控件（Task 1-a 抽取共用）：检查中提示 / 下载按钮 / 进度条 / 失败原因+重试。
 * 「语音 API」页的 OfflineAsrSection 与「AI 动手」页唤醒状态行共用同一份状态机与 UI——
 * 下载动作幂等（initOfflineAsr 内部去重），两处入口并发发起也只会跑一次；下载完成 status→ready
 * 由 offline-asr Worker 消息置位，唤醒循环订阅该状态自动切回端侧通道（无需本组件通知）。
 * 就绪态（ready）不在此渲染：由调用方按需展示（语音 API 页有删除模型按钮，唤醒行无需）。
 */
export function OfflineAsrDownloadInline({
  label = '下载模型（约 229 MB）',
  hint = '阿里云 ModelScope 直链，国内不绕墙',
  onReady,
}: {
  /** 下载按钮文案（不同入口不同话术：语音 API 页通用，唤醒行强调喊名收益） */
  label?: string;
  /** 按钮下的一行说明 */
  hint?: string;
  /** 下载完成（引擎就绪）回调：语音 API 页弹 toast 提示，唤醒行无需 */
  onReady?: () => void;
}) {
  const { status, progress, sourceIndex, error } = useOfflineAsr();
  const [busy, setBusy] = useState(false);

  const totalMb = progress ? progress.total / 1048576 : 229;
  const loadedMb = progress ? progress.loaded / 1048576 : 0;

  const startDownload = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    useOfflineAsr.getState().set({
      status: 'downloading',
      error: null,
      progress: { loaded: 0, total: Math.round(totalMb * 1048576), pct: 0 },
    });
    try {
      await initOfflineAsr(); // 内部：下载（进度实时写 store）→ 注入 → ready 状态
      onReady?.();
    } catch {
      // 错误状态已由 offline-asr 内部写入（store.error），UI 展示
    } finally {
      setBusy(false);
    }
  };

  if (status === 'ready') return null;

  return (
    <div className="mt-2">
      {status === 'checking' && <p className="text-[12px] text-muted-foreground">正在检查本地缓存…</p>}

      {(status === 'not-downloaded' || (status === 'error' && !busy)) && (
        <>
          <button
            type="button"
            onClick={() => void startDownload()}
            disabled={busy}
            className="rounded-xl bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-all active:scale-[0.97] disabled:opacity-50"
          >
            {status === 'error' ? `重试${label}` : label}
          </button>
          <p className="mt-1.5 text-[12px] text-muted-foreground/70">{hint}</p>
        </>
      )}

      {status === 'error' && error && (
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: IOS_RED }}>
          {error}
        </p>
      )}

      {status === 'downloading' && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.12]">
            <div
              className="h-full rounded-full bg-[#07C160] transition-[width] duration-300"
              style={{ width: `${Math.max(2, progress?.pct ?? 0)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>
              下载中 {progress ? `${progress.pct.toFixed(1)}%` : '准备中…'}
              {progress ? ` · ${loadedMb.toFixed(1)}/${totalMb.toFixed(0)} MB` : ''}
            </span>
            <span>{sourceIndex === 0 ? '主源' : '备用源'}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground/60">下载完成后自动注入引擎，可离开本页（下次进入续传整包）。</p>
        </div>
      )}
    </div>
  );
}

/**
 * 离线识别（端侧模型，可选）下载模块：
 * - 模型：SenseVoice int8（约 229 MB）+ tokens，阿里云 ModelScope 直链（国内直连不走 HF）；
 * - 缓存：浏览器 Cache API 持久化，只需下载一次；进度条实时更新（流式读取 Content-Length）；
 * - 主源失败自动切换备用源；下载完成自动注入 WASM 引擎（MEMFS），状态置「已就绪」；
 * - 就绪后按住说话/转文字优先本地识别（断网可用），失败静默降级云端 STT（stt-client 已接）；
 * - 下载 UI 抽为 OfflineAsrDownloadInline 共用（Task 1-a）：唤醒状态行同款入口，此处传回调弹提示。
 */
export function OfflineAsrSection() {
  const { status } = useOfflineAsr();
  const [busy, setBusy] = useState(false);
  const [toastMsg, showToast] = useLocalToast();

  const removeModel = async (): Promise<void> => {
    setBusy(true);
    try {
      await deleteOfflineModel();
      showToast('已删除端侧模型与本地缓存');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-foreground">离线识别（端侧模型，可选）</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
            SenseVoice 中文端侧模型（约 229MB，仅下载一次）：断网也可识别。
          </p>
        </div>
      </div>

      {/* 检查中/未下载/下载进度/失败重试（与唤醒状态行共用同一控件） */}
      <OfflineAsrDownloadInline onReady={() => showToast('离线识别模型已就绪，按住说话优先本地识别')} />

      {status === 'ready' && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[12px] text-[#07C160]">✓ 已就绪：按住说话优先本地识别（断网可用）</p>
          <button
            type="button"
            onClick={() => void removeModel()}
            disabled={busy}
            className="shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-[12px] text-muted-foreground ring-1 ring-black/[0.08] transition-all active:scale-[0.97] disabled:opacity-50 dark:ring-white/[0.12]"
          >
            删除模型
          </button>
        </div>
      )}
      <LocalToast msg={toastMsg} />
    </div>
  );
}
