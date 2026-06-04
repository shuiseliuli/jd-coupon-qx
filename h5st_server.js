/*
 * 京东 h5st 签名后端服务
 * 
 * 用法: node h5st_server.js
 * 
 * 依赖:
 *   npm install express crypto-js
 * 
 * 接口:
 *   POST /sign
 *   Body: { "functionId": "collectCoupon", "body": {...}, "cookie": "..." }
 *   Response: { "url": "完整签名后的请求URL", "headers": {...} }
 * 
 * Quantumult X 中调用:
 *   $tool.fetch({ url: "http://你的服务器:3000/sign", method: "POST", body: JSON.stringify(payload) })
 */

const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ========== h5st 签名核心 ==========

function generateUUID() {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
        Math.floor(Math.random() * 16).toString(16)
    );
}

function generateFingerPrint() {
    // 模拟浏览器指纹
    const chars = '0123456789abcdef';
    let fp = '';
    for (let i = 0; i < 32; i++) {
        fp += chars[Math.floor(Math.random() * 16)];
    }
    return fp;
}

function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

function hmacSHA256(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * 生成 h5st 签名
 * 
 * h5st 格式: timestamp;fingerPrint;appId;token;sign;version;timestampMs;envData
 * 
 * 注意: 这是简化版实现。完整的 h5st 需要逆向京东的 js_security_v3 算法。
 * 完整版请参考: https://github.com/dengbaikun/jdh5st
 */
function generateH5st(params, appId = 'wh5') {
    const timestampMs = Date.now();
    const timestamp = new Date(timestampMs)
        .toISOString()
        .replace(/[-:T.Z]/g, '')
        .substring(0, 17) + '88';

    const fingerPrint = generateFingerPrint();
    const token = generateUUID();
    const version = '4.4';

    // 对参数排序并生成签名串
    const sortedKeys = Object.keys(params).sort();
    const signStr = sortedKeys.map(k => `${k}:${params[k]}`).join('&');

    // 简化版签名算法（实际需要逆向 algo 函数）
    const signInput = `${token}${signStr}${token}`;
    const sign = md5(signInput);

    // 环境数据（简化版）
    const envData = Buffer.from(JSON.stringify({
        fp: fingerPrint,
        v: 'h5_file_v4.4.0',
        bu1: '0.1.8',
    })).toString('base64');

    return `${timestamp};${fingerPrint};${appId};${token};${sign};${version};${timestampMs};${envData}`;
}

// ========== API 路由 ==========

/**
 * POST /sign
 * 生成签名并返回完整请求信息
 */
app.post('/sign', (req, res) => {
    try {
        const { functionId, body, cookie, appId = 'wh5', extraParams = {} } = req.body;

        if (!functionId) {
            return res.status(400).json({ error: 'functionId is required' });
        }

        const timestamp = Date.now();
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

        // 构建请求参数
        const params = {
            appid: appId,
            functionId: functionId,
            body: bodyStr,
            t: timestamp.toString(),
            ...extraParams,
        };

        // 生成 h5st
        const h5st = generateH5st(params, appId);

        // 构建完整 URL
        const queryParams = new URLSearchParams({
            ...params,
            h5st: h5st,
            _stk: Object.keys(params).sort().join(','),
            _ste: '1',
        });

        const fullUrl = `https://api.m.jd.com/?${queryParams.toString()}`;

        // 构建请求头
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Referer': 'https://coupon.jd.com/',
            'Origin': 'https://coupon.jd.com',
            'X-Request-Id': generateUUID(),
        };

        if (cookie) {
            headers['Cookie'] = cookie;
        }

        res.json({
            success: true,
            url: fullUrl,
            method: 'GET',
            headers: headers,
            h5st: h5st,
            timestamp: timestamp,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /sign-batch
 * 批量签名多张券
 */
app.post('/sign-batch', (req, res) => {
    try {
        const { coupons, cookie, appId = 'wh5' } = req.body;

        if (!coupons || !Array.isArray(coupons)) {
            return res.status(400).json({ error: 'coupons array is required' });
        }

        const results = coupons.map(coupon => {
            const timestamp = Date.now();
            const body = {
                couponId: coupon.couponId,
                roleId: coupon.roleId || '',
                actId: coupon.actId || '',
            };
            const bodyStr = JSON.stringify(body);

            const params = {
                appid: appId,
                functionId: 'collectCoupon',
                body: bodyStr,
                t: timestamp.toString(),
            };

            const h5st = generateH5st(params, appId);
            const queryParams = new URLSearchParams({ ...params, h5st });
            const fullUrl = `https://api.m.jd.com/?${queryParams.toString()}`;

            return {
                name: coupon.name || coupon.couponId,
                url: fullUrl,
                h5st: h5st,
            };
        });

        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
            'Referer': 'https://coupon.jd.com/',
        };
        if (cookie) headers['Cookie'] = cookie;

        res.json({
            success: true,
            count: results.length,
            requests: results,
            headers: headers,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /health
 * 健康检查
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// ========== 启动服务 ==========

app.listen(PORT, () => {
    console.log(`京东 h5st 签名服务已启动: http://0.0.0.0:${PORT}`);
    console.log(`接口:`);
    console.log(`  POST /sign       - 单个签名`);
    console.log(`  POST /sign-batch - 批量签名`);
    console.log(`  GET  /health     - 健康检查`);
});
