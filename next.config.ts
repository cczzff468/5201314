import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // 预览面板通过 *.space.zhipuaidemo.cn 域名访问 dev server（每次会话 chat_id 不同，
  // 用通配符覆盖所有预览域名）；Next 16 dev server 默认只允许 localhost，不配会被拒致预览空白
  allowedDevOrigins: ["*.space.zhipuaidemo.cn", "*.zhipuaidemo.cn", "localhost", "127.0.0.1"],
  // 触发 dev server 进程内重启以加载 src/instrumentation.ts（拉起 ncm-keeper 守护网易云 API）
  outputFileTracingIncludes: {},
  // 4GB 沙箱内存紧张：Next 16.4 已移除 experimental.turbopackMemoryLimit
  //（16.1 可用），靠默认缓存驱逐策略即可
  // 关闭开发模式悬浮指示器（左下角黑色 N 圆钮）：会遮挡应用底部 TabBar 视觉验收
  devIndicators: false,
  // v79 预览提速：dev 下静态资源与 /_next/image 默认 max-age=0，预览走外网网关时
  // 每次刷新 100+ 图标都要逐个重验证（每张一个 RTT），观感就是「图标慢慢冒出来」。
  // 这些资源内容不变（图标/贴纸/表情按文件名寻址），给 1 天强缓存 + 7 天 SWR，
  // 浏览器二次加载直接走本地缓存，不再发请求。
  async headers() {
    const cache = [
      { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
    ];
    const staticPaths = [
      "/icons/:path*",
      "/icons-dark/:path*",
      "/wallpapers/:path*",
      "/home/:path*",
      "/images/:path*",
      "/stickers/:path*",
      "/qq-emojis/:path*",
      "/avatar-library/:path*",
      "/tarot/:path*",
      "/board-bg/:path*",
      "/board-cards/:path*",
      "/pets/:path*",
      "/mt/:path*",
      "/couriers/:path*",
      "/fonts/:path*",
    ];
    return [
      // next/image 优化器输出按「源图+参数」内容寻址，可安全长缓存
      { source: "/_next/image", headers: cache },
      ...staticPaths.map((source) => ({ source, headers: cache })),
    ];
  },
};

export default nextConfig;
