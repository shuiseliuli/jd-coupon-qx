/*
 * Shadowrocket 京东抢券 - 抓包脚本
 *
 * 配置方式（Shadowrocket）：
 *   1. 设置 → MitM → 开启并安装证书
 *   2. 设置 → 脚本 → 添加此脚本
 *      URL 正则：^https:\/\/api\.m\.jd\.com\/client\.action\?functionId=(collectCoupon|receiveCoupon|getCoupon|newReceiveCoupon)
 *      类型：request-body
 *      脚本：粘贴本文件内容
 *   3. 手动领一次券，脚本自动抓取
 *   4. 抓到后关闭此脚本规则
 *
 * 脚本会自动保存 Cookie、functionId、Body 等参数
 */

const url = $request.url;
const body = $request.body;
const headers = $request.headers;

// 提取关键参数
var params = {};

// 从 URL 提取
var urlObj = url;
var urlParams = urlObj.split("?")[1] || "";
urlParams.split("&").forEach(function(pair) {
    var parts = pair.split("=");
    if (parts.length === 2) {
        params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
    }
});

// 提取 Cookie
var cookie = headers["Cookie"] || headers["cookie"] || "";

// 保存到本地
var capturedData = {
    url: url,
    method: "GET",
    cookie: cookie,
    functionId: params.functionId || "",
    appid: params.appid || "fb5df",
    body: body || "",
    client: params.client || "wh5",
    clientVersion: params.clientVersion || "1.0.0",
    h5st: params.h5st || "",
    userAgent: headers["User-Agent"] || headers["user-agent"] || "",
    allParams: params,
    capturedAt: new Date().toISOString()
};

$rocketcache.set("jd_coupon_cookie", cookie);
$rocketcache.set("jd_coupon_data", JSON.stringify(capturedData));

// 通知
$notification.post(
    "✅ 领券请求已抓取",
    params.functionId || "未知接口",
    "请立即关闭此脚本规则，然后运行抢券脚本"
);

console.log("=== 京东领券请求已抓取 ===");
console.log("接口: " + params.functionId);
console.log("参数: " + JSON.stringify(params, null, 2));

$done({});
