/*
 * Quantumult X 京东领券请求抓包脚本
 *
 * 功能：拦截京东领券请求，保存完整请求参数
 * 用途：手动领一次券 → 自动抓取 → 供重放脚本使用
 *
 * 注意：抓取完成后请关闭 rewrite 规则，避免重复抓取
 */

const $prefs = {
    set: function(key, val) {
        $persistentStore.write(val, key);
    },
    get: function(key) {
        return $persistentStore.read(key);
    }
};

// ==================== 主逻辑 ====================

(function() {
    var url = $request.url;
    var method = $request.method;
    var headers = $request.headers;
    var body = $request.body || "";

    // 解析 URL 参数
    var urlParts = url.split("?");
    var baseUrl = urlParts[0];
    var queryString = urlParts[1] || "";
    var queryParams = {};
    queryString.split("&").forEach(function(pair) {
        if (pair) {
            var kv = pair.split("=");
            queryParams[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
        }
    });

    // 提取关键参数
    var functionId = queryParams["functionId"] || "";
    var h5st = queryParams["h5st"] || "";
    var cookie = headers["Cookie"] || headers["cookie"] || "";

    // 保存完整请求数据
    var captured = {
        url: baseUrl,
        method: method,
        headers: headers,
        body: body,
        queryParams: queryParams,
        fullUrl: url,
        capturedAt: new Date().toISOString(),
        timestamp: Date.now()
    };
    $prefs.set("jd_coupon_captured", JSON.stringify(captured));

    // 单独保存 cookie
    if (cookie) {
        $prefs.set("jd_coupon_cookie", cookie);
    }

    // 单独保存 h5st
    if (h5st) {
        $prefs.set("jd_coupon_h5st", h5st);
    }

    // 提取优惠券信息
    var couponInfo = {
        functionId: functionId,
        h5st: h5st ? h5st.substring(0, 40) + "..." : "",
    };

    // 尝试从 body 提取更多信息
    try {
        var bodyObj = JSON.parse(body);
        couponInfo.couponId = bodyObj.couponId || bodyObj.couponid || "";
        couponInfo.roleId = bodyObj.roleId || bodyObj.roleid || "";
        couponInfo.actId = bodyObj.actId || bodyObj.actid || "";
    } catch(e) {
        // form-encoded body
        body.split("&").forEach(function(pair) {
            var kv = pair.split("=");
            var key = decodeURIComponent(kv[0] || "");
            var val = decodeURIComponent(kv[1] || "");
            if (key.indexOf("oupon") > -1 || key.indexOf("Id") > -1) {
                couponInfo[key] = val;
            }
        });
    }
    $prefs.set("jd_coupon_info", JSON.stringify(couponInfo));

    // 通知
    $notification.post(
        "✅ 领券请求已抓取",
        "functionId: " + functionId,
        "请运行重放脚本进行抢券\n" + (h5st ? "h5st: " + h5st.substring(0, 30) + "..." : "无h5st")
    );

    // 放行原始请求
    $done({});
})();
