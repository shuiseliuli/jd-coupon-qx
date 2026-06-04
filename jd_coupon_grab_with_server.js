/*
 * Quantumult X 京东抢券脚本（后端签名版）
 * 
 * 与 h5st_server.js 配合使用，实时获取签名
 * 突破 h5st 30 分钟时效限制
 * 
 * 用法：
 * 1. 部署 h5st_server.js 到你的服务器
 * 2. 修改下方 SERVER_URL 为你的服务器地址
 * 3. 运行此脚本
 */

const $tool = tool();
const $prefs = prefs();

// ========== 配置区 ==========
const CONFIG = {
    // 你的签名服务器地址
    SERVER_URL: "http://你的服务器IP:3000",

    // 要抢的券列表
    COUPONS: [
        { name: "满199减100", couponId: "", roleId: "" },
        { name: "满99减50", couponId: "", roleId: "" },
    ],

    // 并发数
    concurrency: 5,
    // 重试次数
    retryCount: 20,
    // 重试间隔（毫秒）
    retryDelay: 100,
};

// ========== 主逻辑 ==========

async function main() {
    const cookie = $prefs.valueForKey("jd_coupon_cookie") || "";
    if (!cookie) {
        $tool.notify("❌ 缺少 Cookie", "请先抓包获取京东 Cookie", "");
        $done({});
        return;
    }

    // 过滤有效券
    const targets = CONFIG.COUPONS.filter(c => c.couponId);
    if (targets.length === 0) {
        $tool.notify("⚠️ 无目标券", "请配置 COUPONS 列表", "");
        $done({});
        return;
    }

    $tool.notify("🚀 后端签名抢券", `${targets.length} 张券, 并发 ${CONFIG.concurrency}`, "");

    // 获取签名
    let signedRequests;
    try {
        signedRequests = await getSignedRequests(targets, cookie);
    } catch (error) {
        $tool.notify("❌ 签名服务异常", String(error), "请检查服务器是否正常运行");
        $done({});
        return;
    }

    // 并发抢券
    let successList = [];
    for (let round = 0; round < CONFIG.retryCount; round++) {
        const promises = signedRequests.map((req, index) =>
            executeRequest(req, index, round)
        );

        const results = await Promise.allSettled(promises);
        for (const result of results) {
            if (result.status === "fulfilled" && result.value.success) {
                successList.push(result.value.name);
            }
        }

        if (successList.length > 0) break;

        // 每隔几轮刷新签名
        if (round > 0 && round % 5 === 0) {
            try {
                signedRequests = await getSignedRequests(targets, cookie);
                console.log(`第 ${round} 轮: 刷新签名成功`);
            } catch (e) {
                console.log(`第 ${round} 轮: 刷新签名失败，继续使用旧签名`);
            }
        }

        if (round < CONFIG.retryCount - 1) {
            await sleep(CONFIG.retryDelay);
        }
    }

    if (successList.length > 0) {
        $tool.notify("🎉 抢券成功！", successList.join(", "), "");
    } else {
        $tool.notify("😢 未抢到", `${CONFIG.retryCount} 轮均未成功`, "可能已抢完或触发风控");
    }

    $done({});
}

// ========== 获取签名 ==========

async function getSignedRequests(coupons, cookie) {
    const response = await request({
        url: `${CONFIG.SERVER_URL}/sign-batch`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupons, cookie }),
        timeout: 10000,
    });

    const data = JSON.parse(response.body);
    if (!data.success) {
        throw new Error(data.error || "签名失败");
    }

    return data.requests.map((req, i) => ({
        ...req,
        headers: data.headers,
        name: coupons[i].name,
    }));
}

// ========== 执行请求 ==========

async function executeRequest(signedReq, index, round) {
    try {
        const response = await request({
            url: signedReq.url,
            method: "GET",
            headers: signedReq.headers,
            timeout: 5000,
        });

        const json = JSON.parse(response.body || "{}");
        const success = json.code === 0 || json.success === true ||
            (json.data && json.data.receiveResult === 1);

        console.log(`[${signedReq.name}] round=${round} index=${index} code=${json.code} success=${success}`);

        return { success, name: signedReq.name };
    } catch (error) {
        console.log(`[${signedReq.name}] error: ${error}`);
        return { success: false, name: signedReq.name };
    }
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

main();
