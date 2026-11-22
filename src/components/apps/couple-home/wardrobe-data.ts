/**
 * 拾光小屋 —— 女主衣柜数据表（v6.2）
 *
 * CharChibi3D（3D 渲染取色）与 Wardrobe.tsx（弹窗图标取色）共用，
 * 数组顺序即衣柜弹窗展示顺序，索引持久化在 HomeState.wear。
 */

/** 连衣裙：c 主体色 / trim 装饰白边&腰线&胸饰 / bow 发饰蝴蝶结 */
export const DRESSES: { name: string; c: string; trim: string; bow: string }[] = [
  { name: '樱粉连衣裙', c: '#f7c6d2', trim: '#ffffff', bow: '#f591ac' },
  { name: '薄荷奶昔裙', c: '#c2e4d2', trim: '#ffffff', bow: '#8fd0b4' },
  { name: '奶油杏子裙', c: '#f6dfb2', trim: '#fff8ee', bow: '#f0b45c' },
  { name: '香芋奶紫裙', c: '#dcc8ec', trim: '#ffffff', bow: '#bb9fd9' },
];

/** 分体上衣：c 主体色 / bow 发饰蝴蝶结配色 */
export const TOPS: { name: string; c: string; bow: string }[] = [
  { name: '奶白卫衣', c: '#f7f1e3', bow: '#f591ac' },
  { name: '樱粉针织衫', c: '#f4c3cf', bow: '#e87f9c' },
  { name: '薄荷T恤', c: '#c9e8da', bow: '#8fd0b4' },
  { name: '鹅黄毛衣', c: '#f5d98f', bow: '#e8b45c' },
];

/** 分体下装：skirt 裙子（保留过膝袜）/ short 短裤（大腿裤色+小腿袜）/ long 长裤（全腿裤色） */
export const BOTTOMS: { name: string; c: string; kind: 'skirt' | 'short' | 'long' }[] = [
  { name: '白色百褶裙', c: '#ffffff', kind: 'skirt' },
  { name: '樱粉短裙', c: '#f4b3c2', kind: 'skirt' },
  { name: '藏蓝短裤', c: '#46536b', kind: 'short' },
  { name: '牛仔长裤', c: '#7d94ad', kind: 'long' },
];

/** 鞋子：c 鞋面色 / trim 配件色（帆布鞋包边 / 玛丽珍袢带 / 短靴翻边） */
export const SHOES: { name: string; c: string; trim: string }[] = [
  { name: '棕色小皮鞋', c: '#b06a5a', trim: '#8a4f42' },
  { name: '白色帆布鞋', c: '#fbfaf7', trim: '#e8e2d8' },
  { name: '粉色玛丽珍', c: '#e88ca4', trim: '#c96a84' },
  { name: '米色小短靴', c: '#c9a886', trim: '#ab8a68' },
];

/** 发型名（与 GirlHairStyle 一一对应） */
export const HAIR_NAMES: Record<string, string> = {
  twin: '双马尾',
  high: '高马尾',
  bob: '短发',
  straight: '长直发',
  wave: '大波浪',
};

// ---------------- 男生衣柜（v6.3） ----------------

/** 男生发型名（与 BoyHairStyle 一一对应） */
export const BOY_HAIR_NAMES: Record<string, string> = {
  smooth: '顺滑短发',
  fluffy: '蓬松卷发',
  middle: '中分刘海',
  spiky: '活力刺猬',
};

/** 男生上衣：c 主体色 / hood 是否带兜帽（首款 = 当前默认造型） */
export const BOY_TOPS: { name: string; c: string; hood: boolean }[] = [
  { name: '奶白连帽卫衣', c: '#f7f1e3', hood: true },
  { name: '燕麦针织衫', c: '#cdb69c', hood: false },
  { name: '雾灰休闲T', c: '#aeb4b8', hood: false },
  { name: '抹茶绿polo', c: '#9db8a2', hood: false },
];

/** 男生裤子：kind short 短裤（大腿裤色+露小腿）/ long 长裤（全腿裤色） */
export const BOY_BOTTOMS: { name: string; c: string; kind: 'short' | 'long' }[] = [
  { name: '藏蓝短裤', c: '#46536b', kind: 'short' },
  { name: '卡其长裤', c: '#a8927a', kind: 'long' },
  { name: '炭灰短裤', c: '#5a5a5e', kind: 'short' },
  { name: '牛仔长裤', c: '#7d94ad', kind: 'long' },
];

/** 男生鞋子：c 鞋面色 / trim 鞋底/鞋带配件色 */
export const BOY_SHOES: { name: string; c: string; trim: string }[] = [
  { name: '白色圆头鞋', c: '#fbfaf7', trim: '#e6e2d8' },
  { name: '棕色小皮鞋', c: '#b06a5a', trim: '#8a4f42' },
  { name: '灰白运动鞋', c: '#e8e8ea', trim: '#c0c4c8' },
  { name: '米色小短靴', c: '#c9a886', trim: '#ab8a68' },
];

/** 发色调色盘（衣柜 UI 用 · v6.4 全色系扩充：自然发色 + 幻彩发色） */
export const HAIR_COLORS: string[] = [
  '#241d1a', '#3a2a22', '#5b3a28', '#6b4a38',
  '#8a5a3c', '#a97a5c', '#c98d6b', '#b8865f',
  '#d9b38c', '#e6c9a3', '#c9a8e8', '#7a6a8a',
  '#4a3d52', '#6a7a95', '#c96a84', '#b8b8bc',
];

/** 服装调色盘（衣柜 UI 用 · v6.4 全色系扩充：粉/黄/绿/蓝/紫/中性 六色系） */
export const CLOTH_COLORS: string[] = [
  '#f9c8d4', '#f29bb4', '#e56d92', '#c94f75',
  '#f6dfb2', '#f2cf7e', '#e8b45c', '#e8925c',
  '#c2e4d2', '#9fd8bd', '#7fc8ae', '#5da58a',
  '#cfe6f2', '#9cc7ee', '#6a9ec9', '#46536b',
  '#dcc8ec', '#c9a8e8', '#a87fc9', '#7a5a99',
  '#f7f1e3', '#aeb4b8', '#5a5a5e', '#4a3f3d',
];
