/**
 * 文字转语音发送（不想说话时：输入文字 → 发出语音气泡）共用链路：
 * - **无需配置语音 API、也不需要真的出声**：本地直接生成仿真语音气泡
 *   （估算时长 + 文本哈希波形 + 下方白色原文面板），点击气泡只走静音进度动画
 * - 消息里持久化原文（localText），AI 通过 transcript 读得到内容，重启后仍可显示/模拟播放
 * - 文本清洗后为空 → 抛「没有可转语音的内容」（调用方 toast，不影响文字聊天）
 */

import { hashWaveBars } from './audio-utils';
import { cleanTextForTts } from './tts-client';

export interface SelfVoiceClip {
  /** 本地仿真无音频文件：url 恒为空字符串，播放器见到 localText 即走静音模拟播放 */
  dataUrl: string;
  /** 秒（≥1，按字数估算） */
  duration: number;
  /** 静态波形（0~1，22 根，文本哈希生成） */
  wave: number[];
  /** 仿真朗读原文（持久化在消息里；播放器据此走静音模拟，AI 也能读到内容） */
  localText: string;
}

/** 仿真语音时长估算（约 4 字/秒，至少 1 秒）——消息里存的 duration 与静音播放进度共用同一公式 */
export function estimateSpeakDuration(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

export async function synthesizeSelfVoice(text: string): Promise<SelfVoiceClip> {
  const cleaned = cleanTextForTts(text).slice(0, 400);
  if (!cleaned) {
    throw new Error('没有可转语音的内容');
  }
  return {
    dataUrl: '',
    duration: estimateSpeakDuration(cleaned),
    wave: hashWaveBars(cleaned, 22),
    localText: cleaned,
  };
}
