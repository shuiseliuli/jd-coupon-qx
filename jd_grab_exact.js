/*
 * 京东领券 - 精确重放脚本
 *
 * 本文件只保留安全模板。抓包得到的 URL、Body、Cookie、h5st、设备标识
 * 和风控令牌必须保存在本地，禁止提交到 Git。
 */

var CONFIG = {
    concurrency: 3,
    retryCount: 10,
    retryDelay: 300,
    timeout: 5000
};

var REQUEST_DATA = {
    url: "https://api.m.jd.com/client.action",
    headers: {
        "Host": "api.m.jd.com",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "*/*",
        "Origin": "https://pro.m.jd.com",
        "User-Agent": "",
        "Referer": "",
        "Cookie": ""
    },
    body: ""
};

if (!REQUEST_DATA.body || !REQUEST_DATA.headers.Cookie) {
    throw new Error("请仅在本地填写完整请求数据，且不要提交到 Git");
}
// ==================== 引擎 ====================

var env = typeof $httpClient !== "undefined" ? "proxy" : "node";

function notify(title, subtitle, message) {
    if (env === "proxy") {
        $notification.post(title, subtitle || "", message || "");
    } else {
        console.log(title + " | " + (subtitle || "") + " | " + (message || ""));
    }
}

function httpPost(url, body, headers) {
    return new Promise(function(resolve) {
        if (env === "proxy") {
            $httpClient.post({
                url: url,
                body: body,
                headers: headers,
                timeout: CONFIG.timeout
            }, function(err, resp, data) {
                resolve({
                    error: err,
                    status: resp ? resp.status : 0,
                    body: data
                });
            });
        } else {
            var https = require("https");
            var urlObj = new URL(url);
            var options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: "POST",
                headers: headers,
                timeout: CONFIG.timeout
            };
            var req = https.request(options, function(res) {
                var data = "";
                res.on("data", function(chunk) { data += chunk; });
                res.on("end", function() {
                    resolve({ status: res.statusCode, body: data });
                });
            });
            req.on("error", function(e) { resolve({ error: e.message }); });
            req.on("timeout", function() { req.destroy(); resolve({ error: "timeout" }); });
            req.write(body);
            req.end();
        }
    });
}

function parseJson(str) {
    try { return JSON.parse(str); } catch(e) { return {}; }
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ==================== 结果判断 ====================

function isSuccess(json) {
    if (json.code === 0 || json.code === "0") return true;
    if (json.success === true) return true;
    if (json.ret === 0) return true;
    if (json.data) {
        if (json.data.receiveResult === 1) return true;
        if (json.data.couponId) return true;
        if (json.data.result === 1) return true;
    }
    return false;
}

function isPermanentFail(json) {
    if (json.code === 1001 || json.code === 1002 || json.code === 2008) return true;
    if (json.message) {
        if (json.message.indexOf("已领取") > -1) return true;
        if (json.message.indexOf("已抢完") > -1) return true;
        if (json.message.indexOf("已领完") > -1) return true;
        if (json.message.indexOf("未开始") > -1) return true;
    }
    return false;
}

// ==================== 主逻辑 ====================

(function main() {
    var currentRound = 0;
    var successCount = 0;
    var failCount = 0;
    var permanentFail = false;

    notify(
        "🚀 开始抢券",
        CONFIG.concurrency + " 并发 × " + CONFIG.retryCount + " 轮",
        "h5st 有效期约 30 分钟"
    );

    function runRound() {
        if (permanentFail || successCount > 0 || currentRound >= CONFIG.retryCount) {
            // 结束
            if (successCount > 0) {
                notify("🎉 抢券成功！", "成功 " + successCount + " 次", "共执行 " + (successCount + failCount) + " 次");
            } else if (permanentFail) {
                notify("😢 无法继续", "已被限制或券已抢完", "");
            } else {
                notify("😢 未抢到", failCount + " 次均未成功", "可能需要新的 h5st");
            }
            if (env === "proxy") $done({});
            return;
        }

        currentRound++;
        var promises = [];

        for (var i = 0; i < CONFIG.concurrency; i++) {
            promises.push(
                httpPost(REQUEST_DATA.url, REQUEST_DATA.body, REQUEST_DATA.headers)
                    .then(function(resp) {
                        var json = parseJson(resp.body);
                        if (isSuccess(json)) {
                            successCount++;
                            return { success: true };
                        }
                        if (isPermanentFail(json)) {
                            permanentFail = true;
                        }
                        failCount++;
                        return { success: false, msg: json.message || "未知" };
                    })
            );
        }

        Promise.all(promises).then(function(results) {
            var roundSuccess = results.filter(function(r) { return r.success; }).length;
            var msg = "Round " + currentRound + ": " + (roundSuccess > 0 ? "✅ 成功!" : "❌ 失败");
            msg += " (累计 成功:" + successCount + " 失败:" + failCount + ")";
            console.log(msg);

            if (!permanentFail && successCount === 0 && currentRound < CONFIG.retryCount) {
                setTimeout(runRound, CONFIG.retryDelay);
            } else {
                runRound(); // 触发结束
            }
        });
    }

    runRound();
})();
