/*
 * Quantumult X 京东优惠券中心 - 批量抢券脚本
 *
 * 功能：同时抢多张优惠券
 * 用法：
 *   1. 先用抓包脚本获取 Cookie 和请求模板
 *   2. 在下方 COUPON_LIST 填入要抢的券
 *   3. 运行脚本
 */

// ==================== 配置区 ====================

// 你的京东 Cookie（从抓包数据中复制）
var COOKIE = $persistentStore.read("jd_coupon_cookie") || "";

// 要抢的优惠券列表
var COUPON_LIST = [
    // 填入你要抢的券，格式如下：
    // { name: "描述", couponId: "券ID", roleId: "角色ID", actId: "活动ID" },
    // 示例：
    // { name: "满199减100", couponId: "123456789", roleId: "987654321", actId: "" },
];

// 并发数
var CONCURRENCY = 3;
// 每张券重试次数
var RETRY_COUNT = 15;
// 重试间隔（毫秒）
var RETRY_DELAY = 200;

// ==================== 工具 ====================

function httpGet(url, headers) {
    return new Promise(function(resolve) {
        $httpClient.get({ url: url, headers: headers, timeout: 5000 }, function(err, resp, data) {
            resolve({ error: err, status: resp ? resp.status : 0, body: data });
        });
    });
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ==================== 领券逻辑 ====================

var JD_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Referer": "https://coupon.jd.com/",
    "Origin": "https://coupon.jd.com",
    "Cookie": COOKIE
};

function buildCouponUrl(coupon) {
    var body = {};
    if (coupon.couponId) body.couponId = coupon.couponId;
    if (coupon.roleId) body.roleId = coupon.roleId;
    if (coupon.actId) body.actId = coupon.actId;

    var params = {
        "appid": "h5-coupon",
        "functionId": "collectCoupon",
        "client": "wh5",
        "clientVersion": "1.0.0",
        "t": String(Date.now()),
        "body": JSON.stringify(body)
    };

    var qs = [];
    for (var k in params) {
        qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    }
    return "https://api.m.jd.com/?" + qs.join("&");
}

function checkResult(resp) {
    if (resp.error || resp.status !== 200) return { success: false, permanent: false, msg: resp.error || "HTTP " + resp.status };
    try {
        var json = JSON.parse(resp.body);
        if (json.code === 0 || json.success === true || json.ret === 0) return { success: true, msg: "成功" };
        if (json.data && (json.data.receiveResult === 1 || json.data.couponId)) return { success: true, msg: "成功" };

        // 永久失败
        if (json.code === 1001 || json.code === 1002) return { success: false, permanent: true, msg: "已领取过" };
        if (json.code === 2008) return { success: false, permanent: true, msg: "已抢完" };
        if (json.message && json.message.indexOf("已领取") > -1) return { success: false, permanent: true, msg: json.message };
        if (json.message && json.message.indexOf("已抢完") > -1) return { success: false, permanent: true, msg: json.message };

        return { success: false, permanent: false, msg: json.message || json.errorMessage || "未知" };
    } catch(e) {
        return { success: false, permanent: false, msg: "解析失败" };
    }
}

function grabOne(coupon) {
    var url = buildCouponUrl(coupon);
    var headers = {};
    for (var k in JD_HEADERS) headers[k] = JD_HEADERS[k];
    headers["X-Request-Id"] = uuid();

    var attempt = 0;
    var done = false;

    function tryOnce() {
        if (done || attempt >= RETRY_COUNT) return Promise.resolve({ success: false, name: coupon.name });
        attempt++;

        return httpGet(url, headers).then(function(resp) {
            var result = checkResult(resp);
            console.log("[" + coupon.name + "] #" + attempt + " " + result.msg);

            if (result.success || result.permanent) {
                done = true;
                return { success: result.success, name: coupon.name, msg: result.msg };
            }
            return sleep(RETRY_DELAY).then(tryOnce);
        });
    }

    return tryOnce();
}

// ==================== 主逻辑 ====================

(function main() {
    if (!COOKIE) {
        $notification.post("❌ 缺少 Cookie", "请先用抓包脚本获取京东 Cookie", "");
        $done({});
        return;
    }

    var targets = COUPON_LIST.filter(function(c) { return c.couponId; });
    if (targets.length === 0) {
        $notification.post("⚠️ 无目标券", "请在脚本中配置 COUPON_LIST", "");
        $done({});
        return;
    }

    $notification.post("🎯 批量抢券", targets.length + " 张券, 并发 " + CONCURRENCY, "");

    // 分批并发
    var idx = 0;
    var results = [];

    function runBatch() {
        if (idx >= targets.length) {
            // 全部完成
            var wins = results.filter(function(r) { return r.success; });
            var msg = wins.map(function(r) { return r.name; }).join(", ") || "无";
            $notification.post(
                wins.length > 0 ? "🎉 抢券结果" : "😢 全部失败",
                "成功: " + wins.length + "/" + targets.length,
                "结果: " + msg
            );
            $done({});
            return;
        }

        var batch = targets.slice(idx, idx + CONCURRENCY);
        idx += CONCURRENCY;

        var promises = batch.map(function(coupon) { return grabOne(coupon); });
        Promise.all(promises).then(function(batchResults) {
            results = results.concat(batchResults);
            runBatch();
        });
    }

    runBatch();
})();
