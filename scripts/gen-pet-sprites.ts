/**
 * v6.1 宠物立绘批量生成 —— 11 品种一比一复刻（用户参考图同款软萌蓬松插画风）
 *
 * - 统一风格：蓬松毛发质感 + 真实品种毛色花纹 + 大圆亮眼 + 端坐 3/4 前视 + 全身入画
 * - 纯品红背景（#FF00FF）→ 后续 sharp 色键抠透明
 * - 输出 raw/<id>.png（1024²），抠图压缩后入 public/pets/sprite-<id>.png
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'raw');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const STYLE =
  'Adorable fluffy pet sitting upright on the ground, full body visible from ear tips to tail, ' +
  'body facing slightly toward the viewer\'s LEFT, three-quarter front view, ' +
  'soft fluffy fur painted with delicate hair strokes, real authentic breed coat colors and markings, ' +
  'big round sparkly dark eyes, tiny pink blush on cheeks, sweet gentle expression, ' +
  'cute slightly rounded proportions like a high-quality children\'s book illustration, ' +
  'soft warm lighting on the pet, centered composition with a little margin around the pet, ' +
  'completely flat solid dark teal green background color #0E7C6B filling the entire background evenly, ' +
  'no gradient in background, no ground, no shadow, no props, no text, no watermark';

const BREEDS: { id: string; prompt: string }[] = [
  {
    id: 'shiba',
    prompt:
      'A Shiba Inu dog sitting politely, orange-tan short fur with white cream chest belly cheeks and paws, ' +
      'white muzzle, small upright triangular ears, curly cream tail over the back, gentle smile, ' + STYLE,
  },
  {
    id: 'pomeranian',
    prompt:
      'A tiny cream-orange Pomeranian puppy sitting like a fluffy cotton ball, extremely plush round mane around the neck, ' +
      'small pointed ears, big dark eyes, short muzzle, plume tail curved over the back, orange-tan fur, ' + STYLE,
  },
  {
    id: 'golden',
    prompt:
      'A golden retriever puppy sitting, soft golden-cream thick fur, broad head with floppy ears hanging beside the face, ' +
      'white chest, fluffy feathered tail resting on the ground, warm friendly eyes, ' + STYLE,
  },
  {
    id: 'husky',
    prompt:
      'A Siberian Husky puppy sitting, grey and white thick plush coat with dark grey saddle marking on the back, ' +
      'white face with grey cap and forehead spots, striking ice-blue eyes, upright triangular ears, fluffy tail, ' + STYLE,
  },
  {
    id: 'corgi',
    prompt:
      'A Pembroke Welsh Corgi sitting, red-orange and white coat with white blaze on the face and white chest collar, ' +
      'very large upright rounded ears, long low body with short little legs, big pointy ears, no tail, happy expression, ' + STYLE,
  },
  {
    id: 'orange',
    prompt:
      'A chubby orange tabby cat sitting, bright orange-ginger fur with darker orange mackerel stripes on the head back and tail, ' +
      'white muzzle chest and paws, round face with big amber-dark eyes, thick tail wrapped beside the body, ' + STYLE,
  },
  {
    id: 'ragdoll',
    prompt:
      'A Ragdoll cat sitting, semi-longhair silky cream-white fluffy coat with dark seal-brown colorpoints on the face mask ears tail and paws, ' +
      'deep blue round eyes, white soft body fur, elegant fluffy tail, ' + STYLE,
  },
  {
    id: 'calico',
    prompt:
      'A calico cat sitting, mostly white fur with large warm orange patches and black patches on the head and back, ' +
      'one orange patch over one ear and eye area, round cute face, golden eyes, tail wrapped around, ' + STYLE,
  },
  {
    id: 'lihua',
    prompt:
      'A Chinese Li Hua brown tabby cat sitting, brown-grey fur with clear black mackerel tabby stripes, ' +
      'classic dark M shaped marking on the forehead, green-gold eyes, white-grey inner chest, ringed striped tail, ' + STYLE,
  },
  {
    id: 'goldenShaded',
    prompt:
      'A golden shaded British Shorthair cat sitting, apricot-golden dense plush coat with black-tipped shading on the back, ' +
      'very round chubby face with full cheeks, small rounded ears, big round green eyes, dark paw tips, ' + STYLE,
  },
  {
    id: 'tuxedo',
    prompt:
      'A tuxedo cow cat sitting, mostly white fur with big random jet-black patches covering one ear with an eye patch and part of the back, ' +
      'pink nose, round cute face, golden eyes, black tail, like a little dairy cow, ' + STYLE,
  },
];

async function main() {
  const zai = await ZAI.create();
  let ok = 0;
  for (const b of BREEDS) {
    const file = path.join(OUT, `${b.id}.png`);
    if (fs.existsSync(file) && fs.statSync(file).size > 50_000) {
      console.log(`skip ${b.id} (exists)`);
      ok++;
      continue;
    }
    let done = false;
    for (let a = 1; a <= 3 && !done; a++) {
      try {
        const r = await zai.images.generations.create({ prompt: b.prompt, size: '1024x1024' });
        const buf = Buffer.from(r.data[0].base64, 'base64');
        if (buf.length < 30_000) throw new Error(`too small ${buf.length}`);
        fs.writeFileSync(file, buf);
        console.log(`ok ${b.id} ${(buf.length / 1024).toFixed(0)}KB`);
        done = true;
        ok++;
      } catch (e) {
        console.error(`fail ${b.id} try${a}: ${(e as Error).message}`);
        await new Promise((s) => setTimeout(s, 1500 * a));
      }
    }
  }
  console.log(`done ${ok}/${BREEDS.length}`);
  process.exit(ok === BREEDS.length ? 0 : 1);
}
main();
