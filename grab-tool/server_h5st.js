const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const CryptoJS = require("crypto-js");

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "jd-grab-2024";
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ==================== 数据存储 ====================
function loadJSON(f, d) { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")); } catch(e) { return d; } }
function saveJSON(f, d) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); }

let accounts = loadJSON("accounts.json", []);
let coupons = loadJSON("coupons.json", []);
let logs = loadJSON("logs.json", []);
let grabState = { running: false, timer: null };
let h5stTokens = {}; // 缓存各账号的 token

function addLog(type, msg, detail) {
    var e = { time: new Date().toISOString(), type: type, msg: msg, detail: detail || "" };
    logs.unshift(e);
    if (logs.length > 500) logs = logs.slice(0, 500);
    saveJSON("logs.json", logs);
    console.log("[" + type + "] " + msg);
    return e;
}

// ==================== h5st 签名算法 ====================
// 基于 dengbaikun/jdh5st 的 4.4 算法

const H5ST_VERSION = "4.4";
const AES_IV = "0102030405060708";
const AES_KEY = "r1T.6Vinpb.k+/a)";

function getRandomIDPro(size, dictType) {
    size = size || 10;
    var t;
    switch (dictType || "number") {
        case "alphabet": t = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"; break;
        case "max": t = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"; break;
        default: t = "0123456789";
    }
    var u = "";
    for (var i = 0; i < size; i++) u += t[Math.random() * t.length | 0];
    return u;
}

function genFingerPrint() {
    var r = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var n = "";
    for (var i = 0; i < 4; i++) {
        var idx = Math.random() * r.length | 0;
        n += r[idx];
    }
    var o = 10 * Math.random() | 0;
    var i = r;
    for (var j = 0; j < n.length; j++) {
        i = i.replace(new RegExp(n[j], "g"), "");
    }
    var a = "";
    for (var s = 0; s < o; s++) a += i[Math.random() * i.length | 0];
    var b = n;
    for (var s = 0; s < 12 - o - 1; s++) b += i[Math.random() * i.length | 0];
    var result = (a + b + o).split("");
    var u = result.slice(0, 8);
    var h = result.slice(8);
    var p = [];
    for (var s = 0; s < u.length; s++) {
        p.push((35 - parseInt(u[s], 36)).toString(36));
    }
    return p.concat(h).join("");
}

function formatDateTime(ts, fmt) {
    var n = new Date(ts);
    var i = {
        "M+": n.getMonth() + 1, "d+": n.getDate(), "D+": n.getDate(),
        "h+": n.getHours(), "H+": n.getHours(), "m+": n.getMinutes(),
        "s+": n.getSeconds(), "S+": n.getMilliseconds()
    };
    var o = fmt || "yyyyMMddhhmmssSSS";
    if (/(y+)/i.test(o)) o = o.replace(RegExp.$1, ("" + n.getFullYear()).substr(4 - RegExp.$1.length));
    Object.keys(i).forEach(function(t) {
        if (new RegExp("(" + t + ")").test(o)) {
            var r = "S+" === t ? "000" : "00";
            o = o.replace(RegExp.$1, 1 === RegExp.$1.length ? i[t] : ("" + r + i[t]).substr(("" + i[t]).length));
        }
    });
    return o;
}

function genEnvEncrypted(fingerPrint, appId) {
    var randomId = getRandomIDPro(11, "max");
    var env = {
        "sua": "Windows NT 10.0; Win64; x64",
        "pp": { "p2": "jd_" + getRandomIDPro(14, "max") },
        "extend": { "wd": 0, "l": 0, "ls": 5, "wk": 0, "bu1": "0.1.9", "bu2": -1, "bu3": 91, "bu4": 0, "bu5": 0 },
        "random": randomId,
        "v": "h5_file_v4.4.0",
        "fp": fingerPrint,
        "bu1": "0.1.8"
    };
    var iv = CryptoJS.enc.Utf8.parse(AES_IV);
    var key = CryptoJS.enc.Utf8.parse(AES_KEY);
    var data = CryptoJS.enc.Utf8.parse(JSON.stringify(env));
    var encrypted = CryptoJS.AES.encrypt(data, key, {
        iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7
    });
    return encrypted.ciphertext.toString();
}

function genKey(token, fingerPrint, u, appId) {
    var rd = "1omnRMcSOOOQ";
    var str = token + fingerPrint + u + appId + rd;
    return CryptoJS.SHA256(str, token).toString();
}

function gensign(key, params) {
    var result = "";
    for (var i = 0; i < params.length; i++) {
        result += params[i].key + ":" + params[i].value + "&";
    }
    result = result.slice(0, -1);
    result = key + result + key;
    return CryptoJS.MD5(result).toString();
}

function generateH5st(params, token, fingerPrint, appId) {
    fingerPrint = fingerPrint || genFingerPrint();
    appId = appId || "fb5df";

    var timestamp = Date.now();
    var dateTime = formatDateTime(timestamp, "yyyyMMddhhmmssSSS");
    var u = dateTime + "88";

    // 对 body 做 SHA256
    var l = JSON.parse(JSON.stringify(params));
    if (l.body) l.body = CryptoJS.SHA256(l.body).toString();

    // 按 key 排序
    var sortedKeys = Object.keys(l).sort();
    var t = sortedKeys.map(function(key) {
        return { key: String(key), value: String(l[key]) };
    });

    var envData = genEnvEncrypted(fingerPrint, appId);
    var signKey = genKey(token, fingerPrint, u, appId);
    var sign = gensign(signKey, t);

    var h5st = [dateTime, fingerPrint, appId, token, sign, H5ST_VERSION, timestamp, envData].join(";");
    return h5st;
}

// ==================== 获取 token ====================
function getToken(cookie, ua) {
    return new Promise(function(resolve) {
        var reqUrl = "https://api.m.jd.com/client.action?functionId=genToken&appid=JDGP0502&client=wh5&clientVersion=1.0.0&area=&networkType=&osVersion=&d_brand=&d_model=&d_name=&lang=zh_CN&jsonp=";
        var headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "*/*",
            "User-Agent": ua || "jdapp;iPhone;15.5.0;;;M/5.0;appBuild/170241",
            "Origin": "https://pro.m.jd.com",
            "Referer": "https://pro.m.jd.com/",
            "Cookie": cookie
        };
        var body = 'body={"to":"https://pro.m.jd.com/","action":"to"}';

        var u = new URL(reqUrl);
        var opts = {
            hostname: u.hostname, port: u.port || 443,
            path: u.pathname + u.search,
            method: "POST", headers: headers, timeout: 10000
        };
        var req = https.request(opts, function(res) {
            var data = "";
            res.on("data", function(c) { data += c; });
            res.on("end", function() {
                try {
                    var json = JSON.parse(data);
                    if (json.token) {
                        resolve({ token: json.token });
                    } else {
                        resolve({ error: "token获取失败", raw: data.substring(0, 200) });
                    }
                } catch(e) {
                    resolve({ error: "解析失败", raw: data.substring(0, 200) });
                }
            });
        });
        req.on("error", function(e) { resolve({ error: e.message }); });
        req.on("timeout", function() { req.destroy(); resolve({ error: "timeout" }); });
        req.write(body);
        req.end();
    });
}

// ==================== HTTP 请求 ====================
function httpReq(method, reqUrl, body, headers) {
    return new Promise(function(resolve) {
        var mod = reqUrl.startsWith("https") ? https : http;
        var u = new URL(reqUrl);
        var opts = { hostname: u.hostname, port: u.port || (reqUrl.startsWith("https") ? 443 : 80), path: u.pathname + u.search, method: method, headers: headers || {}, timeout: 8000 };
        var r = mod.request(opts, function(res) {
            var d = "";
            res.on("data", function(c) { d += c; });
            res.on("end", function() { resolve({ status: res.statusCode, body: d }); });
        });
        r.on("error", function(e) { resolve({ error: e.message }); });
        r.on("timeout", function() { r.destroy(); resolve({ error: "timeout" }); });
        if (body) r.write(body);
        r.end();
    });
}

function parseJson(s) { try { return JSON.parse(s); } catch(e) { return {}; } }
function isSuccess(j) {
    // 真正的领取成功：bizCode 为 "000" 或 result.baseResult.resultCode 为 0
    if (j.bizCode === "000" || j.bizCode === 0) return true;
    if (j.result && j.result.baseResult && j.result.baseResult.resultCode === 0) return true;
    return false;
}
function isPermFail(j) {
    // bizCode 判断
    if (j.bizCode === "011") return true; // 已领取
    if (j.bizCode === "012") return true; // 已抢完
    if (j.bizCode === "001") return true; // 参数错误
    // resultCode 判断
    if (j.result && j.result.baseResult) {
        var rc = j.result.baseResult.resultCode;
        if (rc === 15 || rc === 16 || rc === 17 || rc === 18) return true; // 已参加/已领取/已抢完/不满足
    }
    // toast 判断
    var t = (j.toast || j.bizMsg || j.result && j.result.baseResult && j.result.baseResult.resultMsg || "") + "";
    if (t.indexOf("已领取") > -1 || t.indexOf("已领完") > -1 || t.indexOf("已抢完") > -1) return true;
    if (t.indexOf("已参加过") > -1 || t.indexOf("明天再来") > -1) return true;
    if (t.indexOf("过期") > -1 || t.indexOf("领取上限") > -1 || t.indexOf("不满足") > -1) return true;
    return false;
}

// ==================== 抢券核心（带 h5st 签名）====================
async function runGrab(cfg) {
    if (grabState.running) return { error: "已在运行中" };
    var ac = coupons.filter(function(c) { return c.enabled; });
    var aa = accounts.filter(function(a) { return a.enabled; });
    if (!ac.length) return { error: "没有启用的券" };
    if (!aa.length) return { error: "没有启用的账号" };

    grabState.running = true;
    var cc = cfg.concurrency || 3, rc = cfg.retryCount || 10, rd = cfg.retryDelay || 300;
    addLog("START", "开始抢券（h5st签名）", "券:" + ac.length + " 账号:" + aa.length);

    // 为每个账号获取 token
    var tokenMap = {};
    for (var i = 0; i < aa.length; i++) {
        var ak = aa[i];
        // 优先使用账号上存储的 token
        if (ak.token) {
            tokenMap[ak.cookie] = ak.token;
            addLog("TOKEN", "使用已存token: " + ak.name, "");
        } else if (h5stTokens[ak.cookie] && Date.now() - h5stTokens[ak.cookie].time < 25 * 60 * 1000) {
            tokenMap[ak.cookie] = h5stTokens[ak.cookie].token;
        } else {
            addLog("TOKEN", "获取token: " + ak.name, "（服务器IP可能被JD拦截）");
            var tr = await getToken(ak.cookie, ak.ua);
            if (tr.token) {
                tokenMap[ak.cookie] = tr.token;
                h5stTokens[ak.cookie] = { token: tr.token, time: Date.now() };
                addLog("TOKEN", "token获取成功: " + ak.name, "");
            } else {
                addLog("TOKEN", "token获取失败: " + ak.name, tr.error + " | 请在网页上手动获取token");
                tokenMap[ak.cookie] = null;
            }
        }
    }

    var res = { success: 0, fail: 0, total: 0 };

    for (var round = 1; round <= rc; round++) {
        if (!grabState.running) break;
        var promises = [];

        for (var ci = 0; ci < ac.length; ci++) {
            for (var ai = 0; ai < aa.length; ai++) {
                if (promises.length >= cc) break;
                var cp = ac[ci], ak = aa[ai];
                var token = tokenMap[ak.cookie];

                if (!token) {
                    addLog("SKIP", ak.name + " | " + cp.name + " | 无token", "");
                    continue;
                }

                res.total++;
                (function(cp, ak) {
                    var reqUrl, headers, body;

                    // 如果券有完整 URL（从 cURL 导入），直接重放
                    if (cp.fullUrl) {
                        reqUrl = cp.fullUrl;
                        body = cp.body || "";
                        headers = cp.fullHeaders ? JSON.parse(JSON.stringify(cp.fullHeaders)) : {};
                        headers["Cookie"] = ak.cookie;
                    } else {
                        // 用多版本 h5st 签名 (v4.9.1)
                        var token = tokenMap[ak.cookie];
                        if (!token) { res.fail++; return; }
                        var signResult = multiVersionH5stSign('4.9.1', cp.functionId || 'getBenefit', cp.appid || 'coupon-activity', cp.body || '{}', ak.pin, ak.ua);
                        var qs = 'functionId=' + (cp.functionId || 'getBenefit') + '&appid=' + (cp.appid || 'coupon-activity') + '&client=wh5&clientVersion=1.0.0';
                        if (signResult && signResult.h5st) {
                            qs += '&h5st=' + encodeURIComponent(signResult.h5st);
                            qs += '&_stk=' + encodeURIComponent(signResult._stk);
                            qs += '&_ste=' + signResult._ste;
                            qs += '&body=' + encodeURIComponent(signResult.body);
                        }
                        reqUrl = 'https://api.m.jd.com/client.action?' + qs;
                        body = cp.body || '{}';
                        headers = {
                            'User-Agent': ak.ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Accept': 'application/json, text/plain, */*',
                            'Origin': 'https://api.m.jd.com',
                            'Cookie': ak.cookie
                        };
                    }

                    var p = cp.method === "POST" ? httpReq("POST", reqUrl, body, headers) : httpReq("GET", reqUrl, null, headers);
                    promises.push(p.then(function(resp) {
                        var j = parseJson(resp.body);
                        var bizCode = j.bizCode || "";
                        var toast = j.toast || "";
                        var resultCode = j.result && j.result.baseResult && j.result.baseResult.resultCode;
                        var resultMsg = j.result && j.result.baseResult && j.result.baseResult.resultMsg || "";
                        var respSummary = "bizCode:" + bizCode + " rc:" + resultCode + " | " + (toast || resultMsg).substring(0, 100);
                        if (isSuccess(j)) {
                            res.success++;
                            addLog("SUCCESS", ak.name + " | " + cp.name, respSummary);
                            return { ok: true };
                        }
                        if (isPermFail(j)) {
                            addLog("FAIL", ak.name + " | " + cp.name, respSummary);
                            return { ok: false, perm: true };
                        }
                        addLog("FAIL", ak.name + " | " + cp.name, respSummary);
                        res.fail++;
                        return { ok: false };
                    }));
                })(cp, ak);
            }
        }

        var rr = await Promise.all(promises);
        if (rr.some(function(r) { return r.ok; })) { addLog("ROUND", "Round " + round + ": ✅ 成功!", ""); break; }
        if (rr.some(function(r) { return r.perm; })) { addLog("ROUND", "Round " + round + ": 永久失败", ""); break; }
        addLog("ROUND", "Round " + round + "/" + rc + ": 失败", "");
        if (round < rc) await new Promise(function(r) { setTimeout(r, rd); });
    }

    grabState.running = false;
    addLog("END", "抢券结束", "成功:" + res.success + " 失败:" + res.fail);
    return { success: true, results: res };
}

// ==================== 解析 cURL ====================
function parseCurl(curl) {
    try {
        var m = curl.match(/curl\s+'([^']+)'/) || curl.match(/curl\s+"([^"]+)"/) || curl.match(/curl\s+(\S+)/);
        if (!m) return { error: "无法解析 URL" };
        var reqUrl = m[1];
        var method = curl.includes("--data") || curl.includes("-d ") ? "POST" : "GET";
        var body = null;
        var dm = curl.match(/--data\s+'([^']+)'/) || curl.match(/--data\s+"([^"]+)"/) || curl.match(/-d\s+'([^']+)'/);
        if (dm) body = dm[1];
        var name = "券";
        var fid = reqUrl.match(/functionId=(\w+)/);
        if (fid) name = fid[1];
        var appid = "coupon-activity";
        var amid = reqUrl.match(/appid=(\w+)/);
        if (amid) appid = amid[1];
        // 提取 headers
        var headers = {};
        var hRe = /-H\s+'([^']+)'/g;
        var hm;
        while (hm = hRe.exec(curl)) {
            var kv = hm[1].split(/:\s*(.+)/);
            if (kv.length >= 2) headers[kv[0].trim()] = kv[1].trim();
        }
        return { name: name, method: method, url: reqUrl, body: body, appid: appid, functionId: fid ? fid[1] : "",
                 fullUrl: reqUrl, fullHeaders: headers };
    } catch(e) {
        return { error: "解析失败: " + e.message };
    }
}

// ==================== HTML 前端 ====================
// ==================== 多版本 h5st 签名 (v4.2.0 ~ v4.9.1) ====================
// 基于 chenpython/jd_h5st_server 的算法参数
const H5ST_ALGO_CONFIGS = {
  '4.2.0': {
    version: '4.2', fv: 'h5_file_v4.2.0',
    envSecret: 'DNiHi703B0&17hh1', bu1: '0.1.9', randomLength: 10,
    visitKey: { seed: '6d0jhqw3pa', selectLength: 4, randomLength: 11, convertLength: 14 },
    defaultKey: { extend: '9>5*t5' },
    makeSign: { extendDateStr: '74' },
    genLocalTK: { magic: 'tk', version: '02', platform: 'w', expires: '41', producer: 'l', secret1: 'qem7+)g%Dhw5', prefix: 'z7' }
  },
  '4.3.1': {
    version: '4.3', fv: 'h5_file_v4.3.1',
    envSecret: '&d74&yWoV.EYbWbZ', bu1: '0.1.7', randomLength: 10,
    visitKey: { seed: 'kl9i1uct6d', selectLength: 3, randomLength: 12, convertLength: 10 },
    defaultKey: { extend: 'Z=<J_2' },
    makeSign: { extendDateStr: '22' },
    genLocalTK: { magic: 'tk', version: '02', platform: 'w', expires: '41', producer: 'l', secret1: '+WzD<U36rlTf', prefix: '0J' }
  },
  '4.4.0': {
    version: '4.4', fv: 'v_lite_f_4.4.0',
    envSecret: 'r1T.6Vinpb.k+/a)', randomLength: 12,
    visitKey: { seed: '1uct6d0jhq', selectLength: 4, randomLength: 11, convertLength: 8 },
    defaultKey: { extend: 'qV!+A!' },
    makeSign: { extendDateStr: '88' },
    genLocalTK: { magic: 'tk', version: '02', platform: 'w', expires: '41', producer: 'l', secret1: 'HiO81-Ei89DH', prefix: '(>' }
  },
  '4.7.1': {
    version: '4.7', fv: 'h5_file_v4.7.1',
    envSecret: '_M6Y?dvfN40VMF[X', bu1: '0.1.5', randomLength: 12,
    visitKey: { seed: '1uct6d0jhq', selectLength: 5, randomLength: 10, convertLength: 15 },
    defaultKey: { extend: 'hh1BNE' },
    makeSign: { extendDateStr: '97' },
    genLocalTK: { magic: 'tk', version: '03', platform: 'w', expires: '41', producer: 'l', secret1: '8[8I[]d?960w', prefix: 'cw' },
    customAlgorithm: { salt: '23k@X!', keyReverse: true, convertIndex: { hmac: 16 } }
  },
  '4.7.4': {
    version: '4.7', fv: 'h5_file_v4.7.4', genSignDefault: true,
    envSecret: '_M6Y?dvfN40VMF[X', bu1: '0.1.5', randomLength: 11,
    visitKey: { seed: '1uct6d0jhq', selectLength: 5, randomLength: 10, convertLength: 15 },
    defaultKey: { extend: 'Mp(2C1' },
    makeSign: { extendDateStr: '47' },
    genLocalTK: { magic: 'tk', version: '03', platform: 'w', expires: '41', producer: 'l', secret1: '4*iK&33Z|+6)', prefix: 'FX' },
    customAlgorithm: { salt: '7n5<G*', keyReverse: true, convertIndex: { hmac: 5 } }
  },
  '4.8.1': {
    version: '4.8', fv: 'h5_file_v4.8.1', genSignDefault: true,
    randomLength: 11,
    visitKey: { seed: '2mn87xbyof', selectLength: 6, randomLength: 9, convertLength: 14 },
    defaultKey: { extend: 'JdM3|5' },
    makeSign: { extendDateStr: '36' },
    genLocalTK: { magic: 'tk', version: '04', platform: 'w', expires: '41', producer: 'l', secret1: 'DbIAgz71j04v', prefix: 'mT' },
    customAlgorithm: { salt: '7hh1BN', convertIndex: { hex: 6, hmac: 5 } }
  },
  '4.9.1': {
    version: '4.9', fv: 'h5_file_v4.9.1', genSignDefault: true,
    randomLength: 12,
    visitKey: { seed: 'z4rekl9i1u', selectLength: 4, randomLength: 11, convertLength: 8 },
    defaultKey: { extend: 'SDV&6(' },
    makeSign: { extendDateStr: '07' },
    genLocalTK: { magic: 'tk', version: '04', platform: 'w', expires: '41', producer: 'l', secret1: 'qodOHbSV1ik2', prefix: 'ba' },
    customAlgorithm: { salt: 'x38rG0', convertIndex: { hex: 6, hmac: 9 } }
  }
};

function h5stGetRandomIDPro(size, dictType) {
  if (typeof size === 'object') { dictType = size.dictType; size = size.size; }
  size = size || 16;
  var chars = dictType === 'max' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' : 'abcdefghijklmnopqrstuvwxyz0123456789';
  var r = '';
  for (var i = 0; i < size; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function h5stAdler32(data) {
  var a = 1, b = 0, MOD = 65521;
  for (var i = 0; i < data.length; i++) { a = (a + data[i]) % MOD; b = (b + a) % MOD; }
  return ((b << 16) | a) >>> 0;
}

function h5stStringToHex(str) { return Buffer.from(str, 'utf8').toString('hex'); }

class H5stSignerV2 {
  constructor(config, pin, ua) {
    this.config = config;
    this.pin = pin;
    this.ua = ua;
    this.fingerprint = h5stGetRandomIDPro(16, 'max');
    this.token = this._genLocalToken();
  }

  _genLocalToken() {
    var cfg = this.config.genLocalTK;
    var now = Date.now();
    var fp = this.fingerprint;

    // gen expr
    var numbers = ['1','2','3'];
    var operators = ['+','x'];
    var length = 2 + Math.floor(4 * Math.random());
    var expression = '';
    for (var i = 0; i < length; i++) {
      expression += numbers[Math.floor(Math.random() * 3)];
      if (i < length - 1) expression += operators[Math.floor(Math.random() * 2)];
    }
    if (expression.length < 9) expression += h5stGetRandomIDPro(9 - expression.length);
    var expr = Buffer.from(expression).toString('base64').replace(/=+$/, '');

    // gen cipher
    var prefix = cfg.prefix;
    var secret1 = cfg.secret1;
    var fpBytes = Buffer.alloc(16);
    for (var i = 0; i < 16; i++) fpBytes[i] = fp.charCodeAt(i);
    var timeBytes = Buffer.alloc(4);
    timeBytes.writeUInt32BE((now & 0xFFFFFFFF) >>> 0);
    var prefixBytes = Buffer.from(prefix);
    var secret1Bytes = Buffer.alloc(12);
    for (var i = 0; i < Math.min(12, secret1.length); i++) secret1Bytes[i] = secret1.charCodeAt(i);
    var combined = Buffer.concat([prefixBytes, secret1Bytes, timeBytes, fpBytes]);
    var checksum = h5stAdler32(combined);
    var checksumStr = checksum.toString(16).padStart(8, '0');
    var cipherPlain = h5stStringToHex(checksumStr) + h5stStringToHex(prefix) + h5stStringToHex(secret1) + timeBytes.toString('hex') + h5stStringToHex(fp);
    var envKey = Buffer.alloc(16, 0);
    Buffer.from('0102030405060708').copy(envKey);
    var cipher = _aesEncrypt(Buffer.from(cipherPlain, 'hex').toString('utf8'), envKey, Buffer.from('0102030405060708'));

    var adler = h5stAdler32(Buffer.from(cfg.magic + cfg.version + cfg.platform + cfg.expires + cfg.producer + expr + cipher));
    return cfg.magic + cfg.version + cfg.platform + adler.toString(16).padStart(8,'0') + cfg.expires + cfg.producer + expr + cipher;
  }

  sign(functionId, appid, body) {
    var now = Date.now();
    var ts = new Date(now - new Date().getTimezoneOffset() * 60000).toISOString().replace(/[-:T.Z]/g, '').slice(0, 17);
    var ts2 = now.toString();
    var fp = this.fingerprint;
    var tk = this.token;
    var appId = 'a5290';
    var bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    var bodyHash = CryptoJS.SHA256(bodyStr).toString();
    var key = this.config.makeSign.extendDateStr + this.config.defaultKey.extend;
    var params = 'appid:' + appid + ',body:' + bodyStr + ',functionId:' + functionId;
    var signStr;
    if (this.config.genSignDefault) {
      signStr = CryptoJS.MD5(key + params + key).toString();
    } else {
      signStr = CryptoJS.HmacMD5(params, key).toString();
    }
    var envSecret = this.config.envSecret || '0102030405060708';
    var envKey = Buffer.alloc(16, 0);
    Buffer.from(envSecret, 'utf8').copy(envKey);
    var envData = JSON.stringify({ fp: fp, bu1: this.config.bu1 || '0.1.9', fv: this.config.fv });
    var envEncrypted = _aesEncrypt(envData, envKey, Buffer.from('0102030405060708'));
    var h5st = ts + ';' + fp + ';' + appId + ';' + tk + ';' + signStr + ';' + this.config.version + ';' + ts2 + ';' + envEncrypted;
    return { h5st: h5st, _stk: 'appid,body,functionId', _ste: 1, appid: appid, body: bodyHash, functionId: functionId };
  }
}

function _aesEncrypt(plaintext, key, iv) {
  var cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(true);
  var encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function multiVersionH5stSign(version, functionId, appid, body, pin, ua) {
  var config = H5ST_ALGO_CONFIGS[version];
  if (!config) return { error: '不支持的版本: ' + version + '，支持: ' + Object.keys(H5ST_ALGO_CONFIGS).join(', ') };
  var signer = new H5stSignerV2(config, pin || '', ua || '');
  return signer.sign(functionId, appid, body);
}

var htmlContent = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function parseBody(req) {
    return new Promise(function(resolve) {
        var b = ""; req.on("data", function(c) { b += c; });
        req.on("end", function() { try { resolve(JSON.parse(b)); } catch(e) { resolve({}); } });
    });
}
function sendJSON(res, d, s) { res.writeHead(s || 200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(d)); }
function sendHTML(res) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(htmlContent); }

var server = http.createServer(async function(req, res) {
    var p = url.parse(req.url, true).pathname;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    // 认证检查（仅对外部签名接口）
    if (p === "/api/sign" || p === "/api/token") {
        var auth = req.headers["authorization"] || "";
        if (auth !== "Bearer " + AUTH_TOKEN && auth !== AUTH_TOKEN) {
            var ip = req.connection.remoteAddress || "";
            if (ip.indexOf("127.0.0.1") === -1 && ip.indexOf("::1") === -1 && ip.indexOf("192.168.") === -1 && ip.indexOf("10.") === -1) {
                return sendJSON(res, { error: "Unauthorized" }, 401);
            }
        }
    }

    if (p === "/" || p === "/index.html") return sendHTML(res);
    if (p === "/health") return sendJSON(res, { status: "ok", time: new Date().toISOString() });

    // h5st 签名接口（供手机脚本调用）
    if (p === "/api/sign" && req.method === "POST") {
        var b = await parseBody(req);
        var token = b.token;
        var params = b.params;
        var fingerPrint = b.fingerPrint;
        var appId = b.appId || "fb5df";

        if (!token || !params) return sendJSON(res, { error: "缺少 token 或 params" });

        var h5st = generateH5st(params, token, fingerPrint, appId);
        return sendJSON(res, { h5st: h5st, timestamp: params.t });
    }

    // 获取 token 接口
    if (p === "/api/token" && req.method === "POST") {
        var b = await parseBody(req);
        if (!b.cookie) return sendJSON(res, { error: "缺少 cookie" });
        var result = await getToken(b.cookie, b.ua);
        return sendJSON(res, result);
    }

    // 状态
    if (p === "/api/state" && req.method === "GET") {
        return sendJSON(res, { accounts: accounts, coupons: coupons, logs: logs.slice(0, 100), grabRunning: grabState.running });
    }

    // 账号 CRUD
    if (p === "/api/accounts" && req.method === "POST") {
        var b = await parseBody(req);
        accounts.push({ name: b.name || "账号" + (accounts.length + 1), cookie: b.cookie, ua: b.ua || "", enabled: true });
        saveJSON("accounts.json", accounts); addLog("CONFIG", "添加账号: " + (b.name || ""), "");
        return sendJSON(res, { success: true });
    }
    if (p.match(/^\/api\/accounts\/\d+$/) && req.method === "PUT") {
        var i = parseInt(p.split("/").pop()), b = await parseBody(req);
        if (accounts[i]) Object.assign(accounts[i], b);
        saveJSON("accounts.json", accounts); return sendJSON(res, { success: true });
    }
    if (p.match(/^\/api\/accounts\/\d+$/) && req.method === "DELETE") {
        accounts.splice(parseInt(p.split("/").pop()), 1); saveJSON("accounts.json", accounts); return sendJSON(res, { success: true });
    }

    // 券 CRUD
    if (p === "/api/coupons" && req.method === "POST") {
        var b = await parseBody(req);
        coupons.push({ name: b.name || "券" + (coupons.length + 1), method: b.method || "POST", url: b.url, body: b.body || "", appid: b.appid || "coupon-activity", functionId: b.functionId || "", fullUrl: b.fullUrl || "", fullHeaders: b.fullHeaders || null, enabled: true });
        saveJSON("coupons.json", coupons); addLog("CONFIG", "添加券: " + (b.name || ""), "");
        return sendJSON(res, { success: true });
    }
    if (p.match(/^\/api\/coupons\/\d+$/) && req.method === "PUT") {
        var i = parseInt(p.split("/").pop()), b = await parseBody(req);
        if (coupons[i]) Object.assign(coupons[i], b);
        saveJSON("coupons.json", coupons); return sendJSON(res, { success: true });
    }
    if (p.match(/^\/api\/coupons\/\d+$/) && req.method === "DELETE") {
        coupons.splice(parseInt(p.split("/").pop()), 1); saveJSON("coupons.json", coupons); return sendJSON(res, { success: true });
    }

    // 解析 cURL
    if (p === "/api/parse-curl" && req.method === "POST") {
        var b = await parseBody(req); return sendJSON(res, parseCurl(b.curl || ""));
    }

    // 抢券
    if (p === "/api/grab/start" && req.method === "POST") {
        var b = await parseBody(req);
        if (b.scheduleTime) {
            var target = new Date(b.scheduleTime).getTime();
            var now = Date.now();
            if (target <= now) return sendJSON(res, { error: "定时时间已过" });
            var delay = target - now;
            addLog("SCHEDULE", "定时抢: " + b.scheduleTime, delay + "ms 后开始");
            grabState.timer = setTimeout(function() { runGrab(b); }, delay);
            return sendJSON(res, { scheduled: b.scheduleTime, delay: delay });
        }
        var r = await runGrab(b); return sendJSON(res, r);
    }
    if (p === "/api/grab/stop" && req.method === "POST") {
        grabState.running = false;
        if (grabState.timer) { clearTimeout(grabState.timer); grabState.timer = null; }
        addLog("STOP", "手动停止", ""); return sendJSON(res, { success: true });
    }

    // 解析 JD 页面，提取领券链接
    if (p === "/api/parse-jd-page" && req.method === "POST") {
        var b = await parseBody(req);
        var html = b.html || "";
        if (!html) return sendJSON(res, { error: "请粘贴页面内容" });
        var links = extractJdLinks(html);
        return sendJSON(res, { links: links, total: links.length });
    }

    // 多版本 h5st 签名 (v4.2.0 ~ v4.9.1)
    if (p === "/api/h5st-sign" && req.method === "POST") {
        var b = await parseBody(req);
        var version = b.version || '4.9.1';
        var result = multiVersionH5stSign(version, b.functionId, b.appid, b.body, b.pin, b.ua);
        if (result.error) return sendJSON(res, result, 400);
        return sendJSON(res, { success: true, h5st: result });
    }
    if (p === "/api/h5st-versions" && req.method === "GET") {
        return sendJSON(res, { versions: Object.keys(H5ST_ALGO_CONFIGS) });
    }

    // 日志
    if (p === "/api/logs" && req.method === "DELETE") {
        logs = []; saveJSON("logs.json", logs); return sendJSON(res, { success: true });
    }

    sendJSON(res, { error: "Not Found" }, 404);
});

// ==================== JD 页面链接提取 ====================
function extractJdLinks(html) {
    var links = [];
    var seen = {};

    // 方式0: 批量 cURL（多行，来自 Stream 抓包）
    var curlBlocks = html.split(/(?=curl\s+['"]https?:\/\/api\.m\.jd\.com)/);
    if (curlBlocks.length > 1) {
        curlBlocks.forEach(function(block) {
            block = block.trim();
            if (!block.startsWith("curl")) return;
            var parsed = parseCurl(block);
            if (parsed.error) return;
            if (parsed.fullUrl && parsed.fullUrl.indexOf("functionId=") > -1) {
                var fid = parsed.functionId || "unknown";
                var key = fid + "_" + (parsed.appid || "");
                if (!seen[key]) {
                    seen[key] = true;
                    parsed.source = "stream-batch";
                    links.push(parsed);
                }
            }
        });
        if (links.length > 0) return links;
    }

    // 方式0b: 单个 cURL（直接粘贴完整 cURL）
    if (html.trim().startsWith("curl ") && html.indexOf("api.m.jd.com") > -1) {
        var single = parseCurl(html.trim());
        if (!single.error && single.fullUrl) {
            single.source = "stream-single";
            links.push(single);
            return links;
        }
    }

    // 方式1: 提取 api.m.jd.com/client.action 链接（GET 格式）
    var re1 = /https?:\/\/api\.m\.jd\.com\/client\.action[^"'\s<>]+/g;
    var m;
    while (m = re1.exec(html)) {
        var u = decodeURIComponent(m[0]);
        var fid = u.match(/functionId=(\w+)/);
        var aid = u.match(/appid=(\w+)/);
        var key = (fid ? fid[1] : "") + "_" + (aid ? aid[1] : "");
        if (!seen[key] && fid) {
            seen[key] = true;
            var bodyMatch = u.match(/body=([^&]+)/);
            var body = bodyMatch ? decodeURIComponent(bodyMatch[1]) : "{}";
            links.push({
                name: fid[1],
                functionId: fid[1],
                appid: aid ? aid[1] : "coupon-activity",
                url: u.split("&h5st=")[0], // 去掉旧 h5st
                method: "GET",
                body: body,
                source: "page-link"
            });
        }
    }

    // 方式2: 提取 JS 代码中的 functionId + body 组合
    var re2 = /functionId["']?\s*[:=]\s*["'](\w+)["']/g;
    while (m = re2.exec(html)) {
        var fid2 = m[1];
        if (seen[fid2]) continue;
        // 检查是否是领券相关的 functionId
        var couponFids = ["getBenefit", "collectCoupon", "receiveCoupon", "getCoupon", "claimCoupon", "grabCoupon"];
        if (couponFids.indexOf(fid2) > -1 || fid2.toLowerCase().indexOf("coupon") > -1 || fid2.toLowerCase().indexOf("benefit") > -1) {
            seen[fid2] = true;
            // 尝试在附近找 body 或 appid

            var ctxStart = Math.max(0, m.index - 500);
            var ctxEnd = Math.min(html.length, m.index + 2000);
            var ctx = html.substring(ctxStart, ctxEnd);
            var aid2 = ctx.match(/appid["']?\s*[:=]\s*["'](\w+)["']/);
            var body2 = ctx.match(/body["']?\s*[:=]\s*["']({[^}]+})["']/);
            var source2 = ctx.match(/source["']?\s*[:=]\s*["']([^"']+)["']/);
            var platform2 = ctx.match(/platform["']?\s*[:=]\s*["']([^"']+)["']/);
            var epMatch = ctx.match(/encryptedParam["']?\s*[:=]\s*["']([^"']+)["']/);

            var bodyObj = {};
            if (source2) bodyObj.source = source2[1];
            if (platform2) bodyObj.platform = platform2[1];
            if (epMatch) bodyObj.encryptedParam = epMatch[1];
            if (body2) { try { bodyObj = JSON.parse(body2[1]); } catch(e) {} }

            links.push({
                name: fid2,
                functionId: fid2,
                appid: aid2 ? aid2[1] : "coupon-activity",
                url: "https://api.m.jd.com/client.action?functionId=" + fid2 + "&appid=" + (aid2 ? aid2[1] : "coupon-activity") + "&client=wh5&clientVersion=15.5.0",
                method: "POST",
                body: JSON.stringify(bodyObj),
                source: "page-js"
            });
        }
    }

    // 方式3: 提取 activityId / couponUrl 等活动链接
    var re3 = /https?:\/\/pro\.m\.jd\.com\/mall\/active\/([A-Za-z0-9]+)\/index\.html/g;
    while (m = re3.exec(html)) {
        var actId = m[1];
        if (!seen["act_" + actId]) {
            seen["act_" + actId] = true;
            links.push({
                name: "活动页面: " + actId,
                functionId: "getBenefit",
                appid: "coupon-activity",
                url: "https://api.m.jd.com/client.action?functionId=getBenefit&appid=coupon-activity&client=wh5&clientVersion=15.5.0",
                method: "POST",
                body: JSON.stringify({ source: "conpons-volley", platform: "conpons-volley", encryptedParam: "", key: "", roleId: "" }),
                source: "activity-page",
                activityId: actId
            });
        }
    }

    return links;
}

server.listen(PORT, function() {
    console.log("============================================");
    console.log("  🎯 京东抢券工具 v2.1 (h5st签名版)");
    console.log("  监听: http://0.0.0.0:" + PORT);
    console.log("  签名接口: POST /api/sign");
    console.log("============================================");
});
