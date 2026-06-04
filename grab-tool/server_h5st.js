const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
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
    if (j.code === 0 || j.code === "0" || j.ret === 0 || j.success === true) return true;
    if (j.data && (j.data.receiveResult === 1 || j.data.couponId || j.data.result === 1)) return true;
    return false;
}
function isPermFail(j) {
    if (j.code === 1001 || j.code === 1002 || j.code === 2008) return true;
    var m = j.message || "";
    if (m.indexOf("已领取") > -1 || m.indexOf("已抢完") > -1 || m.indexOf("已领完") > -1) return true;
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
                (function(cp, ak, token) {
                    // 生成 h5st
                    var params = {
                        appid: cp.appid || "coupon-activity",
                        functionId: cp.functionId || "getBenefit",
                        client: "wh5",
                        clientVersion: "1.0.0",
                        t: Date.now(),
                        body: cp.body || "{}"
                    };
                    var h5st = generateH5st(params, token, null, cp.appid || "fb5df");

                    // 构建请求
                    var reqUrl = cp.url + "&h5st=" + h5st + "&t=" + params.t;
                    var headers = {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "*/*",
                        "User-Agent": ak.ua || "jdapp;iPhone;15.5.0;;;M/5.0;appBuild/170241",
                        "Origin": "https://pro.m.jd.com",
                        "Referer": "https://pro.m.jd.com/",
                        "Cookie": ak.cookie
                    };

                    var p = cp.method === "POST" ? httpReq("POST", reqUrl, cp.body, headers) : httpReq("GET", reqUrl, null, headers);
                    promises.push(p.then(function(resp) {
                        var j = parseJson(resp.body);
                        if (isSuccess(j)) {
                            res.success++;
                            addLog("SUCCESS", ak.name + " | " + cp.name, JSON.stringify(j.data || {}).substring(0, 100));
                            return { ok: true };
                        }
                        if (isPermFail(j)) {
                            addLog("FAIL", ak.name + " | " + cp.name + " | " + (j.message || ""), "");
                            return { ok: false, perm: true };
                        }
                        res.fail++;
                        return { ok: false };
                    }));
                })(cp, ak, token);
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
        return { name: name, method: method, url: reqUrl, body: body, appid: appid, functionId: fid ? fid[1] : "" };
    } catch(e) {
        return { error: "解析失败: " + e.message };
    }
}

// ==================== HTML 前端 ====================
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
        coupons.push({ name: b.name || "券" + (coupons.length + 1), method: b.method || "POST", url: b.url, body: b.body || "", appid: b.appid || "coupon-activity", functionId: b.functionId || "", enabled: true });
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

    // 日志
    if (p === "/api/logs" && req.method === "DELETE") {
        logs = []; saveJSON("logs.json", logs); return sendJSON(res, { success: true });
    }

    sendJSON(res, { error: "Not Found" }, 404);
});

server.listen(PORT, function() {
    console.log("============================================");
    console.log("  🎯 京东抢券工具 v2.1 (h5st签名版)");
    console.log("  监听: http://0.0.0.0:" + PORT);
    console.log("  签名接口: POST /api/sign");
    console.log("============================================");
});
