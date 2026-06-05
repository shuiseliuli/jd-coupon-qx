// ============================================================
// 京东抢券 - 配置管理脚本
// 在 Shadowrocket 中运行此脚本来添加/管理账号和券
// ============================================================

var STORE_ACCOUNTS = "jd_accounts";
var STORE_COUPONS = "jd_coupons";
var STORE_CONFIG = "jd_config";
var STORE_LOGS = "jd_logs";

// 读取存储
function load(key) {
    var s = $persistentStore.read(key);
    if (!s) return null;
    try { return JSON.parse(s); } catch(e) { return null; }
}
function save(key, data) {
    $persistentStore.write(JSON.stringify(data), key);
}

// 获取 URL 参数决定操作
var params = {};
if (typeof $argument !== "undefined" && $argument) {
    $argument.split("&").forEach(function(p) {
        var kv = p.split("=");
        params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
    });
}

var action = params.action || "menu";

// ==================== 主菜单 ====================
if (action === "menu") {
    var accounts = load(STORE_ACCOUNTS) || [];
    var coupons = load(STORE_COUPONS) || [];
    var config = load(STORE_CONFIG) || { concurrency: 3, retryCount: 10, retryDelay: 300 };
    
    $notification.post(
        "🎯 京东抢券配置",
        "账号: " + accounts.length + " | 券: " + coupons.length + " | 并发: " + config.concurrency,
        "添加账号?action=add_acc\n添加券?action=add_cpn\n设置参数?action=settings\n查看日志?action=logs\n清空数据?action=clear"
    );
    $done({});
}

// ==================== 添加账号 ====================
else if (action === "add_acc") {
    // 通过输入框添加
    var name = params.name || "账号" + ((load(STORE_ACCOUNTS) || []).length + 1);
    var cookie = params.cookie;
    var ua = params.ua || "";
    
    if (!cookie) {
        $notification.post("⚠️ 添加账号", "请通过 URL 参数传入 cookie", "示例: action=add_acc&name=主号&cookie=pt_key=xxx;pt_pin=xxx");
        $done({});
        return;
    }
    
    var accounts = load(STORE_ACCOUNTS) || [];
    accounts.push({ name: name, cookie: cookie, ua: ua, enabled: true });
    save(STORE_ACCOUNTS, accounts);
    
    $notification.post("✅ 账号已添加", name, "共 " + accounts.length + " 个账号");
    $done({});
}

// ==================== 添加券 ====================
else if (action === "add_cpn") {
    var name = params.name || "券" + ((load(STORE_COUPONS) || []).length + 1);
    var method = params.method || "POST";
    var reqUrl = params.url;
    var body = params.body || "";
    
    if (!reqUrl) {
        $notification.post("⚠️ 添加券", "请通过 URL 参数传入请求地址", "示例: action=add_cpn&name=满减&method=POST&url=https://api.m.jd.com/...&body=source=...");
        $done({});
        return;
    }
    
    var coupons = load(STORE_COUPONS) || [];
    coupons.push({ name: name, method: method, url: reqUrl, body: body, enabled: true });
    save(STORE_COUPONS, coupons);
    
    $notification.post("✅ 券已添加", name, "共 " + coupons.length + " 张券");
    $done({});
}

// ==================== 从剪贴板添加（批量） ====================
else if (action === "paste_acc") {
    // 格式: 每行一个 cookie，或 JSON 数组
    var text = params.text;
    if (!text) {
        $notification.post("⚠️", "请传入 text 参数（URL 编码的 cookie 文本）", "");
        $done({});
        return;
    }
    
    var accounts = load(STORE_ACCOUNTS) || [];
    var lines = text.split("\n").filter(function(l) { return l.trim(); });
    var count = 0;
    
    lines.forEach(function(line, i) {
        line = line.trim();
        if (line.length > 20) {
            accounts.push({ name: "账号" + (accounts.length + 1), cookie: line, ua: "", enabled: true });
            count++;
        }
    });
    
    save(STORE_ACCOUNTS, accounts);
    $notification.post("✅ 批量添加", "添加了 " + count + " 个账号", "共 " + accounts.length + " 个");
    $done({});
}

else if (action === "paste_cpn") {
    var text = params.text;
    if (!text) {
        $notification.post("⚠️", "请传入 text 参数", "");
        $done({});
        return;
    }
    
    var coupons = load(STORE_COUPONS) || [];
    var lines = text.split("\n").filter(function(l) { return l.trim(); });
    var count = 0;
    
    lines.forEach(function(line) {
        line = line.trim();
        if (line.indexOf("http") === 0 || line.indexOf("curl") === 0) {
            // 解析 URL
            var urlMatch = line.match(/(https?:\/\/[^\s'"]+)/);
            if (urlMatch) {
                var method = line.includes("--data") || line.includes("-d ") ? "POST" : "GET";
                var body = "";
                var bodyMatch = line.match(/--data\s+'([^']+)'/) || line.match(/--data\s+"([^"]+)"/) || line.match(/-d\s+'([^']+)'/);
                if (bodyMatch) body = bodyMatch[1];
                var name = "券" + (coupons.length + 1);
                var fid = urlMatch[1].match(/functionId=(\w+)/);
                if (fid) name = fid[1];
                coupons.push({ name: name, method: method, url: urlMatch[1], body: body, enabled: true });
                count++;
            }
        }
    });
    
    save(STORE_COUPONS, coupons);
    $notification.post("✅ 批量添加", "添加了 " + count + " 张券", "共 " + coupons.length + " 张");
    $done({});
}

// ==================== 设置参数 ====================
else if (action === "settings") {
    var config = load(STORE_CONFIG) || {};
    if (params.concurrency) config.concurrency = parseInt(params.concurrency);
    if (params.retryCount) config.retryCount = parseInt(params.retryCount);
    if (params.retryDelay) config.retryDelay = parseInt(params.retryDelay);
    if (params.scheduleTime) config.scheduleTime = params.scheduleTime;
    save(STORE_CONFIG, config);
    
    $notification.post(
        "⚙️ 参数已更新",
        "并发: " + config.concurrency + " | 重试: " + config.retryCount + " | 间隔: " + config.retryDelay + "ms",
        config.scheduleTime ? "定时: " + config.scheduleTime : "未设定时"
    );
    $done({});
}

// ==================== 查看日志 ====================
else if (action === "logs") {
    var logs = load(STORE_LOGS) || [];
    var recent = logs.slice(0, 10);
    var text = recent.map(function(l) {
        var t = l.time ? l.time.substring(11, 19) : "";
        return "[" + t + "] " + l.type + " " + l.msg;
    }).join("\n") || "暂无日志";
    
    $notification.post("📋 最近日志", "最近 " + recent.length + " 条", text);
    $done({});
}

// ==================== 清空数据 ====================
else if (action === "clear") {
    if (params.target === "all") {
        save(STORE_ACCOUNTS, []);
        save(STORE_COUPONS, []);
        save(STORE_LOGS, []);
        save(STORE_CONFIG, { concurrency: 3, retryCount: 10, retryDelay: 300 });
        $notification.post("🗑️ 已清空", "所有数据已重置", "");
    } else if (params.target === "logs") {
        save(STORE_LOGS, []);
        $notification.post("🗑️ 日志已清空", "", "");
    }
    $done({});
}

// ==================== 查看当前配置 ====================
else if (action === "show") {
    var accounts = load(STORE_ACCOUNTS) || [];
    var coupons = load(STORE_COUPONS) || [];
    var config = load(STORE_CONFIG) || {};
    
    var accList = accounts.map(function(a, i) { return (i+1) + ". " + a.name + (a.enabled ? " ✅" : " ❌"); }).join("\n") || "无";
    var cpnList = coupons.map(function(c, i) { return (i+1) + ". " + c.name + " " + c.method + (c.enabled ? " ✅" : " ❌"); }).join("\n") || "无";
    
    $notification.post(
        "📊 当前配置",
        "账号 (" + accounts.length + "):\n" + accList,
        "券 (" + coupons.length + "):\n" + cpnList + "\n\n并发: " + (config.concurrency || 3) + " 重试: " + (config.retryCount || 10) + " 间隔: " + (config.retryDelay || 300) + "ms"
    );
    $done({});
}

else {
    $done({});
}
