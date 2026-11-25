import PhoneShell from '@/components/ios/PhoneShell';
// 第三十一轮：Cove 韩系开屏动画（冷启动播 ~1.8s 后自动卸载；fixed 全屏盖住一切）
import BootSplash from '@/components/ios/BootSplash';

export default function Home() {
  return (
    <>
      <BootSplash />
      <PhoneShell />
    </>
  );
}
