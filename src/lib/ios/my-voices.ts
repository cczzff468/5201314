'use client';

/**
 * 我的音色（用户自建音色库，永久保存在本机）：
 * - 「设置 › 语音 API › 我的音色」里添加：填一个名字（如「温柔御姐」）+ 音色 ID
 *   （MiniMax 音色名 / OpenAI 音色名 / 内置声线 id `builtin:…` 均可），保存后永久生效；
 * - 「联系人 App 编辑角色」与聊天设置「他的声音」里都会出现这些音色，点选即用；
 * - 实际发声由当前 TTS 服务商解析 voiceId（内置声线 id 在内置引擎下可直接朗读）。
 * - 持久化：localStorage 单键 JSON（与回复条数等本机设置同风格），跨刷新/重启不丢。
 */

import { create } from 'zustand';
import { BUILTIN_TTS_VOICES } from './builtin-voices';

export interface MyVoice {
  /** 唯一 id（my: 前缀，仅用于本库内部删除/遍历） */
  id: string;
  /** 展示名（如 温柔御姐） */
  name: string;
  /** 音色 ID（服务商音色名或 builtin: 声线 id；保存到联系人 voiceId 的是这个值） */
  voiceId: string;
}

const STORE_KEY = 'my-tts-voices';

function load(): MyVoice[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: MyVoice[] = [];
    for (const it of parsed) {
      if (!it || typeof it !== 'object') continue;
      const rec = it as Partial<MyVoice>;
      if (typeof rec.id === 'string' && typeof rec.name === 'string' && typeof rec.voiceId === 'string' && rec.name.trim() && rec.voiceId.trim()) {
        out.push({ id: rec.id, name: rec.name.trim(), voiceId: rec.voiceId.trim() });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function persist(list: MyVoice[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    // 存储失败忽略（内存态本次会话仍生效）
  }
}

export interface MyVoicesState {
  voices: MyVoice[];
  /** 添加一个音色（名字与音色 ID 都必填；完全重复的忽略）。成功返回记录，失败返回 null */
  add: (name: string, voiceId: string) => MyVoice | null;
  /** 删除一个音色 */
  remove: (id: string) => void;
}

export const useMyVoices = create<MyVoicesState>((set, get) => ({
  voices: load(),
  add(name, voiceId) {
    const n = name.trim();
    const v = voiceId.trim();
    if (!n || !v) return null;
    if (get().voices.some((x) => x.name === n && x.voiceId === v)) return null;
    const rec: MyVoice = {
      id: `my:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: n,
      voiceId: v,
    };
    const list = [...get().voices, rec];
    persist(list);
    set({ voices: list });
    return rec;
  },
  remove(id) {
    const list = get().voices.filter((v) => v.id !== id);
    persist(list);
    set({ voices: list });
  },
}));

/**
 * 音色 ID → 展示名（「他的声音」等入口行的摘要用）：
 * 内置声线 → 声线名；我的音色 → 名字；其它 → 原样 ID；空 → 默认。
 */
export function describeVoiceId(voiceId: string | null | undefined, myVoices?: MyVoice[]): string {
  const v = voiceId?.trim() ?? '';
  if (!v) return '默认';
  const builtin = BUILTIN_TTS_VOICES.find((p) => p.id === v);
  if (builtin) return `${builtin.name}（${builtin.label}）`;
  const mine = (myVoices ?? []).find((x) => x.voiceId === v);
  return mine ? mine.name : v;
}
