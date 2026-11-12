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

let reqCount = 0;
const captured: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  console.log(`[fetch #${++reqCount}]`, String(url).slice(0, 40));
  const body = JSON.parse(init.body);
  captured.push(body);
  const msg = reqCount === 1
    ? { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'saveMemo', arguments: JSON.stringify({ content: '明天买牛奶', title: '购物' }) } }] }
    : { content: '记好啦，明天买牛奶，我不会让你忘掉的～' };
  return new Response(JSON.stringify({ message: msg }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

async function main() {
  const pt = await import('../../src/lib/ios/phone-tools');
  console.log('[import ok] runPhoneToolRound =', typeof pt.runPhoneToolRound);
  const config = { baseUrl: 'https://api.test.local/v1', apiKey: 'sk-test', model: 'test-model', temperature: 0.7, maxTokens: 2048, ttsEnabled: false, ttsVoice: '' };
  const messages = [
    { role: 'system' as const, content: '你是小柔，性格温柔贴心的女友。你记得机主喜欢喝牛奶。【深度思考（每条回复必做）】每条回复都要先写思考块。除思考块之外，正文照常遵守其他所有消息规则。' },
    { role: 'user' as const, content: '帮我记个备忘录：明天买牛奶' },
  ];
  const out = await pt.runPhoneToolRound(messages, config as any);
  console.log('=== RESULT === usedTools:', out?.usedTools, '| text:', out?.text);
  const r1 = captured[0];
  console.log('tools 数量:', r1.tools?.length, '| toolMode:', r1.toolMode);
  const sysText = r1.messages[0].content as string;
  console.log('[角色设定·记忆库]:', sysText.includes('[角色设定·记忆库（你的角色灵魂）]'));
  console.log('人设保留:', sysText.includes('你是小柔，性格温柔贴心'));
  console.log('记忆保留:', sysText.includes('机主喜欢喝牛奶'));
  console.log('深度思考已剥除:', !sysText.includes('【深度思考（每条回复必做）】'));
  console.log('[工具使用规则·最高权限]:', sysText.includes('[工具使用规则·最高权限]'));
  console.log('[自主决策铁律]:', sysText.includes('[自主决策铁律]'));
  console.log('傻瓜机器人警告:', sysText.includes('不要像傻瓜机器人一样只等机主说「打开微信」'));
  console.log('霸道吃醋举例:', sysText.includes('霸道吃醋'));
  console.log('工具清单段:', sysText.includes('[当前可用工具清单]'));
  const r2 = captured[1];
  console.log('第2轮角色序列:', r2.messages.map((m: any) => m.role).join('→'));
  const toolMsg = r2.messages.find((m: any) => m.role === 'tool');
  console.log('role:tool 内容:', (toolMsg?.content ?? '').slice(0, 70));
  console.log('ALL PASS');
  process.exit(0);
}
setTimeout(() => { console.error('GLOBAL TIMEOUT 40s'); process.exit(1); }, 40_000);
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
