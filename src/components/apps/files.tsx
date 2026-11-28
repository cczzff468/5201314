'use client';

/**
 * 文件 App（v2.4.36）：
 * - 定位收敛为纯「储存空间管理器」——只保留存储管理主界面（./files/data-manager）；
 * - v2.4.36 iPhone 储存空间截图复刻：页面纯色 #F2F2F4 / 卡片不透明白 + 26px 圆角；
 *   hero = Cove + 已使用 X/Y + 可用 Z + iOS 四段色进度条（红/橙/黄/浅灰）+ 图例；
 *   新增「推荐」区（自动清理媒体缓存 / 云端自动备份）与底部悬浮搜索胶囊，
 *   应用占用为单张白卡列表行（上次备份副行 + 大小 + 大小/名称排序）；
 * - 导入备份免刷新生效（rehydrateKvFromIdb + 设置重载 + 回主屏），不再自动下载安全备份；
 * - App 专属详情页与健康检查已删除。
 */

import { IOSNavBar } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

const DataManager = dynamic(() => import('./files/data-manager'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[320px] items-center justify-center gap-2 text-[14px] text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 正在打开储存空间…
    </div>
  ),
});

export default function FilesApp() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <IOSNavBar inline title="Cove 储存空间" left={<BackToHome className="static!" />} />
        <DataManager />
      </div>
    </div>
  );
}
