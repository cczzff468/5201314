// silk-wasm 适配层（云端核心 sources.ts 的 silkEncode 以 `await import('./silk-wasm.mjs')`
// 方式加载 Node 容器版编码器；这里把 npm silk-wasm 包桥接成同名模块）。
// v18：改成纯 ESM JavaScript——旧版带 TypeScript 注解但扩展名是 .mjs，
// Bun 对 .mjs 文件不做 TS 转译（Expected ")" but found ":"），动态 import 必失败
// → silk 编码 10 分钟缓存失败 → QQ 语音条永远降级文字（真机 QQ「AI 不会发语音」的根因）。
// WAV 头里解析真实采样率（核心调用传 0；encode 需要真实 rate）。
export async function encode(u8, _rate) {
  const m = await import('silk-wasm');
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
  return out;
}
export async function decode(data, sampleRate) {
  const m = await import('silk-wasm');
  const out = await m.decode(data, sampleRate);
  return out;
}
