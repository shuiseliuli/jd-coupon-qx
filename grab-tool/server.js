const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ==================== 数据存储 ====================
function load(f, d) { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")); } catch(e) { return d; } }
function save(f, d) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); }

let accounts = load("accounts.json", []);
let coupons = load("coupons.json", []);
let logs = load("logs.json", []);
let grabState = { running: false, timer: null };

function addLog(type, msg, detail) {
    var e = { time: new Date().toISOString(), type: type, msg: msg, detail: detail || "" };
    logs.unshift(e);
    if (logs.length > 500) logs = logs.slice(0, 500);
    save("logs.json", logs);
    console.log("[" + type + "] " + msg);
    return e;
}

// ==================== HTTP 请求 ====================
function httpReq(method, reqUrl, body, headers) {
    return new Promise(function(resolve) {
        var mod = reqUrl.startsWith("https") ? https : http;
        var u = new URL(reqUrl);
        var opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method, headers: headers || {}, timeout: 8000 };
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

// ==================== 抢券核心 ====================
async function runGrab(cfg) {
    if (grabState.running) return { error: "已在运行中" };
    var ac = coupons.filter(function(c) { return c.enabled; });
    var aa = accounts.filter(function(a) { return a.enabled; });
    if (!ac.length) return { error: "没有启用的券" };
    if (!aa.length) return { error: "没有启用的账号" };

    grabState.running = true;
    var cc = cfg.concurrency || 3, rc = cfg.retryCount || 10, rd = cfg.retryDelay || 300;
    addLog("START", "开始抢券", "券:" + ac.length + " 账号:" + aa.length + " 并发:" + cc);

    var res = { success: 0, fail: 0, total: 0 };

    for (var round = 1; round <= rc; round++) {
        if (!grabState.running) break;
        var promises = [];

        for (var ci = 0; ci < ac.length; ci++) {
            for (var ai = 0; ai < aa.length; ai++) {
                if (promises.length >= cc) break;
                var cp = ac[ci], ak = aa[ai];
                res.total++;
                (function(cp, ak) {
                    var headers = {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "*/*",
                        "User-Agent": ak.userAgent || "jdapp;iPhone;15.5.0;;;M/5.0;appBuild/170241",
                        "Origin": "https://pro.m.jd.com",
                        "Referer": "https://pro.m.jd.com/",
                        "Cookie": ak.cookie
                    };
                    var p = cp.method === "POST" ? httpReq("POST", cp.url, cp.body, headers) : httpReq("GET", cp.url, null, headers);
                    promises.push(p.then(function(resp) {
                        var j = parseJson(resp.body);
                        if (isSuccess(j)) { res.success++; addLog("SUCCESS", ak.name + " | " + cp.name, JSON.stringify(j.data || {}).substring(0, 100)); return { ok: true }; }
                        if (isPermFail(j)) { addLog("FAIL", ak.name + " | " + cp.name + " | " + (j.message || ""), ""); return { ok: false, perm: true }; }
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

        var name = "券" + new Date().toISOString().substring(11, 19);
        var fid = reqUrl.match(/functionId=(\w+)/);
        if (fid) name = fid[1];

        return { name: name, method: method, url: reqUrl, body: body };
    } catch(e) {
        return { error: "解析失败: " + e.message };
    }
}

// ==================== HTTP 服务 ====================
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    if (p === "/" || p === "/index.html") return sendHTML(res);

    if (p === "/api/state" && req.method === "GET") {
        return sendJSON(res, { accounts: accounts, coupons: coupons, logs: logs.slice(0, 100), grabRunning: grabState.running });
    }

    // 账号
    if (p === "/api/accounts" && req.method === "POST") {
        var b = await parseBody(req);
        accounts.push({ name: b.name || "账号" + (accounts.length + 1), cookie: b.cookie, userAgent: b.userAgent || "", enabled: true });
        save("accounts.json", accounts); addLog("CONFIG", "添加账号: " + (b.name || ""), "");
        return sendJSON(res, { success: true });
    }
    if (p.match(/^\/api\/accounts\/\d+$/) && req.method === "PUT") {
        var i = parseInt(p.split("/").pop()), b = await parseBody(req);
        if (accounts[i]) Object.assign(accounts[i], b);
        save("accounts.json", accounts); return sendJSON(res, { success: true });
    }
    if (p.match(/^\/api\/accounts\/\d+$/) && req.method === "DELETE") {
        accounts.splice(parseInt(p.split("/").pop()), 1); save("accounts.json", accounts); return sendJSON(res, { success: true });
    }

    // 券
    if (p === "/api/coupons" && req.method === "POST") {
        var b = await parseBody(req);
        coupons.push({ name: b.name || "券" + (coupons.length + 1), method: b.method || "POST", url: b.url, body: b.body || "", enabled: true });
        save("coupons.json", coupons); addLog("CONFIG", "添加券: " + (b.name || ""), "");
        return sendJSON(res, { success: true });
    }
    if (p.match(/^\/api\/coupons\/\d+$/) && req.method === "PUT") {
        var i = parseInt(p.split("/").pop()), b = await parseBody(req);
        if (coupons[i]) Object.assign(coupons[i], b);
        save("coupons.json", coupons); return sendJSON(res, { success: true });
    }
    if (p.match(/^\/api\/coupons\/\d+$/) && req.method === "DELETE") {
        coupons.splice(parseInt(p.split("/").pop()), 1); save("coupons.json", coupons); return sendJSON(res, { success: true });
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
        logs = []; save("logs.json", logs); return sendJSON(res, { success: true });
    }

    sendJSON(res, { error: "Not Found" }, 404);
});

server.listen(PORT, function() {
    console.log("============================================");
    console.log("  🎯 京东抢券工具 v2.0");
    console.log("  监听: http://0.0.0.0:" + PORT);
    console.log("============================================");
});
