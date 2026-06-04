// ============================================================
// 京东抢券 - Shadowrocket 抢券脚本（h5st签名版）
// 流程：手机 → 服务器签名 → 手机发请求 → JD
// ============================================================

var STORE_ACCOUNTS = "jd_accounts";
var STORE_COUPONS = "jd_coupons";
var STORE_CONFIG = "jd_config";
var STORE_LOGS = "jd_logs";
var STORE_STATE = "jd_state";

// ⚠️ 改成你的服务器地址
var SERVER_URL = "http://116.205.237.143:3000";
var SERVER_TOKEN = "jd-grab-2024";

function load(key) {
    var s = $persistentStore.read(key);
    if (!s) return null;
    try { return JSON.parse(s); } catch(e) { return null; }
}
function save(key, data) {
    $persistentStore.write(JSON.stringify(data), key);
}

function addLog(type, msg, detail) {
    var logs = load(STORE_LOGS) || [];
    logs.unshift({ time: new Date().toISOString(), type: type, msg: msg, detail: detail || "" });
    if (logs.length > 200) logs = logs.slice(0, 200);
    save(STORE_LOGS, logs);
    console.log("[" + type + "] " + msg);
}

// 检查是否已在运行
var state = load(STORE_STATE) || { running: false };
if (state.running) {
    $notification.post("⚠️", "抢券任务已在运行中", "");
    $done({});
}

// 读取配置
var accounts = (load(STORE_ACCOUNTS) || []).filter(function(a) { return a.enabled && a.cookie; });
var coupons = (load(STORE_COUPONS) || []).filter(function(c) { return c.enabled && c.url; });
var config = load(STORE_CONFIG) || { concurrency: 3, retryCount: 10, retryDelay: 300 };

if (!accounts.length) { $notification.post("❌", "没有启用的账号", "请先运行配置脚本添加"); $done({}); }
if (!coupons.length) { $notification.post("❌", "没有启用的券", "请先运行配置脚本添加"); $done({}); }

// 标记运行中
save(STORE_STATE, { running: true, startTime: new Date().toISOString() });
addLog("START", "开始抢券(h5st)", "账号:" + accounts.length + " 券:" + coupons.length);

// ==================== 请求 h5st 签名 ====================
function getH5st(params, cookie) {
    return new Promise(function(resolve) {
        $httpClient({
            url: SERVER_URL + "/api/sign",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + SERVER_TOKEN
            },
            body: JSON.stringify({
                token: getTokenFromCache(cookie),
                params: params
            }),
            timeout: 5
        }, function(error, response, data) {
            if (error) { resolve({ error: error }); return; }
            try {
                var json = JSON.parse(data);
                resolve(json);
            } catch(e) {
                resolve({ error: "签名服务响应异常" });
            }
        });
    });
}

// ==================== 获取 Token ====================
var tokenCache = {};

function getTokenFromCache(cookie) {
    return tokenCache[cookie] || null;
}

function fetchToken(cookie, ua) {
    return new Promise(function(resolve) {
        $httpClient({
            url: SERVER_URL + "/api/token",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cookie: cookie, ua: ua }),
            timeout: 10
        }, function(error, response, data) {
            if (error) { resolve({ error: error }); return; }
            try {
                var json = JSON.parse(data);
                if (json.token) {
                    tokenCache[cookie] = json.token;
                    resolve({ token: json.token });
                } else {
                    resolve({ error: json.error || "获取token失败" });
                }
            } catch(e) {
                resolve({ error: "解析异常" });
            }
        });
    });
}

// ==================== 发送抢券请求 ====================
function sendRequest(coupon, account, h5st, timestamp) {
    return new Promise(function(resolve) {
        // 拼接 h5st 到 URL
        var reqUrl = coupon.url;
        if (reqUrl.indexOf("?") === -1) reqUrl += "?";
        else reqUrl += "&";
        reqUrl += "h5st=" + h5st + "&t=" + timestamp;

        var headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "*/*",
            "Accept-Language": "zh-CN,zh-Hans;q=0.9",
            "User-Agent": account.ua || "jdapp;iPhone;15.5.0;;;M/5.0;appBuild/170241",
            "Origin": "https://pro.m.jd.com",
            "Referer": "https://pro.m.jd.com/",
            "Cookie": account.cookie
        };

        var options = { url: reqUrl, method: coupon.method || "POST", headers: headers, timeout: 8 };
        if (coupon.method === "POST" && coupon.body) options.body = coupon.body;

        $httpClient(options, function(error, response, data) {
            if (error) { resolve({ success: false, error: error }); return; }
            var json = {};
            try { json = JSON.parse(data); } catch(e) {}

            var success = false, permanent = false;
            if (json.code === 0 || json.code === "0" || json.ret === 0 || json.success === true) success = true;
            if (json.data && (json.data.receiveResult === 1 || json.data.couponId || json.data.result === 1)) success = true;
            if (json.code === 1001 || json.code === 1002 || json.code === 2008) permanent = true;
            var msg = json.message || "";
            if (msg.indexOf("已领取") > -1 || msg.indexOf("已抢完") > -1 || msg.indexOf("已领完") > -1) permanent = true;

            resolve({ success: success, permanent: permanent, message: msg, account: account.name, coupon: coupon.name });
        });
    });
}

// ==================== 单次抢券（签名+请求）====================
async function grabOnce(coupon, account) {
    // 1. 获取 token（如果没有缓存）
    if (!tokenCache[account.cookie]) {
        var tr = await fetchToken(account.cookie, account.ua);
        if (tr.error) {
            addLog("TOKEN", account.name + " token获取失败", tr.error);
            return { success: false, permanent: false, message: "token获取失败" };
        }
    }

    // 2. 构建签名参数
    var timestamp = Date.now();
    var params = {
        appid: coupon.appid || "coupon-activity",
        functionId: coupon.functionId || "getBenefit",
        client: "wh5",
        clientVersion: "1.0.0",
        t: timestamp,
        body: coupon.body || "{}"
    };

    // 3. 请求服务器签名
    var signResult = await getH5st(params, account.cookie);
    if (signResult.error) {
        addLog("SIGN", account.name + " | " + coupon.name + " | 签名失败", signResult.error);
        return { success: false, permanent: false, message: "签名失败" };
    }

    // 4. 发送请求
    return await sendRequest(coupon, account, signResult.h5st, timestamp);
}

// ==================== 主逻辑 ====================
var results = { success: 0, fail: 0, total: 0, details: [] };
var concurrency = config.concurrency || 3;
var retryCount = config.retryCount || 10;
var retryDelay = config.retryDelay || 300;

var allTasks = [];
coupons.forEach(function(cp) {
    accounts.forEach(function(ak) {
        allTasks.push({ coupon: cp, account: ak });
    });
});

var round = 0;

function doRound() {
    round++;
    if (round > retryCount) { finish("达到最大重试次数"); return; }

    var st = load(STORE_STATE);
    if (!st || !st.running) { finish("手动停止"); return; }

    var batch = allTasks.slice(0, concurrency);
    results.total += batch.length;

    var promises = batch.map(function(task) {
        return grabOnce(task.coupon, task.account);
    });

    Promise.all(promises).then(function(roundResults) {
        var anySuccess = roundResults.some(function(r) { return r.success; });
        var allPerm = roundResults.every(function(r) { return r.permanent; });

        roundResults.forEach(function(r) {
            if (r.success) {
                results.success++;
                results.details.push("✅ " + r.account + " | " + r.coupon);
                addLog("SUCCESS", r.account + " | " + r.coupon, r.message);
            } else if (r.permanent) {
                results.details.push("❌ " + r.account + " | " + r.coupon + " | " + r.message);
                addLog("FAIL", r.account + " | " + r.coupon, r.message);
            } else {
                results.fail++;
            }
        });

        if (anySuccess) { finish("Round " + round + ": ✅ 成功!"); return; }
        if (allPerm) { finish("Round " + round + ": 全部永久失败"); return; }

        addLog("ROUND", "Round " + round + "/" + retryCount, "失败，" + retryDelay + "ms后重试");
        setTimeout(doRound, retryDelay);
    });
}

function finish(reason) {
    save(STORE_STATE, { running: false });
    var summary = "成功:" + results.success + " 失败:" + results.fail + " 总请求:" + results.total;
    addLog("END", "抢券结束 | " + reason, summary);
    var detail = results.details.slice(0, 5).join("\n") || "无详细结果";
    $notification.post("🏁 抢券结束", reason + "\n" + summary, detail);
    $done({});
}

doRound();
