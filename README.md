# Quantumult X 京东抢券脚本

基于请求重放的抢券方案，通过 Quantumult X 抓包 + 重放实现快速领券。

## 文件说明

| 文件 | 用途 |
|------|------|
| `quantumultx_rewrites.conf` | Quantumult X 重写规则配置 |
| `jd_coupon_capture.js` | 抓包脚本 - 捕获领券请求参数 |
| `jd_coupon_grab.js` | 抢券脚本 - 重放单个领券请求 |
| `jd_coupon_center.js` | 券中心脚本 - 批量抢多张券 |
| `h5st_server.js` | 后端签名服务（Node.js） |
| `jd_coupon_grab_with_server.js` | 后端签名版抢券脚本 |

## 快速开始

直接在 Quantumult X 脚本编辑器中粘贴脚本内容即可：

| 脚本 | URL |
|------|-----|
| 抓包脚本 | `https://raw.githubusercontent.com/shuiseliuli/jd-coupon-qx/main/jd_coupon_capture.js` |
| 重放抢券 | `https://raw.githubusercontent.com/shuiseliuli/jd-coupon-qx/main/jd_coupon_grab.js` |
| 批量抢券 | `https://raw.githubusercontent.com/shuiseliuli/jd-coupon-qx/main/jd_coupon_center.js` |

## 使用步骤

### 第一步：导入重写规则

1. 打开 Quantumult X
2. 进入 **设置 → 重写 → 引用**
3. 添加配置文件 URL（或手动添加 rewrite 规则）
   URL: https://raw.githubusercontent.com/shuiseliuli/jd-coupon-qx/main/quantumultx_rewrites.conf
4. 确保 MITM 已启用并信任证书

需要添加的 MITM hostname:
```
hostname = api.m.jd.com, coupon.jd.com, api.jd.com
```

### 第二步：抓包获取请求

1. 在 Quantumult X 中启用 `jd_coupon_capture.js` 的重写规则
2. 打开京东 App 或 H5 页面
3. **手动领取一张券**（随便哪张都行）
4. 脚本会自动弹通知，提示请求已捕获
5. 捕获的数据保存在 Quantumult X 的持久化存储中

### 第三步：抢券

#### 方式 A：单券重放（jd_coupon_grab.js）

适用于已知目标券，快速重放：

1. 在 Quantumult X 脚本编辑器中打开 `jd_coupon_grab.js`
2. 调整 CONFIG 中的参数：
   - `concurrency`: 并发数（默认 3，建议 3-5）
   - `retryCount`: 重试次数（默认 5）
3. 点击运行

#### 方式 B：批量抢券（jd_coupon_center.js）

适用于领券中心多张券同时抢：

1. 编辑 `jd_coupon_center.js` 中的 `COUPON_LIST`
2. 填入要抢的券的 `couponId` 和 `roleId`（从抓包数据中获取）
3. 运行脚本

### 第四步：定时抢券（可选）

如果需要定时抢（比如 10:00 开抢）：

1. 在 `jd_coupon_grab.js` 中设置：
   ```js
   scheduledMode: true,
   targetHour: 10,
   targetMinute: 0,
   targetSecond: 0,
   ```
2. **提前 30 分钟内**完成抓包（h5st 有效期约 30 分钟）
3. 提前运行脚本，它会自动等待到目标时间

## 抓包参数说明

从 Quantumult X 抓包中可以获取以下关键参数：

| 参数 | 说明 | 来源 |
|------|------|------|
| `couponId` | 优惠券ID | URL 参数或 body |
| `roleId` | 角色ID | URL 参数或 body |
| `functionId` | 接口功能名 | URL 参数 |
| `h5st` | 京东签名 | URL 参数 |
| `Cookie` | 登录凭证 | 请求头 |

## 注意事项

1. **h5st 时效性**：京东 h5st 签名约 30 分钟过期，过期后需重新抓包
2. **风控风险**：并发数不要设太高（建议 ≤5），间隔不要太短（建议 ≥100ms）
3. **Cookie 有效性**：Cookie 过期后需重新登录京东
4. **抓包时效**：抢券前确保抓包数据在 30 分钟内

## 进阶：后端签名方案

如果需要突破 h5st 30 分钟时效限制，可以搭建后端服务：

```
手机 (Quantumult X) → 你的服务器 (生成 h5st) → 京东 API
```

后端需要：
- Node.js 18+ 环境
- 运行 `jdh5st` 仓库中的签名算法
- 提供 HTTP API 供 Quantumult X 调用

这种方式可以实现：
- 突破 h5st 时效限制
- 更高的并发和稳定性
- 7x24 小时定时抢券

## 免责声明

本脚本仅供学习研究使用。使用本脚本产生的一切后果由使用者自行承担。
