/**
 * 全局音频焦点注册表：让「语音消息气泡播放」与「TTS 朗读（电话/微信/QQ 的播放语音按钮）」互斥——
 * 任何一方开始播放前调用 stopOtherAudio(自己的 id)，其它在播的音频先停（含对方停止的 UI 归位）。
 * 模块级 Map，无依赖，避免 tts-client ↔ voice-player 循环引用。
 */

type StopFn = () => void;

const stoppers = new Map<string, StopFn>();

/** 注册一个音频源（重复注册覆盖旧的 stopper）；返回注销函数 */
export function registerAudioSource(id: string, stop: StopFn): () => void {
  stoppers.set(id, stop);
  return () => {
    if (stoppers.get(id) === stop) stoppers.delete(id);
  };
}

/** 开始播放 id 这一路之前，停掉其它所有在播音频（静默容错） */
export function stopOtherAudio(id: string): void {
  for (const [k, stop] of stoppers) {
    if (k === id) continue;
    try {
      stop();
    } catch {
      // 单路停止失败不影响其它路
    }
  }
}
