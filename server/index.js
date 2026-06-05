/*
 * 京东 h5st 4.4 签名后端服务
 *
 * 基于 dengbaikun/jdh5st 逆向算法
 * 为 Quantumult X 提供实时签名
 *
 * 用法:
 *   cd server && npm install && node index.js
 *
 * 环境变量:
 *   PORT          - 监听端口（默认 3000）
 *   AUTH_TOKEN    - API 鉴权 token（可选，建议设置）
 */

const express = require("express");
const CryptoJS = require("crypto-js");
const md5 = require("md5");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

// ==================== h5st 4.4 签名核心 ====================

const AES_IV = "0102030405060708";
const AES_KEY = "r1T.6Vinpb.k+/a)";
const H5ST_VERSION = "4.4";
const FILE_VERSION = "h5_file_v4.4.0";
const SECURITY_JS_VERSION = "0.1.8";

// 默认 appId，可通过请求覆盖
const DEFAULT_APP_ID = "fb5df";

// 生成随机字符串
function randomStr(len, type) {
    var chars;
    switch (type) {
        case "alphabet":
            chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
            break;
        case "max":
            chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-";
            break;
        default:
            chars = "0123456789";
    }
    var result = "";
    for (var i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

// 生成 fingerprint（基于逆向算法简化版）
function genFingerPrint() {
    var base = "0123456789abcdefghijklmnopqrstuvwxyz";
    var fp = "";
    for (var i = 0; i < 16; i++) {
        fp += base[Math.floor(Math.random() * base.length)];
    }
    return fp;
}

// AES-CBC 加密环境数据
function encryptEnv(fingerPrint) {
    var envData = {
        sua: "iPhone; CPU iPhone OS 17_0 like Mac OS X",
        pp: { p2: "jd_4536d74677e8d" },
        extend: {
            wd: 0, l: 0, ls: 5, wk: 0,
            bu1: "0.1.9", bu2: -1, bu3: 91, bu4: 0, bu5: 0
        },
        random: randomStr(11, "max"),
        v: FILE_VERSION,
        fp: fingerPrint,
        bu1: SECURITY_JS_VERSION
    };

    var key = CryptoJS.enc.Utf8.parse(AES_KEY);
    var iv = CryptoJS.enc.Utf8.parse(AES_IV);
    var data = CryptoJS.enc.Utf8.parse(JSON.stringify(envData, null, 2));
    var encrypted = CryptoJS.AES.encrypt(data, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    return encrypted.ciphertext.toString();
}

// SHA256
function sha256(text) {
    return CryptoJS.SHA256(text).toString();
}

// 生成签名 key
// 注意：这里的 algo 函数是基于逆向分析的已知模式
// 实际 JD 可能会更新，如果签名失败需要更新这个函数
function genKey(token, fingerPrint, datetime, appId, algoSalt) {
    var str = token + fingerPrint + datetime + appId + (algoSalt || "9oHcP9otd77c");
    return sha256(str);
}

// 生成 sign
function genSign(key, sortedParams) {
    var data = sortedParams.map(function(item) {
        return item.key + ":" + item.value;
    }).join("&");
    return md5(key + data + key);
}

// 格式化时间（北京时间）
function formatDateTime(timestamp) {
    var d = new Date(timestamp);
    // 转北京时间 UTC+8
    var utc = d.getTime() + d.getTimezoneOffset() * 60000;
    var bj = new Date(utc + 8 * 3600000);

    var yyyy = bj.getFullYear();
    var MM = ("0" + (bj.getMonth() + 1)).slice(-2);
    var dd = ("0" + bj.getDate()).slice(-2);
    var HH = ("0" + bj.getHours()).slice(-2);
    var mm = ("0" + bj.getMinutes()).slice(-2);
    var ss = ("0" + bj.getSeconds()).slice(-2);
    var SSS = ("00" + bj.getMilliseconds()).slice(-3);

    return "" + yyyy + MM + dd + HH + mm + ss + SSS;
}

/**
 * 生成 h5st 签名
 *
 * @param {Object} params - 请求参数（不含 h5st）
 * @param {Object} opts - 选项
 * @param {string} opts.token - 从 JD 获取的 token
 * @param {string} opts.fingerPrint - 指纹
 * @param {string} opts.appId - 应用 ID
 * @param {string} opts.algoSalt - algo 盐值（可选）
 * @returns {Object} { h5st, datetime, timestamp }
 */
function generateH5st(params, opts) {
    var token = opts.token;
    var fingerPrint = opts.fingerPrint || genFingerPrint();
    var appId = opts.appId || DEFAULT_APP_ID;
    var algoSalt = opts.algoSalt || "9oHcP9otd77c";

    var timestamp = Date.now();
    var datetime = formatDateTime(timestamp);
    var u = datetime + "88";

    // 对 body 做 SHA256
    var paramsCopy = {};
    for (var k in params) {
        paramsCopy[k] = params[k];
    }
    if (paramsCopy.body) {
        paramsCopy.body = sha256(paramsCopy.body);
    }

    // 排序参数
    var sortedKeys = Object.keys(paramsCopy).sort();
    var sortedParams = sortedKeys.map(function(key) {
        return { key: key, value: String(paramsCopy[key]) };
    });

    // 生成签名
    var envData = encryptEnv(fingerPrint);
    var key = genKey(token, fingerPrint, u, appId, algoSalt);
    var sign = genSign(key, sortedParams);

    var h5st = [
        datetime, fingerPrint, appId, token,
        sign, H5ST_VERSION, timestamp, envData
    ].join(";");

    return {
        h5st: h5st,
        datetime: datetime,
        timestamp: timestamp,
        fingerPrint: fingerPrint
    };
}

// ==================== Token 管理 ====================

// token 缓存（每个 cookie 对应一个 token）
var tokenCache = {};

/**
 * 从 JD 获取 token 和 algo 信息
 * 需要有效的 JD cookie
 */
async function fetchTokenAndAlgo(cookie, referer) {
    var url = "https://cactus.jd.com/request_algo?g_ty=ajax";
    var headers = {
        "authority": "cactus.jd.com",
        "accept": "application/json",
        "accept-language": "zh-CN,zh;q=0.9",
        "content-type": "application/json",
        "origin": "https://item.jd.com",
        "referer": referer || "https://item.jd.com/",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "cookie": cookie
    };

    var body = JSON.stringify({
        version: "4.4",
        fp: genFingerPrint(),
        appId: DEFAULT_APP_ID,
        timestamp: Date.now(),
        platform: "web",
        expandParams: ""
    });

    try {
        var resp = await fetch(url, {
            method: "POST",
            headers: headers,
            body: body
        });
        var json = await resp.json();

        if (json.data && json.data.result) {
            return {
                token: json.data.result.tk,
                algo: json.data.result.algo,
                fingerprint: json.data.result.fp || genFingerPrint(),
                fetchedAt: Date.now()
            };
        }
        throw new Error("Invalid response: " + JSON.stringify(json));
    } catch (e) {
        throw new Error("fetchTokenAndAlgo failed: " + e.message);
    }
}

// ==================== Express 路由 ====================

// 鉴权中间件
function authMiddleware(req, res, next) {
    if (!AUTH_TOKEN) return next();

    var token = req.headers["authorization"] || req.query.token || "";
    token = token.replace("Bearer ", "");
    if (token !== AUTH_TOKEN) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}

app.use(authMiddleware);

/**
 * POST /sign
 * 生成 h5st 签名
 *
 * Body:
 * {
 *   "cookie": "JD cookie string",
 *   "functionId": "collectCoupon",
 *   "body": { "couponId": "xxx", "roleId": "yyy" },
 *   "appid": "fb5df",          // 可选
 *   "referer": "https://...",  // 可选
 *   "token": "...",            // 可选，不传则自动获取
 *   "fingerprint": "..."       // 可选
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "h5st": "...",
 *   "url": "完整请求 URL",
 *   "headers": { ... },
 *   "expiresIn": 1800000
 * }
 */
app.post("/sign", async (req, res) => {
    try {
        var { cookie, functionId, body, appid, referer, token, fingerprint } = req.body;

        if (!functionId) {
            return res.status(400).json({ error: "functionId is required" });
        }

        var appId = appid || DEFAULT_APP_ID;
        var bodyStr = typeof body === "string" ? body : JSON.stringify(body || {});

        // 获取或使用提供的 token
        var h5stOpts = { appId: appId };

        if (token) {
            h5stOpts.token = token;
            h5stOpts.fingerPrint = fingerprint || genFingerPrint();
        } else if (cookie) {
            // 从缓存获取 token
            var cacheKey = cookie.substring(0, 50);
            var cached = tokenCache[cacheKey];
            if (!cached || Date.now() - cached.fetchedAt > 30 * 60 * 1000) {
                try {
                    cached = await fetchTokenAndAlgo(cookie, referer);
                    tokenCache[cacheKey] = cached;
                } catch (e) {
                    return res.status(500).json({ error: "Failed to fetch token: " + e.message });
                }
            }
            h5stOpts.token = cached.token;
            h5stOpts.fingerPrint = cached.fingerprint || fingerprint || genFingerPrint();
        } else {
            return res.status(400).json({ error: "cookie or token is required" });
        }

        // 构建请求参数
        var timestamp = Date.now();
        var params = {
            appid: appId,
            functionId: functionId,
            client: "wh5",
            clientVersion: "1.0.0",
            t: String(timestamp),
            body: bodyStr
        };

        // 生成 h5st
        var result = generateH5st(params, h5stOpts);

        // 构建完整 URL
        var queryParams = new URLSearchParams();
        for (var k in params) {
            queryParams.set(k, params[k]);
        }
        queryParams.set("h5st", result.h5st);
        queryParams.set("_stk", Object.keys(params).sort().join(","));
        queryParams.set("_ste", "1");

        var fullUrl = "https://api.m.jd.com/?" + queryParams.toString();

        // 构建请求头
        var headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            "Referer": referer || "https://coupon.jd.com/",
            "Origin": "https://coupon.jd.com",
            "X-Request-Id": crypto.randomUUID()
        };
        if (cookie) headers["Cookie"] = cookie;

        res.json({
            success: true,
            h5st: result.h5st,
            url: fullUrl,
            method: "GET",
            headers: headers,
            expiresIn: 30 * 60 * 1000,
            timestamp: result.timestamp
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /sign-batch
 * 批量签名（同时签多张券）
 *
 * Body:
 * {
 *   "cookie": "...",
 *   "coupons": [
 *     { "name": "满199减100", "couponId": "xxx", "roleId": "yyy" },
 *     ...
 *   ]
 * }
 */
app.post("/sign-batch", async (req, res) => {
    try {
        var { cookie, coupons, appid, referer } = req.body;

        if (!coupons || !Array.isArray(coupons) || coupons.length === 0) {
            return res.status(400).json({ error: "coupons array is required" });
        }

        var appId = appid || DEFAULT_APP_ID;

        // 获取 token
        var cacheKey = cookie ? cookie.substring(0, 50) : "no-cookie";
        var cached = tokenCache[cacheKey];
        if (!cookie && !req.body.token) {
            return res.status(400).json({ error: "cookie or token is required" });
        }

        if (req.body.token) {
            cached = { token: req.body.token, fingerprint: req.body.fingerprint || genFingerPrint() };
        } else if (!cached || Date.now() - cached.fetchedAt > 30 * 60 * 1000) {
            try {
                cached = await fetchTokenAndAlgo(cookie, referer);
                tokenCache[cacheKey] = cached;
            } catch (e) {
                return res.status(500).json({ error: "Failed to fetch token: " + e.message });
            }
        }

        var h5stOpts = {
            token: cached.token,
            fingerPrint: cached.fingerprint,
            appId: appId
        };

        // 批量签名
        var results = coupons.map(function(coupon) {
            var body = {};
            if (coupon.couponId) body.couponId = coupon.couponId;
            if (coupon.roleId) body.roleId = coupon.roleId;
            if (coupon.actId) body.actId = coupon.actId;

            var timestamp = Date.now();
            var params = {
                appid: appId,
                functionId: "collectCoupon",
                client: "wh5",
                clientVersion: "1.0.0",
                t: String(timestamp),
                body: JSON.stringify(body)
            };

            var signResult = generateH5st(params, h5stOpts);

            var queryParams = new URLSearchParams();
            for (var k in params) queryParams.set(k, params[k]);
            queryParams.set("h5st", signResult.h5st);
            queryParams.set("_stk", Object.keys(params).sort().join(","));
            queryParams.set("_ste", "1");

            return {
                name: coupon.name || coupon.couponId,
                url: "https://api.m.jd.com/?" + queryParams.toString(),
                h5st: signResult.h5st,
                timestamp: signResult.timestamp
            };
        });

        var headers = {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            "Referer": referer || "https://coupon.jd.com/",
            "Origin": "https://coupon.jd.com"
        };
        if (cookie) headers["Cookie"] = cookie;

        res.json({
            success: true,
            count: results.length,
            requests: results,
            headers: headers,
            expiresIn: 30 * 60 * 1000
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /proxy
 * 代理请求：签名 + 发送 + 返回结果
 * QX 脚本只需调这一个接口
 *
 * Body:
 * {
 *   "cookie": "...",
 *   "functionId": "collectCoupon",
 *   "body": { "couponId": "xxx" },
 *   "referer": "https://..."
 * }
 */
app.post("/proxy", async (req, res) => {
    try {
        var { cookie, functionId, body, referer } = req.body;

        if (!functionId || !cookie) {
            return res.status(400).json({ error: "functionId and cookie are required" });
        }

        // 获取 token
        var cacheKey = cookie.substring(0, 50);
        var cached = tokenCache[cacheKey];
        if (!cached || Date.now() - cached.fetchedAt > 30 * 60 * 1000) {
            cached = await fetchTokenAndAlgo(cookie, referer);
            tokenCache[cacheKey] = cached;
        }

        var bodyStr = typeof body === "string" ? body : JSON.stringify(body || {});
        var timestamp = Date.now();

        var params = {
            appid: DEFAULT_APP_ID,
            functionId: functionId,
            client: "wh5",
            clientVersion: "1.0.0",
            t: String(timestamp),
            body: bodyStr
        };

        var signResult = generateH5st(params, {
            token: cached.token,
            fingerPrint: cached.fingerprint,
            appId: DEFAULT_APP_ID
        });

        var queryParams = new URLSearchParams();
        for (var k in params) queryParams.set(k, params[k]);
        queryParams.set("h5st", signResult.h5st);

        var url = "https://api.m.jd.com/?" + queryParams.toString();

        var headers = {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            "Referer": referer || "https://coupon.jd.com/",
            "Origin": "https://coupon.jd.com",
            "Cookie": cookie,
            "X-Request-Id": crypto.randomUUID()
        };

        // 代理请求到 JD
        var jdResp = await fetch(url, { method: "GET", headers: headers });
        var jdData = await jdResp.text();

        var json = {};
        try { json = JSON.parse(jdData); } catch(e) {}

        res.json({
            success: json.code === 0 || json.success === true,
            status: jdResp.status,
            data: json,
            h5st: signResult.h5st,
            timestamp: signResult.timestamp
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /health
 */
app.get("/health", function(req, res) {
    res.json({ status: "ok", version: H5ST_VERSION, uptime: process.uptime() });
});

// ==================== 启动 ====================

app.listen(PORT, function() {
    console.log("============================================");
    console.log("  京东 h5st " + H5ST_VERSION + " 签名服务");
    console.log("  监听: http://0.0.0.0:" + PORT);
    console.log("  鉴权: " + (AUTH_TOKEN ? "已启用" : "未启用"));
    console.log("============================================");
    console.log("");
    console.log("接口:");
    console.log("  POST /sign       - 单个签名");
    console.log("  POST /sign-batch - 批量签名");
    console.log("  POST /proxy      - 签名+代理请求");
    console.log("  GET  /health     - 健康检查");
    console.log("");
});
