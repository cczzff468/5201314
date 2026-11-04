/**
 * [发朋友圈]/[发说说]/[发动态] 动作标记解析实测（B9-②）：
 * 覆盖整段正文保留（含冒号/标点）、混合正文顺序、段尾未闭合、与既有标记不串台。
 */
import { extractRichActionParts, ACTION_TAIL_RE } from '../src/lib/chat-rich';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` —— ${extra}` : ''}`);
  }
}

console.log('== [发朋友圈:正文] 解析 ==');
{
  const parts = extractRichActionParts('好呀，我现在就发～\n[发朋友圈:我最喜欢凡凡老婆啦 ❤️]\n发好啦，快去看！');
  const acts = parts.filter((p) => p.type === 'action');
  check('恰好 1 个动作', acts.length === 1, `got ${acts.length}`);
  const a0 = acts[0] as { type: 'action'; action: { kind: string; targetId: string } };
  check('kind=post-moment', a0?.action.kind === 'post-moment', a0?.action.kind);
  check('正文整段保留（含 ❤️）', a0?.action.targetId === '我最喜欢凡凡老婆啦 ❤️', a0?.action.targetId);
  const texts = parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text.trim());
  check('标记前正文保留', texts.some((t) => t.startsWith('好呀')), JSON.stringify(texts));
  check('标记后正文保留', texts.some((t) => t.startsWith('发好啦')), JSON.stringify(texts));
  check('标记原文不漏进正文', texts.every((t) => !t.includes('发朋友圈')), JSON.stringify(texts));
}

console.log('== 正文带冒号/标点整段保留 ==');
{
  const parts = extractRichActionParts('[发朋友圈:今天也要加油鸭：早起第一件事就是想她]');
  const a0 = parts.find((p) => p.type === 'action') as { action: { targetId: string } } | undefined;
  check('冒号后整段保留', a0?.action.targetId === '今天也要加油鸭：早起第一件事就是想她', a0?.action.targetId);
}

console.log('== [发说说]/[发动态] 变体 ==');
{
  const a1 = extractRichActionParts('[发说说:晚安啦]');
  check('发说说 → post-moment', (a1[0] as { action?: { kind: string } })?.action?.kind === 'post-moment');
  const a2 = extractRichActionParts('[发动态:今天天气真好]');
  check('发动态 → post-moment', (a2[0] as { action?: { kind: string } })?.action?.kind === 'post-moment');
}

console.log('== 空正文丢弃 ==');
{
  const parts = extractRichActionParts('[发朋友圈:]');
  check('空正文无动作产出', parts.every((p) => p.type === 'text'));
}

console.log('== 段尾未闭合截断 ==');
{
  check('ACTION_TAIL_RE 认 [发朋友圈:半截', ACTION_TAIL_RE.test('发好啦 [发朋友圈:我最喜欢凡'));
}

console.log('== 与既有动作不串台 ==');
{
  const parts = extractRichActionParts('[代付淘宝:px-1] 收到！\n[发朋友圈:收到代付啦好开心]');
  const kinds = parts.filter((p) => p.type === 'action').map((p) => (p as { action: { kind: string } }).action.kind);
  check('代付淘宝 仍解析', kinds.includes('tb-proxy-pay'), JSON.stringify(kinds));
  check('发朋友圈 同回复合存', kinds.includes('post-moment'), JSON.stringify(kinds));
}
{
  const parts = extractRichActionParts('[换朋友圈背景:msg-1]');
  const kind = (parts[0] as { action?: { kind: string } })?.action?.kind;
  check('换朋友圈背景 不被发朋友圈抢匹配', kind === 'change-moments-bg', kind);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
