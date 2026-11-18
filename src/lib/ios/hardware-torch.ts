'use client';

/** 系统硬件手电筒（Torch API）：锁屏手电筒优先走真实闪光灯——
 *  Chrome/Android 支持 MediaStreamTrack torch 约束；iOS Safari / 桌面无闪光灯环境不支持，
 *  调用方据返回结果回退「白屏补光模拟」。相机流仅用于点亮闪光灯，不采集不存储任何画面。 */

export interface HardwareTorchResult {
  ok: boolean;
  /** 失败原因：unsupported=浏览器/设备不支持 torch；no-camera=无摄像头或不可用；denied=用户拒绝授权；error=其它 */
  reason?: 'unsupported' | 'no-camera' | 'denied' | 'error';
}

/** torch 能力不在标准 MediaTrackCapabilities 类型内（Chrome 私有扩展），局部扩展类型 */
interface MediaTrackCapabilitiesWithTorch extends MediaTrackCapabilities {
  torch?: boolean;
}

/** torch 约束同理：advanced 约束集局部扩展（applyConstraints 用） */
interface MediaTrackConstraintSetWithTorch extends MediaTrackConstraintSet {
  torch?: boolean;
}

// 模块级持有 stream/track 引用：防止 GC 回收导致相机流断开、闪光灯熄灭
let torchStream: MediaStream | null = null;
let torchTrack: MediaStreamTrack | null = null;

/** 停掉指定 stream 的全部轨道（失败路径兜底清理，不向外抛错） */
function stopStreamTracks(stream: MediaStream): void {
  try {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* 单个轨道停止失败不影响其余清理 */
      }
    }
  } catch {
    /* 幂等清理 */
  }
}

/**
 * 开启系统硬件闪光灯（MediaStreamTrack torch 约束）。
 * 成功后相机流保持活跃（不 stop）——流断开闪光灯即熄灭；关闭请调 disableHardwareTorch()。
 */
export async function enableHardwareTorch(): Promise<HardwareTorchResult> {
  // 环境预检：无 mediaDevices/getUserMedia（旧浏览器 / 非安全上下文）→ 不支持
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'unsupported' };
  }

  // 上一次已启用（重复调用）：先 disable 再重新走流程，避免轨道泄漏 / 状态错乱
  if (torchStream || torchTrack) {
    disableHardwareTorch();
  }

  // 请求后置摄像头（闪光灯挂后摄）；仅用于点亮 torch，不采集不存储画面
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? '';
    if (name === 'NotAllowedError') {
      return { ok: false, reason: 'denied' }; // 用户拒绝相机授权
    }
    if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
      return { ok: false, reason: 'no-camera' }; // 无摄像头 / 被占用 / 不满足约束
    }
    return { ok: false, reason: 'error' };
  }

  // 取 video track；没有可用视频轨 → 停掉全部轨道后按无摄像头处理
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stopStreamTracks(stream);
    return { ok: false, reason: 'no-camera' };
  }

  // 能力预检：getCapabilities 存在但未声明 torch 能力（iOS Safari / 桌面摄像头等）→ 不支持
  const caps = track.getCapabilities?.() as MediaTrackCapabilitiesWithTorch | undefined;
  if (caps && caps.torch !== true) {
    stopStreamTracks(stream);
    return { ok: false, reason: 'unsupported' };
  }

  // 点亮闪光灯：applyConstraints 抛错说明运行时不支持 torch 约束 → 同样按不支持处理
  try {
    await track.applyConstraints({
      advanced: [{ torch: true }] as MediaTrackConstraintSetWithTorch[],
    });
  } catch {
    stopStreamTracks(stream);
    return { ok: false, reason: 'unsupported' };
  }

  // 成功：保存引用保持流活跃（闪光灯随流断开而熄灭），统一交给 disableHardwareTorch() 关闭
  torchStream = stream;
  torchTrack = track;
  return { ok: true };
}

/** 关闭硬件闪光灯：停止全部轨道并清引用（try/catch 包裹，幂等，可安全重复调用） */
export function disableHardwareTorch(): void {
  try {
    torchTrack?.stop();
    torchStream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* 幂等：轨道已停止等异常一律忽略 */
  }
  torchTrack = null;
  torchStream = null;
}
