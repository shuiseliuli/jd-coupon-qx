#!/usr/bin/env node
/**
 * h5st 签名服务 (独立版)
 * 基于 chenpython/jd_h5st_server 的算法
 * 支持 h5st v4.2.0 ~ v4.9.1
 * 
 * 部署: node h5st_service.js
 * 端口: 3001 (可通过 PORT 环境变量修改)
 */

const http = require('http');
const crypto = require('crypto');

// ============ 加密工具 ============
class CryptoJS {
  static MD5(msg) {
    return crypto.createHash('md5').update(msg).digest('hex');
  }
  static HmacMD5(msg, key) {
    return crypto.createHmac('md5', key).update(msg).digest('hex');
  }
  static SHA256(msg) {
    return crypto.createHash('sha256').update(msg).digest('hex');
  }
  static HmacSHA256(msg, key) {
    return crypto.createHmac('sha256', key).update(msg).digest('hex');
  }
  static AES_Encrypt(plaintext, key, iv) {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }
}

// ============ 工具函数 ============
function getRandomIDPro(size, dictType) {
  // Support both object and positional args
  if (typeof size === 'object') {
    dictType = size.dictType;
    size = size.size;
  }
  size = size || 16;
  const chars = dictType === 'max'
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    : 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < size; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function toHexString(uint8arr) {
  return Array.from(uint8arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toUint8ArrayFromNumber(num) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE((num & 0xFFFFFFFF) >>> 0);
  return new Uint8Array(buf);
}

function stringToHex(str) {
  return Buffer.from(str, 'utf8').toString('hex');
}

function adler32(data) {
  let a = 1, b = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// ============ 版本配置 ============
const ALGO_CONFIGS = {
  '4.2.0': {
    version: '4.2', fv: 'h5_file_v4.2.0',
    envSecret: 'DNiHi703B0&17hh1', randomLength: 10,
    visitKey: { seed: '6d0jhqw3pa', selectLength: 4, randomLength: 11, convertLength: 14 },
    defaultKey: { extend: '9>5*t5' },
    makeSign: { extendDateStr: '74' },
    genLocalTK: {
      magic: 'tk', version: '02', platform: 'w', expires: '41', producer: 'l',
      secret1: 'qem7+)g%Dhw5', prefix: 'z7'
    }
  },
  '4.3.1': {
    version: '4.3', fv: 'h5_file_v4.3.1',
    envSecret: '&d74&yWoV.EYbWbZ', randomLength: 10,
    visitKey: { seed: 'kl9i1uct6d', selectLength: 3, randomLength: 12, convertLength: 10 },
    defaultKey: { extend: 'Z=<J_2' },
    makeSign: { extendDateStr: '22' },
    genLocalTK: {
      magic: 'tk', version: '02', platform: 'w', expires: '41', producer: 'l',
      secret1: '+WzD<U36rlTf', prefix: '0J'
    }
  },
  '4.4.0': {
    version: '4.4', fv: 'v_lite_f_4.4.0',
    envSecret: 'r1T.6Vinpb.k+/a)', randomLength: 12,
    visitKey: { seed: '1uct6d0jhq', selectLength: 4, randomLength: 11, convertLength: 8 },
    defaultKey: { extend: 'qV!+A!' },
    makeSign: { extendDateStr: '88' },
    genLocalTK: {
      magic: 'tk', version: '02', platform: 'w', expires: '41', producer: 'l',
      secret1: 'HiO81-Ei89DH', prefix: '(>'
    }
  },
  '4.7.1': {
    version: '4.7', fv: 'h5_file_v4.7.1',
    envSecret: '_M6Y?dvfN40VMF[X', randomLength: 12,
    visitKey: { seed: '1uct6d0jhq', selectLength: 5, randomLength: 10, convertLength: 15 },
    defaultKey: { extend: 'hh1BNE' },
    makeSign: { extendDateStr: '97' },
    genLocalTK: {
      magic: 'tk', version: '03', platform: 'w', expires: '41', producer: 'l',
      secret1: '8[8I[]d?960w', prefix: 'cw'
    },
    customAlgorithm: { salt: '23k@X!', map: 'WVUTSRQPONMLKJIHGFEDCBA-_9876543210zyxwvutsrqponmlkjihgfedcbaZYX', keyReverse: true, convertIndex: { hmac: 16 } }
  },
  '4.7.4': {
    version: '4.7', fv: 'h5_file_v4.7.4', genSignDefault: true,
    envSecret: '_M6Y?dvfN40VMF[X', randomLength: 11,
    visitKey: { seed: '1uct6d0jhq', selectLength: 5, randomLength: 10, convertLength: 15 },
    defaultKey: { extend: 'Mp(2C1' },
    makeSign: { extendDateStr: '47' },
    genLocalTK: {
      magic: 'tk', version: '03', platform: 'w', expires: '41', producer: 'l',
      secret1: '4*iK&33Z|+6)', prefix: 'FX'
    },
    customAlgorithm: { salt: '7n5<G*', map: 'WVUTSRQPONMLKJIHGFEDCBA-_9876543210zyxwvutsrqponmlkjihgfedcbaZYX', keyReverse: true, convertIndex: { hmac: 5 } }
  },
  '4.8.1': {
    version: '4.8', fv: 'h5_file_v4.8.1', genSignDefault: true,
    randomLength: 11,
    visitKey: { seed: '2mn87xbyof', selectLength: 6, randomLength: 9, convertLength: 14 },
    defaultKey: { extend: 'JdM3|5' },
    makeSign: { extendDateStr: '36' },
    genLocalTK: {
      magic: 'tk', version: '04', platform: 'w', expires: '41', producer: 'l',
      secret1: 'DbIAgz71j04v', prefix: 'mT'
    },
    customAlgorithm: { salt: '7hh1BN', map: 'WVUTSRQPONMLKJIHGFEDCBA-_9876543210zyxwvutsrqponmlkjihgfedcbaZYX', convertIndex: { hex: 6, hmac: 5 } }
  },
  '4.9.1': {
    version: '4.9', fv: 'h5_file_v4.9.1', genSignDefault: true,
    randomLength: 12,
    visitKey: { seed: 'z4rekl9i1u', selectLength: 4, randomLength: 11, convertLength: 8 },
    defaultKey: { extend: 'SDV&6(' },
    makeSign: { extendDateStr: '07' },
    genLocalTK: {
      magic: 'tk', version: '04', platform: 'w', expires: '41', producer: 'l',
      secret1: 'qodOHbSV1ik2', prefix: 'ba'
    },
    customAlgorithm: { salt: 'x38rG0', map: 'rqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA-_9876543210zyxwvuts', convertIndex: { hex: 6, hmac: 9 } }
  }
};

// ============ 核心签名类 ============
class H5stSigner {
  constructor(config, pin, ua) {
    this.config = config;
    this.pin = pin;
    this.ua = ua;
    this.fingerprint = this._genFingerprint();
    this.token = this._genLocalToken();
  }

  _genFingerprint() {
    return getRandomIDPro({ size: 16, dictType: 'max' });
  }

  _genLocalToken() {
    const cfg = this.config.genLocalTK;
    const now = Date.now();
    const fp = this.fingerprint;
    
    // gen expr
    const numbers = ['1', '2', '3'];
    const operators = ['+', 'x'];
    const length = 2 + Math.floor(4 * Math.random());
    let expression = '';
    for (let i = 0; i < length; i++) {
      expression += numbers[Math.floor(Math.random() * 3)];
      if (i < length - 1) expression += operators[Math.floor(Math.random() * 2)];
    }
    if (expression.length < 9) expression += getRandomIDPro(9 - expression.length);
    const expr = Buffer.from(expression).toString('base64').replace(/=+$/, '');

    // gen cipher
    const prefix = cfg.prefix;
    const secret1 = cfg.secret1;
    const fpBytes = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) fpBytes[i] = fp.charCodeAt(i);
    const timeBytes = Buffer.alloc(4);
    timeBytes.writeUInt32BE((now & 0xFFFFFFFF) >>> 0);
    const prefixBytes = Buffer.from(prefix);
    const secret1Bytes = Buffer.alloc(12);
    for (let i = 0; i < Math.min(12, secret1.length); i++) secret1Bytes[i] = secret1.charCodeAt(i);
    const combined = Buffer.concat([prefixBytes, secret1Bytes, timeBytes, fpBytes]);
    const checksum = adler32(combined);
    const checksumStr = checksum.toString(16).padStart(8, '0');
    const cipherPlain = stringToHex(checksumStr) + stringToHex(prefix) + stringToHex(secret1) + toHexString(timeBytes) + stringToHex(fp);
    const cipher = CryptoJS.AES_Encrypt(
      Buffer.from(cipherPlain, 'hex').toString('utf8'),
      Buffer.from('0102030405060708'),
      Buffer.from('0102030405060708')
    );

    // adler32 of token data
    const adler = adler32(Buffer.from(`${cfg.magic}${cfg.version}${cfg.platform}${cfg.expires}${cfg.producer}${expr}${cipher}`));
    const adlerStr = adler.toString(16).padStart(8, '0');

    return `${cfg.magic}${cfg.version}${cfg.platform}${adlerStr}${cfg.expires}${cfg.producer}${expr}${cipher}`;
  }

  sign(functionId, appid, body) {
    const now = Date.now();
    const ts = new Date(now - new Date().getTimezoneOffset() * 60000).toISOString().replace(/[-:T.Z]/g, '').slice(0, 17);
    const ts2 = now.toString();
    const fp = this.fingerprint;
    const tk = this.token;
    const appId = 'a5290';

    // body hash
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const bodyHash = CryptoJS.SHA256(bodyStr);

    // sign key
    const key = `${this.config.makeSign.extendDateStr}${this.config.defaultKey.extend}`;

    // stk
    const stk = 'appid,body,functionId';

    // sign
    let signStr;
    if (this.config.genSignDefault) {
      const params = `appid:${appid},body:${bodyStr},functionId:${functionId}`;
      signStr = CryptoJS.MD5(`${key}${params}${key}`);
    } else {
      const params = `appid:${appid},body:${bodyStr},functionId:${functionId}`;
      signStr = CryptoJS.HmacMD5(params, key);
    }

    // env encrypted
    const envData = JSON.stringify({
      fp: fp,
      bu1: (this.config.env && this.config.env.bu1) || '0.1.9',
      fv: this.config.fv,
    });
    const envSecret = this.config.envSecret || '0102030405060708';
    const envKey = Buffer.alloc(16, 0);
    Buffer.from(envSecret, 'utf8').copy(envKey);
    const envIv = Buffer.from('0102030405060708');
    const envEncrypted = CryptoJS.AES_Encrypt(envData, envKey, envIv);

    const h5st = `${ts};${fp};${appId};${tk};${signStr};${this.config.version};${ts2};${envEncrypted}`;

    return {
      h5st,
      _stk: stk,
      _ste: 1,
      appid,
      body: bodyHash,
      functionId,
    };
  }
}

// ============ HTTP 服务 ============
const PORT = process.env.PORT || 3001;

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health
  if (url.pathname === '/health' && req.method === 'GET') {
    return sendJSON(res, 200, { code: 200, body: 'OK', message: '成功' });
  }

  // Versions
  if (url.pathname === '/versions' && req.method === 'GET') {
    return sendJSON(res, 200, { code: 200, body: Object.keys(ALGO_CONFIGS), message: '成功' });
  }

  // h5st sign
  if (url.pathname === '/h5st' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) return sendJSON(res, 400, { code: -1, message: '参数异常', body: ['请求体解析失败'] });

    const { version, pin, ua, appId, body: reqBody } = body;
    const config = ALGO_CONFIGS[version];
    if (!config) {
      return sendJSON(res, 400, {
        code: -1,
        message: '参数异常',
        body: [`不支持的版本: ${version}，支持: ${Object.keys(ALGO_CONFIGS).join(', ')}`]
      });
    }

    try {
      const signer = new H5stSigner(config, pin || '', ua || '');
      const result = signer.sign(
        reqBody.functionId,
        reqBody.appid,
        reqBody.body
      );
      return sendJSON(res, 200, { code: 200, body: { h5st: result }, message: '成功' });
    } catch (err) {
      return sendJSON(res, 500, { code: -1, message: '签名失败', body: [err.message] });
    }
  }

  // GET /h5st (query params)
  if (url.pathname === '/h5st' && req.method === 'GET') {
    const version = url.searchParams.get('version');
    const pin = url.searchParams.get('pin');
    const ua = url.searchParams.get('ua');
    const functionId = url.searchParams.get('functionId');
    const appid = url.searchParams.get('appid');
    const bodyStr = url.searchParams.get('body');

    const config = ALGO_CONFIGS[version];
    if (!config) return sendJSON(res, 400, { code: -1, message: '参数异常' });

    try {
      const signer = new H5stSigner(config, pin || '', ua || '');
      const result = signer.sign(functionId, appid, bodyStr);
      return sendJSON(res, 200, { code: 200, body: { h5st: result }, message: '成功' });
    } catch (err) {
      return sendJSON(res, 500, { code: -1, message: '签名失败', body: [err.message] });
    }
  }

  sendJSON(res, 404, { code: -1, message: 'Not Found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[h5st-service] 签名服务启动 http://0.0.0.0:${PORT}`);
  console.log(`[h5st-service] 支持版本: ${Object.keys(ALGO_CONFIGS).join(', ')}`);
  console.log(`[h5st-service] 接口: POST /h5st, GET /h5st, GET /health, GET /versions`);
});
