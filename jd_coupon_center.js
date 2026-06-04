/*
 * Quantumult X 京东优惠券中心抢券脚本
 * 
 * 针对京东领券中心（coupon.jd.com）的批量抢券
 * 
 * 使用方式：
 * 1. 在浏览器打开京东领券中心
 * 2. 用抓包脚本捕获一个领券请求
 * 3. 配置下方 COUPON_LIST 中要抢的券
 * 4. 运行此脚本
 */

const $tool = tool();
const $prefs = prefs();

// ========== 配置区 ==========
const CONFIG = {
    // 要抢的优惠券列表（从抓包中获取）
    COUPON_LIST: [
        {
            name: "满199减100",
            couponId: "",     // 从抓包获取
            roleId: "",       // 从抓包获取
            actId: "",        // 活动ID
            enabled: true,
        },
        {
            name: "满99减50",
            couponId: "",
            roleId: "",
            actId: "",
            enabled: true,
        },
    ],

    // 并发数
    concurrency: 3,
    // 每张券重试次数
    retryCount: 10,
    // 重试间隔（毫秒）
    retryDelay: 100,
    // 提前开始时间（毫秒），抢券开始前提前多少毫秒开始请求
    preStartMs: 500,
};

// ========== 京东领券 API ==========

const API = {
    // 领券中心接口
    couponCenter: "https://api.m.jd.com/client.action",
    // H5 领券接口
    h5Coupon: "https://coupon.jd.com/coupon/couponReceive",
};

// ========== 主逻辑 ==========

async function main() {
    // 读取基础 cookie
    const cookie = $prefs.valueForKey("jd_coupon_cookie") || "";
    if (!cookie) {
        $tool.notify("❌ 缺少 Cookie", "请先用抓包脚本获取京东 Cookie", "");
        $done({});
        return;
    }

    // 读取抓包数据作为基础请求模板
    const capturedRaw = $prefs.valueForKey("jd_coupon_captured_request");
    let captured = null;
    try {
        captured = JSON.parse(capturedRaw);
    } catch (e) {}

    // 过滤启用的券
    const targetCoupons = CONFIG.COUPON_LIST.filter(c => c.enabled && c.couponId);
    if (targetCoupons.length === 0) {
        $tool.notify("⚠️ 无目标券", "请在脚本中配置 COUPON_LIST", "或先用抓包脚本抓取领券请求");
        $done({});
        return;
    }

    $tool.notify(
        "🎯 开始抢券中心",
        `目标: ${targetCoupons.length} 张券`,
        targetCoupons.map(c => c.name).join(", ")
    );

    // 对每张券并发抢
    const allPromises = targetCoupons.map(coupon => grabCoupon(coupon, cookie, captured));
    const results = await Promise.allSettled(allPromises);

    // 汇总结果
    let successList = [];
    let failList = [];
    results.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value.success) {
            successList.push(targetCoupons[index].name);
        } else {
            failList.push(targetCoupons[index].name);
        }
    });

    if (successList.length > 0) {
        $tool.notify("🎉 领券成功！", successList.join(", "), "");
    }
    if (failList.length > 0) {
        console.log(`未抢到: ${failList.join(", ")}`);
    }

    $done({});
}

// ========== 抢单张券 ==========

async function grabCoupon(coupon, cookie, captured) {
    for (let i = 0; i < CONFIG.retryCount; i++) {
        try {
            const result = await makeCouponRequest(coupon, cookie, captured);
            if (result.success) {
                console.log(`[${coupon.name}] 第 ${i + 1} 次成功!`);
                return { success: true, coupon: coupon.name };
            }

            // 如果是已领过/已抢完，不继续重试
            if (result.permanentFail) {
                console.log(`[${coupon.name}] 永久失败: ${result.message}`);
                return { success: false, coupon: coupon.name, reason: result.message };
            }

            console.log(`[${coupon.name}] 第 ${i + 1} 次失败: ${result.message}`);
        } catch (error) {
            console.log(`[${coupon.name}] 第 ${i + 1} 次异常: ${error}`);
        }

        // 重试间隔
        if (i < CONFIG.retryCount - 1) {
            await sleep(CONFIG.retryDelay + Math.random() * 100);
        }
    }

    return { success: false, coupon: coupon.name };
}

// ========== 构建领券请求 ==========

async function makeCouponRequest(coupon, cookie, captured) {
    // 方式1: 如果有抓包模板，基于模板重放
    if (captured && captured.fullUrl) {
        return replayFromCapture(coupon, cookie, captured);
    }

    // 方式2: 构建标准领券请求
    return buildStandardRequest(coupon, cookie);
}

async function replayFromCapture(coupon, cookie, captured) {
    const url = new URL(captured.fullUrl);

    // 替换优惠券参数
    if (coupon.couponId) url.searchParams.set("couponId", coupon.couponId);
    if (coupon.roleId) url.searchParams.set("roleId", coupon.roleId);
    if (coupon.actId) url.searchParams.set("actId", coupon.actId);

    // 更新时间戳
    url.searchParams.set("t", Date.now().toString());

    const headers = { ...captured.headers };
    if (cookie) headers["Cookie"] = cookie;
    headers["X-Request-Id"] = generateUUID();

    const response = await request({
        url: url.toString(),
        method: captured.method || "GET",
        headers: headers,
        body: captured.body,
        timeout: 5000,
    });

    return parseResponse(response);
}

async function buildStandardRequest(coupon, cookie) {
    const body = {
        couponId: coupon.couponId,
        roleId: coupon.roleId,
        actId: coupon.actId || "",
    };

    const url = `${API.couponCenter}?functionId=collectCoupon&appid=h5-coupon&t=${Date.now()}&body=${encodeURIComponent(JSON.stringify(body))}`;

    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://coupon.jd.com/",
        "Origin": "https://coupon.jd.com",
        "X-Request-Id": generateUUID(),
    };

    const response = await request({
        url: url,
        method: "GET",
        headers: headers,
        timeout: 5000,
    });

    return parseResponse(response);
}

// ========== 解析响应 ==========

function parseResponse(response) {
    const statusCode = response.status || response.statusCode;
    let json = {};
    try {
        json = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    } catch (e) {}

    if (statusCode !== 200) {
        return { success: false, permanentFail: false, message: `HTTP ${statusCode}` };
    }

    // 成功
    if (json.code === 0 || json.success === true || json.ret === 0) {
        return { success: true, message: "成功" };
    }
    if (json.data && (json.data.receiveResult === 1 || json.data.couponId)) {
        return { success: true, message: "成功" };
    }

    // 永久失败（不重试）
    if (json.code === 1001 || json.code === 1002) {
        return { success: false, permanentFail: true, message: "已领取过" };
    }
    if (json.code === 2008) {
        return { success: false, permanentFail: true, message: "已抢完" };
    }
    if (json.message && (json.message.includes("已领取") || json.message.includes("已抢完"))) {
        return { success: false, permanentFail: true, message: json.message };
    }

    // 临时失败（可重试）
    return { success: false, permanentFail: false, message: json.message || json.errorMessage || "未知错误" };
}

// ========== 工具函数 ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function request(options) {
    return new Promise((resolve, reject) => {
        $tool.fetch(options).then(resolve).catch(reject);
    });
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ========== 运行 ==========
main();
