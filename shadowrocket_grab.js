/*
 * Shadowrocket 京东抢券 - 快速重放
 *
 * 配置方式（Shadowrocket）：
 *   1. 设置 → 脚本 → 添加此脚本
 *      类型：cron
 *      时间：手动运行
 *   2. 先用抓包脚本获取请求参数
 *   3. 运行此脚本开始抢券
 */

// ==================== 配置 ====================
var CONFIG = {
    // 并发数（建议 3-5）
    concurrency: 3,
    // 重试轮数
    retryCount: 10,
    // 每轮间隔（毫秒）
    retryDelay: 300,
    // 请求超时（毫秒）
    timeout: 5000,
};

// ==================== 工具 ====================

function httpGet(url, headers) {
    return new Promise(function(resolve) {
        $httpClient.get({ url: url, headers: headers, timeout: CONFIG.timeout }, function(err, resp, data) {
            resolve({ error: err, status: resp ? resp.status : 0, body: data });
        });
    });
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function parseJson(str) {
    try { return JSON.parse(str); } catch(e) { return {}; }
}

function isSuccess(json) {
    if (json.code === 0 || json.code === "0") return true;
    if (json.success === true) return true;
    if (json.ret === 0) return true;
    if (json.data && json.data.receiveResult === 1) return true;
    if (json.data && json.data.couponId) return true;
    return false;
}

function isPermanentFail(json) {
    if (json.code === 1001 || json.code === 1002 || json.code === 2008) return true;
    if (json.message && (json.message.indexOf("已领取") > -1 || json.message.indexOf("已抢完") > -1 || json.message.indexOf("已领完") > -1)) return true;
    return false;
}

// ==================== 主逻辑 ====================

(function main() {
    var cookie = $rocketcache.get("jd_coupon_cookie") || "";
    var rawData = $rocketcache.get("jd_coupon_data") || "";

    if (!cookie || !rawData) {
        $notification.post("❌ 缺少数据", "请先用抓包脚本获取领券请求", "");
        $done({});
        return;
    }

    var data = parseJson(rawData);
    if (!data.allParams) {
        $notification.post("❌ 数据格式错误", "请重新抓包", "");
        $done({});
        return;
    }

    var headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "User-Agent": data.userAgent || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Referer": "https://coupon.jd.com/",
        "Origin": "https://coupon.jd.com",
        "Cookie": cookie
    };

    var baseUrl = data.url.split("?")[0];
    var queryParams = new URLSearchParams();
    for (var k in data.allParams) {
        queryParams.set(k, data.allParams[k]);
    }

    $notification.post(
        "🚀 开始抢券",
        "并发 " + CONFIG.concurrency + ", 重试 " + CONFIG.retryCount + " 轮",
        "接口: " + data.functionId
    );

    var currentRound = 0;
    var successCount = 0;
    var failCount = 0;
    var permanentFail = false;

    function runRound() {
        if (permanentFail || successCount > 0 || currentRound >= CONFIG.retryCount) {
            if (successCount > 0) {
                $notification.post("🎉 抢券成功！", "成功 " + successCount + " 次", "");
            } else if (permanentFail) {
                $notification.post("😢 无法继续", "已被限制或已抢完", "");
            } else {
                $notification.post("😢 未抢到", failCount + " 次均未成功", "");
            }
            $done({});
            return;
        }

        currentRound++;

        var promises = [];
        for (var i = 0; i < CONFIG.concurrency; i++) {
            // 每次并发稍微改一下时间戳
            queryParams.set("t", String(Date.now() + i));
            var fullUrl = baseUrl + "?" + queryParams.toString();
            promises.push(
                httpGet(fullUrl, headers).then(function(resp) {
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
            console.log("Round " + currentRound + ": " + (roundSuccess > 0 ? "✅" : "❌") + " (成功 " + successCount + ", 失败 " + failCount + ")");
            setTimeout(runRound, CONFIG.retryDelay);
        });
    }

    runRound();
})();
