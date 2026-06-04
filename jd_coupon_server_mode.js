/*
 * Quantumult X 京东抢券 - 后端签名版（方案二）
 *
 * 配合后端签名服务使用，突破 h5st 30 分钟时效限制
 *
 * 用法：
 *   1. 部署 server/index.js 到你的服务器
 *   2. 修改下方 SERVER_URL 为你的服务器地址
 *   3. 确保已用抓包脚本获取 Cookie（jd_coupon_capture.js）
 *   4. 在 QX 脚本编辑器中运行此脚本
 */

// ==================== 配置区 ====================
var CONFIG = {
    // 你的签名服务器地址（必填）
    SERVER_URL: "http://你的服务器IP:3000",

    // API 鉴权 token（如果服务器设置了 AUTH_TOKEN）
    AUTH_TOKEN: "",

    // 要抢的券列表
    // functionId + body 的组合，从抓包数据中获取
    COUPONS: [
        {
            name: "示例券",
            functionId: "collectCoupon",
            body: { couponId: "", roleId: "" },
            enabled: true
        },
    ],

    // 并发数
    concurrency: 3,
    // 重试轮数
    retryCount: 20,
    // 每轮间隔（毫秒）
    retryDelay: 200,
    // 请求超时（毫秒）
    timeout: 5000,
    // 是否使用代理模式（/proxy 接口，签名+请求一步到位）
    useProxy: false,
};

// ==================== 工具 ====================

function httpPost(url, body, headers) {
    return new Promise(function(resolve) {
        var opts = {
            url: url,
            method: "POST",
            headers: headers || { "Content-Type": "application/json" },
            body: typeof body === "string" ? body : JSON.stringify(body),
            timeout: CONFIG.timeout
        };
        $httpClient.post(opts, function(err, resp, data) {
            resolve({
                error: err,
                status: resp ? resp.status : 0,
                body: data
            });
        });
    });
}

function httpGet(url, headers) {
    return new Promise(function(resolve) {
        $httpClient.get({ url: url, headers: headers, timeout: CONFIG.timeout }, function(err, resp, data) {
            resolve({ error: err, status: resp ? resp.status : 0, body: data });
        });
    });
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function parseJson(str) {
    try { return JSON.parse(str); } catch(e) { return {}; }
}

// ==================== 签名服务调用 ====================

function getSignedRequest(coupon, cookie) {
    var url = CONFIG.SERVER_URL + "/sign";
    var headers = {
        "Content-Type": "application/json"
    };
    if (CONFIG.AUTH_TOKEN) {
        headers["Authorization"] = "Bearer " + CONFIG.AUTH_TOKEN;
    }

    var body = {
        cookie: cookie,
        functionId: coupon.functionId,
        body: coupon.body,
        referer: "https://coupon.jd.com/"
    };

    return httpPost(url, body, headers).then(function(resp) {
        var json = parseJson(resp.body);
        if (json.error) throw new Error(json.error);
        return json;
    });
}

function getBatchSignedRequests(coupons, cookie) {
    var url = CONFIG.SERVER_URL + "/sign-batch";
    var headers = {
        "Content-Type": "application/json"
    };
    if (CONFIG.AUTH_TOKEN) {
        headers["Authorization"] = "Bearer " + CONFIG.AUTH_TOKEN;
    }

    var body = {
        cookie: cookie,
        coupons: coupons.map(function(c) {
            return { name: c.name, couponId: c.body.couponId, roleId: c.body.roleId };
        }),
        referer: "https://coupon.jd.com/"
    };

    return httpPost(url, body, headers).then(function(resp) {
        var json = parseJson(resp.body);
        if (json.error) throw new Error(json.error);
        return json;
    });
}

function proxyRequest(coupon, cookie) {
    var url = CONFIG.SERVER_URL + "/proxy";
    var headers = {
        "Content-Type": "application/json"
    };
    if (CONFIG.AUTH_TOKEN) {
        headers["Authorization"] = "Bearer " + CONFIG.AUTH_TOKEN;
    }

    var body = {
        cookie: cookie,
        functionId: coupon.functionId,
        body: coupon.body,
        referer: "https://coupon.jd.com/"
    };

    return httpPost(url, body, headers).then(function(resp) {
        return parseJson(resp.body);
    });
}

// ==================== 结果判断 ====================

function isSuccess(json) {
    if (json.code === 0 || json.code === "0") return true;
    if (json.success === true) return true;
    if (json.ret === 0) return true;
    if (json.data && json.data.receiveResult === 1) return true;
    if (json.data && json.data.couponId) return true;
    return false;
}

function isPermanentFail(json) {
    if (json.code === 1001 || json.code === 1002) return true;
    if (json.code === 2008) return true;
    if (json.message && json.message.indexOf("已领取") > -1) return true;
    if (json.message && json.message.indexOf("已抢完") > -1) return true;
    if (json.message && json.message.indexOf("已领完") > -1) return true;
    return false;
}

// ==================== 主逻辑 ====================

(function main() {
    // 读取 Cookie
    var cookie = $persistentStore.read("jd_coupon_cookie") || "";
    if (!cookie) {
        $notification.post("❌ 缺少 Cookie", "请先用抓包脚本获取京东 Cookie", "");
        $done({});
        return;
    }

    // 过滤启用的券
    var targets = CONFIG.COUPONS.filter(function(c) { return c.enabled && c.body && c.body.couponId; });
    if (targets.length === 0) {
        $notification.post("⚠️ 无目标券", "请在脚本中配置 COUPONS", "");
        $done({});
        return;
    }

    // 检查服务器地址
    if (CONFIG.SERVER_URL.indexOf("你的服务器") > -1) {
        $notification.post("❌ 未配置服务器", "请修改 SERVER_URL", "");
        $done({});
        return;
    }

    $notification.post(
        "🚀 方案二：后端签名抢券",
        targets.length + " 张券, 并发 " + CONFIG.concurrency,
        "服务器: " + CONFIG.SERVER_URL
    );

    // 代理模式
    if (CONFIG.useProxy) {
        runProxyMode(targets, cookie);
    } else {
        // 签名+重放模式
        runSignMode(targets, cookie);
    }
})();

// ==================== 签名+重放模式 ====================

function runSignMode(targets, cookie) {
    var currentRound = 0;
    var successCount = 0;
    var failCount = 0;
    var permanentFail = false;
    var signedRequests = null;

    function refreshSigns() {
        return getBatchSignedRequests(targets, cookie).then(function(result) {
            signedRequests = result;
            console.log("签名刷新成功, " + result.count + " 个");
        }).catch(function(e) {
            console.log("签名刷新失败: " + e.message);
        });
    }

    function runRound() {
        if (permanentFail || successCount > 0 || currentRound >= CONFIG.retryCount) {
            finish();
            return;
        }

        currentRound++;

        // 每 5 轮刷新签名
        if (!signedRequests || currentRound % 5 === 1) {
            refreshSigns().then(function() { executeRound(); });
        } else {
            executeRound();
        }
    }

    function executeRound() {
        if (!signedRequests || !signedRequests.requests) {
            console.log("无可用签名，跳过");
            setTimeout(runRound, CONFIG.retryDelay);
            return;
        }

        var promises = signedRequests.requests.slice(0, CONFIG.concurrency).map(function(req) {
            return httpGet(req.url, signedRequests.headers).then(function(resp) {
                var json = parseJson(resp.body);
                if (isSuccess(json)) {
                    successCount++;
                    return { success: true, name: req.name };
                }
                if (isPermanentFail(json)) {
                    permanentFail = true;
                    failCount++;
                    return { success: false, name: req.name, msg: json.message };
                }
                failCount++;
                return { success: false, name: req.name, msg: json.message || "未知" };
            });
        });

        Promise.all(promises).then(function(results) {
            results.forEach(function(r) {
                console.log("Round " + currentRound + " [" + r.name + "] " + (r.success ? "✅" : "❌ " + (r.msg || "")));
            });
            setTimeout(runRound, CONFIG.retryDelay);
        });
    }

    function finish() {
        if (successCount > 0) {
            $notification.post("🎉 抢券成功！", "成功 " + successCount + " 次", "共执行 " + (successCount + failCount) + " 次");
        } else if (permanentFail) {
            $notification.post("😢 无法继续", "已被限制或已抢完", "");
        } else {
            $notification.post("😢 未抢到", failCount + " 次均未成功", "");
        }
        $done({});
    }

    runRound();
}

// ==================== 代理模式 ====================

function runProxyMode(targets, cookie) {
    var currentRound = 0;
    var successCount = 0;
    var failCount = 0;
    var permanentFail = false;

    function runRound() {
        if (permanentFail || successCount > 0 || currentRound >= CONFIG.retryCount) {
            if (successCount > 0) {
                $notification.post("🎉 抢券成功！", "成功 " + successCount + " 次", "");
            } else {
                $notification.post("😢 未抢到", failCount + " 次均未成功", "");
            }
            $done({});
            return;
        }

        currentRound++;

        var promises = targets.map(function(coupon) {
            return proxyRequest(coupon, cookie).then(function(result) {
                if (result.success) {
                    successCount++;
                    return { success: true, name: coupon.name };
                }
                if (result.data && isPermanentFail(result.data)) {
                    permanentFail = true;
                }
                failCount++;
                return { success: false, name: coupon.name, data: result.data };
            }).catch(function(e) {
                failCount++;
                return { success: false, name: coupon.name, error: e.message };
            });
        });

        Promise.all(promises).then(function(results) {
            results.forEach(function(r) {
                console.log("Round " + currentRound + " [" + r.name + "] " + (r.success ? "✅" : "❌"));
            });
            setTimeout(runRound, CONFIG.retryDelay);
        });
    }

    runRound();
}
