# 京东领券抓包数据说明

本仓库不保存任何真实抓包数据。Cookie、`pt_key`、`pt_pin`、`h5st`、`x-api-eid-token`、设备标识、地理位置、`encryptedParam` 和完整请求体都属于本地敏感数据。

安全示例：

```text
POST https://api.m.jd.com/client.action?functionId=<FUNCTION_ID>
Content-Type: application/x-www-form-urlencoded
Cookie: <LOCAL_ONLY>

body=<URL_ENCODED_JSON>&h5st=<DYNAMIC_SIGNATURE>
```

请将真实数据放入已被 `.gitignore` 排除的本地配置文件或服务端密钥存储，不要粘贴到源码、Issue、日志或提交记录中。曾经提交过的账号 Cookie 应立即在京东重新登录使其失效，并改写 Git 历史。
