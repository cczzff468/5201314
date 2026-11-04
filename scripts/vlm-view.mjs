import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

async function main() {
  const zai = await ZAI.create();
  const f = process.argv[2];
  const q = process.argv[3] || '描述这张截图的内容';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const b64 = fs.readFileSync(f).toString('base64');
      const res = await zai.chat.completions.createVision({
        messages: [{ role: 'user', content: [
          { type: 'text', text: q },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ]}],
        thinking: { type: 'disabled' },
      });
      console.log(res.choices[0]?.message?.content || 'no content');
      return;
    } catch (e) {
      console.log(`attempt ${attempt} ERROR: ${String(e).slice(0,150)}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
main();
