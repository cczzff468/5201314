/**
 * 轻量 LLM 补全（AI 助读三件套专用：前情回顾/本章速读/推荐书单）
 * 独立于 ai.ts（避免与陪读聊天共用模块时的热更新缓存问题），禁思考链省 Token。
 */
import type { LLMMessage } from '@/lib/server-llm';

interface ZAIClient {
  chat: {
    completions: {
      create: (body: {
        model?: string;
        messages: LLMMessage[];
        stream?: boolean;
        thinking?: { type: 'enabled' | 'disabled' };
        [k: string]: unknown;
      }) => Promise<{ choices?: { message?: { content?: string } }[] }>;
    };
  };
}

let zaiCache: ZAIClient | null = null;
async function getZai(): Promise<ZAIClient> {
  if (zaiCache) return zaiCache;
  const { default: ZAI } = await import('z-ai-web-dev-sdk');
  zaiCache = (await ZAI.create()) as unknown as ZAIClient;
  return zaiCache;
}

export async function lightChat(messages: LLMMessage[], maxTokens = 512): Promise<string> {
  const zai = await getZai();
  const res = await zai.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
    max_tokens: maxTokens,
    temperature: 0.7,
  });
  const text = res?.choices?.[0]?.message?.content || '';
  return text.trim();
}
