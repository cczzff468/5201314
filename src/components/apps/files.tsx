'use client';

/**
 * 文件 App（v2.4.35）：
 * - 定位收敛为纯「储存空间管理器」——只保留存储管理主界面（./files/data-manager）；
 * - v2.4.35 机主截图改版（iOS 储存空间风）：标题改「Cove 储存空间」；hero = Cove +
 *   已使用 X/Y + iOS 分段进度条（红/橙/深灰/浅灰）+ 图例；应用占用改单张大玻璃卡
 *   列表行（图标+名称+大小+百分比，全部 App 平铺）；快捷操作顺序 =
 *   备份 / 导入备份 / 清除数据（清除数据放最后）；
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
