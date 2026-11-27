'use client';

// API（聊天模型）设置页 + 内置 API 预设。

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  Check,
  Cloud,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Plus,
  Repeat,
  Save,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';

import { genId } from '@/lib/ios/db';

import {
  useSettings,
  type ApiFallback,
  type ApiPreset,
} from '@/lib/ios/store';

import { Input } from '@/components/ui/input';

import { Slider } from '@/components/ui/slider';

import {
  directTest,
  isPrivateApiUrl,
  pullModelsUnified,
} from '@/lib/ios/direct-api';

// 云端助手（微信 7x24 自动回复）：部署到用户自己的 Supabase。
// 状态中心 + 部署管线都在 src/lib/ios/wx-cloud/，凭证只在用户浏览器密文保存。
import { useWxCloud } from '@/lib/ios/wx-cloud/store';

import {
  IS_TOUCH_DEVICE,
  IOS_RED,
  TONE_BLUE,
  TONE_CYAN,
  DetailShell,
  FieldLabel,
  SectionLabel,
  useModelPanelReveal,
} from './shared';



/** 内置预设：OpenAI + 国内可直连三家。海外厂商服务器出口有地区限制，但拉模型/测连接/聊天流式
 *  均已内置「服务端失败 → 浏览器直连」自动回退（directOnly），OpenAI 兼容中转/反代地址同样适用 */
export const BUILTIN_API_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
];
// ---------------- API 设置 ----------------

export function ApiPage({ onBack }: { onBack: () => void }) {
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiPresets = useSettings((s) => s.apiPresets);
  const updateApiConfig = useSettings((s) => s.updateApiConfig);
  const setApiPresets = useSettings((s) => s.setApiPresets);
  const apiFallbacks = useSettings((s) => s.apiFallbacks);
  const setApiFallbacks = useSettings((s) => s.setApiFallbacks);

  const [showKey, setShowKey] = useState(false);
  // v2.2.3：「保存预设」双入口锚点——预设区顶部「添加预设」chip 与连接配置区「保存预设」
  // 按钮共用同一份名称输入状态，锚点决定输入行渲染在哪个入口下方（同一时间只开一处）
  const [saveAnchor, setSaveAnchor] = useState<'preset' | 'config' | null>(null);
  const [presetName, setPresetName] = useState('');

  const [models, setModels] = useState<string[]>([]);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');

  // v2.2.4 模型面板滑动三连修（机主实测「拉取模型那个面板不能滑动了」）：
  // ① 旧 fixed 全屏遮罩吃掉页面触摸滚动（fixed 元素在变换容器内不参与滚动链——
  //    面板高度抬到 ~490px 超出一屏后：页面拖不动、列表又不满无需滚 → 什么都滑不了）
  //    → 撤掉遮罩，改 document click 委托做 outside-click 关闭：拖动滚动不触发 click
  //    （面板保持打开、页面正常滚），真实点击外部才关闭；
  // ② 面板开启后把模型区滚到可视中部（面板从锚点向下展开，不滚底部会超屏）；
  // ③ 列表内部滚动强化（overscroll-contain + touch-action + 高度上限收敛）。
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

  // v2.2.5 F-1 模型面板露出双根修（机主实测「拉取模型那个面板不能滑动了」）：
  // ① 面板开启后自动补滚：旧版 scrollIntoView(block:'center') 只把锚点（模型输入行）居中——
  //    面板从锚点向下展开 300~460px，尾部常年叠在屏幕外（实测底边 745px vs 视口 577px）；
  //    现在改为「面板底边超出视口 → 页面滚动容器补滚到面板完整可见（夹在最大可滚量内）」。
  // ② 列表不可滚时移除 overscroll-contain：contain 会切断滚动链——列表内容不满一屏时
  //    它本身就是滚动容器，触摸永远在边界上、永远不链给页面 → 手指划面板什么都不动。
  //    现在只在列表真正可滚（内容超出 max-h）时才 contain，不满时链给页面正常滚。
  const [modelListScrollable, setModelListScrollable] = useState(false);
  useEffect(() => {
    const sec = modelSectionRef.current;
    const list = (sec?.querySelector('[data-model-panel] .overflow-y-auto') as HTMLElement | null) ?? null;
    setModelListScrollable(!!list && list.scrollHeight - list.clientHeight > 4);
  }, [models, modelPanelOpen, modelQuery]);
  // v2.4.27（第四十六轮）：补滚露出逻辑抽成共享 hook（api/vision/imggen/voice 四页同一实现）——
  // 容器可见底边基准 + 锚点行不破屏上限 + 键盘/窗口尺寸变化重算（详见 shared.tsx 注释）
  useModelPanelReveal(modelSectionRef, modelPanelOpen, models, modelQuery);

  const [testLoading, setTestLoading] = useState(false);
  const [testOk, setTestOk] = useState<{ latencyMs: number; model: string; viaDirect?: boolean } | null>(null);
  const [testError, setTestError] = useState('');
  const [testConnected, setTestConnected] = useState(false);
  const [testUrl, setTestUrl] = useState('');
  // v2.2.2：「连接基本可用」中间态——chat/completions 双通道测试都未完成，但模型列表
  // 验证了地址与密钥有效（聊天实际走双通道自动切换，能收发即正常），不再误报「连接不上」
  const [testPartial, setTestPartial] = useState<{ modelCount: number } | null>(null);

  const [maxText, setMaxText] = useState(() => String(apiConfig.maxTokens));
  // v2.2：温度数值输入缓冲（与 Slider 双向同步——拖滑块更新 tempText，输入框改值也回写 apiConfig）
  const [tempText, setTempText] = useState(() => apiConfig.temperature.toFixed(1));

  // ---- 云端自动同步（v6）：改「API 设置」后自动重推运行包到已部署的云端（同接入/换绑/
  // 断开微信 QQ 的自动同步链路——改完不用再手动去云端助手页点「重新同步运行包」）。
  // 2.5 秒防抖合并连续编辑；离开本页时还有未同步的变更立即补一发（防抖被卸载截断）。
  // 没部署过云端时 autoSyncRunPackageIfDeployed 直接 no-op，不打扰未部署用户。 ----
  const apiSyncTimer = useRef<number | null>(null);
  const apiSyncBase = useRef<string | null>(null);
  useEffect(() => {
    const sig = `${apiConfig.baseUrl}|${apiConfig.apiKey}|${apiConfig.model}`;
    if (apiSyncBase.current === null) {
      apiSyncBase.current = sig; // 挂载首轮只记基线（没变更不触发）
      return;
    }
    if (sig === apiSyncBase.current) return;
    if (apiSyncTimer.current) window.clearTimeout(apiSyncTimer.current);
    apiSyncTimer.current = window.setTimeout(() => {
      apiSyncTimer.current = null;
      // 已推过的基线前移（失败不自动重试：到 设置 → 云端助手「重新同步运行包」兑底）
      apiSyncBase.current = sig;
      void import('@/lib/ios/wx-cloud/supabase').then((m) => m.autoSyncRunPackageIfDeployed('API 设置已更新', 'api'));
    }, 2500);
  }, [apiConfig]);
  useEffect(
    () => () => {
      // 卸载补发：防抖计时器还挂着 = 变更还没推出去，立即推（不等 2.5 秒）
      if (apiSyncTimer.current) {
        window.clearTimeout(apiSyncTimer.current);
        apiSyncTimer.current = null;
        void import('@/lib/ios/wx-cloud/supabase').then((m) => m.autoSyncRunPackageIfDeployed('API 设置已更新', 'api'));
      }
    },
    [],
  );
  /** 改「API 设置」后的后台自动同步结果（只看 api 渠道；同步在页面上时即时刷新） */
  const apiAutoSync = useWxCloud((s) => s.lastAutoSync);

  const clearTestResult = () => {
    setTestOk(null);
    setTestError('');
    setTestConnected(false);
    setTestUrl('');
    setTestPartial(null);
  };

  const applyBuiltin = (p: (typeof BUILTIN_API_PRESETS)[number]) => {
    updateApiConfig({ baseUrl: p.baseUrl, model: p.model });
    clearTestResult();
  };

  const applyUserPreset = (p: ApiPreset) => {
    updateApiConfig(p.config);
    setMaxText(String(p.config.maxTokens));
    setTempText(p.config.temperature.toFixed(1));
    clearTestResult();
  };

  const deletePreset = (id: string) => {
    setApiPresets(apiPresets.filter((p) => p.id !== id));
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setApiPresets([...apiPresets, { id: genId(), name, config: { ...apiConfig } }]);
    setPresetName('');
    setSaveAnchor(null);
  };

  /** 修改第 i 个备用渠道的单个字段（未填完的空行保留在编辑中，发送时由渠道链自动跳过） */
  const patchFallback = (i: number, patch: Partial<ApiFallback>) => {
    setApiFallbacks(apiFallbacks.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  };

  const fetchModels = async () => {
    if (!apiConfig.baseUrl.trim()) {
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
      const out = await pullModelsUnified(apiConfig.baseUrl, apiConfig.apiKey);
      if (out.models.length > 0) {
        setModels(out.models);
        setModelQuery('');
        setModelPanelOpen(true);
        // v2.2.5：露出逻辑移入 modelPanelOpen effect（补滚到面板完整可见，旧版只把锚点
        // 居中导致面板尾部常年叠在屏幕外；两处 effect 共享同一份时机/依赖）
        // v2.2.3：通道计数提示全删（「浏览器直连拉取到 N 个（服务器通道不可用）」等）——
        // 模型总数改由面板底部计数行展示，单一数据源不再出现「说 7 个只见 6 个」的错觉；
        // 仅保留「本次实时拉取失败、展示的是上次缓存」这一条有行动价值的提示
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

  const runTest = async () => {
    if (!apiConfig.baseUrl.trim()) {
      setTestError('请先填写 API 地址');
      return;
    }
    setTestLoading(true);
    clearTestResult();
    try {
      const res = await fetch('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: apiConfig.baseUrl,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          temperature: apiConfig.temperature,
          maxTokens: apiConfig.maxTokens,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            latencyMs?: number;
            model?: string;
            error?: string;
            connected?: boolean;
            url?: string;
            directOnly?: boolean;
            upstreamStatus?: number;
          }
        | null;
      setTestUrl(typeof data?.url === 'string' ? data.url : '');
      if (data?.ok) {
        setTestOk({ latencyMs: data.latencyMs ?? 0, model: data.model ?? apiConfig.model });
        return;
      }
      const isPrivate = isPrivateApiUrl(apiConfig.baseUrl);
      const serverError = data?.error ?? '测试失败，请稍后重试';
      // v2.2.2：需要浏览器直连兑底的情况：私网地址 / 服务器网络不可达或地区受限（directOnly）/
      // 403、429（可能是 WAF/限流针对服务器出口 IP，用户本机不一定受影响）/ 服务器返回非 JSON。
      // 401（Key 无效）、400（参数）、404（路径不存在）是服务商给出的确定性结论，不再直连重试
      const needsDirect =
        isPrivate ||
        !data ||
        Boolean(data.directOnly) ||
        data.upstreamStatus === 403 ||
        data.upstreamStatus === 429;
      if (!needsDirect) {
        setTestError(serverError);
        setTestConnected(Boolean(data?.connected));
        return;
      }
      // 并行：浏览器直连测试 + 双通道模型列表探针（探针同时写入模型缓存，供「拉取模型」复用）
      const [direct, probe] = await Promise.all([
        directTest(apiConfig),
        pullModelsUnified(apiConfig.baseUrl, apiConfig.apiKey),
      ]);
      if (direct.ok) {
        setTestOk({ latencyMs: direct.latencyMs, model: direct.model, viaDirect: true });
        return;
      }
      // 聊天端点双通道都没测通，但模型列表能拉到 → 地址与密钥有效，
      // 聊天实际在「服务器代理 / 浏览器直连」间自动切换：不再误报「连接不上」
      if (probe.models.length > 0) {
        setTestPartial({ modelCount: probe.models.length });
        return;
      }
      setTestUrl(apiConfig.baseUrl);
      setTestError(
        isPrivate
          ? direct.error ?? '浏览器直连失败'
          : `${serverError}；浏览器直连也不可用：${direct.error ?? '请确认该 API 允许跨域访问（CORS）'}`
      );
    } catch {
      setTestError('无法连接到服务器');
    } finally {
      setTestLoading(false);
    }
  };

  const handleMaxChange = (v: string) => {
    setMaxText(v);
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n >= 64) updateApiConfig({ maxTokens: n });
  };

  const handleMaxBlur = () => {
    const n = Number.parseInt(maxText, 10);
    if (!Number.isFinite(n) || n < 64) {
      setMaxText(String(apiConfig.maxTokens));
    } else {
      setMaxText(String(n));
      updateApiConfig({ maxTokens: n });
    }
  };

  // v2.2：温度输入框（与 Slider 同源）——输入时实时回写 apiConfig（clamp 0~2，保留 1 位小数）
  const handleTempChange = (v: string) => {
    setTempText(v);
    const n = Number.parseFloat(v);
    if (Number.isFinite(n) && n >= 0 && n <= 2) {
      updateApiConfig({ temperature: Math.round(n * 10) / 10 });
    }
  };
  // 失焦兜底：非法/超范围值回退到当前 apiConfig.temperature
  const handleTempBlur = () => {
    const n = Number.parseFloat(tempText);
    if (!Number.isFinite(n) || n < 0 || n > 2) {
      setTempText(apiConfig.temperature.toFixed(1));
    } else {
      const clamped = Math.max(0, Math.min(2, Math.round(n * 10) / 10));
      setTempText(clamped.toFixed(1));
      updateApiConfig({ temperature: clamped });
    }
  };

  const q = modelQuery.trim().toLowerCase();
  const filteredModels = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;

  return (
    <DetailShell title="API 设置" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 预设区 */}
        <section>
          <SectionLabel icon={Layers} tone={TONE_CYAN}>预设</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {BUILTIN_API_PRESETS.map((p) => {
              const active = apiConfig.baseUrl === p.baseUrl;
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
            {apiPresets.map((p) => {
              const active =
                apiConfig.baseUrl === p.config.baseUrl && apiConfig.model === p.config.model;
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
                    aria-label={`删除预设 ${p.name}`}
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
                placeholder="预设名称，如 我的GPT"
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
            right={<span className="text-[11px] text-muted-foreground/70">更改自动保存</span>}
          >
            连接配置
          </SectionLabel>
          <div className="flex flex-col gap-4 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {/* API 地址 */}
            <div>
              <FieldLabel>API 地址</FieldLabel>
              <Input
                value={apiConfig.baseUrl}
                onChange={(e) => updateApiConfig({ baseUrl: e.target.value })}
                placeholder="填写 API 地址（OpenAI 兼容）"
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            {/* API Key */}
            <div>
              <FieldLabel>API Key</FieldLabel>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiConfig.apiKey}
                  onChange={(e) => updateApiConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                  className={`h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)] ${
                    apiConfig.apiKey ? 'pr-16' : 'pr-10'
                  }`}
                />
                {/* 清空 Key（仅在有内容时显示） */}
                {apiConfig.apiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      updateApiConfig({ apiKey: '' });
                      clearTestResult();
                    }}
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

            {/* 模型 */}
            <div ref={modelSectionRef} className="relative">
              <FieldLabel>模型</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={apiConfig.model}
                  onChange={(e) => updateApiConfig({ model: e.target.value })}
                  placeholder="如 gpt-4o-mini / deepseek-chat"
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
                <div
                  data-model-panel
                  className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-2xl ring-1 ring-black/[0.05] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-[#1C1C1E]/85"
                >
                    <div className="border-b border-black/[0.05] p-2 dark:border-white/[0.06]">
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="搜索模型，如 32k / turbo"
                        // v2.4.27（第四十六轮）：触屏设备不再 autoFocus——面板一开就拉起
                        // 软键盘会盖住半个面板（APK 无键盘跟随时尤甚）；桌面保留 autoFocus
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
                              updateApiConfig({ model: m });
                              setModelPanelOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                          >
                            <span className="truncate text-[14px]">{m}</span>
                            {apiConfig.model === m && (
                              <Check
                                className="h-4 w-4 shrink-0 text-foreground"
                                strokeWidth={2.5}
                              />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    {/* v2.2.3：底部计数行——小屏折叠线以下仍有模型时计数行让总数永远可见；
                        v2.2.5 F-1：列表高度收敛到 min(360px,48vh) + 不满一屏时放开 contain 保滚动链 */}
                    <div className="border-t border-black/[0.05] px-4 py-2 text-center text-[11px] tabular-nums text-muted-foreground dark:border-white/[0.06]">
                      {q ? `匹配 ${filteredModels.length}，共 ${models.length} 个模型` : `共 ${models.length} 个模型`}
                    </div>
                  </div>
              )}
            </div>

            {/* 测试连接 + 保存预设（v2.2.3 机主要求：测试按钮移到模型下方，保存预设与测试按钮对齐） */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testLoading}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                {testLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                测试连接
              </button>
              <button
                type="button"
                onClick={() => setSaveAnchor((v) => (v === 'config' ? null : 'config'))}
                className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-[14px] text-[14px] font-medium shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 backdrop-blur-2xl transition-all active:scale-[0.98] disabled:opacity-40 dark:active:bg-white/[0.16] ${
                  saveAnchor === 'config'
                    ? 'bg-foreground text-background ring-transparent dark:bg-white dark:text-black'
                    : 'bg-white/60 text-foreground ring-white/70 active:bg-white/85 dark:bg-white/[0.1] dark:ring-white/[0.12]'
                }`}
              >
                <Save className="h-4 w-4" />
                保存预设
              </button>
            </div>
            {saveAnchor === 'config' && (
              <div className="flex gap-2">
                <Input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="预设名称，如 我的GPT"
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
            {testOk && (
              <div className="rounded-[16px] border border-emerald-500/30 bg-emerald-400/15 px-4 py-3 text-[13px] leading-relaxed text-emerald-700 backdrop-blur-xl dark:bg-emerald-300/[0.08] dark:text-emerald-300">
                ✅ 连接成功{testOk.viaDirect ? '（浏览器直连）' : ''} · 延迟 {testOk.latencyMs}ms · 模型 {testOk.model}
              </div>
            )}
            {testPartial && (
              <div
                data-testid="test-partial"
                className="rounded-[16px] border border-amber-500/30 bg-amber-400/15 px-4 py-3 text-[13px] font-medium leading-relaxed text-amber-700 backdrop-blur-xl dark:bg-amber-300/[0.08] dark:text-amber-200/90"
              >
                ⚠️ 连接基本可用：API 地址与密钥有效（模型列表验证通过，共 {testPartial.modelCount} 个模型）
                <span className="mt-1 block text-[12px] font-normal opacity-80">
                  chat/completions 测试请求从当前网络未能完成；实际聊天会在「服务器代理 / 浏览器直连」双通道间自动切换，能正常收发消息即无需处理。
                </span>
              </div>
            )}
            {testError && (
              <div
                className="rounded-[12px] border px-4 py-3 text-[13px] leading-relaxed"
                style={
                  testConnected
                    ? {
                        borderColor: 'rgba(245,158,11,0.35)',
                        backgroundColor: 'rgba(245,158,11,0.1)',
                        color: '#B45309',
                      }
                    : { borderColor: 'rgba(255,69,58,0.3)', backgroundColor: 'rgba(255,69,58,0.1)', color: IOS_RED }
                }
              >
                {testConnected ? '⚠️ ' : '❌ '}
                {testError}
                {testConnected && (
                  <span className="mt-1 block text-[12px] opacity-80">
                    接口本身可达，问题出在配置而不是连接；按提示修正后即可聊天。
                  </span>
                )}
              </div>
            )}
            {testUrl && (
              <div className="break-all px-1 text-[11px] leading-relaxed text-muted-foreground/80">
                实际请求：{testUrl}
              </div>
            )}

            {/* 温度（v2.2.3：随测试按钮上移后下排在测试结果之后） */}
            <div>
              <div className="mb-2.5 text-[13px] font-medium text-muted-foreground">温度</div>
              <div className="flex items-center gap-3">
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={[apiConfig.temperature]}
                  onValueChange={(v) => {
                    const t = v[0] ?? 0.7;
                    updateApiConfig({ temperature: t });
                    setTempText(t.toFixed(1));
                  }}
                  className="flex-1"
                  aria-label="温度"
                />
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={tempText}
                  onChange={(e) => handleTempChange(e.target.value)}
                  onBlur={handleTempBlur}
                  aria-label="温度数值"
                  className="h-9 w-[76px] rounded-full border-black/[0.05] bg-white/65 text-center text-[13px] tabular-nums shadow-sm ring-1 ring-black/[0.05] backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.1] dark:ring-white/[0.1]"
                />
              </div>
            </div>

            {/* 最大 Token */}
            <div>
              <FieldLabel>最大 Token</FieldLabel>
              <Input
                type="number"
                min={64}
                step={64}
                value={maxText}
                onChange={(e) => handleMaxChange(e.target.value)}
                onBlur={handleMaxBlur}
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            {/* 未配置 Key 提示 */}
            {!apiConfig.apiKey.trim() && (
              <div className="rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                未配置 API Key 时，AI 助手无法回复；请填写 OpenAI 兼容接口地址与 API Key 后再聊天。
              </div>
            )}
          </div>
        </section>

        {/* 备用渠道（多渠道故障转移） */}
        <section>
          <SectionLabel
            icon={Repeat}
            tone={TONE_BLUE}
            right={<span className="text-[11px] text-muted-foreground/70">主渠道失败时自动切换</span>}
          >
            备用渠道
          </SectionLabel>
          <div className="flex flex-col gap-4 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              主渠道请求失败（连接不上 / 鉴权失败 / 限流等）且本轮还没有内容产出时，自动按顺序改用下面配置的备用渠道重发，消息照常送达；温度与最大 Token 沿用主渠道。
            </p>
            {apiFallbacks.map((f, i) => (
              <div
                key={i}
                className="flex flex-col gap-2.5 rounded-[16px] bg-white/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ring-1 ring-black/[0.04] dark:bg-white/[0.05] dark:ring-white/[0.07]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-muted-foreground">备用渠道 {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setApiFallbacks(apiFallbacks.filter((_, j) => j !== i))}
                    aria-label={`删除备用渠道 ${i + 1}`}
                    className="p-1 text-muted-foreground transition-colors hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <Input
                  value={f.baseUrl}
                  onChange={(e) => patchFallback(i, { baseUrl: e.target.value })}
                  placeholder="备用 API 地址（OpenAI 兼容）"
                  className="h-10 rounded-[12px] border-black/[0.05] bg-white/55 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.07]"
                />
                <Input
                  value={f.apiKey}
                  onChange={(e) => patchFallback(i, { apiKey: e.target.value })}
                  type="password"
                  autoComplete="off"
                  placeholder="API Key（反代可留空）"
                  className="h-10 rounded-[12px] border-black/[0.05] bg-white/55 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.07]"
                />
                <Input
                  value={f.model}
                  onChange={(e) => patchFallback(i, { model: e.target.value })}
                  placeholder="模型（如 deepseek-chat）"
                  className="h-10 rounded-[12px] border-black/[0.05] bg-white/55 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.07]"
                />
              </div>
            ))}
            {apiFallbacks.length < 5 && (
              <button
                type="button"
                onClick={() => setApiFallbacks([...apiFallbacks, { baseUrl: '', apiKey: '', model: '' }])}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-black/15 text-[13px] font-medium text-muted-foreground transition-all active:scale-[0.98] hover:border-black/25 hover:text-foreground dark:border-white/15 dark:hover:border-white/30"
              >
                <Plus className="h-4 w-4" />
                添加备用渠道
              </button>
            )}
          </div>
        </section>

        {/* 云端自动同步状态行 + 说明（测试按钮已上移到模型下方） */}
        <section className="flex flex-col gap-3">
          {/* 云端自动同步状态行：改「API 设置」后运行包自动重推到已部署云端的结果
              （只显示 api 渠道的同步；未部署云端时不触发不显示） */}
          {apiAutoSync?.channel === 'api' && (
            <div
              data-testid="api-autosync"
              className={`flex items-start gap-1.5 rounded-[12px] px-3 py-2 text-[12px] leading-[1.5] ${
                apiAutoSync.ok
                  ? 'bg-[#34C759]/[0.08] text-[#2E9E4F]'
                  : 'border border-amber-500/30 bg-amber-300/15 text-amber-700 dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90'
              }`}
            >
              <Cloud className="mt-[2px] h-[13px] w-[13px] shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                {apiAutoSync.ok
                  ? `${apiAutoSync.msg}（${new Date(apiAutoSync.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）`
                  : apiAutoSync.msg}
              </span>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            预设保存后下次打开网站依然可用（数据保存在本机 IndexedDB）；已部署云端助手时，改这里的配置会自动同步到云端（真机微信/QQ 的回复跟着换）。
          </p>
        </section>
      </div>
    </DetailShell>
  );
}
