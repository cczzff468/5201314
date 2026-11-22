import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

async function ask(zai, file, question) {
  const data = fs.readFileSync(`/home/z/my-project/upload/${file}`);
  const b64 = data.toString('base64');
  const response = await zai.chat.completions.createVision({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: question },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ],
    }],
    thinking: { type: 'disabled' },
  });
  console.log(`\n===== ${file} =====\n` + response.choices[0]?.message?.content);
}

async function main() {
  const zai = await ZAI.create();
  await ask(zai, 'Screenshot_20261121_215214.jpg',
    '这是阅读App「我的/我」页面的截图。请描述：1) 页面整体布局（从上到下有哪些区块）；2) 阅读统计卡片区域：三张卡片分别显示什么，哪张卡片有文字换行/溢出问题？具体哪个文字换行了？3) 其他文字显示不全、换行、溢出的地方？请精确引用文字。');
  await ask(zai, 'Screenshot_20261121_215634.jpg',
    '这是书籍详情页截图。请仔细描述：1) 顶部导航区：返回按钮的位置、样式（颜色/形状），它周围有什么；刷新按钮/换源按钮在哪，什么样式；2) 返回键那里看起来有什么问题？（比如重叠、错位、被裁切、按钮太小、位置怪异等）3) 书籍信息区布局：封面、书名、作者、标签等排布；4) 其他排版问题。请精确描述。');
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
