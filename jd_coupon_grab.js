/*
 * 京东抢券 - 精确重放（方案一）
 *
 * 本文件只保留安全模板。请在本地填写抓包数据，禁止把 Cookie、h5st、
 * x-api-eid-token、设备标识或完整请求体提交到 Git。
 */

var CONFIG = {
    url: "https://api.m.jd.com/client.action",
    body: "",
    headers: {
        "Host": "api.m.jd.com",
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://pro.m.jd.com",
        "User-Agent": "",
        "Referer": "",
        "Cookie": ""
    },
    concurrency: 3,
    retryCount: 10,
    retryDelay: 300,
    timeout: 5000
};

if (!CONFIG.body || !CONFIG.headers.Cookie) {
    throw new Error("请仅在本地填写完整请求体和 Cookie，且不要提交到 Git");
}
// ==================== 引擎 ====================

var env = typeof $httpClient !== "undefined" ? "proxy" : "node";
var notify, httpPost;

if (env === "proxy") {
    // Surge / Shadowrocket / Quantumult X 环境
    notify = function(t, s, c) { $notification.post(t, s, c || ""); };
    httpPost = function(url, body, headers) {
        return new Promise(function(resolve) {
            $httpClient.post({ url: url, body: body, headers: headers, timeout: CONFIG.timeout }, function(err, resp, data) {
                resolve({ error: err, status: resp ? resp.status : 0, body: data });
            });
        });
    };
} else {
    // Node.js 环境（测试用）
    notify = function(t, s, c) { console.log(t + " | " + s + " | " + (c || "")); };
    var http = require("http"), https = require("https");
    httpPost = function(url, body, headers) {
        return new Promise(function(resolve) {
            var mod = url.startsWith("https") ? https : http;
            var req = mod.request(url, { method: "POST", headers: headers, timeout: CONFIG.timeout }, function(res) {
                var data = "";
                res.on("data", function(c) { data += c; });
                res.on("end", function() { resolve({ status: res.statusCode, body: data }); });
            });
            req.on("error", function(e) { resolve({ error: e.message }); });
            req.on("timeout", function() { req.destroy(); resolve({ error: "timeout" }); });
            req.write(body);
            req.end();
        });
    };
}

function parseJson(s) { try { return JSON.parse(s); } catch(e) { return {}; } }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function isSuccess(json) {
    if (json.code === 0 || json.code === "0" || json.ret === 0 || json.success === true) return true;
    if (json.data && (json.data.receiveResult === 1 || json.data.couponId)) return true;
    return false;
}

function isPermanentFail(json) {
    if (json.code === 1001 || json.code === 1002 || json.code === 2008) return true;
    var msg = json.message || "";
    if (msg.indexOf("已领取") > -1 || msg.indexOf("已抢完") > -1 || msg.indexOf("已领完") > -1) return true;
    return false;
}

// ==================== 主逻辑 ====================

(function main() {
    var currentRound = 0, successCount = 0, failCount = 0, permanentFail = false;

    notify("🚀 开始抢券",
        CONFIG.concurrency + " 并发 × " + CONFIG.retryCount + " 轮",
        "h5st 有效期约 30 分钟"
    );

    function runRound() {
        if (permanentFail || successCount > 0 || currentRound >= CONFIG.retryCount) {
            if (successCount > 0) {
                notify("🎉 抢券成功！", "成功 " + successCount + " 次", "共执行 " + (successCount + failCount) + " 次");
            } else if (permanentFail) {
                notify("😢 无法继续", "已被限制或券已抢完", "");
            } else {
                notify("😢 未抢到", failCount + " 次均未成功", "");
            }
            if (env === "proxy") $done({});
            return;
        }

        currentRound++;

        var promises = [];
        for (var i = 0; i < CONFIG.concurrency; i++) {
            promises.push(
                httpPost(CONFIG.url, CONFIG.body, CONFIG.headers).then(function(resp) {
                    var json = parseJson(resp.body);
                    if (isSuccess(json)) {
                        successCount++;
                        return { success: true };
                    }
                    if (isPermanentFail(json)) permanentFail = true;
                    failCount++;
                    return { success: false, msg: json.message || "未知" };
                })
            );
        }

        Promise.all(promises).then(function(results) {
            var roundSuccess = results.filter(function(r) { return r.success; }).length;
            console.log("Round " + currentRound + ": " + (roundSuccess > 0 ? "✅ 成功!" : "❌ 失败") + " (累计 成功:" + successCount + " 失败:" + failCount + ")");
            setTimeout(runRound, CONFIG.retryDelay);
        });
    }

    runRound();
})();
