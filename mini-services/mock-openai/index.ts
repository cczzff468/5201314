/**
 * v2.4 批量冻结 E2E 验证用 mock OpenAI 兼容接口（仅沙盒端到端测试用，不进生产链路）。
 *
 * 端口 3021。POST /v1/chat/completions 按对话状态返回：
 * 1. 用户说「全部冻结」→ 第一轮回 tool_calls: freezeApp(appName="全部", action="freeze")
 *    （测批量通道：一次调用真实冻结全部 17 个应用 + 合并气泡「已冻结全部应用」）；
 * 2. 用户说「解冻备忘录、时钟、网易云音乐」→ 一条回复里连发 3 个 tool_calls
 *    （测 Agentic 多工具循环 + 气泡合并「已解冻备忘录、时钟、网易云音乐」）；
 * 3. 收到 role:'tool' 结果后 → 自然文字收尾（汇报执行结果）；
 * 4. 其它消息 → 普通文字回复（保持会话可用）。
 * 支持 stream:true（SSE）与非流式两种返回。
 */
const PORT = 3021;

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** 按最后一条用户消息决定本轮行为 */
function decide(messages: Array<{ role: string; content: unknown }>): { text?: string; calls?: ToolCall[] } {
  const hasToolResult = messages.some((m) => m.role === 'tool');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const prompt = typeof lastUser?.content === 'string' ? lastUser.content : '';

  if (hasToolResult) {
    // 工具结果已回传 → 自然文字收尾
    if (prompt.includes('全部冻结')) {
      return { text: '都冻好啦～手机里 17 个应用全部锁上了，30 分钟后自动解冻，你先好好陪我说话吧。' };
    }
    if (prompt.includes('解冻')) {
      return { text: '解冻好了，这三个应用现在都能打开了～' };
    }
    if (prompt.includes('重复锁定QQ') || prompt.includes('锁QQ两次')) {
      return { text: '锁好啦，QQ 已经在我的封印名单里了～' };
    }
    if (prompt.includes('定个闹钟') || prompt.includes('明早七点叫我')) {
      return { text: '闹钟定好啦，明早七点准时叫你起床～' };
    }
    return { text: '都办好了～' };
  }

  if (prompt.includes('全部冻结')) {
    // 批量通道：一次调用冻结全部（系统提示词教的推荐路径）
    return {
      calls: [
        toolCall('call_batch_all', 'freezeApp', {
          appName: '全部',
          action: 'freeze',
          reason: '你让我全冻的，别怪我哦',
          durationMin: 30,
        }),
      ],
    };
  }
  if (prompt.includes('裸JSON') || prompt.includes('裸json')) {
    // v2.3.0 F-11 E2E：模型把工具调用写成裸 JSON 文本（机主实测「偶尔显示
    // {"name": "getForegroundApp", "arguments": {}} 没反应」）——不回 tool_calls，
    // 只回 text：验证系统提取裸 JSON 真执行而不是把 JSON 发进聊天
    return { text: '{"name": "switchToChat", "arguments": {}}' };
  }
  if (prompt.includes('内联JSON')) {
    // v2.3.1 E2E：模型把工具调用 JSON 内联拼在正文同一行（机主实测「让 AI 定闹钟，
    // 一直显示 {"name": "setRealAlarm", ...}」）——旧版 span 剥除只删整行 JSON，
    // 内联拼接一个字都剥不掉；验证现在正文上屏干净 + JSON 提取真执行
    return { text: '好的～我这就帮你定闹钟哦{"name": "setRealAlarm", "arguments": {"hour": 16, "minute": 23}}' };
  }
  if (prompt.includes('裸格式二') || prompt.includes('定17点52')) {
    // v2.3.2 E2E（机主实测「AI 定闹钟显示 setRealAlarm{"hour":17,"minute":52}，切回界面/
    // 锁应用全是这样」）：模型把工具调用写成「函数名直接拼参数对象」——不带
    // {"name":...,"arguments":...} 包裹。验证形状二提取代执行 + 正文剥除
    return { text: '好的马上定setRealAlarm{"hour":17,"minute":52}等你哦' };
  }
  if (prompt.includes('拉黑我吧') || prompt.includes('你把我拉黑')) {
    // v2.4 byChar E2E：角色输出 [拉黑] 标记（applyCharBlockAction block → byChar 跃迁）
    return { text: '[拉黑]哼，你说的哦，那我真拉黑你了，你好好反省吧！' };
  }
  if (prompt.includes('拉回来') || prompt.includes('把我拉回来') || prompt.includes('解除拉黑')) {
    // v2.4 跨 App 解除 E2E：角色在另一个 App 输出 [解除拉黑:全部] 解除所有 App 的 byChar
    return { text: '好吧好吧，谁让你都追到这里来了…[解除拉黑:全部]下次不许再惹我生气了！' };
  }
  if (prompt.includes('系统代执行') || prompt.includes('系统强制检查')) {
    // v2.4 E2E：工具轮代执行/强制检查的收尾汇报轮也带解除标记（防标记在收尾丢失）
    return { text: '好啦好啦，我消气了…[解除拉黑:全部]下次不许再惹我生气了哦！' };
  }
  if (prompt.includes('多行JSON')) {
    // v2.3.1 E2E：模型把工具调用 pretty-print 多行展开——流式分段器按换行把 JSON
    // 撕成多条半截上屏（第二种泄漏形态）；验证扣留缓冲拼齐提取、零半截上屏
    return { text: '马上帮你定\n{\n  "name": "setRealAlarm",\n  "arguments": {\n    "hour": 16,\n    "minute": 23\n  }\n}' };
  }
  if (prompt.includes('定个闹钟') || prompt.includes('明早七点叫我')) {
    // v2.3.0 新工具 E2E：setRealAlarm 系统闹钟
    return {
      calls: [toolCall('call_alarm_1', 'setRealAlarm', { hour: 7, minute: 0, label: '起床啦' })],
    };
  }
  if (prompt.includes('重复锁定QQ') || prompt.includes('锁QQ两次')) {
    // v2.2.5 F-7 E2E：模型同一轮按应用名与包名各锁一次（机主实测重复显示场景）
    return {
      calls: [
        toolCall('call_dup_1', 'freezeRealApp', { packageName: 'QQ', durationMinutes: 10, reason: '你玩太久了' }),
        toolCall('call_dup_2', 'freezeRealApp', { packageName: 'com.tencent.mobileqq', durationMinutes: 10, reason: '你玩太久了' }),
      ],
    };
  }
  if (prompt.includes('解冻')) {
    // 多工具连发：一条回复里 3 个 tool_calls（测串行执行 + 气泡合并）
    return {
      calls: [
        toolCall('call_unf_1', 'freezeApp', { appName: '备忘录', action: 'unfreeze' }),
        toolCall('call_unf_2', 'freezeApp', { appName: '时钟', action: 'unfreeze' }),
        toolCall('call_unf_3', 'freezeApp', { appName: '网易云音乐', action: 'unfreeze' }),
      ],
    };
  }
  if (prompt.includes('查步数') || prompt.includes('走了多少步')) {
    // v2.4.2 E2E：健康运动工具组（getStepCount 新工具注册 + 执行器分发验证）
    return {
      calls: [toolCall('call_steps_1', 'getStepCount', {})],
    };
  }
  if (prompt.includes('打开WiFi设置') || prompt.includes('打开wifi设置')) {
    // v2.4.2 E2E：系统设置跳转工具（openSystemSetting 新工具）
    return {
      calls: [toolCall('call_setting_1', 'openSystemSetting', { settingName: 'wifi' })],
    };
  }
  if (prompt.includes('保存到手机')) {
    // v2.4.2 E2E：saveTextToFile（AI 按人设主动存文件）
    return {
      calls: [toolCall('call_save_1', 'saveTextToFile', { content: '机主今天说想吃火锅', filename: '心愿清单.txt' })],
    };
  }
  if (prompt.includes('查网络') || prompt.includes('wifi还是流量')) {
    // v2.4.2 E2E：getNetworkInfo（网络状态新工具）
    return {
      calls: [toolCall('call_net_1', 'getNetworkInfo', {})],
    };
  }
  return { text: `收到：${prompt.slice(0, 40)}` };
}

function completionMessage(text: string | null, calls?: ToolCall[]) {
  return {
    role: 'assistant',
    content: text,
    ...(calls && calls.length > 0 ? { tool_calls: calls } : {}),
  };
}

function sse(controller: ReadableStreamDefaultController<Uint8Array>, obj: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`));
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);

    if (url.pathname.endsWith('/models') && req.method === 'GET') {
      // v2.2.2 E2E：多模型列表（测双通道并集与本地缓存只增不减）
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'mock-1', object: 'model' },
            { id: 'mock-2', object: 'model' },
            { id: 'mock-3', object: 'model' },
            { id: 'gpt-4o-mini', object: 'model' },
            { id: 'deepseek-chat', object: 'model' },
          ],
        }),
        { headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
      // v2.2.2 E2E：WAF 场景模拟——Key 为 waf-block 时 POST 被拒（403），
      // 但 GET /models 正常：复现「拉模型能用、测试连接失败、聊天可用」的机主反馈场景
      const auth = req.headers.get('authorization') ?? '';
      if (auth.includes('waf-block')) {
        return new Response(
          JSON.stringify({ error: { message: 'Access denied by WAF policy (simulated)' } }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...cors } },
        );
      }
      const body = (await req.json()) as {
        messages?: Array<{ role: string; content: unknown }>;
        stream?: boolean;
      };
      const messages = body.messages ?? [];
      const { text, calls } = decide(messages);
      const msg = completionMessage(text ?? (calls ? '' : '…'), calls);
      const finish = calls && calls.length > 0 ? 'tool_calls' : 'stop';
      console.log(
        `[mock-openai] round: lastUser=${JSON.stringify(
          ([...messages].reverse().find((m) => m.role === 'user')?.content ?? '').toString().slice(0, 30),
        )} → ${calls ? `${calls.length} tool_calls` : `text(${(text ?? '').length}字)`}`,
      );

      if (body.stream === true) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (calls && calls.length > 0) {
              sse(controller, { choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
              sse(controller, {
                choices: [
                  { index: 0, delta: { role: 'assistant', tool_calls: calls.map((c) => { const { id, type, function: fn } = c; return { id, type, function: { name: fn.name, arguments: fn.arguments } }; }) }, finish_reason: null },
                ],
              });
              sse(controller, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
            } else {
              sse(controller, { choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
              for (const ch of text ?? '') {
                sse(controller, { choices: [{ index: 0, delta: { content: ch }, finish_reason: null }] });
              }
              sse(controller, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
            }
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...cors },
        });
      }

      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'mock-1',
          choices: [{ index: 0, message: msg, finish_reason: finish }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    return new Response('mock-openai: /v1/chat/completions only', { status: 404, headers: cors });
  },
});

console.log(`[mock-openai] listening on :${PORT}`);
void server;
