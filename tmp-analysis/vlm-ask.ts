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
  for (const [f, q] of files.map((x) => [x, null] as const)) {
    void q;
  }
  // 用法: bun vlm-ask.ts <file> <question>
}

async function ask() {
  const zai = await ZAI.create();
  const [file, question] = [process.argv[2], process.argv.slice(3).join(' ')];
  const url = toDataUrl(file);
  const completion = await zai.chat.completions.createVision({
    model: 'glm-4.5v',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url } },
        ],
      },
    ],
  });
  const content = (completion as any)?.choices?.[0]?.message?.content ?? '';
  console.log(typeof content === 'string' ? content : JSON.stringify(content));
}

ask().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});

void main;
