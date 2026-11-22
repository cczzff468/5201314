/**
 * QQ 音乐现代接口（v2）—— 绕开已失效的老 fcg 端点，直连 u.y.qq.com musicu.fcg
 *
 * 挂载路径（app.js 按 routes/<file>.js → /<file> 前缀挂载，本文件 → /v2/*）：
 *   GET /v2/lyric?songmid=<mid>                 歌词（crypt=0 明文 base64 LRC + 翻译）
 *   GET /v2/songlist/detail?id=<tid>&page=&num= 歌单详情 + 歌曲（游客可用）
 *   GET /v2/user/created-playlists?uin=&euin=   用户创建的歌单（需 cookie）
 *   GET /v2/user/fav-songs?euin=&page=&num=     我喜欢的歌曲（dirid=201，需 cookie）
 *   GET /v2/user/fav-playlists?euin=&page=&num= 收藏的歌单（需 cookie）
 *   GET /v2/user/profile?uin=                   用户主页（需 cookie）
 *
 * 鉴权：与全站一致 —— 前端把登录得到的 cookie 串放在 ?cookie= 查询参数里
 * （util/request.js 补丁会把它作为上游 Cookie 头转发；本文件 musicu 调用也带它）。
 *
 * 统一响应形状（对齐前端 multi-source 客户端预期）：
 *   { code: 200, data: {...} } 成功
 *   { code: 301, errMsg: '未登陆' } cookie 缺失/失效
 *   { code: 500, errMsg: '...' } 上游异常
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const http = axios.create({ timeout: 15000, validateStatus: () => true });

const notLogin = (res) => res.json({ code: 301, errMsg: '未登陆' });

/** 解析 ?cookie= 查询参数（或 Cookie 头）为上游可用的 Cookie 串 */
const cookieOf = (req) => {
  const raw = req.query.cookie || req.headers.cookie || '';
  return String(raw).trim();
};

/** musicu.fcg 统一调用：返回 req_N.data，code!==0 抛错 */
async function musicu(comm, modules, cookie) {
  const body = { comm: { ct: 24, cv: 0, ...comm } };
  Object.entries(modules).forEach(([k, v]) => {
    body[k] = v;
  });
  const r = await http.post('https://u.y.qq.com/cgi-bin/musicu.fcg', body, {
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/',
      Origin: 'https://y.qq.com',
      'User-Agent': UA,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const resp = r.data;
  const first = Object.values(modules)[0];
  const key = Object.keys(modules)[0];
  const item = resp && resp[key];
  if (!item || item.code !== 0 || !item.data) {
    // 1000/30001/500003 系 = 登录态问题
    const c = item && item.code;
    const e = new Error((item && item.data && item.data.msg) || `musicu code ${c}`);
    e.code = c === 1000 || c === 30001 ? 301 : 500;
    throw e;
  }
  void first;
  return item.data;
}

const b64 = (s) => {
  try {
    return Buffer.from(String(s || ''), 'base64').toString('utf8');
  } catch (e) {
    return '';
  }
};

/** 歌单歌曲（CgiGetDiss songlist 项）→ 统一精简形状 */
const mapDissSong = (s) => ({
  id: s.id,
  mid: s.mid,
  name: s.name || s.title || '',
  singers: (s.singer || []).map((x) => ({ id: x.id, mid: x.mid, name: x.name })),
  albumMid: (s.album || {}).mid,
  albumName: (s.album || {}).name,
  albumPmid: (s.album || {}).pmid,
  mediaMid: (s.file || {}).media_mid,
  intervalSec: s.interval || 0,
  vip: !!(s.pay && (s.pay.pay_play === 1 || s.pay.pay_month === 1)),
});

module.exports = {
  // ========== 歌词 ==========
  '/lyric': async ({req, res}) => {
    const {songmid} = req.query;
    if (!songmid) return res.json({code: 500, errMsg: 'songmid 不能为空'});
    try {
      const d = await musicu(
        {},
        {
          req_1: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param: {
              crypt: 0, lrc_t: 0, qrc: 0, qrc_t: 0,
              roma: 0, roma_t: 0, trans: 1, trans_t: 0,
              type: 0, songMid: String(songmid),
            },
          },
        },
        cookieOf(req),
      );
      const lrc = b64(d.lyric);
      const trans = b64(d.trans);
      return res.json({code: 200, data: {lrc, trans, hasTranslation: !!trans.trim()}});
    } catch (e) {
      if (e.code === 301) return notLogin(res);
      return res.json({code: 500, errMsg: e.message});
    }
  },

  // ========== 歌单详情（游客可用） ==========
  '/songlist/detail': async ({req, res}) => {
    const id = String(req.query.id || '');
    if (!id) return res.json({code: 500, errMsg: 'id 不能为空'});
    const num = Math.min(Number(req.query.num) || 100, 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    try {
      const d = await musicu(
        {},
        {
          req_1: {
            module: 'music.srfDissInfo.DissInfo',
            method: 'CgiGetDiss',
            param: {
              disstid: Number(id),
              dirid: Number(req.query.dirid) || 0,
              tag: true,
              song_begin: num * (page - 1),
              song_num: num,
              userinfo: true,
              orderlist: true,
              onlysonglist: false,
            },
          },
        },
        cookieOf(req),
      );
      const di = d.dirinfo || {};
      return res.json({
        code: 200,
        data: {
          id: di.id,
          name: di.title || '',
          cover: di.picurl || di.picurl2 || '',
          total: di.songnum || 0,
          creator: (di.creator || {}).nick || '',
          songs: (d.songlist || []).map(mapDissSong),
        },
      });
    } catch (e) {
      if (e.code === 301) return notLogin(res);
      return res.json({code: 500, errMsg: e.message});
    }
  },

  // ========== 用户创建的歌单（需登录） ==========
  '/user/created-playlists': async ({req, res}) => {
    const cookie = cookieOf(req);
    if (!cookie) return notLogin(res);
    const uin = String(req.query.uin || (req.cookies && req.cookies.uin) || '');
    if (!uin) return res.json({code: 500, errMsg: 'uin 不能为空'});
    try {
      const d = await musicu(
        {},
        {
          req_1: {
            module: 'music.musicasset.PlaylistBaseRead',
            method: 'GetPlaylistByUin',
            param: {uin: uin},
          },
        },
        cookie,
      );
      const v = d.v_playlist || [];
      return res.json({
        code: 200,
        data: {
          total: d.total || v.length,
          // 注意：GetPlaylistByUin 上游返回驼峰字段（dirId/dirName/picUrl/songNum/bigpicUrl），
          // 不是网上流传的小写 title/picurl/songnum——此前按小写映射导致歌单 0 首、无封面、名字空
          playlists: v.map((p, idx) => ({
            tid: p.tid,
            dirid: p.dirId,
            name: p.dirName || (idx === 0 ? '我喜欢的音乐' : ''),
            cover: p.picUrl || p.bigpicUrl || p.albumPicUrl || p.headurl || '',
            total: p.songNum || 0,
            // dirId=201 是 QQ「我喜欢」系统歌单的标志（dirName 实际叫「我喜欢」）
            isFav: p.dirId === 201 || (idx === 0 && (p.dirName || '') === '我喜欢'),
          })),
        },
      });
    } catch (e) {
      if (e.code === 301) return notLogin(res);
      return res.json({code: 500, errMsg: e.message});
    }
  },

  // ========== 我喜欢的歌曲（dirid=201，需登录） ==========
  '/user/fav-songs': async ({req, res}) => {
    const cookie = cookieOf(req);
    if (!cookie) return notLogin(res);
    const euin = String(req.query.euin || '');
    const num = Math.min(Number(req.query.num) || 100, 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    try {
      const d = await musicu(
        {},
        {
          req_1: {
            module: 'music.srfDissInfo.DissInfo',
            method: 'CgiGetDiss',
            param: {
              disstid: 0,
              dirid: 201,
              tag: true,
              song_begin: num * (page - 1),
              song_num: num,
              userinfo: true,
              orderlist: true,
              enc_host_uin: euin,
            },
          },
        },
        cookie,
      );
      return res.json({
        code: 200,
        data: {
          total: d.total || (d.songlist || []).length,
          hasMore: !!d.hasmore,
          songs: (d.songlist || []).map(mapDissSong),
        },
      });
    } catch (e) {
      if (e.code === 301) return notLogin(res);
      return res.json({code: 500, errMsg: e.message});
    }
  },

  // ========== 收藏的歌单（需登录） ==========
  '/user/fav-playlists': async ({req, res}) => {
    const cookie = cookieOf(req);
    if (!cookie) return notLogin(res);
    const euin = String(req.query.euin || '');
    const num = Math.min(Number(req.query.num) || 30, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    try {
      const d = await musicu(
        {},
        {
          req_1: {
            module: 'music.musicasset.PlaylistFavRead',
            method: 'CgiGetPlaylistFavInfo',
            param: {uin: euin, offset: num * (page - 1), size: num},
          },
        },
        cookie,
      );
      return res.json({
        code: 200,
        data: {
          total: d.total || 0,
          playlists: (d.v_playlist || []).map((p) => ({
            tid: p.tid,
            name: p.title || '',
            cover: p.picurl || '',
            total: p.songnum || 0,
          })),
        },
      });
    } catch (e) {
      if (e.code === 301) return notLogin(res);
      return res.json({code: 500, errMsg: e.message});
    }
  },

  // ========== 用户主页（需登录） ==========
  '/user/profile': async ({req, res}) => {
    const cookie = cookieOf(req);
    if (!cookie) return notLogin(res);
    const uin = String(req.query.uin || (req.cookies && req.cookies.uin) || '');
    if (!uin) return res.json({code: 500, errMsg: 'uin 不能为空'});
    try {
      const d = await musicu(
        {},
        {
          req_1: {
            module: 'music.UnifiedHomepage.UnifiedHomepageSrv',
            method: 'GetHomepageHeader',
            param: {UserID: uin},
          },
        },
        cookie,
      );
      // 上游真实形状：data.Info.BaseInfo（Name/Avatar/BigAvatar/EncryptedUin）+ Info.FansNum/FollowNum；
      // 兼容旧 header 形状（NickName/HeadUrl）
      const info = d.Info || d.info || {};
      const base = info.BaseInfo || {};
      const h = d.header || {};
      const num = (v) => (v && typeof v.Num === 'number' ? v.Num : (typeof v === 'number' ? v : 0));
      return res.json({
        code: 200,
        data: {
          uin,
          nickname: base.Name || h.NickName || '',
          avatar: base.BigAvatar || base.Avatar || h.HeadUrl || '',
          // EncryptedUin = 我喜欢的歌曲（dirid=201）接口必需的 enc_host_uin，
          // 缺了会拿到空/错误账号的数据（「登录后数据不是本人」的关键修复）
          euin: base.EncryptedUin || h.EncryptUin || '',
          fans: num(info.FansNum) || h.FansNum || 0,
          follows: num(info.FollowNum) || h.FollowNum || 0,
        },
      });
    } catch (e) {
      if (e.code === 301) return notLogin(res);
      return res.json({code: 500, errMsg: e.message});
    }
  },
};
