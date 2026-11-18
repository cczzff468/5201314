const Base64 = require('js-base64');

module.exports = {
  '/': async ({req, res, request}) => {
    const {songmid, raw} = req.query;

    if (!songmid) {
      return res.send({
        result: 500,
        errMsg: 'songmid 不能为空',
      })
    }

    const result = await request({
      url: 'http://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
      data: {
        songmid,
        pcachetime: new Date().getTime(),
        g_tk: 5381,
        loginUin: 0,
        hostUin: 0,
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq',
        needNewCode: 0,
      },
      headers: {
        Referer: 'https://y.qq.com',
      }
    });

    // 安全解码：上游偶发非规范 base64（含 BOM/换行/空值），Node 原生 atob 会直接抛
    // InvalidCharacterError 并炸掉整个服务 —— 这里统一 try/catch 兜底为空串。
    const safeDecode = (s) => {
      if (!s) return '';
      try {
        return Base64.Base64.decode(s);
      } catch (e) {
        try {
          return Buffer.from(String(s), 'base64').toString('utf8');
        } catch (e2) {
          return '';
        }
      }
    };
    result.lyric = safeDecode(result.lyric);
    result.trans = safeDecode(result.trans);
    if (Number(raw)) {
      res.send(result);
    } else {
      res.send({
        result: 100,
        data: result,
      })
    }
  },
}
