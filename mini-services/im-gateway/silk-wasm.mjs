// silk-wasm 适配层（云端核心 sources.ts 的 silkEncode 以 `await import('./silk-wasm.mjs')`
// 方式加载 Node 容器版编码器；这里把 npm silk-wasm 包桥接成同名模块）。
// WAV 头里解析真实采样率（核心调用传 0；encode 需要真实 rate）。
export async function encode(u8: Uint8Array, _rate: number): Promise<{ data: Uint8Array; duration?: number }> {
  const m = (await import('silk-wasm')) as typeof import('silk-wasm');
  let rate = _rate || 24000;
  try {
    if (u8.length > 44 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) {
      const r = u8[24] | (u8[25] << 8) | (u8[26] << 16) | (u8[27] << 24);
      if (r > 4000 && r < 100000) rate = r;
    }
  } catch {
    /* WAV 头解析失败按默认 */
  }
  const out = await m.encode(u8, rate);
  return out as unknown as { data: Uint8Array; duration?: number };
}
export async function decode(data: Uint8Array, sampleRate: number): Promise<Uint8Array> {
  const m = (await import('silk-wasm')) as typeof import('silk-wasm');
  const out = await m.decode(data, sampleRate);
  return out as unknown as Uint8Array;
}
