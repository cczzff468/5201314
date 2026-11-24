/**
 * v2.3.1 裸 JSON 工具调用剥除/扣留 全用例回归（常驻回归套件：`bun run tools/tests/test-json-calls.ts`，零依赖）
 */
import {
  extractJsonToolCalls,
  stripJsonToolCalls,
  looksLikePartialToolJson,
  stripTrailingPartialToolJson,
  TOOL_NAME_SET,
} from '../../src/lib/ios/json-tool-calls';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` → ${detail}` : ''}`);
  }
}

console.log('== 1. stripJsonToolCalls ==');
check('纯 JSON 整条 → null', stripJsonToolCalls('{"name": "setRealAlarm", "arguments": {"hour": 16, "minute": 23}}') === null);
check(
  '正文+JSON 同行内联（机主症状）',
  stripJsonToolCalls('好的～我这就帮你定闹钟哦{"name": "setRealAlarm", "arguments": {"hour": 16, "minute": 23}}') === '好的～我这就帮你定闹钟哦',
);
check(
  '正文+换行+JSON+换行+正文',
  stripJsonToolCalls('好嘞，马上定～\n{"name": "setRealAlarm", "arguments": {"hour": 16, "minute": 23}}\n等你哦') === '好嘞，马上定～\n\n等你哦',
);
check(
  '汇报里回显工具调用（C5）',
  stripJsonToolCalls('我已经帮你定好闹钟啦！调用的是 {"name": "setRealAlarm", "arguments": {"hour": 16, "minute": 23}} 这个工具，到点会响哦') ===
    '我已经帮你定好闹钟啦！调用的是 这个工具，到点会响哦',
);
check(
  'JSON+正文同行（前中后都齐）',
  stripJsonToolCalls('马上{"name":"switchToChat","arguments":{}}就好啦') === '马上就好啦',
);
check(
  'pretty 多行 JSON 整块剥除',
  stripJsonToolCalls('好的马上定\n{\n  "name": "setRealAlarm",\n  "arguments": {\n    "hour": 16,\n    "minute": 23\n  }\n}') === '好的马上定',
);
check(
  '两处散布 JSON 全剥',
  stripJsonToolCalls('先{"name":"switchToChat","arguments":{}}再{"name":"getForegroundApp","arguments":{}}完成') === '先再完成',
);
check(
  '代码块包裹 JSON 整块剥',
  stripJsonToolCalls('看这个\n```json\n{"name": "setRealAlarm", "arguments": {"hour": 7, "minute": 30}}\n```\n好了') === '看这个\n\n好了',
);
check('普通文本带配平花括号不动', stripJsonToolCalls('我给你发个{爱心}好不好') === '我给你发个{爱心}好不好');
check('非工具 JSON 不剥', stripJsonToolCalls('配置是 {"timeout": 30, "retries": 3} 就这样') === '配置是 {"timeout": 30, "retries": 3} 就这样');
check('未知工具名 JSON 不剥', stripJsonToolCalls('{"name": "notATool", "arguments": {}}') === '{"name": "notATool", "arguments": {}}');
check('纯文本原样', stripJsonToolCalls('今天天气真好呀') === '今天天气真好呀');
check('空串 → null', stripJsonToolCalls('') === null);
check('纯空白 → null', stripJsonToolCalls('   \n  ') === null);

console.log('== 2. extractJsonToolCalls ==');
const ex1 = extractJsonToolCalls('好的{"name": "setRealAlarm", "arguments": {"hour": 16, "minute": 23}}马上');
check('内联提取出 setRealAlarm', ex1.length === 1 && ex1[0].name === 'setRealAlarm' && (ex1[0].args as { hour: number }).hour === 16);
const ex2 = extractJsonToolCalls('{"function": {"name": "getForegroundApp", "arguments": {}}}');
check('function 形状提取', ex2.length === 1 && ex2[0].name === 'getForegroundApp');
const ex3 = extractJsonToolCalls('{"name": "sendSMS", "arguments": "{\\"phoneNumber\\": \\"13800138000\\", \\"message\\": \\"hi\\"}"}');
check('arguments 为字符串时解析', ex3.length === 1 && (ex3[0].args as { phoneNumber: string }).phoneNumber === '13800138000');
const ex4 = extractJsonToolCalls('重复重复{"name":"getVolume","arguments":{}}{"name":"getVolume","arguments":{}}');
check('同调用去重', ex4.length === 1);
// v2.4.5：52 → 62（补 v2.4.2 十件 + v2.4.3 三件：步数/运动/睡眠/文件四件/下载 + 听歌/切歌/真机日历读取）
check('TOOL_NAME_SET 含 62 个工具', TOOL_NAME_SET.size === 62, `实际 ${TOOL_NAME_SET.size}`);

console.log('== 3. looksLikePartialToolJson（分段扣留判定）==');
check('半截开头 { → true', looksLikePartialToolJson('{') === true);
check('pretty 首行 { → true', looksLikePartialToolJson('{\n') === true);
check('半截带 name 键 → true', looksLikePartialToolJson('{"name": "setRealAlarm",') === true);
check('完整 JSON → false', looksLikePartialToolJson('{"name": "setRealAlarm", "arguments": {}}') === false);
check('普通文本 → false', looksLikePartialToolJson('我给你发个{爱心}') === false);
check('无 name 键且不以 { 开头 → false', looksLikePartialToolJson('笑死{{{') === false);
check('正文+半截 JSON（有 name）→ true', looksLikePartialToolJson('马上就好{"name": "setRe') === true);
// 以 { 开头的未闭合对象一律扣留（name 键可能在对象后部才出现）；拼齐后不是工具调用会正常上屏
check('非工具半截以{开头也扣留（防 name 后置漏扣）', looksLikePartialToolJson('{"msg": "hel') === true);

console.log('== 4. stripTrailingPartialToolJson（文尾残缺清理）==');
check(
  '尾部半截工具 JSON 切除保正文',
  stripTrailingPartialToolJson('定好闹钟哦{"name": "setRe') === '定好闹钟哦',
);
check(
  '尾部 pretty 半截切除',
  stripTrailingPartialToolJson('马上定\n{\n"name": "setRealAlarm",\n"hour": 16') === '马上定',
);
check('完整 JSON 尾巴不动', stripTrailingPartialToolJson('{"name": "setRealAlarm", "arguments": {}}') === '{"name": "setRealAlarm", "arguments": {}}');
check('无 name 键的半截不动', stripTrailingPartialToolJson('你好{"msg": "hel') === '你好{"msg": "hel');
check('普通文本不动', stripTrailingPartialToolJson('今天天气真好') === '今天天气真好');

console.log('== 5. segSink 分段扣留管线模拟（复刻 chat-stream-store 逻辑） ==');
function makeSegSink() {
  const displayed: string[] = [];
  const pendingJsonCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let jsonHold = '';
  const sink = (seg: string): void => {
    let piece = seg;
    if (jsonHold) {
      piece = jsonHold + seg;
      jsonHold = '';
    }
    if (looksLikePartialToolJson(piece)) {
      jsonHold = piece;
      return;
    }
    const calls = extractJsonToolCalls(piece);
    if (calls.length > 0) {
      const clean = stripJsonToolCalls(piece);
      if (calls.length > 0 && clean === null) {
        for (const c of calls) pendingJsonCalls.push(c);
        return;
      }
      if (clean) displayed.push(clean);
      for (const c of calls) pendingJsonCalls.push(c);
      return;
    }
    displayed.push(piece);
  };
  return {
    sink,
    finish: () => {
      const held = jsonHold;
      jsonHold = '';
      return { displayed, pendingJsonCalls, heldAtFinish: held };
    },
  };
}

// 场景 A：pretty JSON 逐行喂（分段器按换行撕开的形态）
{
  const s = makeSegSink();
  s.sink('马上定');
  s.sink('{');
  s.sink('"name": "setRealAlarm",');
  s.sink('"arguments": {');
  s.sink('"hour": 16,');
  s.sink('"minute": 23');
  s.sink('}');
  s.sink('}');
  const r = s.finish();
  check('A. pretty JSON 逐行喂：正文上屏', JSON.stringify(r.displayed) === '["马上定"]', JSON.stringify(r.displayed));
  check('A. 半截零上屏（旧版会逐条漏 JSON）', r.heldAtFinish === '');
  check('A. 工具调用提取到', r.pendingJsonCalls.length === 1 && r.pendingJsonCalls[0].name === 'setRealAlarm');
}
// 场景 B：整段紧凑 JSON（无换行）
{
  const s = makeSegSink();
  s.sink('{"name": "setRealAlarm", "arguments": {"hour": 16, "minute": 23}}');
  const r = s.finish();
  check('B. 紧凑 JSON：零上屏', r.displayed.length === 0);
  check('B. 提取到调用', r.pendingJsonCalls.length === 1);
}
// 场景 C：正文与 JSON 同段（机主症状形态）
{
  const s = makeSegSink();
  s.sink('好的我帮你定{"name": "setRealAlarm", "arguments": {"hour": 16, "minute": 23}}');
  const r = s.finish();
  check('C. 内联混合：只上屏净正文', JSON.stringify(r.displayed) === '["好的我帮你定"]', JSON.stringify(r.displayed));
  check('C. 提取到调用', r.pendingJsonCalls.length === 1);
}
// 场景 D：流掐断在半个 JSON（pretty 中断）
{
  const s = makeSegSink();
  s.sink('马上定');
  s.sink('{');
  s.sink('"name": "setRealAlarm",');
  const r = s.finish();
  check('D. 断流半截：正文上屏、半截不上屏', JSON.stringify(r.displayed) === '["马上定"]', JSON.stringify(r.displayed));
  check('D. 零调用提取（残缺不可执行）', r.pendingJsonCalls.length === 0);
}
// 场景 E：普通聊天完全不受影响
{
  const s = makeSegSink();
  s.sink('今天好累呀～');
  s.sink('想你了呢！');
  const r = s.finish();
  check('E. 普通分段全上屏', r.displayed.length === 2 && r.displayed[0] === '今天好累呀～' && r.displayed[1] === '想你了呢！');
  check('E. 零误提取', r.pendingJsonCalls.length === 0 && r.heldAtFinish === '');
}
// 场景 F：表情/红包类带括号文本不误扣
{
  const s = makeSegSink();
  s.sink('给你发个{爱心}');
  s.sink('收下吧[红包:888]');
  const r = s.finish();
  check('F. 配平花括号/方括号文本全上屏', r.displayed.length === 2, JSON.stringify(r.displayed));
  check('F. 零扣留', r.heldAtFinish === '');
}

console.log('== 6. v2.3.2 形状二「工具名{参数}」（机主实测 setRealAlarm{"hour":17,"minute":52}） ==');
check(
  '形状二纯调用整条剥除 → null',
  stripJsonToolCalls('setRealAlarm{"hour":17,"minute":52}') === null,
);
check(
  '形状二正文内联剥除',
  stripJsonToolCalls('好的马上定setRealAlarm{"hour":17,"minute":52}等你哦') === '好的马上定等你哦',
);
check(
  '形状二中文正文里内联',
  stripJsonToolCalls('我用setRealAlarm{"hour":17,"minute":52}给你定了') === '我用给你定了',
);
check(
  '形状二带括号包裹 setRealAlarm({...}) 剥除',
  stripJsonToolCalls('马上setRealAlarm({"hour":17,"minute":52})就好') === '马上就好',
);
check(
  '形状二 pretty 多行参数剥除',
  stripJsonToolCalls('好嘞\nlockApp{\n  "packageName": "com.tencent.mm"\n}') === '好嘞',
);
const ex5 = extractJsonToolCalls('setRealAlarm{"hour":17,"minute":52}');
check('形状二提取 setRealAlarm 参数完整', ex5.length === 1 && ex5[0].name === 'setRealAlarm' && (ex5[0].args as { hour: number; minute: number }).hour === 17 && (ex5[0].args as { minute: number }).minute === 52, JSON.stringify(ex5));
const ex6 = extractJsonToolCalls('好哦switchToChat{}');
check('形状二空参数提取', ex6.length === 1 && ex6[0].name === 'switchToChat' && Object.keys(ex6[0].args).length === 0);
const ex7 = extractJsonToolCalls('先setVolume{"volume":3}再lockApp({"packageName":"com.x"})');
check('形状二两处提取（括号包裹+裸贴）', ex7.length === 2 && ex7[0].name === 'setVolume' && ex7[1].name === 'lockApp', JSON.stringify(ex7));
const ex8 = extractJsonToolCalls('{"name": "setRealAlarm", "hour": 17, "minute": 52}');
check('扁平形状（无 arguments 包裹）参数不丢', ex8.length === 1 && ex8[0].name === 'setRealAlarm' && (ex8[0].args as { hour: number }).hour === 17 && (ex8[0].args as { minute: number }).minute === 52, JSON.stringify(ex8));
check(
  '扁平形状剥除',
  stripJsonToolCalls('马上{"name": "setRealAlarm", "hour": 17, "minute": 52}好') === '马上好',
);
check('非工具名标识符+{参数} 不误剥', stripJsonToolCalls('配置foo{"timeout":30}就这样') === '配置foo{"timeout":30}就这样');
check('工具名与{之间有空格不误剥', stripJsonToolCalls('setVolume {"volume":3} 说明') === 'setVolume {"volume":3} 说明');
check('形状二半截 → true（扣留）', looksLikePartialToolJson('setRealAlarm{"hour":17,"min') === true);
check('形状二半截带正文 → true', looksLikePartialToolJson('马上setRealAlarm({"hour":17') === true);
check('形状二完整 → false（不扣留，走提取）', looksLikePartialToolJson('setRealAlarm{"hour":17,"minute":52}') === false);
check(
  '形状二尾部残缺切除连工具名',
  stripTrailingPartialToolJson('定好闹钟哦setRealAlarm{"hour":17,"minu') === '定好闹钟哦',
);
check(
  '形状二尾部残缺带括号',
  stripTrailingPartialToolJson('马上setRealAlarm({"hour":') === '马上',
);
check('形状二完整尾巴不动', stripTrailingPartialToolJson('setRealAlarm{"hour":17,"minute":52}') === 'setRealAlarm{"hour":17,"minute":52}');
check('普通标识符半截不动', stripTrailingPartialToolJson('你好foo{"msg": "hel') === '你好foo{"msg": "hel');

// 场景 G：形状二流式分段（机主实测「切回界面也是这样、锁应用也是这样」的流式形态）
{
  const s = makeSegSink();
  s.sink('好的');
  s.sink('setRealAlarm{"hour":17,"minute":52}');
  const r = s.finish();
  check('G. 形状二整段：正文上屏、调用提取', JSON.stringify(r.displayed) === '["好的"]' && r.pendingJsonCalls.length === 1 && r.pendingJsonCalls[0].name === 'setRealAlarm', JSON.stringify(r.displayed) + JSON.stringify(r.pendingJsonCalls));
}
// 场景 H：形状二流掐断在半截
{
  const s = makeSegSink();
  s.sink('马上');
  s.sink('setRealAlarm{"hour":17,"mi');
  const r = s.finish();
  check('H. 形状二断流：半截不上屏', JSON.stringify(r.displayed) === '["马上"]' && r.heldAtFinish.includes('setRealAlarm') === false || r.displayed.join('').includes('setRealAlarm') === false, JSON.stringify(r.displayed));
  check('H. 形状二断流：零误提取', r.pendingJsonCalls.length === 0);
}

console.log(`\n== 结果：${pass} ok / ${fail} fail ==`);
process.exit(fail > 0 ? 1 : 0);
