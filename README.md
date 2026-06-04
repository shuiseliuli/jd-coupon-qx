# Quantumult X 京东抢券脚本

通过 Quantumult X 抓包 + 重放实现快速抢优惠券。

## 文件说明

| 文件 | 用途 |
|------|------|
| `mitm_rewrite.conf` | QX MITM + 重写规则配置 |
| `jd_coupon_capture.js` | 抓包脚本 - 捕获领券请求 |
| `jd_coupon_grab.js` | 抢券脚本 - 重放单个领券请求 |
| `jd_coupon_center.js` | 券中心 - 批量抢多张券 |

## 使用步骤

### 第一步：配置 MITM

1. Quantumult X → 设置 → Mitm → 添加主机名：
```
api.m.jd.com, coupon.jd.com, api.jd.com
```

2. 设置 → 重写 → 引用，添加规则（或手动添加到 `[rewrite_local]`）：
```
^https:\/\/api\.m\.jd\.com\/client\.action\?functionId=(collectCoupon|receiveCoupon|getCoupon|newReceiveCoupon) url script-request-body jd_coupon_capture.js
^https:\/\/coupon\.jd\.com\/coupon\/couponReceive url script-request-body jd_coupon_capture.js
```

3. 确保 MITM 证书已安装并信任

### 第二步：抓包

1. 确保重写规则已启用
2. 打开京东 App 或 H5 页面
3. **手动领取一张券**（随便哪张）
4. 脚本自动弹通知："✅ 领券请求已抓取"
5. **关闭重写规则**（避免重复抓取）

### 第三步：抢券

**方式 A - 快速重放（推荐）**

1. 在 QX 脚本编辑器中打开 `jd_coupon_grab.js`
2. 调整配置：
   - `concurrency`: 并发数，建议 3-5
   - `retryCount`: 重试轮数，建议 10-20
   - `retryDelay`: 每轮间隔，建议 200-500ms
3. 运行脚本

**方式 B - 批量抢券**

1. 编辑 `jd_coupon_center.js` 中的 `COUPON_LIST`
2. 填入券的 `couponId` 和 `roleId`
3. 运行脚本

### 第四步：定时抢（可选）

如果需要准点抢（比如 10:00 开抢）：
1. **9:50** 左右手动领一张券（抓包）
2. **9:59:50** 运行抢券脚本
3. 脚本会在 h5st 有效期内（~30分钟）持续重放

## 抓包参数说明

| 参数 | 说明 | 获取方式 |
|------|------|---------|
| `couponId` | 优惠券 ID | URL 参数 / body |
| `roleId` | 角色 ID | URL 参数 / body |
| `functionId` | 接口名 | URL 参数 |
| `h5st` | 京东签名 | URL 参数 |
| `Cookie` | 登录凭证 | 请求头 |

## 注意事项

1. **h5st 有效期 ~30 分钟**，过期需重新抓包
2. **并发别太高**，建议 ≤5，太高触发风控
3. **间隔别太短**，建议 ≥200ms
4. **Cookie 过期**需重新登录京东
5. 京东可能更新接口/h5st 算法，脚本可能需要适配

## 参考

- [dengbaikun/jdh5st](https://github.com/dengbaikun/jdh5st) - 京东 h5st 4.4 算法逆向
