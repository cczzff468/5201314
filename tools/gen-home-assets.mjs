/**
 * 情侣小家 2.5D 卡通素材批量生成器 v2（蓝幕版）
 *
 * v1 教训：洋红被画成粉色渐变、与粉色系家具同族；绿幕会误伤绿植。
 * v2 用纯蓝幕（#1E66FF）——与奶油/木色/粉色/绿植全部正交，抠图零误伤。
 * 生成后由 process-home-assets.mjs 做洪泛+边框簇色键控。
 *
 * 用法：bun tools/gen-home-assets.mjs          （增量：已存在且非空的文件跳过）
 *       bun tools/gen-home-assets.mjs --force  （全部重新生成）
 */

import ZAI from 'z-ai-web-dev-sdk';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('tools/assets-raw');
const FORCE = process.argv.includes('--force');

// ---------------- 风格基座 ----------------

const BLUE =
  'The object floats centered on a solid flat uniform bright pure blue background (#1E66FF) ' +
  'like a blue screen chroma key, the blue fills the entire frame edge to edge, ' +
  'absolutely nothing else in the frame: no shadow, no floor, no ground, no grass, no plants, ' +
  'no extra objects, no text, no watermark. high quality game asset';

const STYLE_FURN =
  "Cute cartoon 2.5D render game asset in the style of 'Adorable Home' mobile game, " +
  'soft pastel colors, cream white and warm honey wood tones, rounded plush shapes, ' +
  'smooth cel shading, soft gradients, cozy heartwarming, ';

const TAIL_FURN = `, front view with slight top-down angle, single object perfectly centered. ${BLUE}`;

const STYLE_CHAR =
  "Cute chibi cartoon character game asset in the style of 'Adorable Home' mobile game, " +
  'soft pastel colors, rounded proportions, big head, smooth cel shading, ';

const TAIL_CHAR = `, standing neutral pose, full body including shoes visible, perfectly centered. ${BLUE}`;

// ---------------- 素材清单 ----------------

const F = (file, subject, size = '1152x864') => ({ file, prompt: STYLE_FURN + subject + TAIL_FURN, size });
const C = (file, subject, size = '864x1152') => ({ file, prompt: STYLE_CHAR + subject + TAIL_CHAR, size });

const TASKS = [
  // ---- 家具（客厅） ----
  F('sofa.png', 'a cozy two-seater cream fabric sofa with a soft pink knitted blanket draped over one armrest and two pastel pink cushions'),
  F('sofaLong.png', 'a cozy three-seater cream fabric sofa with pastel pink and peach cushions'),
  F('coffeeTable.png', 'a round honey wood coffee table with two small white ceramic mugs and a tiny green potted succulent on top'),
  F('rug.png', 'a soft round dusty pink area rug with a subtle cream geometric border pattern, seen slightly from above, flat thick fabric with soft edges'),
  F('tvStand.png', 'a low honey wood TV cabinet with two drawers, round knobs and slim legs'),
  F('tv.png', 'a modern flat-screen smart TV with dark grey screen turned off, slim dark frame, on a small media stand base'),
  F('recordPlayer.png', 'a cute retro portable vinyl record player with walnut wood case, cream control knobs and a black record on the platter'),
  F('speaker.png', 'a small cute retro bluetooth speaker, cream fabric texture with walnut wood top panel'),
  F('sideTable.png', 'a small round white side table with slim wood legs, a cute couple photo frame and one mug on top'),
  F('lampFloor.png', 'a slim floor lamp with a warm glowing round cream paper lantern shade and thin honey wood stand'),
  F('lampTable.png', 'a small cute bedside table lamp with a mushroom shaped warm glowing cream shade, nothing else around it'),
  F('plantMonstera.png', 'a lush green monstera plant with glossy leaves in a cream ceramic pot'),
  F('plantSmall.png', 'a tiny round green succulent plant in a small terracotta pot'),
  F('pillow.png', 'a cute heart shaped pastel pink throw pillow, plump and soft'),
  F('cat.png', 'a chubby orange tabby cat curled up sleeping, cozy and round, tail wrapped around body'),
  F('trashcan.png', 'a small cute white trash bin with pastel pink push lid'),
  F('books.png', 'a neat stack of five pastel colored hardcover books with a tiny plant on top'),
  F('box.png', 'a small cardboard moving box with closed flaps and packing tape'),
  F('boxOpen.png', 'a small cardboard moving box with open flaps and neatly folded pink and cream clothes inside'),

  // ---- 家具（卧室） ----
  F('bed.png', 'a cozy double bed with cream duvet, pastel pink blanket folded at the foot, two regular pillows plus one heart pillow, warm wood frame and headboard'),
  F('nightstand.png', 'a small white nightstand with one drawer, round gold knob and slim legs'),
  F('wardrobe.png', 'a tall white and warm wood two-door wardrobe with round handles, closed doors'),
  F('wardrobeOpen.png', 'a tall white and warm wood two-door wardrobe with both doors wide open revealing neatly hung pink and cream clothes on hangers and folded sweaters on a shelf'),

  // ---- 家具（餐厨/洗衣） ----
  F('tableDining.png', 'a warm honey wood dining table for two with a small vase of pink tulips on it'),
  F('chair.png', 'a cute rounded wood chair with a pastel pink seat cushion'),
  F('fridge.png', 'a cute cream retro refrigerator with rounded corners and gold handles, doors closed'),
  F('fridgeOpen.png', 'a cute cream retro refrigerator with doors open revealing shelves with milk bottles, fruits and jam jars'),
  F('stove.png', 'a cute white kitchen stove with oven door and four pastel pink burner rings on top'),
  F('washer.png', 'a cute white front-load washing machine with round glass door showing an empty drum, silver control panel on top'),

  // ---- 墙面装饰 ----
  F('wallClock.png', 'a cute round wall clock with cream face, honey wood frame and pastel pink hands', '1024x1024'),
  F('photoFrame.png', 'a cute white photo frame with small hearts in the corners, holding a warm pastel illustration of two cartoon lovebirds', '1024x1024'),
  F('wallShelf.png', 'a floating honey wood wall shelf with tiny potted plants, two small picture frames and a little candle'),

  // ---- 小人（我 = 男生） ----
  C('me_front.png', 'a cute chibi boy with short dark brown hair wearing a cream knit sweater, brown pants and white sneakers, front view standing, facing the viewer with a gentle smile'),
  C('me_back.png', 'a cute chibi boy with short dark brown hair wearing a cream knit sweater, brown pants and white sneakers, back view standing, seen from behind showing the back of the hair and sweater'),
  C('me_side.png', 'a cute chibi boy with short dark brown hair wearing a cream knit sweater, brown pants and white sneakers, side view standing facing left in full side profile'),

  // ---- 小人（TA = 女生） ----
  C('ta_front.png', 'a cute chibi girl with shoulder-length chestnut brown hair and a small pink hairclip, wearing a pastel pink dress with white collar and white shoes, front view standing, facing the viewer with a gentle smile'),
  C('ta_back.png', 'a cute chibi girl with shoulder-length chestnut brown hair and a small pink hairclip, wearing a pastel pink dress with white collar and white shoes, back view standing, seen from behind showing the back of the hair'),
  C('ta_side.png', 'a cute chibi girl with shoulder-length chestnut brown hair and a small pink hairclip, wearing a pastel pink dress with white collar and white shoes, side view standing facing left in full side profile'),
];

// ---------------- 生成器 ----------------

fs.mkdirSync(path.join(OUT_DIR, 'furniture'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'chars'), { recursive: true });

function outPath(t) {
  return path.join(OUT_DIR, t.file.startsWith('me_') || t.file.startsWith('ta_') ? 'chars' : 'furniture', t.file);
}

async function genOne(zai, t, attempt = 1) {
  const o = outPath(t);
  if (!FORCE && fs.existsSync(o) && fs.statSync(o).size > 2048) {
    return { file: t.file, status: 'skip' };
  }
  try {
    const res = await zai.images.generations.create({ prompt: t.prompt, size: t.size });
    const b64 = res?.data?.[0]?.base64;
    if (!b64) throw new Error('empty base64');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 4096) throw new Error('image too small: ' + buf.length);
    fs.writeFileSync(o, buf);
    await new Promise((r) => setTimeout(r, 800));
    return { file: t.file, status: 'ok', bytes: buf.length };
  } catch (e) {
    const msg = String(e?.message ?? e);
    const is429 = msg.includes('429');
    if (attempt < (is429 ? 6 : 3)) {
      await new Promise((r) => setTimeout(r, (is429 ? 6000 : 1500) * attempt));
      return genOne(zai, t, attempt + 1);
    }
    return { file: t.file, status: 'fail', error: msg };
  }
}

async function main() {
  const zai = await ZAI.create();
  const results = [];
  const queue = [...TASKS];
  const workers = Array.from({ length: 1 }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const r = await genOne(zai, t);
      results.push(r);
      console.log(`[${results.length}/${TASKS.length}] ${r.status.padEnd(4)} ${r.file}${r.error ? ' :: ' + r.error : ''}`);
    }
  });
  await Promise.all(workers);

  const fails = results.filter((r) => r.status === 'fail');
  console.log(`\nDONE ok=${results.filter((r) => r.status !== 'fail').length} fail=${fails.length}`);
  if (fails.length) {
    console.log('FAILED:', fails.map((f) => f.file).join(', '));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
