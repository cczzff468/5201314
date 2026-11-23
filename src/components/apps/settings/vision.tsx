'use client';

// 识图模型设置页 + 内置识图预设。

import { useState } from 'react';

import {
  AlertCircle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Save,
  ScanEye,
  Type,
  Wrench,
  X,
} from 'lucide-react';

import { genId } from '@/lib/ios/db';

import {
  useSettings,
  type VisionConfig,
  type VisionPreset,
} from '@/lib/ios/store';

import { Input } from '@/components/ui/input';

import { pullModelsUnified } from '@/lib/ios/direct-api';

import { describeImages } from '@/lib/vision-client';

import {
  IOS_RED,
  TONE_BLUE,
  TONE_CYAN,
  DetailShell,
  FieldLabel,
  SectionLabel,
} from './shared';



/** 内置识图预设：均为支持图片输入的模型（识图模型与聊天模型可同厂不同款） */
export const BUILTIN_VISION_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v-flash' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-vl-plus' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1/chat/completions', model: 'Qwen/Qwen2.5-VL-7B-Instruct' },
];
// ---------------- 识图模型设置 ----------------

/**
 * 识图模型配置页（与「API 配置」并列、互相独立）：
 * 预设（内置 4 家 + 用户自存）/ API 地址 / API Key / 模型名（可拉取模型列表）/ 添加预设 / 测试（发送内置测试图，走与聊天完全相同的识图管线验证连通与效果）；
 * 更改自动保存、聊天发送时现场读取（保存后自动生效，无需重启）；使用说明放页尾。
 * 未配置时聊天发图不触发识图，文字聊天完全不受影响。
 */
export function VisionPage({ onBack }: { onBack: () => void }) {
  const visionConfig = useSettings((s) => s.visionConfig);
  const visionPresets = useSettings((s) => s.visionPresets);
  const updateVisionConfig = useSettings((s) => s.updateVisionConfig);
  const setVisionPresets = useSettings((s) => s.setVisionPresets);

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

  // 识图测试（内置测试图 → describeImages 同款管线）
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [testResult, setTestResult] = useState('');

  /** 配置变更统一入口：自动保存 + 清掉过期的测试结果 */
  const patchVisionConfig = (patch: Partial<VisionConfig>) => {
    updateVisionConfig(patch);
    setTestError('');
    setTestResult('');
  };

  const applyBuiltin = (p: (typeof BUILTIN_VISION_PRESETS)[number]) => {
    patchVisionConfig({ baseUrl: p.baseUrl, model: p.model });
    setModelsError('');
    setModelsHint('');
  };

  const applyUserPreset = (p: VisionPreset) => {
    patchVisionConfig(p.config);
    setModelsError('');
    setModelsHint('');
  };

  const deletePreset = (id: string) => {
    setVisionPresets(visionPresets.filter((p) => p.id !== id));
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setVisionPresets([...visionPresets, { id: genId(), name, config: { ...visionConfig } }]);
    setPresetName('');
    setSaveAnchor(null);
  };

  const fetchModels = async () => {
    if (!visionConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      // v2.2.2：双通道统一拉取（服务器代理 + 浏览器直连并行取并集，再并入本地缓存只增不减）
      // ——修复「同一个地址和密钥拉取模型变少」：部分服务商对服务器出口 IP 与用户本机
      // 返回不同的模型列表，单一通道经常只能看到子集
      const out = await pullModelsUnified(visionConfig.baseUrl, visionConfig.apiKey);
      if (out.models.length > 0) {
        setModels(out.models);
        setModelQuery('');
        setModelPanelOpen(true);
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

  /** 程序化画一张内容可识别的测试图（户外小屋场景），用于验证识图模型真的「看懂」了图片 */
  const buildTestImage = (): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const sky = ctx.createLinearGradient(0, 0, 0, 240);
    sky.addColorStop(0, '#6FBBF5');
    sky.addColorStop(1, '#D8F0FF');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#FFD60A';
    ctx.beginPath();
    ctx.arc(262, 48, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#79C86E';
    ctx.fillRect(0, 158, 320, 82);
    ctx.fillStyle = '#F4F4F8';
    ctx.fillRect(56, 112, 92, 62);
    ctx.fillStyle = '#FF9F0A';
    ctx.beginPath();
    ctx.moveTo(46, 114);
    ctx.lineTo(102, 68);
    ctx.lineTo(158, 114);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8A6248';
    ctx.fillRect(90, 136, 26, 38);
    ctx.fillStyle = '#1C1C1E';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('测试图片', 176, 196);
    ctx.font = '13px sans-serif';
    ctx.fillText('VISION TEST', 177, 216);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  /** 连接测试：走与聊天发图完全相同的 describeImages 管线，成功展示描述、失败展示错误 */
  const runVisionTest = async () => {
    if (!visionConfig.baseUrl.trim()) {
      setTestError('请先填写 API 地址');
      return;
    }
    if (!visionConfig.model.trim()) {
      setTestError('请先填写模型名');
      return;
    }
    const testImage = buildTestImage();
    if (!testImage) {
      setTestError('无法生成测试图片，请直接在聊天里发图验证');
      return;
    }
    setTesting(true);
    setTestError('');
    setTestResult('');
    try {
      const desc = await describeImages(visionConfig, {
        images: [testImage],
        text: '连接测试：请用一句话描述这张图片',
      });
      if (desc) {
        setTestResult(desc);
      } else {
        setTestError('识图模型没有返回描述内容，请确认模型是否支持图片输入');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '测试失败，请稍后重试');
    } finally {
      setTesting(false);
    }
  };

  return (
    <DetailShell title="识图模型" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 预设区 */}
        <section>
          <SectionLabel icon={ScanEye} tone={TONE_CYAN}>预设</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {BUILTIN_VISION_PRESETS.map((p) => {
              const active = visionConfig.baseUrl === p.baseUrl;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyBuiltin(p)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                    active
                      ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                      : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
            {visionPresets.map((p) => {
              const active =
                visionConfig.baseUrl === p.config.baseUrl && visionConfig.model === p.config.model;
              return (
                <span
                  key={p.id}
                  className={`flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2 text-[13px] transition-all active:scale-[0.97] ${
                    active
                      ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                      : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1]'
                  }`}
                >
                  <button type="button" onClick={() => applyUserPreset(p)} className="max-w-[120px] truncate">
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(p.id)}
                    aria-label={`删除识图预设 ${p.name}`}
                    className="opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
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
                placeholder="预设名称，如 本地视觉模型"
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

        {/* 配置表单 */}
        <section>
          <SectionLabel
            icon={Wrench}
            tone={TONE_BLUE}
            right={<span className="text-[11px] text-muted-foreground/70">更改自动保存 · 即时生效</span>}
          >
            连接配置
          </SectionLabel>
          <div className="flex flex-col gap-4 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {/* API 地址 */}
            <div>
              <FieldLabel>API 地址</FieldLabel>
              <Input
                value={visionConfig.baseUrl}
                onChange={(e) => patchVisionConfig({ baseUrl: e.target.value })}
                placeholder="填写识图 API 地址（OpenAI 兼容）"
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            {/* API Key */}
            <div>
              <FieldLabel>API Key</FieldLabel>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={visionConfig.apiKey}
                  onChange={(e) => patchVisionConfig({ apiKey: e.target.value })}
                  placeholder="sk-...（免 Key 接口可留空）"
                  autoComplete="off"
                  className={`h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)] ${
                    visionConfig.apiKey ? 'pr-16' : 'pr-10'
                  }`}
                />
                {visionConfig.apiKey && (
                  <button
                    type="button"
                    onClick={() => updateVisionConfig({ apiKey: '' })}
                    aria-label="清空识图 API Key"
                    className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏识图 Key' : '显示识图 Key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 模型名 */}
            <div className="relative">
              <FieldLabel>模型名</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={visionConfig.model}
                  onChange={(e) => patchVisionConfig({ model: e.target.value })}
                  placeholder="如 gpt-4o-mini / qwen-vl-plus / glm-4v-flash"
                  className="h-11 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                />
                <button
                  type="button"
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
                        placeholder="搜索模型，如 vl / vision"
                        autoFocus
                        className="h-10 rounded-[12px] border-black/[0.05] bg-white/70 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.09]"
                      />
                    </div>
                    <div className="thin-scrollbar max-h-[min(420px,60vh)] overflow-y-auto">
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
                              patchVisionConfig({ model: m });
                              setModelPanelOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                          >
                            <span className="truncate text-[14px]">{m}</span>
                            {visionConfig.model === m && (
                              <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    {/* v2.2.3：底部计数行（总数永远可见，不再出现「拉到 7 个只见 6 个」的错觉） */}
                    <div className="border-t border-black/[0.05] px-4 py-2 text-center text-[11px] tabular-nums text-muted-foreground dark:border-white/[0.06]">
                      {q ? `匹配 ${filteredModels.length}，共 ${models.length} 个模型` : `共 ${models.length} 个模型`}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 未配置提示（精简）：v1.9.25 起未配置时自动用聊天模型直识（支持图片输入即可） */}
            {!visionConfig.baseUrl.trim() && (
              <div className="rounded-[16px] border border-emerald-500/30 bg-emerald-300/15 px-3.5 py-2.5 text-[12px] leading-relaxed text-emerald-700 backdrop-blur-xl dark:border-emerald-400/25 dark:bg-emerald-300/[0.08] dark:text-emerald-200/90">
                未配置专用识图模型：发图时将自动用聊天模型直接看图（需聊天模型支持图片输入，如 gpt-4o / gemini / qwen-vl / glm-4v 等）；不支持时本次回复不结合图片，可在此另配识图模型。
              </div>
            )}

            {/* 识图测试 + 保存预设（v2.2.3：保存预设与测试按钮对齐；测试走与聊天发图同一条管线） */}
            <div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void runVisionTest()}
                  disabled={testing}
                  data-testid="vision-test-btn"
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[13px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                >
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanEye className="h-3.5 w-3.5" />}
                  {testing ? '正在识图…' : '测试识图'}
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
              {saveAnchor === 'config' && (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="预设名称，如 本地视觉模型"
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
                  data-testid="vision-test-error"
                  className="mt-2 flex items-start gap-1.5 px-1 text-[12px] leading-relaxed"
                  style={{ color: IOS_RED }}
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{testError}</span>
                </div>
              )}
              {testResult && (
                <div
                  data-testid="vision-test-result"
                  className="mt-2 flex items-start gap-1.5 px-1 text-[12px] leading-relaxed text-emerald-600 dark:text-emerald-400/90"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                  <span>{testResult}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 使用说明（精简为一段） */}
        <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
          识图模型只负责「看图」：发图先转文字描述再交给聊天模型；未配置时自动用聊天模型直接看图；图片仅传给你自己配置的接口，预设存本机。
        </p>
      </div>
    </DetailShell>
  );
}
