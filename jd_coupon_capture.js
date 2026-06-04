/*
 * Quantumult X 京东领券请求抓包脚本
 * 
 * 用法：
 * 1. 在 Quantumult X 中启用此脚本的重写规则
 * 2. 手动在京东 App/H5 页面领一次券
 * 3. 脚本会自动记录请求参数到 $prefs
 * 4. 然后用 jd_coupon_grab.js 进行重放抢券
 */

const $tool = tool();
const $prefs = prefs();

// 解析请求
const url = $request.url;
const method = $request.method;
const headers = $request.headers;
const body = $request.body || "";

// 提取关键参数
const urlObj = new URL(url);
const params = {};
for (const [key, value] of urlObj.searchParams.entries()) {
    params[key] = value;
}

// 保存请求数据
const captureData = {
    url: url.split('?')[0],  // 不含 query string 的 base url
    method: method,
    headers: headers,
    body: body,
    queryParams: params,
    fullUrl: url,
    capturedAt: new Date().toISOString(),
    timestamp: Date.now()
};

// 存入 Quantumult X 持久化存储
$prefs.setForKey(JSON.stringify(captureData), "jd_coupon_captured_request");

// 提取并保存 cookie
const cookie = headers["Cookie"] || headers["cookie"] || "";
if (cookie) {
    $prefs.setForKey(cookie, "jd_coupon_cookie");
}

// 提取 h5st 参数（如果有的话）
const h5st = params.h5st || "";
if (h5st) {
    $prefs.setForKey(h5st, "jd_coupon_h5st");
}

// 提取优惠券相关参数
const couponData = {
    couponId: params.couponId || params.couponid || "",
    roleId: params.roleId || params.roleid || "",
    shopId: params.shopId || params.shopid || "",
    skuId: params.skuId || params.skuid || "",
    functionId: params.functionId || "",
};

// 尝试从 body 解析
try {
    const bodyParams = new URLSearchParams(body);
    for (const [key, value] of bodyParams.entries()) {
        if (key.includes('oupon') || key.includes('Id') || key.includes('id')) {
            couponData[key] = value;
        }
    }
} catch (e) {}

// 尝试从 body 解析 JSON
try {
    const bodyJson = JSON.parse(body);
    Object.assign(couponData, bodyJson);
} catch (e) {}

$prefs.setForKey(JSON.stringify(couponData), "jd_coupon_params");

// 通知
$tool.notify(
    "✅ 领券请求已抓取",
    `functionId: ${params.functionId || 'N/A'}`,
    `URL: ${url.substring(0, 80)}...`
);

$done({});
