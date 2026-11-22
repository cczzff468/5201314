// 网易云歌曲解灰 —— 真 UNM 版（UnblockNeteaseMusic/server 官方包直连）
//
// 演进：旧版走 @neteasecloudmusicapienhanced/unblockmusic-utils 的 matchID，其
// modules/ 里是 byfuns/ddyr/gdmusic 等第三方中转代理（大多已失效），且包装层在读
// `result.data.url` 时未判空（data 为 null 直接抛 "Cannot read properties of null"，
// 500 不可用）。本版直接调已安装的 @unblockneteasemusic/server（即 UnblockNeteaseMusic
// /server 官方包，main = src/provider/match.js，签名 match(id, sources[])）：
//
//   GET /song/url/match?id=<网易云歌曲id>&source=kuwo,bodian,pyncmd
//   → { code: 200, data: { url, source, br, size, md5 } }
//   失败 → { code: 404, msg: '解灰失败：所有音源均无可用链接', data: null }（绝不 500）
//
// source 说明：逗号分隔的候选音源列表，按序尝试，默认 kuwo,bodian,pyncmd,kugou,migu,qq
// （沙箱实测 2026-11：kuwo/bodian/pyncmd 可解出完整直链含 VIP 歌；kugou/qq/migu 大概率
// 无权限——保留在候选尾部，官方音源策略随时间变化）。

module.exports = async (query) => {
  const id = String(query.id || '');
  if (!id) {
    return { status: 200, body: { code: 400, msg: '缺少 id 参数', data: null } };
  }
  const sources = String(query.source || 'kuwo,bodian,pyncmd,kugou,migu,qq')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const match = require('@unblockneteasemusic/server');
    const r = await match(id, sources);
    if (r && r.url) {
      return {
        status: 200,
        body: {
          code: 200,
          data: { url: r.url, source: r.source || '', br: r.br ?? null, size: r.size ?? null, md5: r.md5 ?? null },
        },
      };
    }
    return { status: 200, body: { code: 404, msg: '解灰失败：未取得可用链接', data: null } };
  } catch (e) {
    return {
      status: 200,
      body: {
        code: 404,
        msg: `解灰失败：所有音源均无可用链接${e && e.message ? `（${e.message}）` : ''}`,
        data: null,
      },
    };
  }
};
