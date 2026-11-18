/**
 * QQ / 微信扫码登录（二维码）— 移植自 python qqmusic_api modules/login.py
 *
 * 挂载路径（由 app.js 自动按文件名挂载为 /login 前缀）：
 *   GET /login/qq/qr/create  获取 QQ 授权二维码 → { code:200, data:{ id, qrimg } }
 *   GET /login/qq/qr/check   轮询 QQ 扫码状态  → { code:200, data:{ status[, uin, musickey, cookie, extra] } }
 *   GET /login/wx/qr/create  获取微信扫码二维码 → { code:200, data:{ id, qrimg } }
 *   GET /login/wx/qr/check   轮询微信扫码状态（长轮询 ~35s）→ 同上
 *
 * status: waiting(待扫码) / scanned(已扫待确认) / expired(过期) / ok(确认成功) / error(失败, 附 msg)
 */
const axios = require('axios');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

// 与上游 jsososo 路由一致的 axios 封装：不抛 4xx/5xx，手动判断
const http = axios.create({
  timeout: 15000,
  validateStatus: () => true,
});

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const hash33 = (s, h = 0) => {
  for (const ch of s) {
    h = (h * 33 + ch.charCodeAt(0)) & 2147483647;
  }
  return h;
};

// 模块级存储：QQ 二维码 id → { qrsig, ts }，15 分钟自动清理
const qrStore = new Map();
const QR_TTL = 15 * 60 * 1000;

const setCookiesOf = (res) => {
  let list = res.headers['set-cookie'] || [];
  if (!Array.isArray(list)) list = [list];
  return list.map((c) => String(c).split(';')[0].trim()).filter(Boolean);
};

// QQConnectLogin / music.login 统一换取 musicid + musickey
const exchangeCode = async (loginType, param) => {
  const r = await http.post(
    'https://u.y.qq.com/cgi-bin/musicu.fcg',
    {
      comm: { tmeLoginType: loginType },
      req_1: param,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://y.qq.com/',
        Origin: 'https://y.qq.com',
        'User-Agent': UA,
      },
    }
  );
  const resp = r.data;
  if (!resp || !resp.req_1 || resp.req_1.code !== 0 || !resp.req_1.data) {
    const msg = (resp && resp.req_1 && resp.req_1.data && resp.req_1.data.errmsg) || 'login exchange failed';
    const err = new Error(msg);
    err.resp = resp && resp.req_1;
    throw err;
  }
  return resp.req_1.data;
};

const buildCookie = (d) => {
  const uin = String(d.musicid || d.str_musicid || '');
  const key = d.musickey || '';
  return `uin=${uin}; qm_keyst=${key}; qqmusic_key=${key}; musicid=${uin}`;
};

const login = {
  // ========== QQ 扫码登录 ==========
  '/qq/qr/create': async ({req, res}) => {
    try {
      const r = await http.get('https://ssl.ptlogin2.qq.com/ptqrshow', {
        params: {
          appid: '716027609',
          e: '2',
          l: 'M',
          s: '3',
          d: '72',
          v: '4',
          t: String(Math.random()),
          daid: '383',
          pt_3rd_aid: '100497308',
        },
        headers: { Referer: 'https://xui.ptlogin2.qq.com/', 'User-Agent': UA },
        responseType: 'arraybuffer',
        maxRedirects: 0,
      });
      const qrsigPair = setCookiesOf(r).find((c) => c.startsWith('qrsig='));
      if (!qrsigPair) {
        return res.json({ code: 200, data: { status: 'error', msg: 'qrsig not found in set-cookie' } });
      }
      const qrsig = qrsigPair.slice('qrsig='.length);

      // 清理过期二维码
      const now = Date.now();
      for (const [k, v] of qrStore) {
        if (now - v.ts > QR_TTL) qrStore.delete(k);
      }

      const id = md5(qrsig + Date.now());
      qrStore.set(id, { qrsig, ts: now });

      const qrimg = 'data:image/png;base64,' + Buffer.from(r.data).toString('base64');
      return res.json({ code: 200, data: { id, qrimg } });
    } catch (err) {
      return res.json({ code: 200, data: { status: 'error', msg: err.message } });
    }
  },

  '/qq/qr/check': async ({req, res}) => {
    try {
      const { id } = req.query;
      const entry = qrStore.get(id);
      if (!entry) {
        return res.json({ code: 200, data: { status: 'expired' } });
      }
      const { qrsig } = entry;

      const r = await http.get('https://ssl.ptlogin2.qq.com/ptqrlogin', {
        params: {
          u1: 'https://graph.qq.com/oauth2.0/login_jump',
          ptqrtoken: String(hash33(qrsig)),
          ptredirect: '0',
          h: '1',
          t: '1',
          g: '1',
          from_ui: '1',
          ptlang: '2052',
          action: `0-0-${Date.now()}`,
          js_ver: '20102616',
          js_type: '1',
          pt_uistyle: '40',
          aid: '716027609',
          daid: '383',
          pt_3rd_aid: '100497308',
          has_onekey: '1',
        },
        headers: { Cookie: `qrsig=${qrsig}`, Referer: 'https://xui.ptlogin2.qq.com/', 'User-Agent': UA },
        maxRedirects: 0,
      });
      const text = String(r.data || '');
      const m = /ptuiCB\((.*)\)/.exec(text);
      if (!m) {
        return res.json({ code: 200, data: { status: 'error', msg: 'parse ptuiCB failed', body: text.slice(0, 200) } });
      }
      const args = m[1].split("','").map((s) => s.replace(/^'|'$/g, ''));
      const code = args[0];

      // QQ 音乐 pt_3rd_aid 流程的状态码与经典 ptlogin 相反（luren-dc/QQMusicApi 实测口径）：
      // 0=确认成功 / 65=二维码已失效(过期) / 66=二维码未失效(等待扫码) / 67=已扫码待确认 / 68=拒绝
      if (code === '65') {
        qrStore.delete(id);
        return res.json({ code: 200, data: { status: 'expired' } });
      }
      if (code === '66') return res.json({ code: 200, data: { status: 'waiting' } });
      if (code === '67') return res.json({ code: 200, data: { status: 'scanned' } });
      if (code === '68') {
        qrStore.delete(id);
        return res.json({ code: 200, data: { status: 'expired' } });
      }
      if (code !== '0') {
        return res.json({ code: 200, data: { status: 'error', msg: `ptuiCB code ${code}` } });
      }

      // 已确认：args[2] 为 check_sig 跳转地址
      const checkSigUrl = args[2] || '';
      const sigxM = /ptsigx=([0-9a-zA-Z]+)/.exec(checkSigUrl);
      const uinM = /uin=(\d+)/.exec(checkSigUrl);
      if (!sigxM || !uinM) {
        return res.json({ code: 200, data: { status: 'error', msg: 'parse ptsigx/uin failed' } });
      }

      const cs = await http.get('https://ssl.ptlogin2.graph.qq.com/check_sig', {
        params: {
          uin: uinM[1],
          pttype: '1',
          service: 'ptqrlogin',
          nodirect: '0',
          ptsigx: sigxM[1],
          s_url: 'https://graph.qq.com/oauth2.0/login_jump',
          ptlang: '2052',
          ptredirect: '100',
          aid: '716027609',
          daid: '383',
          j_later: '0',
          low_login_hour: '0',
          regmaster: '0',
          pt_login_type: '3',
          pt_aid: '0',
          pt_aaid: '16',
          pt_light: '0',
          pt_3rd_aid: '100497308',
        },
        headers: { Referer: 'https://xui.ptlogin2.qq.com/', 'User-Agent': UA },
        maxRedirects: 0,
      });
      const pairs = setCookiesOf(cs);
      const p_skeyPair = pairs.find((c) => c.startsWith('p_skey='));
      const p_skey = p_skeyPair ? p_skeyPair.slice('p_skey='.length) : '';
      if (!p_skey) {
        return res.json({ code: 200, data: { status: 'error', msg: 'p_skey not found in set-cookie' } });
      }

      const body = new URLSearchParams({
        response_type: 'code',
        client_id: '100497308',
        redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',
        scope: 'get_user_info,get_app_friends',
        state: 'state',
        switch: '',
        from_ptlogin: '1',
        src: '1',
        update_auth: '1',
        openapi: '1010_1030',
        g_tk: String(hash33(p_skey, 5381)),
        auth_time: String(Math.floor(Date.now() / 1000) * 1000),
        ui: crypto.randomUUID(),
      }).toString();

      const az = await http.post('https://graph.qq.com/oauth2.0/authorize', body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: pairs.join('; '),
          Referer: 'https://graph.qq.com/',
          'User-Agent': UA,
        },
        maxRedirects: 0,
      });
      const location = az.headers.location || az.headers.Location || '';
      const codeM = /code=([^&]+)/.exec(location);
      if (!codeM) {
        return res.json({ code: 200, data: { status: 'error', msg: 'code not found in authorize Location' } });
      }

      const d = await exchangeCode(2, {
        module: 'QQConnectLogin.LoginServer',
        method: 'QQLogin',
        param: { code: codeM[1] },
      });

      qrStore.delete(id);
      const uin = String(d.musicid || d.str_musicid || '');
      return res.json({
        code: 200,
        data: {
          status: 'ok',
          uin,
          musickey: d.musickey || '',
          cookie: buildCookie(d),
          extra: d,
        },
      });
    } catch (err) {
      return res.json({
        code: 200,
        data: { status: 'error', msg: err.message, resp: err.resp || undefined },
      });
    }
  },

  // ========== 微信扫码登录 ==========
  '/wx/qr/create': async ({req, res}) => {
    try {
      const r = await http.get('https://open.weixin.qq.com/connect/qrconnect', {
        params: {
          appid: 'wx48db31d50e334801',
          redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/',
          response_type: 'code',
          scope: 'snsapi_login',
          state: 'STATE',
          href: 'https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect',
        },
        headers: { 'User-Agent': UA },
      });
      const html = String(r.data || '');
      let uuidM = /connect_qrcode\/([0-9a-zA-Z]+)/.exec(html);
      if (!uuidM) uuidM = /uuid"?[:=]"?([0-9a-zA-Z]{8,})/.exec(html);
      if (!uuidM) {
        return res.json({ code: 200, data: { status: 'error', msg: 'uuid not found in qrconnect html' } });
      }
      const uuid = uuidM[1];

      const qr = await http.get(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, {
        headers: { Referer: 'https://open.weixin.qq.com/connect/qrconnect', 'User-Agent': UA },
        responseType: 'arraybuffer',
      });
      const qrimg = 'data:image/jpeg;base64,' + Buffer.from(qr.data).toString('base64');
      return res.json({ code: 200, data: { id: uuid, qrimg } });
    } catch (err) {
      return res.json({ code: 200, data: { status: 'error', msg: err.message } });
    }
  },

  '/wx/qr/check': async ({req, res}) => {
    try {
      const { id } = req.query;
      if (!id) {
        return res.json({ code: 200, data: { status: 'expired' } });
      }

      let text = '';
      try {
        const r = await http.get('https://lp.open.weixin.qq.com/connect/l/qrconnect', {
          params: { uuid: id, _: String(Date.now()) },
          headers: { Referer: 'https://open.weixin.qq.com/', 'User-Agent': UA },
          timeout: 35000, // 微信长轮询 ~25-35s
          maxRedirects: 0,
        });
        text = String(r.data || '');
      } catch (err) {
        // 超时 / 网络异常按 waiting 处理
        text = 'wx_errcode=408;';
      }

      const eM = /wx_errcode=(\d+)/.exec(text);
      const errcode = eM ? eM[1] : '408';
      const cM = /wx_code='?([^';]*)'?/.exec(text);
      const wx_code = cM ? cM[1] : '';

      if (errcode === '408') return res.json({ code: 200, data: { status: 'waiting' } });
      if (errcode === '404') return res.json({ code: 200, data: { status: 'scanned' } });
      if (errcode === '403' || errcode === '402') return res.json({ code: 200, data: { status: 'expired' } });
      if (errcode !== '405') {
        return res.json({ code: 200, data: { status: 'error', msg: `wx_errcode ${errcode}` } });
      }
      if (!wx_code) {
        return res.json({ code: 200, data: { status: 'error', msg: 'wx_code missing' } });
      }

      // 已确认：wx_code 换取登录态
      const d = await exchangeCode(1, {
        module: 'music.login.LoginServer',
        method: 'Login',
        param: { code: wx_code, strAppid: 'wx48db31d50e334801' },
      });

      const uin = String(d.musicid || d.str_musicid || '');
      // 微信账号：jsososo 上游依赖 login_type=2 + wxuin 识别微信登录
      const cookie = `${buildCookie(d)}; wxuin=${uin}; login_type=2`;
      return res.json({
        code: 200,
        data: {
          status: 'ok',
          uin,
          musickey: d.musickey || '',
          cookie,
          extra: d,
        },
      });
    } catch (err) {
      return res.json({
        code: 200,
        data: { status: 'error', msg: err.message, resp: err.resp || undefined },
      });
    }
  },
};

module.exports = login;
