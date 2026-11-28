'use client';

/**
 * 文件 App（v2.4.29 毛玻璃胶囊重做）：
 * - 定位收敛为纯「存储管理器」——删除原 LIBRARY 六大资料库（照片/录音/音乐/
 *   备忘录/事件/提醒）的浏览、导入、播放、新建全部代码，只保留存储管理主界面；
 * - 主界面由 ./files/data-manager 承载：极简毛玻璃 + 胶囊设计（应用占用胶囊
 *   列表 / 长按多选 / App 专属详情页 / 一键云备份 / 健康检查 / 云端与恢复）；
 * - App 图标与名字仍叫「文件」，标题改为「存储管理」。
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
