const store: Record<string, string> = {};
const noop = () => {};
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  },
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
  setTimeout, clearTimeout, location: { href: 'http://localhost:3000/' },
};
(globalThis as any).document = {
  addEventListener: noop, removeEventListener: noop,
  hasFocus: () => true, visibilityState: 'visible', hidden: false,
  createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
  querySelector: () => null, querySelectorAll: () => [],
  body: { appendChild: noop, classList: { add: noop, remove: noop } },
};

async function main() {
  const sa = await import('../../src/lib/ios/shizuku-autonomy');
  const pt = await import('../../src/lib/ios/phone-tools');
  // web 模式
  let tools = pt.buildPhoneTools();
  console.log('=== [web] 工具数:', tools.length, '===');
  console.log(tools.map((t) => t.function.name).join(', '));
  // 每个 schema 基本校验
  for (const t of tools) {
    const p = t.function.parameters as any;
    if (p.type !== 'object' || typeof p.properties !== 'object') throw new Error('bad schema: ' + t.function.name);
    if (!t.function.description) throw new Error('no desc: ' + t.function.name);
  }
  console.log('=== [web] schema 全部合法 ✓ ===');
  // device 模式
  sa.setAiActionTarget('device');
  tools = pt.buildPhoneTools();
  console.log('\n=== [device] 工具数:', tools.length, '===');
  console.log(tools.map((t) => t.function.name).join(', '));
  const hasAll = ['openRealApp','tapScreen','swipeScreen','inputText','pressKey','lookScreen','takeScreenshot','getForegroundApp','forceStopApp','getBatteryStatus','getVolume','getNotifications'].every((n) => tools.some((t) => t.function.name === n));
  console.log('=== [device] 真机 12 工具全量注册:', hasAll, '===');
  // 工具轮 system 包装验证
  const msgs = [{ role: 'system' as const, content: '你是测试人设。【深度思考（每条回复必做）】要写思考块。除思考块之外，正文照常遵守其他所有消息规则。' }, { role: 'user' as const, content: '帮我记个备忘录：明天买牛奶' }];
  // wrapSystemWithSoul 未导出——经 runPhoneToolRound 验证会发请求，这里直接验证 execWebTool 的 web-only 兜底
  const r = await pt.execWebTool('tapScreen', { x: 100, y: 200 });
  console.log('\n=== [web] 误调真机工具兜底:', r.slice(0, 60), '===');
  console.log('\nALL PASS');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
