package com.srctv.app

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import com.srctv.app.BuildConfig
import androidx.appcompat.app.AppCompatActivity

/**
 * SrcTV 安卓壳：用 WebView 加载已部署的 Web 站点（Cloudflare Workers 无法在安卓内运行，
 * 因此 APK 只做「浏览器壳」，逻辑与数据全在服务端）。
 *
 * 工程含两个 product flavor（见 app/build.gradle 的 form 维度）：
 * - mobile：手机版，包名 com.srctv.app，桌面 LAUNCHER 启动；
 * - tv：电视版，包名 com.srctv.apptv，TV 主屏 LEANBACK_LAUNCHER 启动，并额外注入
 *   遥控器方向键 → 网页焦点移动的适配（injectTvNav）。
 * 两个 flavor 共用本 WebView 壳代码与自动登录/导入逻辑，无需另起工程。
 *
 * 自动处理两件事（无需打开浏览器、无需手动操作）：
 * 1. 免输密码：在下方 APP_PASSWORD 填入你部署时设置的访问密码，App 打开即自动登录；
 *    若留空，用户首次手动输入一次后会被记住（存到 App 私有 SharedPreferences），以后免输。
 * 2. 自动导入源：APK 内置 assets/LibreTV-SourceList.json，登录后由注入脚本自包含地完成
 *    解析与客户端入库（POST /api/source-list + 写 zustand 持久化键），不依赖 Web 端构建。
 *
 * 改动部署地址：修改下方的 START_URL 常量即可。
 */
class MainActivity : AppCompatActivity() {

    companion object {
        // 改成你部署后的地址（Cloudflare Workers 域名或自定义域名）
        private const val START_URL = "https://srctv.xyza.workers.dev"

        /**
         * 部署时设置的访问密码。填了之后 App 打开自动登录，永不再弹密码框。
         * 留空（""）则首次手动输入一次后自动记住，以后免输。
         */
        private const val APP_PASSWORD = ""

        // APK 内置的默认源列表（assets 目录下）
        private const val SOURCE_LIST_ASSET = "LibreTV-SourceList.json"
    }

    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        setupWebView()

        // 返回键：优先退出 WebView 历史 / 退出全屏播放，再退出 App
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (customView != null) {
                        webView.webChromeClient?.onHideCustomView()
                        return
                    }
                    if (webView.canGoBack()) webView.goBack() else finish()
                }
            }
        )

        webView.loadUrl(START_URL)
        // 电视版：让 WebView 立即获焦，遥控器按键才会进入网页；手机版无副作用
        webView.requestFocus(View.FOCUS_DOWN)
    }

    private fun setupWebView() {
        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = false
        // 允许混合内容（部分直播/源为 http，避免被 WebView 拦截）
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.mediaPlaybackRequiresUserGesture = false // 允许视频自动播放
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.setSupportZoom(false)
        // TV 版需要 WebView 自身能获焦，遥控器方向键才会以「键盘方向键」形式派发给网页
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true

        // 接受 Cookie（登录态跨请求保持），含第三方 Cookie
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        // 暴露 JS 桥：自动登录 + 自动导入源
        webView.addJavascriptInterface(
            SrcTvBridge(applicationContext, APP_PASSWORD, SOURCE_LIST_ASSET),
            "SrctvBridge"
        )

        webView.webViewClient =
            object : WebViewClient() {
                // 站内 / 站外链接都在同一 WebView 内打开
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean = false

                // 页面加载完成后注入自动登录 / 自动导入逻辑
                override fun onPageFinished(view: WebView?, url: String?) {
                    autoSetup()
                    // 电视版：注入遥控器方向键 → 网页焦点移动的适配（仅 tv flavor 生效）
                    if (BuildConfig.FLAVOR == "tv") {
                        injectTvNav()
                    }
                }
            }

        webView.webChromeClient =
            object : WebChromeClient() {
                // 视频全屏播放（播放器内点全屏时回调）
                override fun onShowCustomView(
                    view: View?,
                    callback: WebChromeClient.CustomViewCallback?
                ) {
                    if (customView != null) {
                        callback?.onCustomViewHidden()
                        return
                    }
                    customView = view
                    customViewCallback = callback
                    val root = findViewById<ViewGroup>(R.id.fullscreen_container)
                    root.visibility = View.VISIBLE
                    root.addView(view)
                }

                override fun onHideCustomView() {
                    val root = findViewById<ViewGroup>(R.id.fullscreen_container)
                    root.removeAllViews()
                    root.visibility = View.GONE
                    customView = null
                    customViewCallback?.onCustomViewHidden()
                    customViewCallback = null
                }
            }
    }

    /**
     * 注入一段 JS，完全自包含、不依赖 Web 端任何改动（线上是旧构建也能用）：
     * 1. 若已配置/记住密码，周期性 POST /api/auth 保证登录态（cookie）就绪；
     *    若未配置密码，记住用户手输的密码（下次免输）；
     * 2. 把 APK 内置的源列表文本 POST 给服务端解析（与「设置里手动文件导入」同一管线），
     *    再把解析结果直接合并写进 zustand 持久化键 libretv-settings（点播→customAPIs/
     *    selectedKeys，直播→liveSubscriptions/liveSelectedUrls），按 URL 去重；
     * 3. 写完后刷新页面，让 App 从 localStorage 重新 hydrate，界面即出现源。
     * 自带「已导入」标记 + 迁移清理（清掉旧版错误标记），幂等、不重复。最多轮询约 3 分钟。
     */
    private fun autoSetup() {
        val js = """
        (function () {
          var pw = SrctvBridge.getPassword();
          var text = SrctvBridge.getSourceListContent();
          var FLAG = 'lt_bundled_source_imported';
          var MIG = 'srctv_bundled_done_v2';
          var KEY = 'libretv-settings';

          // 一次性迁移：清掉旧版被错误设置的导入标记（旧版只 POST 服务端、没写客户端 store，
          // 标记置位但客户端实际没有任何源），让本次重新真正导入。
          if (!localStorage.getItem(MIG)) {
            localStorage.removeItem(FLAG);
            localStorage.setItem(MIG, '1');
          }

          if (!pw) {
            document.addEventListener('submit', function () {
              var inp = document.querySelector('input[type=password]');
              if (inp && inp.value) { SrctvBridge.savePassword(inp.value); }
            }, true);
          }

          var done = false;
          function tryImport() {
            if (done) return;
            if (localStorage.getItem(FLAG)) { done = true; return; }
            if (!text) { localStorage.setItem(FLAG, '1'); done = true; return; }
            var chain = Promise.resolve();
            if (pw) {
              chain = chain.then(function () {
                return fetch('/api/auth', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password: pw })
                }).catch(function () {});
              });
            }
            chain.then(function () {
              return fetch('/api/source-list', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: text })
              });
            }).then(function (r) { return r.json(); }).then(function (payload) {
              if (!payload || (!payload.sources && !payload.liveSources)) return; // 可能未登录，下次重试
              var sources = payload.sources || [];
              var liveSources = payload.liveSources || [];
              if (sources.length === 0 && liveSources.length === 0) return;

              var data;
              try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { data = null; }
              if (!data || typeof data !== 'object') data = { state: {}, version: 8 };
              if (!data.state || typeof data.state !== 'object') data.state = {};
              var st = data.state;
              if (!Array.isArray(st.customAPIs)) st.customAPIs = [];
              if (!Array.isArray(st.liveSubscriptions)) st.liveSubscriptions = [];
              if (!Array.isArray(st.liveSelectedUrls)) st.liveSelectedUrls = [];
              if (!Array.isArray(st.selectedKeys)) st.selectedKeys = [];
              var yellowFilter = (st.yellowFilter !== false);

              var trailing = function (u) { return (u || '').replace(/\/+$/, ''); };
              var seenVod = {};
              (st.customAPIs).concat(st.envSources || []).forEach(function (a) { if (a && a.url) seenVod[trailing(a.url)] = true; });
              var maxKey = -1;
              st.customAPIs.forEach(function (a) { var m = /^custom_(\d+)$/.exec(a.key || ''); if (m) maxKey = Math.max(maxKey, +m[1]); });
              var newVod = 0;
              sources.forEach(function (s) {
                var u = trailing(s.url); if (!u || seenVod[u]) return; seenVod[u] = true;
                var key = 'custom_' + (++maxKey);
                st.customAPIs.push({ key: key, name: s.name || u, url: s.url, detail: s.detail, isAdult: s.isAdult });
                if (!(s.isAdult && yellowFilter)) st.selectedKeys.push(key);
                newVod++;
              });

              var seenLive = {};
              (st.liveSubscriptions).concat(st.liveEnvSources || []).forEach(function (a) { if (a && a.url) seenLive[a.url] = true; });
              var newLive = 0;
              liveSources.forEach(function (s) {
                if (!s.url || seenLive[s.url]) return; seenLive[s.url] = true;
                var key = 'live_' + Date.now() + '_' + newLive;
                st.liveSubscriptions.push({ key: key, name: s.name || s.url, url: s.url, epg: s.epg, fromSubscriptions: [] });
                st.liveSelectedUrls.push(s.url);
                newLive++;
              });

              if (newVod === 0 && newLive === 0) { localStorage.setItem(FLAG, '1'); done = true; return; }

              // 先强制把 store 可能缓冲的旧状态刷盘，随后用我们的直接写覆盖，
              // 避免页面刷新时 beforeunload 把旧（无源）状态覆盖回去。
              try { window.dispatchEvent(new Event('beforeunload')); } catch (e) {}
              localStorage.setItem(KEY, JSON.stringify(data));
              localStorage.setItem(FLAG, '1');
              done = true;
              location.reload();
            }).catch(function () {}); // 失败（多因未登录 401）下次轮询重试
          }

          var attempts = 0;
          var timer = setInterval(function () {
            attempts++;
            tryImport();
            if (done || attempts > 90) clearInterval(timer);
          }, 2000);
        })();
        """

        webView.evaluateJavascript(js, null)
    }

    /**
     * 电视版专属：把遥控器方向键正确转成网页焦点移动。
     *
     * 背景：Android TV 的遥控器方向键（KEYCODE_DPAD_*）会被 WebView 翻译成键盘
     * Arrow 键派发给网页，但 LibreTV 这类 React SPA 大量使用 div + onClick，并非原生
     * 可聚焦元素，浏览器内置的「空间导航」对它们无效，结果是「能打开、遥控点不动」。
     *
     * 这里注入一段 JS 做 roving-tabindex 式的焦点管理：
     * - 收集页面上所有可交互元素（链接/按钮/输入/带 tabindex/role=button，且仅可见的）；
     * - 方向键（上下左右）在元素间循环移动焦点，保证「焦点一定可动」；
     * - 确认键（Enter，遥控器中心键即映射为 Enter）触发当前焦点元素的 click，
     *   对 React 的 div onClick 同样有效；
     * - 焦点落在输入框内时不拦截方向键，保证正常输入；
     * - 页面加载后主动把焦点落到第一个可交互元素。
     *
     * 注意：this 方法只在 tv flavor（BuildConfig.FLAVOR == "tv"）被调用。
     */
    private fun injectTvNav() {
        val js = """
        (function () {
          function list() {
            var els = document.querySelectorAll(
              'a[href], button:not([disabled]), input:not([disabled]), ' +
              'select:not([disabled]), textarea:not([disabled]), ' +
              '[tabindex]:not([tabindex="-1"]), [role="button"]'
            );
            var out = [];
            for (var i = 0; i < els.length; i++) {
              if (els[i].offsetParent !== null) out.push(els[i]); // 仅可见元素
            }
            return out;
          }
          function ensureFocus() {
            var items = list();
            if (!items.length) return;
            var a = document.activeElement;
            if (!a || a === document.body || a === document.documentElement ||
                items.indexOf(a) === -1) {
              items[0].focus();
            }
          }
          document.addEventListener('keydown', function (e) {
            var ae = document.activeElement;
            var editable = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                                 ae.isContentEditable);
            if (editable) return; // 输入框内不拦截方向键
            var items = list();
            if (!items.length) return;
            var idx = items.indexOf(document.activeElement);
            var handled = true;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
              idx = (idx < 0 ? 0 : idx + 1) % items.length;
              items[idx].focus();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
              idx = (idx < 0 ? items.length - 1 : idx - 1 + items.length) % items.length;
              items[idx].focus();
            } else if (e.key === 'Enter') {
              if (idx >= 0) { e.preventDefault(); items[idx].click(); }
              handled = false; // Enter 不在此阻止（避免与聚焦元素原生点击重复）
            } else {
              handled = false;
            }
            if (handled) e.preventDefault();
          }, true);
          window.__srctvEnsureFocus = ensureFocus;
          document.addEventListener('DOMContentLoaded', function () { setTimeout(ensureFocus, 300); });
          window.addEventListener('load', function () { setTimeout(ensureFocus, 300); });
          setTimeout(ensureFocus, 500);
        })();
        """

        webView.evaluateJavascript(js, null)
    }

    override fun onPause() {
        webView.onPause()
        // 强制把 Cookie 落盘，确保登录态在 App 被杀后依然保留（避免反复输密码）
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}

/**
 * JS 桥：被页面内的 SrctvBridge.* 调用。
 * - getPassword / savePassword：登录密码（默认来自编译期 APP_PASSWORD，手输后存 SharedPreferences 优先）；
 * - getSourceListContent：返回 APK 内置的默认源列表文本。
 */
private class SrcTvBridge(
    private val appContext: Context,
    private val defaultPassword: String,
    private val assetName: String
) {
    private val prefs: SharedPreferences =
        appContext.getSharedPreferences("srctv", Context.MODE_PRIVATE)

    @JavascriptInterface
    fun getPassword(): String {
        return prefs.getString("password", null) ?: defaultPassword
    }

    @JavascriptInterface
    fun savePassword(password: String) {
        if (password.isNotBlank()) {
            prefs.edit().putString("password", password).apply()
        }
    }

    @JavascriptInterface
    fun getSourceListContent(): String {
        return try {
            appContext.assets.open(assetName).bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            ""
        }
    }
}
