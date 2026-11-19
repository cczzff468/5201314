'use client';

/**
 * API 多渠道故障转移（v1.9.25）。
 *
 * 渠道链 = 主渠道（apiConfig）+ 备用渠道（apiFallbacks，设置 › API 配置 › 备用渠道）。
 * 主渠道请求失败（连接不上/鉴权失败/限流/上游 5xx 等）且本轮还没有任何已投递内容时，
 * 自动按顺序改用备用渠道重发一轮——对用户完全透明，消息照常送达。
 *
 * 口径约定：
 * - 发送时刻现场读取（与各调用点读 useSettings 的既有口径一致，保存即生效无需重启）；
 * - 备用渠道继承主渠道的温度/最大 Token（只填 地址/Key/模型 三项）；
 * - 地址或模型为空的备用项直接跳过；
 * - 已有部分内容产出（流中断）或用户中止（换号/取消）时【不】转移——前者重发会重复
 *   已上屏的分段，后者属于主动作废；这两种情况沿用原有的「保留已到手的正文 + 落错误」行为。
 */

import type { ApiConfig, ApiFallback } from '@/lib/ios/store';
import { useSettings } from '@/lib/ios/store';

/** 把主渠道 + 备用渠道展开成完整请求配置链（备用项继承主渠道 temperature/maxTokens） */
export function apiChainOf(apiConfig: ApiConfig, fallbacks: ApiFallback[]): ApiConfig[] {
  const chain: ApiConfig[] = [apiConfig];
  for (const f of fallbacks) {
    if (!f.baseUrl.trim() || !f.model.trim()) continue; // 未填完的占位行跳过
    chain.push({
      baseUrl: f.baseUrl,
      apiKey: f.apiKey,
      model: f.model,
      temperature: apiConfig.temperature,
      maxTokens: apiConfig.maxTokens,
    });
  }
  return chain;
}

/** 发送时刻现场读取完整渠道链（主渠道 + 已配置的备用渠道） */
export function currentApiChain(): ApiConfig[] {
  const { apiConfig, apiFallbacks } = useSettings.getState();
  return apiChainOf(apiConfig, apiFallbacks);
}
