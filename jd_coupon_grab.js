/*
 * Quantumult X 京东抢券脚本（重放模式）
 * 
 * 工作原理：
 * 1. 读取 jd_coupon_capture.js 抓取到的请求参数
 * 2. 快速并发重放领券请求
 * 3. 成功后通知
 * 
 * 使用方式：
 * - 方式1: Quantumult X 脚本编辑器中手动运行
 * - 方式2: 添加到 task_local 定时运行
 * - 方式3: 通过 Quantumult X 的快捷指令触发
 */

const $tool = tool();
const $prefs = prefs();
const $notify = notify ? notify : (t, s, b) => $tool.notify(t, s, b);

// ========== 配置区 ==========
const CONFIG = {
    // 并发请求数（建议 3-5，太高容易风控）
    concurrency: 3,
    // 重试次数
    retryCount: 5,
    // 重试间隔（毫秒）
    retryDelay: 200,
    // 请求超时（毫秒）
    timeout: 5000,
    // 是否开启定时模式（每天定时抢）
    scheduledMode: false,
    // 目标时间（定时模式用，北京时间）
    targetHour: 10,
    targetMinute: 0,
    targetSecond: 0,
};

// ========== 主逻辑 ==========

async function main() {
    // 读取抓包数据
    const capturedRaw = $prefs.valueForKey("jd_coupon_captured_request");
    if (!capturedRaw) {
        $tool.notify("❌ 抢券失败", "未找到抓包数据", "请先运行抓包脚本，手动领一次券后再试");
        $done({});
        return;
    }

    const captured = JSON.parse(capturedRaw);
    const cookie = $prefs.valueForKey("jd_coupon_cookie") || "";
    const couponParams = JSON.parse($prefs.valueForKey("jd_coupon_params") || "{}");

    // 检查抓包时效（h5st 有效期约 30 分钟）
    const capturedTime = new Date(captured.capturedAt).getTime();
    const elapsed = Date.now() - capturedTime;
    const maxAge = 30 * 60 * 1000; // 30 分钟

    if (elapsed > maxAge) {
        $tool.notify(
            "⚠️ 请求已过期",
            `抓包时间: ${captured.capturedAt}`,
            "h5st 签名已过期（约30分钟），请重新抓包"
        );
        $done({});
        return;
    }

    const remainingMin = Math.round((maxAge - elapsed) / 60000);
    console.log(`请求剩余有效时间: ${remainingMin} 分钟`);
    console.log(`优惠券参数: ${JSON.stringify(couponParams)}`);

    // 如果是定时模式，等待目标时间
    if (CONFIG.scheduledMode) {
        await waitForTargetTime();
    }

    // 开始抢券
    $tool.notify("🚀 开始抢券", `并发数: ${CONFIG.concurrency}, 重试: ${CONFIG.retryCount}次`, "");

    let successCount = 0;
    let failCount = 0;
    let results = [];

    // 并发重放
    for (let batch = 0; batch < CONFIG.retryCount; batch++) {
        const promises = [];
        for (let i = 0; i < CONFIG.concurrency; i++) {
            promises.push(replayRequest(captured, cookie, batch * CONFIG.concurrency + i));
        }

        const batchResults = await Promise.allSettled(promises);
        for (const result of batchResults) {
            if (result.status === "fulfilled" && result.value.success) {
                successCount++;
                results.push(result.value);
            } else {
                failCount++;
            }
        }

        // 如果已经有成功的，可以提前停止（根据需求调整）
        if (successCount > 0) {
            console.log(`第 ${batch + 1} 批抢到，停止重试`);
            break;
        }

        // 批次间等待
        if (batch < CONFIG.retryCount - 1) {
            await sleep(CONFIG.retryDelay);
        }
    }

    // 结果通知
    if (successCount > 0) {
        $tool.notify(
            "🎉 抢券成功！",
            `成功 ${successCount} 次`,
            `优惠券: ${couponParams.couponId || '未知'}\n共执行 ${failCount + successCount} 次请求`
        );
    } else {
        $tool.notify(
            "😢 抢券失败",
            `${failCount} 次请求均未成功`,
            "可能已被抢完或触发风控，建议重新抓包后重试"
        );
    }

    $done({});
}

// ========== 重放请求 ==========

async function replayRequest(captured, cookie, index) {
    const headers = { ...captured.headers };

    // 确保 cookie 存在
    if (cookie && !headers["Cookie"] && !headers["cookie"]) {
        headers["Cookie"] = cookie;
    }

    // 添加随机化头部（防风控）
    headers["X-Request-Id"] = generateUUID();
    headers["X-Timestamp"] = Date.now().toString();

    const options = {
        url: captured.fullUrl,
        method: captured.method,
        headers: headers,
        body: captured.body,
        timeout: CONFIG.timeout,
    };

    try {
        const response = await request(options);
        const statusCode = response.status || response.statusCode;
        let body = response.body;

        // 尝试解析 JSON
        let jsonData = {};
        try {
            jsonData = typeof body === 'string' ? JSON.parse(body) : body;
        } catch (e) {}

        const isSuccess = checkSuccess(jsonData, statusCode);

        console.log(`[${index}] status=${statusCode} success=${isSuccess} body=${JSON.stringify(body).substring(0, 200)}`);

        return {
            success: isSuccess,
            statusCode,
            body: jsonData,
            index,
        };
    } catch (error) {
        console.log(`[${index}] 请求失败: ${error}`);
        return { success: false, error: String(error), index };
    }
}

// ========== 判断成功 ==========

function checkSuccess(json, statusCode) {
    if (statusCode !== 200) return false;

    // 常见的成功标识
    if (json.code === 0 || json.code === "0") return true;
    if (json.success === true) return true;
    if (json.ret === 0) return true;
    if (json.data && json.data.couponId) return true;
    if (json.data && json.data.receiveResult === 1) return true;

    // 常见的失败标识
    if (json.code === 1001 || json.code === 1002) return false; // 已领过
    if (json.code === 2008) return false; // 已抢完
    if (json.message && json.message.includes("已领取")) return false;
    if (json.message && json.message.includes("已抢完")) return false;
    if (json.errorMessage && json.errorMessage.includes("风控")) return false;

    // 不确定的情况，看 statusCode
    return statusCode === 200;
}

// ========== 定时等待 ==========

async function waitForTargetTime() {
    const now = new Date();
    // 转换为北京时间
    const beijingOffset = 8 * 60 * 60 * 1000;
    const beijingNow = new Date(now.getTime() + beijingOffset);
    const beijingHour = beijingNow.getUTCHours();
    const beijingMinute = beijingNow.getUTCMinutes();
    const beijingSecond = beijingNow.getUTCSeconds();

    let targetSeconds = CONFIG.targetHour * 3600 + CONFIG.targetMinute * 60 + CONFIG.targetSecond;
    let currentSeconds = beijingHour * 3600 + beijingMinute * 60 + beijingSecond;
    let waitSeconds = targetSeconds - currentSeconds;

    // 如果目标时间已过，等到明天
    if (waitSeconds <= 0) {
        waitSeconds += 24 * 3600;
    }

    // 提前 1 秒开始
    waitSeconds = Math.max(0, waitSeconds - 1);

    console.log(`等待目标时间 ${CONFIG.targetHour}:${CONFIG.targetMinute}:${CONFIG.targetSecond}，还需等待 ${waitSeconds} 秒`);

    if (waitSeconds > 0) {
        await sleep(waitSeconds * 1000);
    }
}

// ========== 工具函数 ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function request(options) {
    return new Promise((resolve, reject) => {
        $tool.fetch(options).then(response => {
            resolve(response);
        }).catch(error => {
            reject(error);
        });
    });
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ========== 运行 ==========
main();
