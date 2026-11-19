const axios = require('axios');
const StringHelper = require('./StringHelper');
const xml2js = require('xml2js').parseString;

function handleXml(data) {
  return new Promise((resolve, reject) => {
    const handleObj = (obj) => {
      Object.keys(obj).forEach((k) => {
        const v = obj[k];
        if ((typeof v).toLowerCase() === 'object' && v instanceof Array && v.length === 1) {
          obj[k] = v[0];
        }
        if ((typeof obj[k]).toLowerCase() === 'object') {
          handleObj(obj[k]);
        }
      })
    };

    xml2js(data, (err, result) => {
      handleObj(result);
      resolve(result);
    })
  })
}

module.exports = (req, res, {globalCookie} = {}) => {
  const userCookie = globalCookie ? globalCookie.userCookie() : {};
  return async (obj, opts = {}) => {
    try {
      if (typeof obj === 'string') {
        obj = {
          url: obj,
          data: {},
        }
      }
      obj.method = obj.method || 'get';

      const {url, data} = obj;

      if (obj.method === 'get') {
        obj.url = StringHelper.changeUrlQuery(data, url);
        delete obj.data;
      }

      obj.headers = obj.headers || {};
      obj.xsrfCookieName = 'XSRF-TOKEN';
      obj.withCredentials = true;
      // 无状态鉴权：req.query.cookie 为非空字符串时，原样作为上游 Cookie 头
      // （前端传 ?cookie=uin%3Dxx%3B%20qm_keyst%3Dxx&ownCookie=1 即可携带登录态）
      const queryCookie = typeof req.query.cookie === 'string' ? req.query.cookie.trim() : '';
      if (queryCookie) {
        obj.headers.Cookie = queryCookie;
      } else {
        const cookieObj = (Number(req.query.ownCookie) ? req.cookies : userCookie) || {};
        obj.headers.Cookie = Object.keys(cookieObj).map((k) => `${k}=${encodeURI(cookieObj[k])}`).join('; ');
      }

      const response = await axios(obj);

      if (opts.dataType === 'xml') {
        return handleXml(response.data.replace(/(<!--)|(-->)/g, ''));
      }

      if (opts.dataType === 'raw') {
        return response.data;
      }

      if (typeof response.data === 'string') {
        response.data = response.data.replace(/callback\(|MusicJsonCallback\(|jsonCallback\(|\)$/g, '');
        return JSON.parse(response.data);
      }

      return response.data;
    } catch (err) {
      res.send({
        result: 400,
        errMsg: `系统异常：${err.message}`,
      })
    }
  }
};