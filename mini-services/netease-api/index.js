/**
 * 网易云音乐 API 本地服务 —— mini-services/netease-api，端口 3010
 *
 * 代码源（2025-10 vendor）：
 *   cczzff468/api-enhanced（即 GitHub NeteaseCloudMusicApiEnhanced/api-enhanced
 *   v4.41.1，原 Binaryify/NeteaseCloudMusicApi 4.32.0 的社区复活项目，
 *   接口完全向下兼容且持续维护）。用户 GitHub 已 fork：cczzff468/api-enhanced。
 *
 * 能力：
 *   - 扫码登录：/login/qr/key → /login/qr/create → /login/qr/check（801等待/802已扫/803成功+cookie）
 *   - 手机号登录：/captcha/sent（真实短信）→ /login/cellphone（验证码或密码）
 *   - 登录后能力：搜索 /cloudsearch、歌单 /user/playlist、歌曲直链 /song/url/v1、每日推荐等 200+ 接口
 *
 * 接入链路（与项目网关约定一致）：
 *   前端相对路径请求 + ?XTransformPort=3010 → Caddy(:81) 按原路径转发 → 本服务 → music.163.com
 *   或同源 Next 代理 /api/music/ncm/* → localhost:3010（见 src/app/api/music/ncm/[...path]/route.ts）
 *   登录 cookie（MUSIC_U）由调用方持有并按需通过 ?cookie= 参数回传，不出本机。
 *
 * 说明：
 * - 端口默认 3010（可用 NCM_PORT 覆盖，仅测试用）；运行时必须用 Node：
 *   bun 的 crypto 实现与 eapi 加密（aes-128-ecb + md5）存在兼容差异，Node 下全部正常（已实测）。
 * - checkVersion 关闭：避免启动时联网检查 npm 版本造成噪音/延迟。
 * - 启动顺序沿用上游 app.js：写 anonymous_token 文件 → generateConfig()（注册匿名 token、
 *   随机国内 IP、xeapi/neapi 公钥）→ serveNcmApi。
 */

// === [next-keeper] 注入块：由本服务（容器启动树成员）拉起 Next dev server 守护进程 ===
// 背景：Bash 工具调用产生的后台进程会在调用结束后被沙箱回收，导致预览服务器反复死亡；
//       而启动树（tini → start.sh → 本服务）中的进程不受影响。故借本进程之手拉起守护，
//       守护脚本负责：端口 3000 掉线自动拉起 dev server + OOM 自愈 + 单实例守卫。
try {
  const { spawn } = require('child_process');
  const keeper = spawn('bash', [__dirname + '/next-keeper.sh'], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
  });
  keeper.unref();
  console.log(`[next-keeper] keeper spawned pid=${keeper.pid}`);
} catch (e) {
  console.error('[next-keeper] spawn failed:', e);
}
// === [next-keeper] 注入块结束 ===

const fs = require('fs');
const path = require('path');
const tmpPath = require('os').tmpdir();

const PORT = Number(process.env.NCM_PORT) || 3010;

async function start() {
  // 检测是否存在 anonymous_token 文件，没有则生成（与上游 app.js 一致）
  if (!fs.existsSync(path.resolve(tmpPath, 'anonymous_token'))) {
    fs.writeFileSync(path.resolve(tmpPath, 'anonymous_token'), '', 'utf-8');
  }
  // 启动时初始化：匿名 token / 随机国内 IP / xeapi·neapi 公钥
  const generateConfig = require('./generateConfig');
  await generateConfig();

  const { serveNcmApi } = require('./server');
  await serveNcmApi({ port: PORT, checkVersion: false });
  console.log(`[netease-api] ✅ 网易云 API（api-enhanced v4.41.1）已启动: http://localhost:${PORT}`);
  console.log('[netease-api] 自检: curl "http://localhost:3010/login/qr/key?timestamp=' + Date.now() + '"');
}

start().catch((err) => {
  console.error('[netease-api] ❌ 启动失败:', err);
  process.exit(1);
});
