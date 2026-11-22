'use client';

/**
 * 订单图片生成/重生成弹层（美团/淘宝共用）：
 * - 模型选择：列出「设置 › 图像生成」当前配置 + 全部生图预设（imgGenPresets），单选；
 * - 提示词：可编辑 textarea（预填默认提示词）；
 * - 提交：onSubmit(prompt, cfg) 由调用方执行 generateFreePhoto（无锁脸，商品图不需要角色形象），
 *   成功后调用方把 dataURL 写回订单/表单并持久化（真正的落库，不留「假成功」）。
 * 未配置任何生图模型时显示引导文案，提交禁用。
 */

import { useMemo, useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { imgGenConfigReady } from '@/lib/imggen';
import type { ImgGenConfig } from '@/lib/ios/store';
import { useSettings } from '@/lib/ios/store';

/** 一个可选的生图模型（当前配置或某个预设） */
export interface ImgGenModelOption {
  key: string;
  /** 展示名（预设名 / 模型名） */
  name: string;
  cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' };
}

/** 收集当前可用的生图模型（当前配置优先 + 预设；都未配置 = 空数组） */
export function collectImgGenModels(): ImgGenModelOption[] {
  const s = useSettings.getState();
  const list: ImgGenModelOption[] = [];
  if (s.imgGenConfig.enabled && imgGenConfigReady(s.imgGenConfig)) {
    list.push({ key: '__main', name: s.imgGenConfig.model.trim() || '当前图像生成配置', cfg: s.imgGenConfig });
  }
  for (const p of s.imgGenPresets) {
    if (!imgGenConfigReady(p.config)) continue;
    list.push({ key: p.id, name: p.name || p.config.model || '预设配置', cfg: p.config });
  }
  return list;
}

export function OrderImgGenSheet({
  open,
  title = '生成商品图片',
  /** 预填提示词（每次打开时重置） */
  initialPrompt,
  busy,
  error,
  accent = '#FF6000',
  submitLabel = '生成图片',
  onSubmit,
  onClose,
}: {
  open: boolean;
  title?: string;
  initialPrompt: string;
  busy: boolean;
  error: string;
  /** 主题色（美团橙 / 淘宝橙） */
  accent?: string;
  submitLabel?: string;
  /** 提交：提示词 + 所选模型配置；调用方执行真实生图与落库 */
  onSubmit: (prompt: string, cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' }) => void;
  onClose: () => void;
}) {
  const models = useMemo(() => collectImgGenModels(), []);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [modelKey, setModelKey] = useState<string>(() => collectImgGenModels()[0]?.key ?? '');
  // 组件由父层按需挂载（open=true 才渲染），状态直接用 props 初始化；open 变 false 直接不渲染
  if (!open) return null;
  const sel = models.find((m) => m.key === modelKey) ?? null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 px-3 pb-[max(14px,env(safe-area-inset-bottom))]"
      data-testid="order-imggen-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-[360px]">
        <div className="overflow-hidden rounded-[14px] bg-white/95 pb-1 backdrop-blur-xl">
          <div className="px-4 pb-2 pt-3">
            <p className="text-[15px] font-semibold text-black/85">{title}</p>
            <p className="mt-0.5 text-[11.5px] leading-[1.5] text-black/45">选择生图模型并修改提示词，生成成功后图片将替换/写入订单</p>
            {/* 提示词 */}
            <textarea
              data-testid="order-imggen-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={300}
              disabled={busy}
              placeholder="描述图片内容（商品/场景/风格），如：一杯满杯鲜芋泥奶茶，紫色调，摆在木桌上"
              className="mt-2.5 w-full resize-none rounded-[10px] border border-black/[0.10] bg-black/[0.03] px-3 py-2 text-[13.5px] leading-[1.6] text-black/80 outline-none placeholder:text-black/30 focus:border-black/25 disabled:opacity-60"
            />
            {/* 模型选择 */}
            <div className="mt-2.5">
              <p className="text-[12px] font-medium text-black/55">生图模型（设置 › 图像生成）</p>
              {models.length === 0 ? (
                <p className="mt-1.5 rounded-lg bg-[#FFF6E6] px-2.5 py-2 text-[12px] leading-[1.6] text-[#B77900]">
                  还没有可用的生图模型：请先到 设置 › 图像生成 完成接口配置（或添加生图预设）
                </p>
              ) : (
                <div className="mt-1.5 max-h-[132px] space-y-1 overflow-y-auto" data-testid="order-imggen-models">
                  {models.map((m) => {
                    const active = m.key === modelKey;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        disabled={busy}
                        onClick={() => setModelKey(m.key)}
                        className={`flex w-full items-center gap-2 rounded-[10px] border px-3 py-2 text-left transition-colors ${
                          active ? 'border-current bg-black/[0.03]' : 'border-black/[0.08] active:bg-black/[0.04]'
                        }`}
                        style={active ? { borderColor: accent, color: accent } : undefined}
                      >
                        <span
                          className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border ${active ? 'border-current' : 'border-black/25'}`}
                          style={active ? { borderColor: accent } : undefined}
                        >
                          {active && <span className="h-[7px] w-[7px] rounded-full" style={{ background: accent }} />}
                        </span>
                        <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? 'font-medium' : 'text-black/70'}`}>{m.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {error ? <p className="mt-1.5 text-[12px] text-red-500">{error}</p> : null}
          </div>
          <button
            type="button"
            data-testid="order-imggen-submit"
            onClick={() => sel && onSubmit(prompt.trim(), sel.cfg)}
            disabled={busy || !prompt || !sel}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 text-[15.5px] font-medium active:bg-black/[0.05] disabled:opacity-60"
            style={{ color: accent }}
          >
            {busy ? (
              <>
                <Loader2 className="h-[16px] w-[16px] animate-spin" strokeWidth={2.4} aria-hidden="true" />
                正在生成…
              </>
            ) : (
              <>
                <Wand2 className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
                {submitLabel}
              </>
            )}
          </button>
        </div>
        <button
          type="button"
          data-testid="order-imggen-cancel"
          onClick={onClose}
          disabled={busy}
          className="mt-2 flex min-h-[50px] w-full items-center justify-center rounded-[14px] bg-white/95 text-[16px] font-semibold text-black/80 backdrop-blur-xl active:bg-black/[0.05] disabled:opacity-60"
        >
          取消
        </button>
      </div>
    </div>
  );
}
