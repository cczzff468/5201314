import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

async function main() {
  const zai = await ZAI.create();
  // 图1 顶部区域细节
  const data = fs.readFileSync('/home/z/my-project/upload/Screenshot_20261121_214508.jpg');
  const b64 = data.toString('base64');
  const response = await zai.chat.completions.createVision({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '这是书源管理页面的截图。请精确回答：1) 顶部导航栏里，"书源管理"标题与右侧的按钮（多选/校验/+）是否存在重叠或距离过近？具体描述各自位置。2) 筛选标签行有哪些标签，是否被截断？3) 每个书源卡片内部布局：图标、名称、标签、网址、按钮的排布，有什么排版问题（如文字换行、溢出、挤压）？4) 整体还有什么 UI 问题？' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ],
    }],
    thinking: { type: 'disabled' },
  });
  console.log(response.choices[0]?.message?.content);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
