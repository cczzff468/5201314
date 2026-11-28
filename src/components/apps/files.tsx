'use client';

/**
 * 文件 App（v2.4.32）：
 * - 定位收敛为纯「存储管理器」——只保留存储管理主界面（./files/data-manager）；
 * - 主界面结构：hero 总览 → 应用占用双列胶囊（长按多选）→ 快捷操作
 *   （备份/清除数据/导入备份）→ 云端与恢复（一键云端备份 + 拉取备份 + 记录/导入/
 *   自动备份/持久化）；App 专属详情页与健康检查已删除；
 * - App 图标与名字仍叫「文件」，标题为「存储管理」。
 */

import { IOSNavBar } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

const DataManager = dynamic(() => import('./files/data-manager'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[320px] items-center justify-center gap-2 text-[14px] text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 正在打开存储管理…
    </div>
  ),
});

export default function FilesApp() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <IOSNavBar inline title="存储管理" left={<BackToHome className="static!" />} />
        <DataManager />
      </div>
    </div>
  );
}
