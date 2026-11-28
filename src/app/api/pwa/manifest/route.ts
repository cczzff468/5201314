import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * 动态 PWA manifest（第三十一轮三选一 → 第三十八轮四选一 → 第三十九轮两选一 →
 * 第四十轮四选一 → 第四十一轮：机主换 3 号图 + 新增 5 号五选一，默认 3 号情书字标）。
 *
 * 浏览器「添加到主屏幕/安装」时拉取本路由（layout.tsx manifest 指到这里）：
 * - name/short_name 恒为 Cove；
 * - icons 按 AppConfig['appIcon']（'1'|'2'|'3'|'4'|'5'，设置 › 外观/APP 图标 写入）
 *   动态返回所选图标；
 * - 无记录/异常/非法值兜底回新默认（icon-3 情书字标）。
 * 图标文件本身是静态的（public/icons/app/icon-{n}-*.png），只有选择状态存 SQLite。
 */
export async function GET() {
  let icon = '3';
  try {
    const rec = await db.appConfig.findUnique({ where: { key: 'appIcon' } });
    if (rec?.value === '1' || rec?.value === '2' || rec?.value === '3' || rec?.value === '4' || rec?.value === '5') {
      icon = rec.value;
    }
  } catch {
    // 数据库异常：回默认图标（安装能力不受影响）
  }

  const manifest = {
    id: '/',
    name: 'Cove',
    short_name: 'Cove',
    description:
      '高还原度 iOS 风格 AI 恋人手机：微信/QQ/信息三端聊天、朋友圈、情侣空间 3D 小屋、网易云音乐、美团、淘宝、塔罗等 20+ 应用；数据本地优先存于浏览器 IndexedDB，可安装到主屏幕全屏使用、断网也能打开。',
    lang: 'zh-CN',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['social', 'entertainment', 'lifestyle'],
    icons: [
      { src: `/icons/app/icon-${icon}-192.png?v=42`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/icons/app/icon-${icon}-512.png?v=42`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/icons/app/icon-${icon}-maskable-512.png?v=42`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: '和 TA 聊天',
        short_name: '信息',
        description: '直达信息 App 会话列表',
        url: '/?open=chat',
        icons: [{ src: `/icons/app/icon-${icon}-192.png?v=42`, sizes: '192x192', type: 'image/png' }],
      },
      {
        name: '微信',
        short_name: '微信',
        description: '直达微信',
        url: '/?open=wechat',
        icons: [{ src: `/icons/app/icon-${icon}-192.png?v=42`, sizes: '192x192', type: 'image/png' }],
      },
      {
        name: '网易云音乐',
        short_name: '音乐',
        description: '直达网易云音乐',
        url: '/?open=music',
        icons: [{ src: `/icons/app/icon-${icon}-192.png?v=42`, sizes: '192x192', type: 'image/png' }],
      },
      {
        name: '情侣空间',
        short_name: '情侣空间',
        description: '直达情侣空间 3D 小屋',
        url: '/?open=couple',
        icons: [{ src: `/icons/app/icon-${icon}-192.png?v=42`, sizes: '192x192', type: 'image/png' }],
      },
    ],
  };

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
