const store: Record<string, string> = {};
const noop = () => {};
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  },
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
  setTimeout, clearTimeout,
};
(globalThis as any).document = {
  addEventListener: noop, removeEventListener: noop,
  hasFocus: () => true, visibilityState: 'visible', hidden: false,
};

async function main() {
  const sa = await import('../../src/lib/ios/shizuku-autonomy');
  const webRules = sa.buildShizukuAutonomyRules();
  console.log('=== [web] 教学规则段数:', webRules.length, '===');
  const directive = sa.buildAutonomyDirective();
  console.log('--- buildAutonomyDirective 前 11 段 ---');
  console.log(directive.slice(0, 11).join('\n'));
  sa.setAiActionTarget('device');
  const devDirective = sa.buildAutonomyDirective();
  const devToolsLine = devDirective.find((l: string) => l.includes('openRealApp'));
  console.log('\n=== [device] 工具清单行含真机工具:', !!devToolsLine, '===');
  const rules = sa.buildShizukuAutonomyRules();
  const hasMarker = rules.some((l: string) => l.includes('[手机操作:点按:x:y]'));
  console.log('=== [device] 标记协议含真机命令:', hasMarker, '===');
  console.log('=== [device] 能力恒开:', JSON.stringify(sa.getAutonomyConfig().master), '===');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
