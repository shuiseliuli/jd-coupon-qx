# Quantumult X 京东抢券脚本

通过 Quantumult X 抓包 + 重放实现快速抢优惠券。

## 方案概览

| | 方案一：本地重放 | 方案二：后端签名 |
|---|---|---|
| 原理 | 抓包后直接重放请求 | 后端实时生成 h5st 签名 |
| h5st 时效 | ~30 分钟内有效 | 永不过期 |
| 部署 | 无需部署 | 需要 Node.js 服务器 |
| 难度 | ⭐ 简单 | ⭐⭐ 中等 |
| 推荐 | 临时抢券、测试 | 长期使用、定时抢券 |

## 文件说明

| 文件 | 用途 |
|------|------|
| `mitm_rewrite.conf` | QX MITM + 重写规则配置 |
| `jd_coupon_capture.js` | 抓包脚本 - 捕获领券请求 |
| `jd_coupon_grab.js` | **方案一** - 本地重放抢券 |
| `jd_coupon_center.js` | **方案一** - 批量抢多张券 |
| `jd_coupon_server_mode.js` | **方案二** - 后端签名版抢券 |
| `server/index.js` | **方案二** - h5st 签名后端服务 |

## 使用步骤

### 通用：配置 MITM

1. Quantumult X → 设置 → Mitm → 添加主机名：
   ```
   api.m.jd.com, coupon.jd.com, api.jd.com
   ```
2. 设置 → 重写 → 引用，添加规则：
   ```
   ^https:\/\/api\.m\.jd\.com\/client\.action\?functionId=(collectCoupon|receiveCoupon|getCoupon|newReceiveCoupon) url script-request-body jd_coupon_capture.js
   ^https:\/\/coupon\.jd\.com\/coupon\/couponReceive url script-request-body jd_coupon_capture.js
   ```
3. 确保 MITM 证书已安装并信任

### 通用：抓包

1. 确保重写规则已启用
2. 打开京东 App 或 H5 页面
3. **手动领取一张券**（随便哪张）
4. 脚本自动弹通知："✅ 领券请求已抓取"
5. **关闭重写规则**（避免重复抓取）

---

### 方案一：本地重放（快速上手）

1. 在 QX 脚本编辑器中打开 `jd_coupon_grab.js`
2. 调整配置：
   ```js
   concurrency: 3,    // 并发数，建议 3-5
   retryCount: 10,    // 重试轮数
   retryDelay: 300,   // 每轮间隔 ms
   ```
3. 运行脚本

⚠️ h5st 有效期约 30 分钟，抓包后需在此窗口内使用。

---

### 方案二：后端签名（长期稳定）

#### 1. 部署签名服务

**方式 A：直接运行**
```bash
cd server
npm install
node index.js
```

**方式 B：Docker**
```bash
cd server
docker build -t jd-h5st-server .
docker run -d -p 3000:3000 --name jd-h5st jd-h5st-server
```

**方式 C：设置鉴权（推荐）**
```bash
AUTH_TOKEN=你的密钥 PORT=3000 node index.js
```

#### 2. 测试服务
```bash
curl http://你的服务器:3000/health
```

#### 3. 配置 QX 脚本

编辑 `jd_coupon_server_mode.js`：
```js
var CONFIG = {
    SERVER_URL: "http://你的服务器IP:3000",
    AUTH_TOKEN: "你的密钥",  // 如果设置了的话
    COUPONS: [
        {
            name: "满199减100",
            functionId: "collectCoupon",
            body: { couponId: "从抓包获取", roleId: "从抓包获取" },
            enabled: true
        },
    ],
    // ...
};
```

#### 4. 运行

在 QX 脚本编辑器中运行 `jd_coupon_server_mode.js`。

#### 两种子模式

- **签名+重放模式**（默认）：服务器生成签名，QX 本地重放
- **代理模式**（`useProxy: true`）：服务器签名+代理请求一步到位

---

## 抓包参数说明

| 参数 | 说明 | 获取方式 |
|------|------|---------|
| `couponId` | 优惠券 ID | URL 参数 / body |
| `roleId` | 角色 ID | URL 参数 / body |
| `functionId` | 接口名 | URL 参数 |
| `h5st` | 京东签名 | URL 参数 |
| `Cookie` | 登录凭证 | 请求头 |

## 后端 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/sign` | POST | 单个签名 |
| `/sign-batch` | POST | 批量签名 |
| `/proxy` | POST | 签名 + 代理请求 |
| `/health` | GET | 健康检查 |

## 注意事项

1. **并发别太高**，建议 ≤5，太高触发风控
2. **间隔别太短**，建议 ≥200ms
3. **Cookie 过期**需重新登录京东
4. 京东可能更新接口/h5st 算法，签名服务可能需要适配
5. 建议设置 `AUTH_TOKEN` 防止接口被滥用

## 参考

- [dengbaikun/jdh5st](https://github.com/dengbaikun/jdh5st) - 京东 h5st 4.4 算法逆向
