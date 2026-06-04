// ============================================================
// 京东抢券 - 执行脚本
// 在 Shadowrocket 中运行，或设置定时任务自动运行
// ============================================================

var STORE_ACCOUNTS = "jd_accounts";
var STORE_COUPONS = "jd_coupons";
var STORE_CONFIG = "jd_config";
var STORE_LOGS = "jd_logs";
var STORE_STATE = "jd_state";

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

if (!accounts.length) {
    $notification.post("❌ 错误", "没有启用的账号", "请先运行配置脚本添加账号");
    $done({});
}
if (!coupons.length) {
    $notification.post("❌ 错误", "没有启用的券", "请先运行配置脚本添加券");
    $done({});
}

// 标记运行中
save(STORE_STATE, { running: true, startTime: new Date().toISOString() });

addLog("START", "开始抢券", "账号:" + accounts.length + " 券:" + coupons.length + " 并发:" + config.concurrency);

// ==================== HTTP 请求函数 ====================
function makeRequest(coupon, account) {
    return new Promise(function(resolve) {
        var headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "*/*",
            "Accept-Language": "zh-CN,zh-Hans;q=0.9",
            "User-Agent": account.ua || "jdapp;iPhone;15.5.0;;;M/5.0;appBuild/170241",
            "Origin": "https://pro.m.jd.com",
            "Referer": "https://pro.m.jd.com/",
            "Cookie": account.cookie
        };

        var options = {
            url: coupon.url,
            method: coupon.method || "POST",
            headers: headers,
            timeout: 8
        };
        if (coupon.method === "POST" && coupon.body) {
            options.body = coupon.body;
        }

        $httpClient(options, function(error, response, data) {
            if (error) {
                resolve({ success: false, error: error, account: account.name, coupon: coupon.name });
                return;
            }

            var json = {};
            try { json = JSON.parse(data); } catch(e) {}

            var success = false;
            var permanent = false;

            // 判断成功
            if (json.code === 0 || json.code === "0" || json.ret === 0 || json.success === true) success = true;
            if (json.data && (json.data.receiveResult === 1 || json.data.couponId || json.data.result === 1)) success = true;

            // 判断永久失败
            if (json.code === 1001 || json.code === 1002 || json.code === 2008) permanent = true;
            var msg = json.message || "";
            if (msg.indexOf("已领取") > -1 || msg.indexOf("已抢完") > -1 || msg.indexOf("已领完") > -1) permanent = true;

            resolve({
                success: success,
                permanent: permanent,
                message: msg || (json.code ? "code:" + json.code : ""),
                account: account.name,
                coupon: coupon.name,
                data: json.data
            });
        });
    });
}

// ==================== 批量并发执行 ====================
function batchGrab(tasks) {
    return Promise.all(tasks.map(function(task) {
        return makeRequest(task.coupon, task.account);
    }));
}

// ==================== 主逻辑 ====================
var results = { success: 0, fail: 0, total: 0, details: [] };
var concurrency = config.concurrency || 3;
var retryCount = config.retryCount || 10;
var retryDelay = config.retryDelay || 300;

// 构建任务列表
var allTasks = [];
coupons.forEach(function(cp) {
    accounts.forEach(function(ak) {
        allTasks.push({ coupon: cp, account: ak });
    });
});

var round = 0;

function doRound() {
    round++;
    if (round > retryCount) {
        finish("达到最大重试次数");
        return;
    }
    if (!state.running) {
        finish("手动停止");
        return;
    }

    // 取并发数的任务
    var batch = allTasks.slice(0, concurrency);
    results.total += batch.length;

    batchGrab(batch).then(function(roundResults) {
        var roundSuccess = roundResults.filter(function(r) { return r.success; });
        var roundPerm = roundResults.filter(function(r) { return r.permanent; });

        // 记录结果
        roundResults.forEach(function(r) {
            if (r.success) {
                results.success++;
                results.details.push("✅ " + r.account + " | " + r.coupon);
                addLog("SUCCESS", r.account + " | " + r.coupon, r.message);
            } else if (r.permanent) {
                results.details.push("❌ " + r.account + " | " + r.coupon + " | " + r.message);
                addLog("FAIL", r.account + " | " + r.coupon + " | " + r.message, "");
            } else {
                results.fail++;
            }
        });

        if (roundSuccess.length > 0) {
            finish("Round " + round + ": ✅ 成功!");
            return;
        }
        if (roundPerm.length > 0 && roundPerm.length === batch.length) {
            finish("Round " + round + ": 全部永久失败");
            return;
        }

        addLog("ROUND", "Round " + round + "/" + retryCount, "失败，" + retryDelay + "ms后重试");

        // 延迟后下一轮
        setTimeout(function() { doRound(); }, retryDelay);
    });
}

function finish(reason) {
    save(STORE_STATE, { running: false });
    var summary = "成功:" + results.success + " 失败:" + results.fail + " 总请求:" + results.total;
    addLog("END", "抢券结束 | " + reason, summary);

    // 通知
    var detail = results.details.slice(0, 5).join("\n") || "无详细结果";
    $notification.post(
        "🏁 抢券结束",
        reason + "\n" + summary,
        detail
    );
    $done({});
}

// 开始执行
doRound();
