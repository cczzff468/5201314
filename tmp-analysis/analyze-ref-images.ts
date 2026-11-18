import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const files = process.argv.slice(2);
const dir = '/home/z/my-project/upload';

function toDataUrl(file: string): string {
  const full = path.join(dir, file);
  const buf = fs.readFileSync(full);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function main() {
  const zai = await ZAI.create();
  for (const f of files) {
    const url = toDataUrl(f);
    const completion = await zai.chat.completions.createVision({
      model: 'glm-4.5v',
      messages: [
        {
          role: 'system',
          content:
            '你是资深 UI 设计师。用户会给一张 iOS 微信「液态玻璃」主题的参考截图，请极其详细地描述 UI 的每个部分：1) 整体背景是什么（颜色/模糊/壁纸）2) 顶部导航栏样式（材质、透明度、按钮）3) 列表/聊天区域每一行的样式（卡片材质、圆角、分割线、头像位置）4) 底部 Tab 栏样式（材质、图标、选中态、标签文字）5) 气泡样式（如果有对话气泡）6) 所有液态玻璃材质的细节（模糊度、边缘高光、边框、阴影、饱和度提升）7) 文字颜色 8) 弹出面板/菜单样式（如果有）。用中文回答，尽量详细、结构化。',
        },
        { role: 'user', content: [{ type: 'text', text: `请详细描述这张图（${f}）的液态玻璃主题 UI 细节` }, { type: 'image_url', image_url: { url } }] },
      ],
    });
    const content = (completion as any)?.choices?.[0]?.message?.content ?? '';
    console.log(`\n${'='.repeat(80)}\nIMAGE: ${f}\n${'='.repeat(80)}`);
    console.log(typeof content === 'string' ? content : JSON.stringify(content));
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
