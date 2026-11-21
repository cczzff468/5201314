import { promises as fs } from 'fs';
import path from 'path';
import { APP_VERSION, APP_VERSION_CODE, APP_RELEASE_NOTES } from '@/lib/app-version';

/**
 * GET /api/app-version —— APP 版本清单（客户端「进 APP 自动检查更新」的数据源）。
 *
 * 返回：
 *  - version / code / notes：最新版本号与说明（含完整版本历史）；
 *  - apkReady / apkSize / apkMtime：public/AI-Phone.apk 是否在位与文件指纹；
 *  - fingerprint：网页版本 + APK 文件指纹合成串——客户端与 localStorage 里
 *    「上次见过的指纹」比对，不同即视为有新版（弹窗提示）。
 *
 * APK 不在位（如沙箱重建后尚未重新打包）时 apkReady=false：
 * 自动弹窗不弹（没东西可下），设置页显示「APK 打包中」状态，指纹只跟网页版本走。
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  let apkReady = false;
  let apkSize: number | null = null;
  let apkMtime: number | null = null;
  try {
    const apkPath = path.join(process.cwd(), 'public', 'AI-Phone.apk');
    const st = await fs.stat(apkPath);
    if (st.isFile() && st.size > 1024) {
      apkReady = true;
      apkSize = st.size;
      apkMtime = Math.floor(st.mtimeMs);
    }
  } catch {
    /* APK 不在位：按未就绪处理 */
  }

  const fingerprint = `v${APP_VERSION}|${apkReady ? `${apkMtime}:${apkSize}` : 'noapk'}`;

  return Response.json(
    {
      version: APP_VERSION,
      code: APP_VERSION_CODE,
      notes: APP_RELEASE_NOTES,
      apkReady,
      apkSize,
      apkMtime,
      fingerprint,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
