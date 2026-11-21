'use client';

import { useCallback } from 'react';
import CoupleHome from './couple-home/CoupleHome';
import { useUI } from '@/lib/ios/store';

/** 拾光小屋（原「情侣小家」独立 App 化）：
 *  完整复用 couple-home 3D 小家场景（生活/装修双模式、Prisma+IndexedDB 双层持久化），
 *  与情侣空间「发现 → 情侣小家」入口共享同一份数据（workspaceId 相同），两端互通；
 *  顶部返回按钮从「回情侣空间」语义改为「关闭 App 回主屏」 */
export default function CottageApp() {
  const close = useCallback(() => useUI.getState().closeApp(), []);
  return <CoupleHome close={close} />;
}
