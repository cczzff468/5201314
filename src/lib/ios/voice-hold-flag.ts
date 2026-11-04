'use client';

/**
 * 按住录音标志（微型模块）：
 * 原先 beginVoiceHold/isVoiceHoldActive 挂在 voice-input.tsx（近千行录音组件）里，
 * PhoneShell 仅为查一个布尔就把整个语音录制模块（含 stt/web-speech/voice-player/audio-utils）
 * 静态拖进首屏 bundle——抽到本微模块后 PhoneShell 只引入这几行，voice-input 再反过来引用这里。
 */

let holdCount = 0;

/** 按住录音开始（计数 +1）：PhoneShell 底部边缘上滑手势在读到 true 期间不再打开多任务卡片 */
export function beginVoiceHold(): void {
  holdCount += 1;
}

/** 按住录音结束（计数 -1） */
export function endVoiceHold(): void {
  holdCount = Math.max(0, holdCount - 1);
}

/** PhoneShell 查询：当前是否处于「按住说话」手势中 */
export function isVoiceHoldActive(): boolean {
  return holdCount > 0;
}
