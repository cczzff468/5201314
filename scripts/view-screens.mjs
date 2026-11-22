import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const files = [
  'Screenshot_20261121_214508.jpg',
  'Screenshot_20261121_215214.jpg',
  'Screenshot_20261121_215246.jpg',
  'Screenshot_20261121_215634.jpg',
  'Screenshot_20261121_220017.jpg',
];

async function main() {
  const zai = await ZAI.create();
  const content = [
    {
      type: 'text',
      text: '这是同一个阅读 App（笔趣阁风格小说阅读器）的5张截图，按顺序编号图1到图5。请逐张详细描述：1) 界面名称/功能；2) 布局结构（顶部、中部、底部各有什么）；3) 所有可见的文字内容（按钮、标签、提示语、标题、统计数字等，尽量原文引用）；4) 视觉样式（颜色、卡片、间距）；5) 任何看起来有问题/不协调的地方（如文字换行、溢出、空白、模糊等）。请特别留意：书源管理界面、阅读设置弹窗、书籍详情页、搜索页、分类页。'
    }
  ];
  for (const f of files) {
    const data = fs.readFileSync(`/home/z/my-project/upload/${f}`);
    const b64 = data.toString('base64');
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${b64}` }
    });
  }
  const response = await zai.chat.completions.createVision({
    messages: [{ role: 'user', content }],
    thinking: { type: 'disabled' },
  });
  console.log(response.choices[0]?.message?.content);
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
