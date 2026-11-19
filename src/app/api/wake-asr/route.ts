import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

/**
 * 唤醒监听 · 服务端识别（POST /api/wake-asr）——喊名唤醒的浏览器兜底通道专用：
 *
 * 背景：浏览器端连续唤醒监听的三条通道（见 agent-voice.ts useAgentWakeLoop）——
 * ① 离线端侧转写（APK 已下载模型时首选）；② Web Speech 实时识别（Chrome 内置，但语音服务
 * 走 Google，大陆网络不可达 → 持续 network 错误形同虚设）；③ 本路由：前端 VAD 检测到说话
 * 才录一小段（3~4s）→ 16k WAV → base64 交到这里 → z-ai ASR 转写 → 前端匹配唤醒名。
 * 安静环境零请求、说一句才发一次，不烧额度也不受 Google 可达性影响。
 *
 * v1.8.3 稳定性重构（修「连续说几句话后喊名永久没反应」）：
 * 上游 ASR 网关有 WAF 限流——短时间内连续转发会被 405 拉黑数分钟（期间连单发都 405），
 * 旧版把上游错误原样 502 回给前端，前端固定 0.8s 重试反而持续触发限流 → 唤醒通道整体死亡。
 * 现在：
 * ① 结果缓存：音频 SHA-256 → 转写结果（10min TTL / 50 条 LRU），同一段音频重复上传零上游调用；
 * ② 每 IP 最小转发间隔 1.2s（超频 429 + Retry-After，绝不转发给上游）；
 * ③ 上游失败按 503 + Retry-After: 30 返回（前端按此指数退避冷却，不再持续触发 WAF）；
 * ④ ZAI 实例复用（旧版每次请求重新 create，白白增加首包延迟）。
 *
 * 请求体（JSON）：{ audio: "<16k 单声道 WAV 的 base64>" }（≤2.8MB ≈ 87s，唤醒片段通常 3~4s）
 * 返回：{ text }；限流 { error, retryAfter }；失败 { error }（中文文案）。识别失败/空结果 text 为空串。
 */

export const runtime = 'nodejs';

/** base64 最大长度（2.8MB ≈ 87s 16k 单声道 16bit WAV；正常唤醒片段 3~4s ≈ 190KB base64） */
const MAX_AUDIO_BASE64 = 2_800_000;

/** 识别结果缓存（audio sha256 → { text, at }；10min TTL，50 条 LRU） */
const resultCache = new Map<string, { text: string; at: number }>();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 50;

/** 每 IP 上次转发时间（上游限流保护：两次真实转发至少隔 1.2s） */
const lastForwardAt = new Map<string, number>();
const FORWARD_MIN_INTERVAL_MS = 1200;
/** 每 IP 转发限流冷却记录（收到上游 405/限流后，本路由主动冷却 30s 不再转发） */
const upstreamCooldownUntil = new Map<string, number>();
const UPSTREAM_COOLDOWN_MS = 30_000;

/** 上游失败时缓存负结果的时间窗（同音频短窗内直接回同错误，不再撞上游） */
const failCache = new Map<string, { at: number }>();
const FAIL_CACHE_TTL_MS = 60_000;

function cacheGet(key: string): string | null {
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  // LRU touch
  resultCache.delete(key);
  resultCache.set(key, hit);
  return hit.text;
}

function cachePut(key: string, text: string): void {
  resultCache.delete(key);
  resultCache.set(key, { text, at: Date.now() });
  while (resultCache.size > CACHE_MAX) {
    resultCache.delete(resultCache.keys().next().value as string);
  }
}

/** 全局单例 ZAI（懒建；create 有握手开销，唤醒是高频小请求必须复用） */
let zaiPromise: Promise<{ audio: { asr: { create: (b: { file_base64: string }) => Promise<unknown> } } }> | null = null;
function getZai() {
  zaiPromise ??= (async () => {
    const { default: ZAI } = await import('z-ai-web-dev-sdk');
    return (await ZAI.create()) as unknown as { audio: { asr: { create: (b: { file_base64: string }) => Promise<unknown> } } };
  })();
  return zaiPromise;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { audio?: unknown } | null;
    const audio = typeof body?.audio === 'string' ? body.audio : '';
    if (!audio || audio.length > MAX_AUDIO_BASE64) {
      return NextResponse.json({ error: '音频数据无效或过大' }, { status: 400 });
    }
    const audioKey = createHash('sha256').update(audio).digest('hex');

    // ① 结果缓存：同音频 10min 内直接复用（零上游调用）
    const cached = cacheGet(audioKey);
    if (cached !== null) {
      return NextResponse.json({ text: cached });
    }

    // ② 上游冷却中：负缓存窗内同音频快速返回同错误；否则 503 让前端冷却
    const now = Date.now();
    const cooldownUntil = upstreamCooldownUntil.get('*') ?? 0;
    if (now < cooldownUntil) {
      const failHit = failCache.get(audioKey);
      if (failHit && now - failHit.at < FAIL_CACHE_TTL_MS) {
        return NextResponse.json(
          { error: '识别服务限流中，请稍候再试', retryAfter: Math.ceil((cooldownUntil - now) / 1000) },
          { status: 503, headers: { 'Retry-After': String(Math.ceil((cooldownUntil - now) / 1000)) } },
        );
      }
      failCache.set(audioKey, { at: now });
      return NextResponse.json(
        { error: '识别服务限流中，请稍候再试', retryAfter: Math.ceil((cooldownUntil - now) / 1000) },
        { status: 503, headers: { 'Retry-After': String(Math.ceil((cooldownUntil - now) / 1000)) } },
      );
    }

    // ③ 每 IP 最小转发间隔（超频直接 429，绝不转发给上游触发 WAF）
    const ip = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const lastAt = lastForwardAt.get(ip) ?? 0;
    if (now - lastAt < FORWARD_MIN_INTERVAL_MS) {
      const wait = Math.ceil((FORWARD_MIN_INTERVAL_MS - (now - lastAt)) / 1000) || 1;
      return NextResponse.json(
        { error: '请求过于频繁，请稍候', retryAfter: wait },
        { status: 429, headers: { 'Retry-After': String(wait) } },
      );
    }
    lastForwardAt.set(ip, now);

    // ④ 转发上游（12s 看门狗；race 结束即清定时器，不挂尾巴）
    try {
      const zai = await getZai();
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      try {
        const r = (await Promise.race([
          zai.audio.asr.create({ file_base64: audio }),
          new Promise<never>((_, reject) => {
            watchdog = setTimeout(() => reject(new Error('上游识别超时')), 12_000);
          }),
        ])) as { text?: unknown };
        const text = typeof r?.text === 'string' ? r.text.trim() : '';
        cachePut(audioKey, text);
        failCache.delete(audioKey);
        upstreamCooldownUntil.delete('*');
        return NextResponse.json({ text });
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }
    } catch (err) {
      // 上游失败（WAF 405/限流/超时/断网）：全路由冷却 30s，期间不再转发（保住上游不持续触发限流）
      upstreamCooldownUntil.set('*', Date.now() + UPSTREAM_COOLDOWN_MS);
      failCache.set(audioKey, { at: Date.now() });
      const detail = err instanceof Error ? err.message : '服务端识别失败';
      console.error('[wake-asr] upstream failed, cooling down 30s:', detail.slice(0, 120));
      return NextResponse.json(
        { error: '识别服务暂时不可用（已自动冷却 30 秒后恢复）', retryAfter: 30 },
        { status: 503, headers: { 'Retry-After': '30' } },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '服务端识别失败，请稍后再试' },
      { status: 502 },
    );
  }
}
