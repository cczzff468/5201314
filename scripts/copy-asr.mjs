#!/usr/bin/env node
/**
 * speech-asr 运行时拷贝 + 补丁脚本（已验证的离线 ASR 终极方案）：
 *
 * 1. 从 node_modules/speech-asr/src/lib 拷贝 WASM 运行时到 public/asr/：
 *    - sherpa-onnx-wasm-main-asr.js  Emscripten glue（loadPackage 补丁）
 *    - sherpa-onnx-wasm-main-asr.wasm  WASM 引擎本体
 *    - sherpa-onnx-asr.js  OfflineRecognizer 等封装
 *    - sherpa-onnx-vad.js  VAD 封装（备用）
 *    - offline-worker.js   2-pass SenseVoice 离线 Worker（模型注入补丁）
 *
 * 2. loadPackage 禁用补丁（关键）：glue 首部插入 return; —— 跳过 npm 包自带的
 *    500MB 冗余 .data 模型包下载（HuggingFace 源国内不可用），只保留 .wasm + glue。
 *    模型改由前端从 ModelScope 直链下载（Cache API 持久化）后经 Worker 注入 MEMFS。
 *
 * 3. offline-worker 模型注入补丁：init 消息新增 modelFiles: [{name, buffer}]，
 *    在创建 OfflineRecognizer 前写入 Module.FS（MEMFS），SenseVoice 即可从
 *    虚拟文件系统加载模型（config 路径 = 注入的 VFS 路径）。
 *
 * 运行：bun scripts/copy-asr.mjs（产物已提交 git，部署环境无需重跑）
 */

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve('node_modules/speech-asr/src/lib');
const DEST = path.resolve('public/asr');

const FILES = [
  'sherpa-onnx-wasm-main-asr.js',
  'sherpa-onnx-wasm-main-asr.wasm',
  'sherpa-onnx-asr.js',
  'sherpa-onnx-vad.js',
  'offline-worker.js',
];

// ---- 补丁 1：glue 的 loadPackage 首行插入 return（禁用 .data 下载） ----
function patchGlue(code) {
  const marker = 'var loadPackage=function(metadata){';
  if (!code.includes(marker)) {
    // 已打过补丁（幂等）
    if (code.includes(marker.replace('{', '{return;'))) {
      console.log('  [skip] glue loadPackage 已含补丁');
      return code;
    }
    throw new Error('glue 未找到 loadPackage 标记，包结构可能已变化');
  }
  return code.replace(marker, marker + 'return;');
}

// ---- 补丁 2：worker init 支持modelFiles 注入 MEMFS ----
// 注意：此 Emscripten 版本不导出 Module.FS，只导出 FS_createDataFile / FS_createPath 等包装
const WORKER_ANCHOR = `      await ensureRuntimeReady();
      console.log('[SenseVoice Worker] Runtime ready, creating OfflineRecognizer with config:', config);`;
const WORKER_PATCH = `      await ensureRuntimeReady();
      // [patched] 模型注入：init 消息可带 modelFiles（model.int8.onnx/tokens.txt 的 ArrayBuffer），
      // 在创建 OfflineRecognizer 前写入 MEMFS 根目录，替代被禁用的 .data 打包下载
      const modelFiles = Array.isArray(data.modelFiles) ? data.modelFiles : [];
      for (const mf of modelFiles) {
        if (!mf || typeof mf.name !== 'string' || !mf.buffer) continue;
        const fname = mf.name.startsWith('/') ? mf.name.slice(1) : mf.name;
        Module.FS_createDataFile('/', fname, new Uint8Array(mf.buffer), true, true, true);
        console.log('[SenseVoice Worker] MEMFS injected:', '/' + fname, mf.buffer.byteLength, 'bytes');
      }
      console.log('[SenseVoice Worker] Runtime ready, creating OfflineRecognizer with config:', config);`;

function patchWorker(code) {
  if (code.includes('modelFiles')) {
    console.log('  [skip] offline-worker 已含补丁');
    return code;
  }
  if (!code.includes(WORKER_ANCHOR)) {
    throw new Error('offline-worker 未找到 init 锚点，包结构可能已变化');
  }
  return code.replace(WORKER_ANCHOR, WORKER_PATCH);
}

await mkdir(DEST, { recursive: true });
for (const f of FILES) {
  const src = path.join(SRC, f);
  const dst = path.join(DEST, f);
  let buf = await readFile(src);
  if (f === 'sherpa-onnx-wasm-main-asr.js') {
    buf = Buffer.from(patchGlue(buf.toString('utf8')), 'utf8');
  } else if (f === 'offline-worker.js') {
    buf = Buffer.from(patchWorker(buf.toString('utf8')), 'utf8');
  }
  await writeFile(dst, buf);
  console.log(`  ${f}  ${(buf.length / 1024).toFixed(0)} KB`);
}
console.log(`✅ speech-asr 运行时已拷贝并补丁 → public/asr/`);
