/*
 * Quantumult X 京东抢券 - 重放脚本
 *
 * 功能：基于抓包数据，快速并发重放领券请求
 * 用法：在 QX 脚本编辑器中运行，或添加为定时任务
 *
 * 配置项在下方 CONFIG 对象中调整
 */

// ==================== 配置区 ====================
var CONFIG = {
    // 并发请求数（建议 3-5，太高易风控）
    concurrency: 3,
    // 重试轮数
    retryCount: 10,
    // 每轮间隔（毫秒）
    retryDelay: 300,
    // 请求超时（毫秒）
    timeout: 5000,
    // 是否更新 h5st 时间戳（实验性，不保证有效）
    updateH5stTimestamp: false,
};

// ==================== 存储工具 ====================
var $prefs = {
    set: function(key, val) { $persistentStore.write(val, key); },
    get: function(key) { return $persistentStore.read(key); }
};

// ==================== HTTP 工具 ====================
function httpGet(url, headers) {
    return new Promise(function(resolve) {
        $httpClient.get({ url: url, headers: headers, timeout: CONFIG.timeout }, function(err, resp, data) {
            resolve({ error: err, status: resp ? resp.status : 0, headers: resp ? resp.headers : {}, body: data });
        });
    });
}

function httpPost(url, headers, body) {
    return new Promise(function(resolve) {
        $httpClient.post({ url: url, headers: headers, body: body, timeout: CONFIG.timeout }, function(err, resp, data) {
            resolve({ error: err, status: resp ? resp.status : 0, headers: resp ? resp.headers : {}, body: data });
        });
    });
}

// ==================== 工具函数 ====================
function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function formatTime(date, pattern) {
    var d = date || new Date();
    var p = pattern || "yyyyMMddHHmmssSSS";
    var tokens = {
        "yyyy": d.getFullYear(),
        "MM": ("0" + (d.getMonth() + 1)).slice(-2),
        "dd": ("0" + d.getDate()).slice(-2),
        "HH": ("0" + d.getHours()).slice(-2),
        "mm": ("0" + d.getMinutes()).slice(-2),
        "ss": ("0" + d.getSeconds()).slice(-2),
        "SSS": ("00" + d.getMilliseconds()).slice(-3)
    };
    var result = p;
    for (var key in tokens) {
        result = result.replace(key, tokens[key]);
    }
    return result;
}

// ==================== h5st 更新（实验性）====================

/**
 * 尝试更新 h5st 中的时间戳
 * h5st 格式: datetime;fingerprint;appId;token;sign;version;timestamp;envData
 *
 * 注意：sign 是基于 datetime 计算的，仅更新 datetime 而不重算 sign 会导致签名失效
 * 这里仅做 timestamp 更新，实际效果取决于服务端校验逻辑
 */
function updateH5stTime(h5st) {
    if (!h5st) return h5st;

    var parts = h5st.split(";");
    if (parts.length < 7) return h5st;

    var now = new Date();
    var newDateTime = formatTime(now, "yyyyMMddHHmmssSSS");
    var newTimestamp = now.getTime();

    parts[0] = newDateTime;
    parts[6] = String(newTimestamp);

    return parts.join(";");
}

// ==================== 请求重放 ====================

function replayRequest(captured, roundIndex, reqIndex) {
    var headers = {};
    for (var k in captured.headers) {
        headers[k] = captured.headers[k];
    }

    // 添加随机化（防风控）
    headers["X-Request-Id"] = uuid();

    var url = captured.fullUrl;
    var body = captured.body;

    // 可选：更新 h5st
    if (CONFIG.updateH5stTimestamp && captured.queryParams && captured.queryParams.h5st) {
        var oldH5st = captured.queryParams.h5st;
        var newH5st = updateH5stTime(oldH5st);
        if (newH5st !== oldH5st) {
            url = url.replace("h5st=" + encodeURIComponent(oldH5st), "h5st=" + encodeURIComponent(newH5st));
        }
    }

    var method = (captured.method || "GET").toUpperCase();

    if (method === "POST") {
        return httpPost(url, headers, body);
    } else {
        return httpGet(url, headers);
    }
}

function isSuccess(resp) {
    if (resp.error) return false;
    if (resp.status !== 200) return false;

    try {
        var json = JSON.parse(resp.body);
        // 成功标识
        if (json.code === 0 || json.code === "0") return true;
        if (json.success === true) return true;
        if (json.ret === 0) return true;
        if (json.data && json.data.receiveResult === 1) return true;
        if (json.data && json.data.couponId) return true;
    } catch(e) {}

    return false;
}

function isPermanentFail(resp) {
    try {
        var json = JSON.parse(resp.body);
        // 已领过
        if (json.code === 1001 || json.code === 1002) return true;
        // 已抢完
        if (json.code === 2008) return true;
        if (json.message && json.message.indexOf("已领取") > -1) return true;
        if (json.message && json.message.indexOf("已抢完") > -1) return true;
        if (json.message && json.message.indexOf("已领完") > -1) return true;
        if (json.errorMessage && json.errorMessage.indexOf("风控") > -1) return true;
    } catch(e) {}

    return false;
}

function getRespMsg(resp) {
    try {
        var json = JSON.parse(resp.body);
        return json.message || json.errorMessage || json.msg || ("code=" + json.code);
    } catch(e) {
        return resp.error || ("status=" + resp.status);
    }
}

// ==================== 主逻辑 ====================

(function main() {
    // 读取抓包数据
    var capturedRaw = $prefs.get("jd_coupon_captured");
    if (!capturedRaw) {
        $notification.post("❌ 抢券失败", "未找到抓包数据", "请先运行抓包脚本，手动领一次券");
        $done({});
        return;
    }

    var captured = JSON.parse(capturedRaw);

    // 检查时效（h5st 有效期约 30 分钟）
    var elapsed = Date.now() - captured.timestamp;
    var maxAge = 30 * 60 * 1000;
    if (elapsed > maxAge) {
        var mins = Math.round(elapsed / 60000);
        $notification.post("⚠️ 请求已过期", "抓包于 " + mins + " 分钟前", "h5st 签名已过期，请重新抓包");
        $done({});
        return;
    }

    var remaining = Math.round((maxAge - elapsed) / 60000);
    var couponInfo = $prefs.get("jd_coupon_info") || "{}";
    var info = JSON.parse(couponInfo);

    $notification.post(
        "🚀 开始抢券",
        "并发:" + CONFIG.concurrency + " 轮数:" + CONFIG.retryCount,
        "剩余有效时间: ~" + remaining + "分钟\n" +
        "functionId: " + (info.functionId || "N/A")
    );

    var successCount = 0;
    var failCount = 0;
    var permanentFail = false;
    var currentRound = 0;

    function runRound() {
        if (permanentFail || successCount > 0 || currentRound >= CONFIG.retryCount) {
            // 结束
            if (successCount > 0) {
                $notification.post("🎉 抢券成功！", "成功 " + successCount + " 次", "共执行 " + (successCount + failCount) + " 次请求");
            } else if (permanentFail) {
                $notification.post("😢 无法继续", "已被限制或已抢完", "请重新抓包后重试");
            } else {
                $notification.post("😢 抢券失败", failCount + " 次均未成功", "可能已抢完，请重新抓包后重试");
            }
            $done({});
            return;
        }

        currentRound++;

        // 本轮并发请求
        var promises = [];
        for (var i = 0; i < CONFIG.concurrency; i++) {
            promises.push(replayRequest(captured, currentRound, i));
        }

        Promise.all(promises).then(function(results) {
            for (var j = 0; j < results.length; j++) {
                var resp = results[j];
                if (isSuccess(resp)) {
                    successCount++;
                } else if (isPermanentFail(resp)) {
                    permanentFail = true;
                    failCount++;
                } else {
                    failCount++;
                }
            }

            console.log("Round " + currentRound + ": success=" + successCount + " fail=" + failCount + " permFail=" + permanentFail);

            // 下一轮
            setTimeout(runRound, CONFIG.retryDelay);
        });
    }

    runRound();
})();
