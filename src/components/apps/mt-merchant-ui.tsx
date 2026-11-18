'use client';

/**
 * 商家中心共享 UI 件（无 emoji 原则 + 毛玻璃风格）：
 * - mtDishIcon：菜名关键词 → Lucide 线条图标（奶茶→杯、咖啡→咖啡、炸鸡→鸡腿…）；
 * - DishImg / ShopImg：有图显示图，无图显示「暖沙色渐变 + 线条图标」占位；
 * - 毛玻璃风格常量：GLASS_PANEL（卡片）/ GLASS_CAPSULE（胶囊）/ 页面暖色渐变底；
 * - useLongPress：长按手势 hook（480ms 触发，移动超 10px / 抬手取消，兼容触屏与鼠标）；
 * - HoldActionsSheet：长按呼出的「编辑 / 删除」毛玻璃操作弹层。
 */
import { createElement, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Apple,
  Banana,
  Beer,
  Beef,
  CakeSlice,
  Candy,
  Citrus,
  Coffee,
  Cookie,
  CookingPot,
  CupSoda,
  Donut,
  Drumstick,
  Egg,
  EggFried,
  Fish,
  Grape,
  IceCreamCone,
  Milk,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  Store,
  Utensils,
  UtensilsCrossed,
  Wheat,
} from 'lucide-react';

/** 美团黄 */
export const MT_YELLOW = '#FFD100';

/** 毛玻璃卡片（放在暖色渐变底上） */
export const GLASS_PANEL = 'bg-white/68 backdrop-blur-2xl ring-1 ring-white/75 shadow-[0_10px_32px_rgba(96,74,10,0.08)]';
/** 毛玻璃胶囊 */
export const GLASS_CAPSULE = 'bg-white/60 backdrop-blur-xl ring-1 ring-white/70';
/** 页面暖色渐变底（毛玻璃需要底色才能看出 blur 效果） */
export const MERCHANT_PAGE_BG = 'bg-[linear-gradient(180deg,#FFF6DE_0%,#FAF6EC_34%,#F2F2F0_100%)]';

/** 关键词 → 图标（按名称匹配，越靠前优先） */
const DISH_ICON_RULES: [RegExp, LucideIcon][] = [
  [/奶茶|柠檬茶|水果茶|茶$|茶饮|汽水|苏打|可乐|雪碧|果汁|饮料|椰汁|酸梅/, CupSoda],
  [/咖啡|拿铁|摩卡|美式|生椰/, Coffee],
  [/牛奶|豆奶|酸奶|乳酪|奶盖|奶昔|纯牛奶/, Milk],
  [/冰淇淋|雪糕|圣代|冰沙|刨冰/, IceCreamCone],
  [/蛋糕|慕斯|提拉米苏|千层/, CakeSlice],
  [/甜甜圈|多拿滋/, Donut],
  [/面包|可颂|欧包|吐司|三明治|贝果|烘焙/, Sandwich],
  [/饼干|曲奇|泡芙|麻薯/, Cookie],
  [/糖果|棉花糖|软糖/, Candy],
  [/披萨|比萨/, Pizza],
  [/炸鸡|鸡排|鸡腿|鸡翅|鸡米花|烤鸡/, Drumstick],
  [/鱼|虾|蟹|鳗|海鲜|三文鱼|金枪鱼/, Fish],
  [/牛肉|肥牛|牛排|羊肉|猪肉|卤肉|红烧肉|排骨/, Beef],
  [/煎蛋|荷包蛋|太阳蛋/, EggFried],
  [/蛋挞|鸡蛋|蒸蛋|茶叶蛋|温泉蛋/, Egg],
  [/沙拉|蔬菜|青菜|西兰花|生菜|凉拌/, Salad],
  [/麻辣烫|火锅|冒菜|炖|煲/, CookingPot],
  [/粥|汤|银耳羹|炖品/, Soup],
  [/面|粉|米线|意面|拉面/, Wheat],
  [/米饭|炒饭|盖浇|煲仔饭|套餐|便当/, Utensils],
  [/苹果/, Apple],
  [/香蕉/, Banana],
  [/葡萄|提子/, Grape],
  [/橙|橘|柠檬|柚|柑/, Citrus],
  [/鸡尾酒|啤酒|酒/, Beer],
];

/** 菜名 → 线条图标（未命中回退通用餐具） */
export function mtDishIcon(name: string): LucideIcon {
  const n = name.trim();
  for (const [re, icon] of DISH_ICON_RULES) {
    if (re.test(n)) return icon;
  }
  return UtensilsCrossed;
}

/** 菜品缩略图：有图显示图，无图显示「渐变 + 线条图标」占位（商家中心内替代 emoji 兜底） */
export function DishImg({ name, img, className = '' }: { name: string; img?: string; className?: string }) {
  if (img) {
    return <img src={img} alt={name} draggable={false} className={`shrink-0 bg-[#F5F6F7] object-cover ${className}`} />;
  }
  // 菜名关键词 → 静态图标映射（createElement 规避“渲染期创建组件”误报）
  const Icon = mtDishIcon(name);
  return createElement(
    'span',
    { className: `flex shrink-0 items-center justify-center bg-gradient-to-br from-[#FFF4D9] via-[#FFEBC2] to-[#FFDF9E] ${className}`, 'aria-hidden': 'true' },
    createElement(Icon, { className: 'h-[34%] w-[34%] text-[#C9932B]', strokeWidth: 1.6 })
  );
}

/** 店铺封面图：有图显示图，无图显示「渐变 + 店铺图标」占位 */
export function ShopImg({ name, cover, className = '' }: { name: string; cover?: string; className?: string }) {
  if (cover) {
    return <img src={cover} alt={name} draggable={false} className={`shrink-0 bg-[#F5F6F7] object-cover ${className}`} />;
  }
  return (
    <span className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-[#FFF1C3] via-[#FFE59A] to-[#FFD100]/80 ${className}`} aria-hidden="true">
      <Store className="h-[36%] w-[36%] text-[#9A6B12]" strokeWidth={1.6} />
    </span>
  );
}

// ================================ 长按手势 ================================

/** 长按 hook：按住 480ms 触发；移动超 10px / 抬手 / 离开取消；屏蔽触屏长按弹出的系统菜单 */
export function useLongPress(onLongPress: () => void, disabled = false): {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerLeave: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  pressing: boolean;
} {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
    setPressing(false);
  };

  useEffect(() => clear, []);

  return {
    pressing,
    onPointerDown: (e) => {
      if (disabled) return;
      start.current = { x: e.clientX, y: e.clientY };
      setPressing(true);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        start.current = null;
        setPressing(false);
        onLongPress();
      }, 480);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerMove: (e) => {
      if (!start.current) return;
      // 移动超过 10px 视为滚动，取消长按
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) clear();
    },
    onContextMenu: (e) => {
      // 触屏长按可能触发系统右键菜单，统一屏蔽
      e.preventDefault();
    },
  };
}

// ================================ 长按操作弹层（毛玻璃） ================================

export interface HoldAction {
  label: string;
  icon: LucideIcon;
  testid?: string;
  danger?: boolean;
  onClick: () => void;
}

/** 长按呼出的毛玻璃操作弹层（底部推出，选项纵向排列） */
export function HoldActionsSheet({ title, actions, onClose }: { title: string; actions: HoldAction[]; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div key="mt-hold-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[68]">
        <button type="button" aria-label="取消" className="absolute inset-0 bg-black/45" onClick={onClose} />
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
          className="absolute inset-x-3 bottom-3 overflow-hidden rounded-3xl bg-white/78 shadow-[0_18px_50px_rgba(40,30,0,0.22)] backdrop-blur-2xl ring-1 ring-white/70"
          data-testid="mt-hold-sheet"
        >
          <p className="pt-4 text-center text-[11px] text-black/35">{title}</p>
          <div className="flex flex-col gap-2 p-3">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                data-testid={a.testid}
                onClick={() => {
                  onClose();
                  a.onClick();
                }}
                className={`flex h-12 items-center gap-2.5 rounded-2xl px-4 text-[15px] font-semibold backdrop-blur-xl ring-1 active:opacity-75 ${
                  a.danger ? 'bg-[#FFF3F0]/90 text-[#FF4B33] ring-[#FF4B33]/20' : 'bg-white/85 text-black/80 ring-black/[0.04]'
                }`}
              >
                <a.icon className={`h-4.5 w-4.5 ${a.danger ? 'text-[#FF4B33]' : 'text-black/55'}`} strokeWidth={1.9} />
                {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={onClose}
              className="mt-0.5 flex h-12 items-center justify-center rounded-2xl bg-black/[0.04] text-[15px] font-medium text-black/55 active:bg-black/[0.08]"
            >
              取消
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
