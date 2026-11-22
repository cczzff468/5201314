/**
 * 一次性维护：清理 FeaturedCover 表里的坏封面（HTML 页面伪装的"封面"死链）。
 * 用严格校验（content-type + 魔数嗅探）逐条实测，删掉非图片的行，
 * 让 featured-covers API 自动用干净源重新补齐。
 * 运行：bun run scripts/clean-featured-covers.ts
 */
import { Database } from 'bun:sqlite';

const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

function isImageBytes(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true; // GIF
  if (b[0] === 0x42 && b[1] === 0x4d) return true; // BMP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WEBP
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true; // AVIF/HEIC
  return false;
}

async function verify(url: string): Promise<boolean> {
  try {
    if (/\.html?($|\?)/i.test(url)) return false;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: new URL(url).origin + '/', Accept: 'image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    if (buf.byteLength <= 512) return false;
    if (type.startsWith('text/') || type.includes('html') || type.includes('json')) return false;
    if (type.startsWith('image/')) return true;
    return isImageBytes(buf);
  } catch {
    return false;
  }
}

const db = new Database('db/custom.db');
const rows = db.query('SELECT name, coverUrl FROM FeaturedCover').all() as { name: string; coverUrl: string }[];
console.log(`共 ${rows.length} 条缓存封面，逐条实测…`);

const bad: string[] = [];
const CONCURRENCY = 12;
let done = 0;
const queue = [...rows];
async function worker() {
  while (queue.length) {
    const r = queue.shift()!;
    const ok = await verify(r.coverUrl);
    if (!ok) bad.push(r.name);
    done++;
    if (done % 20 === 0) console.log(`  进度 ${done}/${rows.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`坏封面 ${bad.length} 条：`);
for (const n of bad) console.log('  ✗', n);
if (bad.length) {
  const stmt = db.prepare('DELETE FROM FeaturedCover WHERE name = ?');
  for (const n of bad) stmt.run(n);
  console.log('已删除。');
} else {
  console.log('全部健康，无需清理。');
}
db.close();
