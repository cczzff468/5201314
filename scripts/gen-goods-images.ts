/**
 * Task 58：淘宝/美团可爱卡通商品图批量生成（持久轮询版）
 * - 67 张 kawaii 扁平卡通图（参考用户上传的可爱奶茶/汉堡/冰淇淋风格）
 * - 1024x1024 生成 → sharp 压缩为 560x560 webp（q82，单张 ~30-60KB）
 * - 已存在且大小正常的文件跳过（可续传）；遇到 429 限流自动等待重试，
 *   整轮跑完后若有缺失从头再来，直到全部成功或总超时 40 分钟
 */
import ZAI from 'z-ai-web-dev-sdk';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const OUT = '/home/z/my-project/public/goods';
const RAW = '/home/z/my-project/.gen-raw';
const LOG = '/home/z/my-project/.gen-imgs.log';
const TOTAL_BUDGET_MS = 40 * 60_000;

const STYLE =
  'cute kawaii flat cartoon illustration sticker, bold thick black outlines, soft pastel colors, rounded simple shapes, chibi style with happy smiling face, centered composition, plain solid {bg} background, no text, no watermark, minimal app icon style';

const BG = [
  'cream yellow (#FFF3D6)',
  'mint green (#E3F6E8)',
  'sakura pink (#FDE8EC)',
  'sky blue (#E3F1FB)',
  'lavender (#EFE9FA)',
  'apricot orange (#FFEFE0)',
];

// 文件名（不含扩展名）→ 画面主体
const SUBJECTS = {
  // ---------------- 美团 食品饮品 ----------------
  'mt-milk-tea': 'bubble milk tea cup with straw and boba pearls',
  'mt-tea': 'glass of iced lemon tea with lemon slices and straw',
  'mt-burger': 'cheeseburger with a few french fries',
  'mt-fried-chicken': 'golden fried chicken drumsticks',
  'mt-pizza': 'whole pizza with pepperoni and mushroom slices, one slice lifted',
  'mt-hotpot': 'bubbling red hot pot with vegetables and mushrooms',
  'mt-noodles': 'bowl of noodles with chopsticks lifting noodles',
  'mt-rice': 'bowl of steamed rice topped with a fried egg',
  'mt-dessert': 'strawberry cream cake slice with a cherry on top',
  'mt-ice-cream': 'soft serve ice cream cone with sprinkles',
  'mt-coffee': 'latte coffee cup with heart foam art',
  'mt-juice': 'glass of fresh orange juice with orange slice and straw',
  'mt-fruit': 'colorful fruit platter with watermelon strawberry grapes',
  'mt-breakfast': 'breakfast set with soy milk cup and fried dough sticks',
  'mt-dumplings': 'steamed dumplings in a bamboo steamer',
  'mt-sushi': 'sushi rolls and salmon nigiri on a plate',
  'mt-barbecue': 'grilled meat skewers on a barbecue grill',
  'mt-chinese-food': 'chinese stir-fried dish in a bowl with chopsticks',
  'mt-seafood': 'grilled shrimp and crab seafood platter',
  'mt-beef': 'braised beef stew bowl with potato',
  'mt-salad': 'fresh vegetable salad bowl with tomato and corn',
  'mt-soup': 'hot soup bowl with steam and mushrooms',
  'mt-cola': 'glass of cola soda with ice cubes and straw',
  'mt-egg': 'sunny side up fried egg',
  'mt-milk': 'glass bottle of milk with a straw',
  'mt-medicine': 'medicine bottles pills and a first aid kit',
  'mt-flower': 'flower bouquet with ribbon bow',
  'mt-store': 'shopping basket filled with daily goods and snacks',
  // ---------------- 门头图 ----------------
  'shop-food': 'cute chinese restaurant storefront with red awning and lanterns',
  'shop-milktea': 'cute bubble tea shop storefront with striped awning and milk tea cup sign',
  'shop-coffee': 'cute coffee shop storefront with brown awning and coffee cup sign',
  'shop-pharmacy': 'cute pharmacy storefront with green cross sign',
  'shop-breakfast': 'cute breakfast shop storefront with orange awning',
  'shop-fun': 'cute cinema storefront with popcorn bucket and film reel sign',
  // ---------------- 淘宝 商品 ----------------
  'tb-phone': 'modern smartphone with cute app icons on screen',
  'tb-earbuds': 'wireless earbuds with open charging case',
  'tb-laptop': 'open silver laptop computer',
  'tb-tablet': 'tablet with a stylus pen',
  'tb-watch': 'smart watch with a cute watch face',
  'tb-keyboard': 'mechanical keyboard with colorful keycaps',
  'tb-speaker': 'portable bluetooth speaker',
  'tb-powerbank': 'power bank with a charging cable',
  'tb-tshirt': 'white t-shirt with a cute strawberry print',
  'tb-jeans': 'folded blue denim jeans pants',
  'tb-dress': 'floral summer dress on hanger',
  'tb-jacket': 'stylish beige trench coat jacket',
  'tb-hoodie': 'cozy oversized hoodie sweatshirt',
  'tb-sneakers': 'white sneakers shoes',
  'tb-backpack': 'cute pink backpack school bag',
  'tb-lipstick': 'open red lipstick',
  'tb-perfume': 'glass perfume bottle with pink liquid',
  'tb-skincare': 'skincare cream jar with lid open',
  'tb-makeup': 'eyeshadow makeup palette with brush',
  'tb-sofa': 'cozy cream fabric sofa with cushions',
  'tb-bedding': 'folded bedding sheets set with pillow',
  'tb-lamp': 'floor lamp with warm light',
  'tb-mug': 'ceramic mug with steam and a spoon',
  'tb-vase': 'vase with pretty flowers',
  'tb-pillow': 'soft square cushion pillow',
  'tb-desk': 'wooden desk with a small chair',
  'tb-toy': 'cute bunny plush toy',
  'tb-umbrella': 'open cute umbrella with polka dots',
  'tb-water-bottle': 'thermos water bottle',
  'tb-snacks': 'snack gift box with chips and cookies',
  'tb-cookies': 'chocolate chip cookies in a jar',
  'tb-tea': 'tea tin box with loose tea leaves and a cup',
  'tb-books': 'stack of colorful books',
};

function log(msg: string): void {
  fs.appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${msg}\n`);
}

function done(name: string): boolean {
  const p = path.join(OUT, `${name}.webp`);
  return fs.existsSync(p) && fs.statSync(p).size > 8000;
}

async function genOne(zai: Awaited<ReturnType<typeof ZAI.create>>, name: string, idx: number): Promise<boolean> {
  const bg = BG[idx % BG.length];
  const prompt = `${SUBJECTS[name]}, ${STYLE.replace('{bg}', bg)}`;
  const buf = Buffer.from((await zai.images.generations.create({ prompt, size: '1024x1024' })).data[0].base64, 'base64');
  fs.writeFileSync(path.join(RAW, `${name}.png`), buf);
  await sharp(buf).resize(560, 560, { fit: 'cover' }).webp({ quality: 82 }).toFile(path.join(OUT, `${name}.webp`));
  log(`OK ${name} (${Math.round(buf.length / 1024)}KB raw)`);
  return true;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  const names = Object.keys(SUBJECTS);
  const started = Date.now();
  const zai = await ZAI.create();
  let round = 0;
  for (;;) {
    round++;
    const pending = names.filter((n) => !done(n));
    if (pending.length === 0) {
      log(`ALL DONE (${names.length} images)`);
      return;
    }
    if (Date.now() - started > TOTAL_BUDGET_MS) {
      log(`BUDGET EXHAUSTED, missing: ${pending.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    log(`round ${round}: ${pending.length} pending`);
    let hadFail = false;
    for (const name of pending) {
      const idx = names.indexOf(name);
      try {
        await genOne(zai, name, idx);
      } catch (e) {
        hadFail = true;
        log(`FAIL ${name}: ${(e as Error)?.message ?? String(e)}`);
        await new Promise((r) => setTimeout(r, 15_000)); // 单张失败歇 15s 再试下一张
      }
    }
    if (hadFail) {
      log('round had failures, cool down 30s');
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

main().catch((e) => {
  log(`FATAL ${e?.message ?? e}`);
  process.exit(1);
});
