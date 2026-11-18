let offlineRecognizer = null;
let expectedSampleRate = 16000;
let runtimeReadyResolve = null;
let runtimeReadyReject = null;
let runtimeInitPromise = null;

const defaultRuntimePaths = () => {
  try {
    const base = new URL('./', self.location?.href || '').href;
    return {
      baseUrl: base,
      wasmJs: 'sherpa-onnx-wasm-main-asr.js',
      asrJs: 'sherpa-onnx-asr.js',
      wasm: 'sherpa-onnx-wasm-main-asr.wasm',
      data: 'sherpa-onnx-wasm-main-asr.data',
    };
  } catch (_) {
    return {
      baseUrl: '',
      wasmJs: 'sherpa-onnx-wasm-main-asr.js',
      asrJs: 'sherpa-onnx-asr.js',
      wasm: 'sherpa-onnx-wasm-main-asr.wasm',
      data: 'sherpa-onnx-wasm-main-asr.data',
    };
  }
};

let runtimePaths = defaultRuntimePaths();

function toErrorMessage(err) {
  if (!err) {
    return 'Unknown error';
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch (jsonErr) {
    return String(err);
  }
}

function resolveRuntimeUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, runtimePaths.baseUrl || self.location?.href || '').href;
  } catch (_) {
    return url;
  }
}

function applyRuntimeOverrides(overrides = {}) {
  const next = {...runtimePaths};
  if (overrides.baseUrl) {
    next.baseUrl = overrides.baseUrl;
  }
  for (const key of ['wasmJs', 'asrJs', 'wasm', 'data']) {
    if (overrides[key]) {
      next[key] = overrides[key];
    }
  }
  runtimePaths = next;
}

function ensureRuntimeReady() {
  if (runtimeInitPromise) return runtimeInitPromise;

  runtimeInitPromise = (async () => {
    const moduleReady = new Promise((resolve, reject) => {
      runtimeReadyResolve = resolve;
      runtimeReadyReject = reject;

      self.Module = {
        locateFile(path) {
          if (path.endsWith('.wasm')) {
            return resolveRuntimeUrl(runtimePaths.wasm);
          }
          if (path.endsWith('.data')) {
            return resolveRuntimeUrl(runtimePaths.data);
          }
          return resolveRuntimeUrl(path);
        },
        onAbort(reason) {
          console.error('[SenseVoice Worker] Module abort', reason);
          if (runtimeReadyReject) {
            runtimeReadyReject(reason);
            runtimeReadyReject = null;
          }
        },
        onRuntimeInitialized() {
          console.log('[SenseVoice Worker] onRuntimeInitialized called');
          if (runtimeReadyResolve) {
            runtimeReadyResolve();
            runtimeReadyResolve = null;
          }
        },
        print(text) {
          console.log('[SenseVoice Worker stdout]', text);
        },
        printErr(text) {
          console.error('[SenseVoice Worker stderr]', text);
        },
        setStatus(text) {
          console.log('[SenseVoice Worker] Module status:', text);
        },
      };
    });

    try {
      const wasmJsUrl = resolveRuntimeUrl(runtimePaths.wasmJs);
      const asrJsUrl = resolveRuntimeUrl(runtimePaths.asrJs);
      console.log('[SenseVoice Worker] Importing runtime', {
        wasmJsUrl,
        asrJsUrl,
        wasmUrl: resolveRuntimeUrl(runtimePaths.wasm),
        dataUrl: resolveRuntimeUrl(runtimePaths.data),
      });
      importScripts(wasmJsUrl);
      importScripts(asrJsUrl);
    } catch (err) {
      console.error('[SenseVoice Worker] Failed to import scripts', err);
      if (runtimeReadyReject) {
        runtimeReadyReject(err);
      }
      throw err;
    }

    await moduleReady;
  })();

  runtimeInitPromise = runtimeInitPromise.catch((err) => {
    // Allow retry if initialization fails.
    runtimeInitPromise = null;
    return Promise.reject(err);
  });

  return runtimeInitPromise;
}

function ensureRecognizerReady() {
  if (!offlineRecognizer) {
    throw new Error('Offline recognizer not initialised');
  }
  return offlineRecognizer;
}

self.onmessage = async (event) => {
  const data = event.data || {};
  const { type } = data;

  if (type === 'init') {
    console.log('[SenseVoice Worker] Received init message', data);
    expectedSampleRate = data.sampleRate || expectedSampleRate;
    const config = data.config;
    const overrides = data.runtimePaths || {};
    applyRuntimeOverrides(overrides);

    try {
      console.log('[SenseVoice Worker] Awaiting runtime ready...');
      await ensureRuntimeReady();
      // [patched] 模型注入：init 消息可带 modelFiles（model.int8.onnx/tokens.txt 的 ArrayBuffer），
      // 在创建 OfflineRecognizer 前写入 MEMFS 根目录，替代被禁用的 .data 打包下载
      const modelFiles = Array.isArray(data.modelFiles) ? data.modelFiles : [];
      for (const mf of modelFiles) {
        if (!mf || typeof mf.name !== 'string' || !mf.buffer) continue;
        const fname = mf.name.startsWith('/') ? mf.name.slice(1) : mf.name;
        Module.FS_createDataFile('/', fname, new Uint8Array(mf.buffer), true, true, true);
        console.log('[SenseVoice Worker] MEMFS injected:', '/' + fname, mf.buffer.byteLength, 'bytes');
      }
      console.log('[SenseVoice Worker] Runtime ready, creating OfflineRecognizer with config:', config);
      offlineRecognizer = new OfflineRecognizer(config, Module);
      console.log('[SenseVoice Worker] OfflineRecognizer created successfully');
      self.postMessage({ type: 'ready' });
    } catch (err) {
      const message = toErrorMessage(err);
      console.error('[SenseVoice Worker] init failed', err);
      self.postMessage({
        type: 'init-error',
        message: `Offline init failed: ${message} (check .data/.onnx paths)`,
      });
    }
    return;
  }

  if (type === 'decode') {
    const jobId = data.id;
    const audioBuffer = data.audioBuffer;
    const sampleRate = data.sampleRate || expectedSampleRate;

    console.log(`[SenseVoice Worker] Decode job #${jobId}: ${audioBuffer?.byteLength || 0} bytes`);

    try {
      await ensureRuntimeReady();
      const recognizer = ensureRecognizerReady();
      const samples = new Float32Array(audioBuffer);
      console.log(`[SenseVoice Worker] Job #${jobId}: ${samples.length} samples @ ${sampleRate} Hz`);
      const start = performance.now();
      const stream = recognizer.createStream();
      stream.acceptWaveform(sampleRate, samples);
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      stream.free();
      const elapsedMs = performance.now() - start;
      console.log(`[SenseVoice Worker] Job #${jobId} completed in ${elapsedMs.toFixed(2)}ms`, result);
      self.postMessage({
        type: 'decode-result',
        id: jobId,
        result,
        elapsedMs,
      });
    } catch (err) {
      const message = toErrorMessage(err);
      console.error(`[SenseVoice Worker] Job #${jobId} decode failed`, err);
      self.postMessage({ type: 'decode-error', id: jobId, message });
    }
    return;
  }

  if (type === 'dispose') {
    try {
      if (offlineRecognizer) {
        offlineRecognizer.free();
        offlineRecognizer = null;
      }
    } catch (err) {
      console.error('[SenseVoice Worker] dispose failed', err);
    } finally {
      self.postMessage({ type: 'disposed' });
      close();
    }
    return;
  }
};
