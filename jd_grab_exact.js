/*
 * 京东领券 - 精确重放脚本
 * 
 * 基于 QX 抓包数据，直接重放请求
 * h5st 有效期约 30 分钟，抓包后尽快使用
 */

// ==================== 配置 ====================
var CONFIG = {
    // 并发数（建议 3-5）
    concurrency: 3,
    // 重试次数
    retryCount: 10,
    // 间隔毫秒
    retryDelay: 300,
    // 超时
    timeout: 5000
};

// ==================== 请求数据 ====================
// 从 QX 抓包提取的完整请求
var REQUEST_DATA = {
    url: "https://api.m.jd.com/client.action?functionId=getBenefit&appid=coupon-activity&client=wh5&clientVersion=15.5.0&build=170241&uuid=f385b60367e3d959f6dd8f7597968262e77c8be8&openudid=&area=19_1601_3633_63247&d_model=iPhone16%2C2&partner=&geo=%7B%22lng%22%3A%22113.336877%22%2C%22lat%22%3A%2223.135746%22%7D",
    
    headers: {
        "Host": "api.m.jd.com",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Origin": "https://pro.m.jd.com",
        "User-Agent": "jdapp;iPhone;15.5.0;;;M/5.0;appBuild/170241;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22ZtC4DWS2CNC2D2UzZNu1EWY2ZQG4Ztc1EJc5DtqyDtTvDzdtEQTvEK%3D%3D%22%2C%22sv%22%3A%22CJqkCy4n%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1780577645%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;",
        "x-rp-client": "h5_1.0.0",
        "x-referer-page": "https://pro.m.jd.com/mall/active/VAjs3vpayA513UwxL5XC4eGBXqY/index.html",
        "Referer": "https://pro.m.jd.com/mall/active/VAjs3vpayA513UwxL5XC4eGBXqY/index.html?stath=54&navh=44&tttparams=l7Zj98HeyJyZnMiOiIwMDAwIiwicG9zTG5nIjoxMTMuMzM3LCJkbCI6MSwiZF9icmFuZCI6ImFwcGxlIiwidWVtcHMiOiIwLTItMCIsImdMbmciOjExMy4zMzcsImdMYXQiOjIzLjEzNTgxOCwibG5nIjoiMTEzLjMzNjg3NyIsIm9yaWVudCI6InAiLCJvcyI6IjE4LjMuMSIsImxic0xhdCI6IjIzLjEzNTg1MSIsImRMbmciOiIiLCJkTGF0IjoiIiwibGJzTG5nIjoiMTEzLjMzNjk0MyIsInByc3RhdGUiOiIwIiwiZ3BzX2FyZWEiOiIxOV8xNjAxXzM2MzNfNjMyNDciLCJzY2FsZSI6IjMiLCJhZGRyZXNzSWQiOiIxMzgwMjM4NDIiLCJ1bl9hcmVhIjoiMTlfMTYwMV8zNjMzXzYzMjQ3Iiwid2lkdGgiOiIxMjkwIiwibGJzQXJlYSI6IjVfMTQ4XzM0MDQ5XzU1OTY0IiwibGF0IjoiMjMuMTM1NzQ2IiwibW9kZWwiOiJpUGhvbmUxNiwyIiwickxuZyI6IjExMy4zMzciLCJyTGF0IjoiMjMuMTM1ODE4IiwicG9zTGF0IjoyMy4xMzU4MTgsImFyZWFDb2RlIjoiMCIsImNvcm5lciI6MX70%3D&topOfHomePage=1&babelChannel=ttt21&hybrid_err_view=1&clickIndex=0&has_native=0&innerIndex=1&homeNavH=153.00&linkArea=lingquan&linkTabId=ed6ac10204357d124ab6d1daa2cdd5a3&linkTopTab=best&mTabId=2LcucMHYX7aXz92Qh7JBHBo6DACH&embedMTab=1&pullRefresh=1&forceCurrentView=1",
        "request-from": "native",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "x-api-eid-token": "jdd03UKDUPBZ2Q55CCS6Z4U4ROKVGW5MUEXE5A2A3VIHVKIAE5MTOEC3SRWSBTLU3TQE4QQ3VVKSZEXXALJ6MZIEKGM2VIQAAAAM6SKZLJ6AAAAAADMO7JELLLT6MVQX",
        "Cookie": "__jd_ref_cls=Babel_dev_sku_GoodGoods_coupon; sdtoken=AAbEsBpEIOVjqTAKCQtvQu17fkrkl9Oa7NYqc3qIX6ZE0SsenP4tNZ9OCCV04JkpTvRWGhh-L3_vPcnXPz4bgTrswDXBeTHqXn-j7cB1jDMBwjX0ODDa0cr9-BjCoWmOWlH1ODWilbDIQ1JBnwyFN0wuOFVFJY1r; shshshfpa=db089e95-63c2-acb0-dd73-4041ad306572-1773117668; shshshfpb=BApXWaHDOkftA_jCFkYVCBG-6KTYW9tSoBjFQcUdl9xJ1I4oKKN-CxU2-wX6iZ9cgKuUA-Cku26JWSepn7qUK5d15MA3k-j-RSN2leg; 3AB9D23F7A4B3C9B=UKDUPBZ2Q55CCS6Z4U4ROKVGW5MUEXE5A2A3VIHVKIAE5MTOEC3SRWSBTLU3TQE4QQ3VVKSZEXXALJ6MZIEKGM2VIQ; 3AB9D23F7A4B3CSS=jdd03UKDUPBZ2Q55CCS6Z4U4ROKVGW5MUEXE5A2A3VIHVKIAE5MTOEC3SRWSBTLU3TQE4QQ3VVKSZEXXALJ6MZIEKGM2VIQAAAAM6SLDOPKAAAAAAC3GRNJZUF7IMTQX; _gia_d=1; joyytokem=babel_VAjs3vpayA513UwxL5XC4eGBXqYMDFVeWRVajk5MQ==.ZE5cZV9iQV1jU2dBXStaGDIMJgYtThUCFGRVUnlbeUgaZxRkByYUGg0uE2QPYxICISsKEycTAQwvJxcteE8vATMCQBAGBRcTIgQJAB0JbBIfSC1hBR4yKngpLSxWeB0NTw0PUzYeLyA/FFQnPh9nTy4COTAJCmIbADJRMVtgNCVmAXgTSQc1LCgPIQ0rBw==.a1c7b03d; unionwsws=%7B%22devicefinger%22%3A%22eidIab208120d6s3QeHWjIKYQemyDoUFoNNCOkHh2BShce0l4%2BI3MTAJqSlC4gKdDRCZTzQ4J1OHvPg87gRx0aw44Zve3%2F5r8FXBif4YUeYTuCRCl9RX%22%7D; unpl=JF8EAKdnNSttXR5SA0xQHkcQG1tTDgoBGB4AOGUDBApeSFQMGAobExd7XlVdWhRKEx9sYxRUXFNKVA4fASsiE0pdVFxUDkMUB19nAV1ZWU1SNRgDGxISQltcXVk4SBczblcFUltQTFIAHwIbEBJCWFdWWABMEQBfZwNkXVBMZDUrAB0VEUhtVW5cOAB5AiJnA1JVX01RARsCGRAZTl5cW1UPTRQzbWcGUVloSA; b_dh=653; __jda=122270672.17780808167121970252819.1778080816.1780241441.1780577644.39; __jdb=122270672.3.17780808167121970252819|39.1780577644; __jdc=122270672; __jdv=122270672%7Ckong%7Ct_1000170135%7Capns%7C4222_6a16cec5e5b3140171de58ec%40%2654a5d4af2f0c9b99c07e95afa9780742bee93a7127c5ecb697b0096525794188%7C1779880475000; joyya=1780578967.0.40.02x7xbb; mba_muid=1777995595119117647213.400.1780578967429; mba_sid=400.8; pre_seq=1; pre_session=f385b60367e3d959f6dd8f7597968262e77c8be8|1011; shshshfpv=JD0211d47dHE8vzHnHiJ178057896636707-FCuo3yndAN5Jx9Rgkj4L99XParcKJfxnAdSJgskEC-DZAcrp1xVPAdDTaHo_KF8LGsamjHZShFXdnU-5XQ8oCQpYMhvyn2v1E0bxbbwoBwVmylPvWdIpcHaZ9oT5E4L0kc3sg4~BApXWoEjOkftDBSum8SANbes_tPjOUSdYc6U9jMdX9xJ1I4oKKN-CxU2-wX6iZ9cgKuUAosZa16JWSbkwvqwI59kvYQ6z_GbBnA_1jw; warehistory=100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C; TARGET_UNIT=bjcenter; pt_key=app_openAAJqIXVrADDpu5SQqGvRzP3xvh9T9q0G1_6irjNvLHwIpF6K7HdG2GdnghH2CsSizfFDXTcxhtw; pt_pin=61594775-58413908; pwdt_id=61594775-58413908; cid=8; retina=1; wq_addr=138023842|19_1601_3633_63247|||113.337%2C23.135818; webp=1; sid=; qid_evord=5; SameSite=Strict; qid_fs=1778994054704; qid_ls=1778994054704; qid_ts=1778994054707; qid_uid=959ad279-d3fa-417b-95da-10e07147960a; qid_vis=1; shshshfpx=db089e95-63c2-acb0-dd73-4041ad306572-1773117668; b_avif=1; b_dpr=3; b_dw=430; b_webp=1"
    },
    
    body: "source=conpons-volley&platform=conpons-volley&encryptedParam=Slqu7F1nY%2B2wAdiaOMhAvs9kZFQ9ytDdAJtCFH4wYgdFyHbIv5%2FPIv79la8BGj9VbJp3yKRRHkyhlCGrQplmSfC0qqpbHMu79CmTV6jhMos3oq5MqBhwWwWwBp%2BqSYtCstX%2BM838mVM1jkrq4iaJOSmdedOXhls3Og4bMMEIibRT0dCpfYTZAfNZVVG%2BxlSv&key=&roleId=&geo=%7B%22lng%22%3A%22113.336877%22%2C%22lat%22%3A%2223.135746%22%7D&h5st=20260604211618827%3Bbzy55ybb5majiby2%3Ba5290%3Btk03wcdef1cbc18nRHhlefrI7gu7tVYwrGexzktyddB1aP0dfq6M0cH92SC0pD6UqHGgR1ySEfehKEBvHVMtk2lDzQvc%3B906ce166051725573f75aead98e9d3107b07a399811d5b4a65a5edf7344bcc42%3B5.3%3B1780578973827%3Bof7ruCLj5HETCCVT_WITJGUe2HENJipjxjpPFipjLDrg3jod4PYdzPYe7L4e6rJdJbEjLrJp-jZPfWHRf6Xb_mkOJrJdJbYf2iFjLrJp-bojxjJQIeFjLrJp-jpdKSlSIa4eGm1T0bITGmoe1PodJaFf6b1fImFe2TYS6jpjxjpPl61SJW1OJrpjh7Jj4TodFm1f0XYS6TYTyHoS7boSIaVSKeVeIe1THKYf3fIjLDIj4mFO9m1TJrpjh7Jj7jpjxjpe2iFjLrJp-jpe9fIg2T0UG6VRFuWeDipjxjJOJrpjh7JjSmEWmeIeKmnW1ipjxjZQ8aFQKiEjLrJp-jZS9ulRbGFjLDIjFqEjLrJp-3kjLDLjzSHjLDIj4nYOJipjLrpjh75fLDIj6nYOJipjLrpjh7pe6rJdJrYf2iFjLrpjLDrgz3pjxjJf6XETJrpjLrJp-jZb8KEN3f4b7ynZjipjxjZQ8aFQKiEjLrpjLDrg7rJdJLYOJipjLrpjh7pfLDIj0XETJrpjLrJp-rIeLDIj1XETJrpjLrJp-rojxjZe2iFjLrpjLDrg7rJdJbYOJipjLrpjh7Zd2rJdJfYOJipjLrpjh7Jj2zZf9r4UGaUR-ipjxjZf2iFjLrpjLDrg7rJdJ-1OJrpjLrJp-Xojxj5P-ipjLrpjh7pfLDIj-ipjLrpjh7pfLDIjHOEjLrpjLD7NLDIjHyVS3KUSJrpjh7ZMLrJpJLofyfYf3LYe_X4e0bYd2nIeJrJdJnoPJrpjLrJpwqJdJrkPJrpjh7JjTq5Xcq5TK2njG_VR-qZfMe4UznojYunjGy1QDqWRLXmXoq5dGy1QDqWRJrJdJnVO4ipjLD7N%3B554777f0cabaae22a62e009e265bf9e8799fea37d8f48dcba6a6d5bd150ec53c%3Bof7rHGHQ8GlOIyVOF6JQ8G1P5WFW3yVSC61T-bEQGGlQI6ZNHuFT-bVR7qUT&x-api-eid-token=jdd03UKDUPBZ2Q55CCS6Z4U4ROKVGW5MUEXE5A2A3VIHVKIAE5MTOEC3SRWSBTLU3TQE4QQ3VVKSZEXXALJ6MZIEKGM2VIQAAAAM6SKZLJ6AAAAAADMO7JELLLT6MVQX"
};

// ==================== 引擎 ====================

var env = typeof $httpClient !== "undefined" ? "proxy" : "node";

function notify(title, subtitle, message) {
    if (env === "proxy") {
        $notification.post(title, subtitle || "", message || "");
    } else {
        console.log(title + " | " + (subtitle || "") + " | " + (message || ""));
    }
}

function httpPost(url, body, headers) {
    return new Promise(function(resolve) {
        if (env === "proxy") {
            $httpClient.post({
                url: url,
                body: body,
                headers: headers,
                timeout: CONFIG.timeout
            }, function(err, resp, data) {
                resolve({
                    error: err,
                    status: resp ? resp.status : 0,
                    body: data
                });
            });
        } else {
            var https = require("https");
            var urlObj = new URL(url);
            var options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: "POST",
                headers: headers,
                timeout: CONFIG.timeout
            };
            var req = https.request(options, function(res) {
                var data = "";
                res.on("data", function(chunk) { data += chunk; });
                res.on("end", function() {
                    resolve({ status: res.statusCode, body: data });
                });
            });
            req.on("error", function(e) { resolve({ error: e.message }); });
            req.on("timeout", function() { req.destroy(); resolve({ error: "timeout" }); });
            req.write(body);
            req.end();
        }
    });
}

function parseJson(str) {
    try { return JSON.parse(str); } catch(e) { return {}; }
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ==================== 结果判断 ====================

function isSuccess(json) {
    if (json.code === 0 || json.code === "0") return true;
    if (json.success === true) return true;
    if (json.ret === 0) return true;
    if (json.data) {
        if (json.data.receiveResult === 1) return true;
        if (json.data.couponId) return true;
        if (json.data.result === 1) return true;
    }
    return false;
}

function isPermanentFail(json) {
    if (json.code === 1001 || json.code === 1002 || json.code === 2008) return true;
    if (json.message) {
        if (json.message.indexOf("已领取") > -1) return true;
        if (json.message.indexOf("已抢完") > -1) return true;
        if (json.message.indexOf("已领完") > -1) return true;
        if (json.message.indexOf("未开始") > -1) return true;
    }
    return false;
}

// ==================== 主逻辑 ====================

(function main() {
    var currentRound = 0;
    var successCount = 0;
    var failCount = 0;
    var permanentFail = false;

    notify(
        "🚀 开始抢券",
        CONFIG.concurrency + " 并发 × " + CONFIG.retryCount + " 轮",
        "h5st 有效期约 30 分钟"
    );

    function runRound() {
        if (permanentFail || successCount > 0 || currentRound >= CONFIG.retryCount) {
            // 结束
            if (successCount > 0) {
                notify("🎉 抢券成功！", "成功 " + successCount + " 次", "共执行 " + (successCount + failCount) + " 次");
            } else if (permanentFail) {
                notify("😢 无法继续", "已被限制或券已抢完", "");
            } else {
                notify("😢 未抢到", failCount + " 次均未成功", "可能需要新的 h5st");
            }
            if (env === "proxy") $done({});
            return;
        }

        currentRound++;
        var promises = [];

        for (var i = 0; i < CONFIG.concurrency; i++) {
            promises.push(
                httpPost(REQUEST_DATA.url, REQUEST_DATA.body, REQUEST_DATA.headers)
                    .then(function(resp) {
                        var json = parseJson(resp.body);
                        if (isSuccess(json)) {
                            successCount++;
                            return { success: true };
                        }
                        if (isPermanentFail(json)) {
                            permanentFail = true;
                        }
                        failCount++;
                        return { success: false, msg: json.message || "未知" };
                    })
            );
        }

        Promise.all(promises).then(function(results) {
            var roundSuccess = results.filter(function(r) { return r.success; }).length;
            var msg = "Round " + currentRound + ": " + (roundSuccess > 0 ? "✅ 成功!" : "❌ 失败");
            msg += " (累计 成功:" + successCount + " 失败:" + failCount + ")";
            console.log(msg);

            if (!permanentFail && successCount === 0 && currentRound < CONFIG.retryCount) {
                setTimeout(runRound, CONFIG.retryDelay);
            } else {
                runRound(); // 触发结束
            }
        });
    }

    runRound();
})();
