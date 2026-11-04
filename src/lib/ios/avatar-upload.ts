'use client';

/**
 * 头像文件 → dataURL 共享管线（微信个人资料 / QQ 个人资料 / 设置个人信息共用）：
 * 居中裁剪缩放为 256×256 JPEG（quality 0.85）——产出恒过 normalizeAvatar 的
 * 「data:image/jpeg;base64 + ≤400KB」校验，控制联系人库体积。
 * 三个换头像入口的存储各自隔离（contacts.avatars 槽位 / settings.profile），
 * 本工具只负责「文件 → 合规 dataURL」这一步。
 */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 不可用');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error('图片处理失败'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}
