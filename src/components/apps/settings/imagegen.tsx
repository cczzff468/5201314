'use client';

// 图像生成（生图）设置页 + 内置生图预设（OpenAI 官方；页尾锁脸区来自 lock 模块）。

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  AlertCircle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Type,
  Wrench,
  X,
} from 'lucide-react';

import { genId } from '@/lib/ios/db';

import {
  useSettings,
  type ImgGenConfig,
  type ImgGenPreset,
} from '@/lib/ios/store';

import { Input } from '@/components/ui/input';

import { Textarea } from '@/components/ui/textarea';

import { Switch } from '@/components/ui/switch';

import { pullModelsUnified } from '@/lib/ios/direct-api';

import {
  extractImgGenError,
  imggenEndpoints,
  pickImageFromResponse,
} from '@/lib/imggen';

import {
  IOS_RED,
  TONE_BLUE,
  TONE_GREEN,
  TONE_CYAN,
  DetailShell,
  FieldLabel,
  SectionLabel,
  GrayCard,
  IS_TOUCH_DEVICE,
  useModelPanelReveal,
} from './shared';

import { FaceLockSection } from './lock';

/** 内置生图预设：OpenAI 官方（预设列表第一项、不可删除；Key 需自行填写） */
export const BUILTIN_IMGGEN_PRESET: ImgGenPreset = {
  id: 'builtin-openai',
  name: 'OpenAI 官方',
  config: {
    enabled: false,
    mode: 'proxy',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-image-2',
    size: '1024x1024',
    quality: 'auto',
    extraPrompt: '',
  },
};
// ---------------- 图像生成（生图） ----------------

/**
 * 图像生成配置页（浅灰底 iOS 设置子页风）：与识图模型页（VisionPage）同构。
 * - 「启用自动生图」总开关：关闭时 AI 不会自动生图（手动触发不受影响），配置始终可见可先填；
 * - 请求方式：服务端转发（/api/imggen，免跨域，推荐）或浏览器直连（需接口允许 CORS）；
 * - 连接配置：OpenAI 兼容基地址 + Key（密文持久化）+ 模型名（可拉取列表选择）+ 尺寸/质量/补充提示词；
 * - 预设管理：内置「OpenAI 官方」（列表第一项、不可删除）+ 用户预设（应用 / 更新 / 删除）；
 * - 测试生图：按当前配置真实生成一张，验证连通性（成功展示图片，失败展示上游错误）；
 * - 形象锁定（锁脸）区（FaceLockSection，页尾）：按角色上传生图参考图 + 外貌描述兜底
 *   （原三端聊天设置里的形象锁定页迁移至此，按 contactId 隔离，数据与三端聊天共用）。
 * 所有变更经 updateImgGenConfig 即时保存，下一次生图现场读取 → 自动生效，无需重启。
 */
export function ImageGenPage({ onBack }: { onBack: () => void }) {
  const imgGenConfig = useSettings((s) => s.imgGenConfig);
  const imgGenPresets = useSettings((s) => s.imgGenPresets);
  const updateImgGenConfig = useSettings((s) => s.updateImgGenConfig);
  const setImgGenPresets = useSettings((s) => s.setImgGenPresets);

  // Tab：连接配置 / 形象锁定（预设区下方，用户需求）
  const [imgTab, setImgTab] = useState<'conn' | 'face'>('conn');

  const [showKey, setShowKey] = useState(false);
  // v2.2.3：「保存预设」双入口锚点（预设区「添加预设」chip / 测试按钮旁「保存预设」按钮）
  const [saveAnchor, setSaveAnchor] = useState<'preset' | 'config' | null>(null);
  const [presetName, setPresetName] = useState('');

  const [models, setModels] = useState<string[]>([]);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');

  // v2.2.4 模型面板滑动三连修：撤 fixed 全屏遮罩（在变换容器内不参与滚动链、
  // 吃掉页面触摸拖动——面板高于一屏时「什么都滑不了」）改 document click 委托
  // outside-click 关闭：拖动滚动不触发 click（面板保持打开、页面正常滚）；
  // 开面板时把模型区滚到可视中部；列表 overscroll-contain 内滚强化。
  const modelSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modelPanelOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const el = modelSectionRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setModelPanelOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [modelPanelOpen]);

  // v2.2.5 F-1 模型面板露出双根修（与聊天 API 页同款）：① 面板底边出屏 → 页面滚动
  // 容器补滚到面板完整可见（旧版只把锚点居中，面板尾部常年叠在屏幕外）；
  // ② 列表不满一屏时移除 overscroll-contain——contain 切断滚动链，手指划面板什么都不动。
  const [modelListScrollable, setModelListScrollable] = useState(false);
  useEffect(() => {
    const sec = modelSectionRef.current;
    const list = (sec?.querySelector('[data-model-panel] .overflow-y-auto') as HTMLElement | null) ?? null;
    setModelListScrollable(!!list && list.scrollHeight - list.clientHeight > 4);
  }, [models, modelPanelOpen, modelQuery]);
  // v2.4.27（第四十六轮）：补滚露出逻辑抽成共享 hook（api/vision/imggen/voice 四页同一实现）——
  // 容器可见底边基准 + 锚点行不破屏上限 + 键盘/窗口尺寸变化重算（详见 shared.tsx 注释）
  useModelPanelReveal(modelSectionRef, modelPanelOpen, models, modelQuery);

  // 测试生图（真实生成一张：成功展示图片、失败展示错误）
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [testSrc, setTestSrc] = useState('');

  /** 配置变更统一入口：自动保存 + 清掉过期的测试结果 */
  const patchImgGenConfig = (patch: Partial<ImgGenConfig>) => {
    updateImgGenConfig(patch);
    setTestError('');
    setTestSrc('');
  };

  // 自动开启总开关（用户需求「配置了以后开关自动打开，不需要手动打开」）：
  // 监听配置完整性（地址+模型名都已填），只在「不完整 → 完整」的临界沿自动置 enabled=true；
  // 已完整后用户手动关闭不会被强制重开（无临界沿），保留手动控制权
  const cfgComplete = Boolean(imgGenConfig.baseUrl.trim() && imgGenConfig.model.trim());
  const wasCompleteRef = useRef(cfgComplete);
  useEffect(() => {
    const prev = wasCompleteRef.current;
    wasCompleteRef.current = cfgComplete;
    if (cfgComplete && !prev && !useSettings.getState().imgGenConfig.enabled) {
      updateImgGenConfig({ enabled: true });
    }
  }, [cfgComplete, updateImgGenConfig]);

  // —— 预设管理 ——
  const allPresets: ImgGenPreset[] = [BUILTIN_IMGGEN_PRESET, ...imgGenPresets];

  /** 应用预设：覆盖连接相关字段；不改动「启用自动生图」开关（开关是全局行为，不属于某家服务商） */
  const applyPreset = (p: ImgGenPreset) => {
    patchImgGenConfig({
      mode: p.config.mode,
      baseUrl: p.config.baseUrl,
      apiKey: p.config.apiKey,
      model: p.config.model,
      size: p.config.size,
      quality: p.config.quality,
      extraPrompt: p.config.extraPrompt,
    });
    setModelsError('');
    setModelsHint('');
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setImgGenPresets([...imgGenPresets, { id: genId(), name, config: { ...imgGenConfig } }]);
    setPresetName('');
    setSaveAnchor(null);
  };

  /** 把当前配置写回指定预设 */
  const updatePreset = (id: string) => {
    setImgGenPresets(imgGenPresets.map((p) => (p.id === id ? { ...p, config: { ...imgGenConfig } } : p)));
  };

  const deletePreset = (id: string) => {
    setImgGenPresets(imgGenPresets.filter((p) => p.id !== id));
  };

  // —— 拉取模型列表（v2.2.2：双通道统一拉取——服务器代理 + 浏览器直连并行取并集，
  //    再并入本地缓存只增不减，修复「同一个地址和密钥拉取模型变少」） ——
  const fetchModels = async () => {
    if (!imgGenConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      const out = await pullModelsUnified(imgGenConfig.baseUrl, imgGenConfig.apiKey);
      if (out.models.length > 0) {
        setModels(out.models);
        setModelQuery('');
        setModelPanelOpen(true);
        // v2.2.5：露出逻辑移入 modelPanelOpen effect（补滚到面板完整可见）
        if (out.fromCacheOnly) setModelsHint(out.hint ?? '');
        return;
      }
      if (out.hint) {
        setModelsHint(out.hint);
        return;
      }
      setModelsError(out.error ?? '拉取模型失败，请稍后重试');
    } catch {
      setModelsError('无法连接到服务器');
    } finally {
      setFetchingModels(false);
    }
  };

  const q = modelQuery.trim().toLowerCase();
  const filteredModels = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;

  /** 测试生图：按当前配置真实生成一张（proxy 走 /api/imggen 转发；direct 浏览器直连 /images/generations） */
  const runImgGenTest = async () => {
    if (!imgGenConfig.baseUrl.trim()) {
      setTestError('请先填写 API 地址');
      return;
    }
    if (!imgGenConfig.apiKey.trim()) {
      setTestError('请先填写 API Key');
      return;
    }
    if (!imgGenConfig.model.trim()) {
      setTestError('请先填写模型名');
      return;
    }
    const basePrompt =
      'test prompt: a young woman taking a selfie in a warm cafe, natural light, realistic photo';
    const extra = imgGenConfig.extraPrompt.trim();
    const prompt = extra ? `${basePrompt}，${extra}` : basePrompt;
    const size = imgGenConfig.size.trim() || '1024x1024';
    const quality = imgGenConfig.quality.trim();
    setTesting(true);
    setTestError('');
    setTestSrc('');
    try {
      if (imgGenConfig.mode === 'direct') {
        // 浏览器直连：需接口允许跨域（CORS）
        const eps = imggenEndpoints(imgGenConfig.baseUrl);
        let lastErr = '生图失败';
        for (const ep of eps.generations) {
          try {
            const res = await fetch(ep, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imgGenConfig.apiKey}` },
              body: JSON.stringify({
                model: imgGenConfig.model,
                prompt,
                n: 1,
                ...(size && size !== 'auto' ? { size } : {}),
                ...(quality && quality !== 'auto' ? { quality } : {}),
              }),
            });
            const payload = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
              lastErr = extractImgGenError(payload, `生图接口错误（${res.status}）`);
              continue;
            }
            const src = await pickImageFromResponse(payload);
            if (src) {
              setTestSrc(src);
              return;
            }
            lastErr = '接口没有返回图片';
          } catch (e) {
            lastErr = e instanceof Error ? e.message : '网络错误（检查接口是否允许跨域 CORS）';
          }
        }
        throw new Error(lastErr);
      }
      // 服务端转发：/api/imggen
      const res = await fetch('/api/imggen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: imgGenConfig.baseUrl,
          apiKey: imgGenConfig.apiKey,
          model: imgGenConfig.model,
          prompt,
          size,
          quality,
        }),
      });
      const data = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
      if (!res.ok || !data?.src) {
        throw new Error(extractImgGenError(data, data?.error || `生图接口错误（${res.status}）`));
      }
      setTestSrc(data.src);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '测试失败，请稍后重试');
    } finally {
      setTesting(false);
    }
  };

  return (
    <DetailShell title="图像生成" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 启用自动生图（总开关） */}
        <section>
          <SectionLabel icon={ImagePlus} tone={TONE_GREEN}>自动生图</SectionLabel>
          <GrayCard className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">启用自动生图</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                  开启后 AI 回复里的照片标签会自动生成真实照片（支持锁脸保持人物一致）
                </p>
              </div>
              <Switch
                checked={imgGenConfig.enabled}
                onCheckedChange={(v) => patchImgGenConfig({ enabled: v })}
                aria-label="启用自动生图"
                data-testid="imggen-enabled"
                className="data-[state=checked]:bg-[#34C759]"
              />
            </div>
            {imgGenConfig.enabled ? null : (
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                关闭后 AI 不会自动生成照片，仍可在聊天里手动触发「生成照片」；下方配置请先填好（手动触发生图也依赖这些配置）。
              </p>
            )}
          </GrayCard>
        </section>

        {/* 预设区 */}
            <section>
              <SectionLabel icon={Layers} tone={TONE_CYAN}>预设</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {allPresets.map((p) => {
                  const isBuiltin = p.id === BUILTIN_IMGGEN_PRESET.id;
                  const active =
                    imgGenConfig.baseUrl === p.config.baseUrl && imgGenConfig.model === p.config.model;
                  return (
                    <span
                      key={p.id}
                      className={`flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2 text-[13px] transition-all active:scale-[0.97] ${
                        active
                          ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                          : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1]'
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`imggen-preset-apply-${p.id}`}
                        onClick={() => applyPreset(p)}
                        className="max-w-[120px] truncate"
                      >
                        {p.name}
                      </button>
                      {!isBuiltin && (
                        <>
                          <button
                            type="button"
                            data-testid={`imggen-preset-update-${p.id}`}
                            onClick={() => updatePreset(p.id)}
                            aria-label={`用当前配置更新预设 ${p.name}`}
                            className="opacity-60 transition-opacity hover:opacity-100"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            data-testid={`imggen-preset-del-${p.id}`}
                            onClick={() => deletePreset(p.id)}
                            aria-label={`删除生图预设 ${p.name}`}
                            className="opacity-60 transition-opacity hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </span>
                  );
                })}
                <button
                  type="button"
                  data-testid="imggen-preset-save"
                  onClick={() => setSaveAnchor((v) => (v === 'preset' ? null : 'preset'))}
                  className="flex items-center gap-1 rounded-full bg-white/55 px-3.5 py-1.5 text-[13px] text-muted-foreground ring-1 ring-black/[0.06] backdrop-blur-xl transition-all hover:bg-white/80 active:scale-[0.97] dark:bg-white/[0.07] dark:ring-white/[0.1] dark:hover:bg-white/[0.14]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加预设
                </button>
              </div>
              {saveAnchor === 'preset' && (
                <div className="mt-3 flex gap-2">
                  <Input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="预设名称，如 本地生图模型"
                    autoFocus
                    className="h-10 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') savePreset();
                    }}
                  />
                  <button
                    type="button"
                    onClick={savePreset}
                    disabled={!presetName.trim()}
                    className="h-10 shrink-0 rounded-[14px] bg-white/60 px-5 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-40 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                  >
                    保存
                  </button>
                </div>
              )}
            </section>

            {/* Tab（用户需求）：连接配置 / 形象锁定（预设下方、连接配置上方，iOS 分段控件风） */}
            <div
              className="flex rounded-[12px] bg-white/40 p-1 ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/[0.05] dark:ring-white/[0.08]"
              role="tablist"
              aria-label="图像生成设置分区"
            >
              <button
                type="button"
                role="tab"
                aria-selected={imgTab === 'conn'}
                data-testid="imggen-tab-conn"
                onClick={() => setImgTab('conn')}
                className={`h-9 flex-1 rounded-[9px] text-[13.5px] font-medium transition-all ${
                  imgTab === 'conn'
                    ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.16]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                连接配置
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={imgTab === 'face'}
                data-testid="imggen-tab-face"
                onClick={() => setImgTab('face')}
                className={`h-9 flex-1 rounded-[9px] text-[13.5px] font-medium transition-all ${
                  imgTab === 'face'
                    ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.16]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                形象锁定
              </button>
            </div>

            {/* 配置表单（连接配置 tab） */}
            {imgTab === 'conn' && (
            <section>
              <SectionLabel
                icon={Wrench}
                tone={TONE_BLUE}
                right={<span className="text-[11px] text-muted-foreground/70">更改自动保存 · 即时生效</span>}
              >
                连接配置
              </SectionLabel>
              <GrayCard className="flex flex-col gap-4">
                {/* 请求方式（iOS 分段控件风） */}
                <div>
                  <FieldLabel>请求方式</FieldLabel>
                  <div className="flex rounded-[12px] bg-white/40 p-1 ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/[0.05] dark:ring-white/[0.08]" role="group" aria-label="请求方式">
                    <button
                      type="button"
                      data-testid="imggen-mode-proxy"
                      onClick={() => patchImgGenConfig({ mode: 'proxy' })}
                      className={`h-8 flex-1 rounded-[9px] text-[13px] font-medium transition-all ${
                        imgGenConfig.mode === 'proxy'
                          ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.16]'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      服务端转发（推荐）
                    </button>
                    <button
                      type="button"
                      data-testid="imggen-mode-direct"
                      onClick={() => patchImgGenConfig({ mode: 'direct' })}
                      className={`h-8 flex-1 rounded-[9px] text-[13px] font-medium transition-all ${
                        imgGenConfig.mode === 'direct'
                          ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.16]'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      浏览器直连
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground/70">
                    {imgGenConfig.mode === 'direct'
                      ? '浏览器直接请求生图接口，需接口允许跨域（CORS）。'
                      : '由本站服务器转发生图请求，免跨域、Key 不暴露给页面。'}
                  </p>
                </div>

                {/* API 地址 */}
                <div>
                  <FieldLabel>API 地址</FieldLabel>
                  <Input
                    value={imgGenConfig.baseUrl}
                    onChange={(e) => patchImgGenConfig({ baseUrl: e.target.value })}
                    placeholder="填写生图 API 地址（OpenAI 兼容）"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    data-testid="imggen-baseurl"
                  />
                </div>

                {/* API Key */}
                <div>
                  <FieldLabel>API Key</FieldLabel>
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={imgGenConfig.apiKey}
                      onChange={(e) => patchImgGenConfig({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      autoComplete="off"
                      className={`h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)] ${
                        imgGenConfig.apiKey ? 'pr-16' : 'pr-10'
                      }`}
                      data-testid="imggen-apikey"
                    />
                    {imgGenConfig.apiKey && (
                      <button
                        type="button"
                        onClick={() => updateImgGenConfig({ apiKey: '' })}
                        aria-label="清空生图 API Key"
                        className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? '隐藏生图 Key' : '显示生图 Key'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* 模型名 + 拉取 */}
                <div ref={modelSectionRef} className="relative">
                  <FieldLabel>模型名</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      value={imgGenConfig.model}
                      onChange={(e) => patchImgGenConfig({ model: e.target.value })}
                      placeholder="如 gpt-image-2 / flux-pro"
                      className="h-11 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                      data-testid="imggen-model"
                    />
                    <button
                      type="button"
                      data-testid="imggen-fetch-models"
                      onClick={() => void fetchModels()}
                      disabled={fetchingModels}
                      className="flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-white/60 px-4 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                    >
                      {fetchingModels && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      拉取模型
                    </button>
                  </div>
                  {modelsError && (
                    <p className="mt-1.5 text-[12px]" style={{ color: IOS_RED }}>
                      {modelsError}
                    </p>
                  )}
                  {modelsHint && (
                    <div className="mt-1.5 rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                      {modelsHint}
                    </div>
                  )}

                  {modelPanelOpen && (
                    <div
                      data-model-panel
                      className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-2xl ring-1 ring-black/[0.05] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-[#1C1C1E]/85"
                    >
                        <div className="border-b border-black/[0.05] p-2 dark:border-white/[0.06]">
                          <Input
                            value={modelQuery}
                            onChange={(e) => setModelQuery(e.target.value)}
                            placeholder="搜索模型，如 image / flux"
                            // v2.4.27：触屏不 autoFocus——面板一开就拉起软键盘会盖住半个面板
                            autoFocus={!IS_TOUCH_DEVICE}
                            className="h-10 rounded-[12px] border-black/[0.05] bg-white/70 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.09]"
                          />
                        </div>
                        <div
                          className={`thin-scrollbar max-h-[min(360px,48vh)] overflow-y-auto ${
                            modelListScrollable ? 'overscroll-contain' : ''
                          }`}
                          style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
                        >
                          {filteredModels.length === 0 ? (
                            <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                              没有匹配的模型
                            </div>
                          ) : (
                            filteredModels.map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  patchImgGenConfig({ model: m });
                                  setModelPanelOpen(false);
                                }}
                                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                              >
                                <span className="truncate text-[14px]">{m}</span>
                                {imgGenConfig.model === m && (
                                  <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} />
                                )}
                              </button>
                            ))
                          )}
                        </div>
                        {/* v2.2.3：底部计数行（总数永远可见）；v2.2.4 撤 fixed 遮罩（吃页面滚动）改 outside-click */}
                        <div className="border-t border-black/[0.05] px-4 py-2 text-center text-[11px] tabular-nums text-muted-foreground dark:border-white/[0.06]">
                          {q ? `匹配 ${filteredModels.length}，共 ${models.length} 个模型` : `共 ${models.length} 个模型`}
                        </div>
                      </div>
                  )}
                </div>

                {/* 测试生图 + 保存预设（v2.2.3：测试按钮移到模型下方，保存预设与测试按钮对齐） */}
                <div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-testid="imggen-test"
                      onClick={() => void runImgGenTest()}
                      disabled={testing}
                      className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[13px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                    >
                      {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                      {testing ? '正在生图…' : '测试生图'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSaveAnchor((v) => (v === 'config' ? null : 'config'))}
                      className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-[14px] text-[13px] font-medium shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 backdrop-blur-2xl transition-all active:scale-[0.98] dark:active:bg-white/[0.16] ${
                        saveAnchor === 'config'
                          ? 'bg-foreground text-background ring-transparent dark:bg-white dark:text-black'
                          : 'bg-white/60 text-foreground ring-white/70 active:bg-white/85 dark:bg-white/[0.1] dark:ring-white/[0.12]'
                      }`}
                    >
                      <Save className="h-3.5 w-3.5" />
                      保存预设
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[11px] leading-snug text-muted-foreground/70">
                    按当前配置真实生成一张（约 10-60 秒），验证接口连通与生图效果
                  </p>
                  {saveAnchor === 'config' && (
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder="预设名称，如 本地生图模型"
                        autoFocus
                        className="h-10 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') savePreset();
                        }}
                      />
                      <button
                        type="button"
                        onClick={savePreset}
                        disabled={!presetName.trim()}
                        className="h-10 shrink-0 rounded-[14px] bg-white/60 px-5 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-40 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                      >
                        保存
                      </button>
                    </div>
                  )}
                  {testError && (
                    <div
                      data-testid="imggen-test-error"
                      className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-[#FF453A]/[0.06] px-3 py-2 text-[12px] leading-relaxed"
                      style={{ color: IOS_RED }}
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{testError}</span>
                    </div>
                  )}
                  {testing && (
                    <div className="mx-auto mt-3 grid aspect-square w-full max-w-[220px] place-items-center rounded-[14px] border border-dashed border-border bg-muted/40">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-[12px]">正在生成照片…</span>
                      </div>
                    </div>
                  )}
                  {testSrc && (
                    <div className="mt-3">
                      <div className="mx-auto w-full max-w-[220px] overflow-hidden rounded-[14px] shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10">
                        <img
                          src={testSrc}
                          alt="测试生成的图片"
                          data-testid="imggen-test-result"
                          className="block aspect-square w-full object-cover"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-center gap-1.5 text-[12px] leading-relaxed text-emerald-600 dark:text-emerald-400/90">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                        <span>测试成功</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 尺寸 */}
                <div>
                  <FieldLabel>尺寸</FieldLabel>
                  <Input
                    value={imgGenConfig.size}
                    onChange={(e) => patchImgGenConfig({ size: e.target.value })}
                    placeholder="1024x1024 / auto"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    data-testid="imggen-size"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['1024x1024', '1024x1536', '1536x1024', 'auto'].map((sv) => (
                      <button
                        key={sv}
                        type="button"
                        onClick={() => patchImgGenConfig({ size: sv })}
                        className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                          imgGenConfig.size.trim() === sv
                            ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                            : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                        }`}
                      >
                        {sv}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 质量 */}
                <div>
                  <FieldLabel>质量</FieldLabel>
                  <Input
                    value={imgGenConfig.quality}
                    onChange={(e) => patchImgGenConfig({ quality: e.target.value })}
                    placeholder="auto / low / medium / high"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    data-testid="imggen-quality"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['auto', 'low', 'medium', 'high'].map((qv) => (
                      <button
                        key={qv}
                        type="button"
                        onClick={() => patchImgGenConfig({ quality: qv })}
                        className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                          imgGenConfig.quality.trim() === qv
                            ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                            : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                        }`}
                      >
                        {qv}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 补充提示词 */}
                <div>
                  <FieldLabel>补充提示词（拼在每个生图提示词末尾的风格要求）</FieldLabel>
                  <Textarea
                    value={imgGenConfig.extraPrompt}
                    onChange={(e) => patchImgGenConfig({ extraPrompt: e.target.value })}
                    placeholder="如：写实风格，自然光线，手机自拍质感"
                    rows={3}
                    className="min-h-[72px] rounded-[14px] border-black/[0.05] bg-white/55 py-2.5 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    data-testid="imggen-extra"
                  />
                </div>

                {/* 未配置提示 */}
                {!imgGenConfig.baseUrl.trim() && (
                  <div className="rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                    还没有配置生图接口：填写 OpenAI 兼容的生图地址与模型名后，AI 回复里的照片标签才能生成真实照片。
                  </div>
                )}
              </GrayCard>
            </section>
            )}

            {/* 形象锁定 tab：按角色设置生图参考图 + 外貌描述（原聊天设置入口迁移至此） */}
            {imgTab === 'face' && <FaceLockSection />}

            {/* 使用说明（页尾） */}
            <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
              图像生成与聊天/识图配置相互独立、互不覆盖。开启后 AI 回复里出现照片标签会自动生成照片并发进聊天、存入角色相册；在「形象锁定」标签页为角色上传参考图即可锁脸，让照片里的人物长相保持一致。
            </p>

            <p className="text-[11px] leading-relaxed text-muted-foreground/80">
              服务端转发模式由本站代理请求你配置的生图接口，免跨域；配置与预设保存在本机 IndexedDB（API Key 加密存储），保存即生效、无需重启。
            </p>
      </div>
    </DetailShell>
  );
}
