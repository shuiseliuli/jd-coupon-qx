// ============================================================
// 京东抢券 - 快速添加（从剪贴板读取）
// 运行此脚本自动读取剪贴板内容并添加
// ============================================================

var STORE_ACCOUNTS = "jd_accounts";
var STORE_COUPONS = "jd_coupons";

function load(key) {
    var s = $persistentStore.read(key);
    if (!s) return null;
    try { return JSON.parse(s); } catch(e) { return null; }
}
function save(key, data) {
    $persistentStore.write(JSON.stringify(data), key);
}

// 从 $context 获取剪贴板内容
var text = "";

// 尝试从不同来源获取
if (typeof $intent !== "undefined" && $intent.extras && $intent.extras.text) {
    text = $intent.extras.text;
} else if (typeof $context !== "undefined" && $context.text) {
    text = $context.text;
} else if (typeof $input !== "undefined" && $input.text) {
    text = $input.text;
}

if (!text || text.trim().length < 10) {
    $notification.post(
        "📋 快速添加",
        "请先复制内容到剪贴板",
        "支持格式：\n1. Cookie（pt_key=...;pt_pin=...）\n2. cURL 命令\n3. API 链接（https://api.m.jd.com/...）"
    );
    $done({});
}

text = text.trim();
var accounts = load(STORE_ACCOUNTS) || [];
var coupons = load(STORE_COUPONS) || [];
var added = { accounts: 0, coupons: 0 };

// 判断类型
if (text.indexOf("pt_key=") > -1 || text.indexOf("pt_pin=") > -1) {
    // 这是 Cookie
    var name = "账号" + (accounts.length + 1);
    accounts.push({ name: name, cookie: text, ua: "", enabled: true });
    save(STORE_ACCOUNTS, accounts);
    added.accounts = 1;

} else if (text.indexOf("curl") === 0) {
    // cURL 命令 - 解析
    var urlMatch = text.match(/(https?:\/\/[^\s'"]+)/);
    if (urlMatch) {
        var method = text.includes("--data") || text.includes("-d ") ? "POST" : "GET";
        var body = "";
        var bodyMatch = text.match(/--data\s+'([^']+)'/) || text.match(/--data\s+"([^"]+)"/) || text.match(/-d\s+'([^']+)'/);
        if (bodyMatch) body = bodyMatch[1];

        // 提取 cookie
        var cookieMatch = text.match(/-H\s+'Cookie:\s*([^']+)'/) || text.match(/-H\s+"Cookie:\s*([^"]+)"/);
        if (cookieMatch) {
            accounts.push({ name: "账号" + (accounts.length + 1), cookie: cookieMatch[1], ua: "", enabled: true });
            save(STORE_ACCOUNTS, accounts);
            added.accounts = 1;
        }

        var name = "券" + (coupons.length + 1);
        var fid = urlMatch[1].match(/functionId=(\w+)/);
        if (fid) name = fid[1];

        coupons.push({ name: name, method: method, url: urlMatch[1], body: body, enabled: true });
        save(STORE_COUPONS, coupons);
        added.coupons = 1;
    }

} else if (text.indexOf("http") === 0) {
    // URL 链接
    var name = "券" + (coupons.length + 1);
    var fid = text.match(/functionId=(\w+)/);
    if (fid) name = fid[1];

    coupons.push({ name: name, method: "POST", url: text, body: "", enabled: true });
    save(STORE_COUPONS, coupons);
    added.coupons = 1;

} else if (text.indexOf("[") === 0 || text.indexOf("{") === 0) {
    // JSON 格式
    try {
        var data = JSON.parse(text);
        if (Array.isArray(data)) {
            data.forEach(function(item) {
                if (item.cookie) {
                    accounts.push({ name: item.name || "账号" + (accounts.length + 1), cookie: item.cookie, ua: item.ua || "", enabled: true });
                    added.accounts++;
                } else if (item.url) {
                    coupons.push({ name: item.name || "券" + (coupons.length + 1), method: item.method || "POST", url: item.url, body: item.body || "", enabled: true });
                    added.coupons++;
                }
            });
            save(STORE_ACCOUNTS, accounts);
            save(STORE_COUPONS, coupons);
        }
    } catch(e) {}
}

var msg = "";
if (added.accounts) msg += "账号 +" + added.accounts + " ";
if (added.coupons) msg += "券 +" + added.coupons;
if (!msg) msg = "未能识别内容格式";

$notification.post(
    msg ? "✅ 添加成功" : "⚠️ 未添加",
    msg,
    "账号: " + accounts.length + " | 券: " + coupons.length
);
$done({});
