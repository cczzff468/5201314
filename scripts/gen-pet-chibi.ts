/**
 * 生成 22 张 Q版3D 品种宠物立绘（11 品种 × boy/girl），绿幕纯色背景供抠图。
 * 运行：bun scripts/gen-pet-chibi.ts
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

interface B {
  id: string;
  name: string;
  features: string;
}

const BREEDS: B[] = [
  {
    id: 'shiba',
    name: '柴犬',
    features: '橙棕色短毛，白色脸颊胸口和肚皮，尾巴卷成一个毛圈贴在背上，竖起的三角耳朵，嘴巴微笑',
  },
  {
    id: 'pomeranian',
    name: '博美犬',
    features: '奶黄色超蓬松长绒毛，圆滚滚像一团棉花糖，小小的尖嘴，立耳，羽毛状蓬松尾巴翘起',
  },
  {
    id: 'golden',
    name: '金毛寻回犬',
    features: '金黄色柔顺长毛，柔软下垂的耳朵，金色蓬松羽毛状大尾巴，温暖的圆眼睛',
  },
  {
    id: 'husky',
    name: '哈士奇',
    features: '灰白双色毛，额头和脸颊有灰色面罩花纹，冰蓝色眼睛，竖起的三角耳，尾巴毛发浓密',
  },
  {
    id: 'corgi',
    name: '柯基犬',
    features: '橙白双色短毛，超大的竖立三角耳朵，极短的小短腿，长长的身子，白色眉心条纹和白围脖',
  },
  {
    id: 'orange',
    name: '橘猫',
    features: '橘色虎斑条纹短毛猫，白色下巴和肚皮，粉色小鼻子，圆圆的脸',
  },
  {
    id: 'ragdoll',
    name: '布偶猫',
    features:
      '身体是奶油白色的蓬松长毛，只有耳朵、脸中央的面罩、四只爪子和尾巴是深巧克力棕色，这是布偶猫标志性的重点色花色（身体浅色、耳朵脸爪尾深色），湛蓝色的大眼睛，蓬松的大尾巴',
  },
  {
    id: 'calico',
    name: '三花猫',
    features: '白色底毛，头顶和背部分布着橘色和黑色不规则斑块，三花猫，粉鼻子',
  },
  {
    id: 'lihua',
    name: '狸花猫',
    features: '棕灰色虎斑条纹短毛猫，额头有M字形条纹，黄绿色的眼睛，条纹清晰',
  },
  {
    id: 'goldenShaded',
    name: '金渐层猫',
    features: '金色渐层短毛猫，毛尖带黑色渐层显得金灿灿，圆圆的胖脸，绿色大眼睛',
  },
  {
    id: 'tuxedo',
    name: '奶牛猫',
    features: '白色底毛带大块黑色斑块，黑色的耳朵和黑色尾巴，黑白花奶牛猫，粉色鼻子',
  },
];

const ACC: Record<'boy' | 'girl', string> = {
  boy: '脖子上戴着一条天蓝色项圈，项圈上挂一个金色小铃铛',
  girl: '头顶右侧戴着一个大大的粉色蝴蝶结',
};

const STYLE =
  'Q版3D卡通渲染，超可爱的{name}手办玩偶，全身完整入镜呈坐姿，大头圆脸小短腿圆滚滚的身体，超大水润闪亮的圆眼睛带星星高光，{features}，{acc}，毛绒绒细腻质感，皮克斯风格柔和3D渲染，柔和摄影棚灯光，纯净的绿色纯色背景（#00FF00绿幕，无阴影无渐变无道具），宠物完整居中构图，高清细节，可爱治愈';

const OUT = path.join(process.cwd(), 'raw', 'pet-chibi');

async function main() {
  const zai = await ZAI.create();
  fs.mkdirSync(OUT, { recursive: true });
  let fail = 0;
  for (const b of BREEDS) {
    for (const g of ['boy', 'girl'] as const) {
      const f = path.join(OUT, `${b.id}-${g}.png`);
      if (fs.existsSync(f) && fs.statSync(f).size > 20000) {
        console.log('skip', f);
        continue;
      }
      const prompt = STYLE.replace('{name}', b.name)
        .replace('{features}', b.features)
        .replace('{acc}', ACC[g]);
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          const r = await zai.images.generations.create({ prompt, size: '1024x1024' });
          const b64 = r?.data?.[0]?.base64;
          if (!b64) throw new Error('empty response');
          const buf = Buffer.from(b64, 'base64');
          if (buf.length < 5000) throw new Error(`too small ${buf.length}`);
          fs.writeFileSync(f, buf);
          console.log('OK', f, buf.length);
          ok = true;
        } catch (e) {
          console.error('FAIL', b.id, g, 'attempt', attempt, (e as Error).message);
          if (attempt === 3) fail++;
          else await new Promise((s) => setTimeout(s, 1500 * attempt));
        }
      }
    }
  }
  console.log(fail === 0 ? 'ALL DONE' : `DONE WITH ${fail} FAILURES`);
}

main();
