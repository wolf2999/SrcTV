package com.srctv.app

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.Manifest
import android.graphics.Bitmap
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.srctv.app.BuildConfig
import java.util.ArrayList
import java.util.Locale

/**
 * SrcTV 安卓壳：用 WebView 加载已部署的 Web 站点（Cloudflare Workers 无法在安卓内运行，
 * 因此 APK 只做「浏览器壳」，逻辑与数据全在服务端）。
 *
 * 工程含两个 product flavor（见 app/build.gradle 的 form 维度）：
 * - mobile：手机版，包名 com.srctv.app，桌面 LAUNCHER 启动；
 * - tv：电视版，包名 com.srctv.apptv，TV 主屏 LEANBACK_LAUNCHER 启动，并注入
 *   window.__TV__ 标志；方向键焦点导航由 Web 端 TV 引擎接管（src/lib/tv-focus.ts）。
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
        private const val START_URL = "http://10.10.20.27:8090"
        //private const val START_URL = "https://srctv.xyza.workers.dev"

        /**
         * 部署时设置的访问密码。填了之后 App 打开自动登录，永不再弹密码框。
         * 留空（""）则首次手动输入一次后自动记住，以后免输。
         */
        private const val APP_PASSWORD = "hui123456"

        // APK 内置的默认源列表（assets 目录下）
        private const val SOURCE_LIST_ASSET = "LibreTV-SourceList.json"

        // 语音输入所需的 RECORD_AUDIO 权限请求码
        private const val REQUEST_RECORD_AUDIO = 2001
    }

    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    // 语音识别器（TV 搜索语音输入）：懒创建，销毁时释放
    private var speechRecognizer: SpeechRecognizer? = null
    private var pendingVoiceStart = false

    // M4-3：TV 降级网页全屏时的沉浸式状态（网页经 SrctvBridge.toggleImmersive 切换）
    private var immersive = false

    /**
     * 切换沉浸式（隐藏/显示系统状态栏+导航栏）。TV WebView 拒绝 Element Fullscreen 时，
     * 网页降级为 CSS 网页全屏并调用本方法配合隐藏系统栏，达到接近原生全屏的观感。
     * JavascriptInterface 方法跑在 JS 线程，UI 操作必须切回主线程。
     */
    private fun toggleImmersive() {
        runOnUiThread {
            immersive = !immersive
            val ctrl = WindowCompat.getInsetsController(window, window.decorView)
            if (immersive) {
                ctrl.systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                ctrl.hide(WindowInsetsCompat.Type.systemBars())
            } else {
                ctrl.show(WindowInsetsCompat.Type.systemBars())
            }
        }
    }

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
                    // 全屏播放（HTML5 视频全屏）时按返回先退出全屏，而不是回退页面
                    if (customView != null) {
                        webView.webChromeClient?.onHideCustomView()
                        return
                    }
                    // TV 模式返回键协调（M4-1）：先问网页是否有打开的弹窗（role=dialog /
                    // alertdialog 等）。若有，网页负责关闭该弹窗并消费本次返回
                    // （__srctvConsumeBack 返回 true），壳不再路由后退；若无弹窗，网页返回
                    // false，壳按既有逻辑回退 WebView 历史或退出应用（FR-6.2）。
                    // 仅 TV 风味生效；移动端保持原行为（直接 goBack / finish）。
                    if (BuildConfig.FLAVOR == "tv") {
                        webView.evaluateJavascript(
                            "(function(){return (typeof window.__srctvConsumeBack==='function')?window.__srctvConsumeBack():false;})()",
                            object : ValueCallback<String> {
                                override fun onReceiveValue(result: String?) {
                                    val handled = result != null && result == "true"
                                    runOnUiThread {
                                        if (!handled) {
                                            // 网页未消费返回：回退 WebView 历史，无可回退则退出应用
                                            if (webView.canGoBack()) webView.goBack() else finish()
                                        }
                                    }
                                }
                            }
                        )
                        return
                    }
                    // 历史可回退时回退 WebView 历史，否则退出应用
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

        // 暴露 JS 桥：自动登录 + 自动导入源 + 语音输入 + 沉浸式切换（TV 全屏降级）
        webView.addJavascriptInterface(
            SrcTvBridge(
                applicationContext,
                APP_PASSWORD,
                SOURCE_LIST_ASSET,
                this::isVoiceAvailable,
                this::startVoiceInput,
                this::toggleImmersive
            ),
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
                    // 电视版：只注入 TV 模式标志。遥控器方向键的焦点导航完全由
                    // Web 端空间焦点引擎（src/lib/tv-focus.ts）接管，壳内不再注入
                    // 旧的线性循环导航（injectTvNav 已删除），避免双导航互相打架。
                    if (BuildConfig.FLAVOR == "tv") {
                        view?.evaluateJavascript("window.__TV__ = true;", null)
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
        speechRecognizer?.destroy()
        speechRecognizer = null
        webView.destroy()
        super.onDestroy()
    }

    // ───────────────────────────── 语音输入（TV 搜索） ─────────────────────────────
    // 仅由 Web 端 TV 键盘的麦克风按钮通过 SrctvBridge 调用；手机版不会触发，
    // 但桥方法对两个 flavor 都注册（无害）。识别出的文字经 WebView evaluateJavascript
    // 派发为 CustomEvent，网页侧（src/lib/tv-voice.ts）订阅即可注入搜索框。

    /** 设备/壳是否支持语音识别（系统无识别服务时返回 false） */
    private fun isVoiceAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(this)

    /** 发起一次语音识别；返回是否已发起（权限缺失则先弹授权，授权后自动开始） */
    private fun startVoiceInput(): Boolean {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            dispatchVoiceStatus("unavailable")
            return false
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            // 记住「授权后自动开始」，并弹出系统授权框
            pendingVoiceStart = true
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQUEST_RECORD_AUDIO
            )
            return true
        }
        startRecognition()
        return true
    }

    private fun ensureSpeechRecognizer() {
        if (speechRecognizer == null && SpeechRecognizer.isRecognitionAvailable(this)) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                setRecognitionListener(recognitionListener)
            }
        }
    }

    private fun startRecognition() {
        ensureSpeechRecognizer()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            // 跟随系统语言（中文环境即识别中文），无需硬编码
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toString())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try {
            speechRecognizer?.startListening(intent)
        } catch (e: Exception) {
            dispatchVoiceStatus("error")
        }
    }

    /** 识别监听器：结果 / 错误统一回传网页 */
    private val recognitionListener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onError(error: Int) {
            val status = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                else -> "error"
            }
            dispatchVoiceStatus(status)
        }

        override fun onResults(results: Bundle?) {
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val text = matches?.firstOrNull()
            if (!text.isNullOrBlank()) dispatchVoiceResult(text) else dispatchVoiceStatus("no-speech")
        }

        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    /** 把识别文字派发到网页（转义单引号 / 反斜杠 / 换行，避免注入脚本语法错误） */
    private fun dispatchVoiceResult(text: String) {
        if (!::webView.isInitialized || isFinishing) return
        val safe = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('srctv-voice-result',{detail:'$safe'}));",
            null
        )
    }

    /** 把语音状态（不可用 / 权限被拒 / 出错 / 无语音）派发到网页，供 UI 提示 */
    private fun dispatchVoiceStatus(status: String) {
        if (!::webView.isInitialized || isFinishing) return
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('srctv-voice-status',{detail:'$status'}));",
            null
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_RECORD_AUDIO) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                if (pendingVoiceStart) {
                    pendingVoiceStart = false
                    startRecognition()
                }
            } else {
                pendingVoiceStart = false
                dispatchVoiceStatus("permission-denied")
            }
        }
    }
}

/**
 * JS 桥：被页面内的 SrctvBridge.* 调用。
 * - getPassword / savePassword：登录密码（默认来自编译期 APP_PASSWORD，手输后存 SharedPreferences 优先）；
 * - getSourceListContent：返回 APK 内置的默认源列表文本；
 * - isVoiceAvailable / startVoiceInput：语音输入（委托给 MainActivity 的 SpeechRecognizer 实现）。
 */
private class SrcTvBridge(
    private val appContext: Context,
    private val defaultPassword: String,
    private val assetName: String,
    private val isVoiceAvailableFn: () -> Boolean,
    private val startVoiceInputFn: () -> Boolean,
    private val toggleImmersiveFn: () -> Unit
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

    @JavascriptInterface
    fun isVoiceAvailable(): Boolean = isVoiceAvailableFn()

    @JavascriptInterface
    fun startVoiceInput(): Boolean = startVoiceInputFn()

    /** 切换沉浸式（隐藏/显示系统栏）：TV 网页全屏降级（tv-web-fs）时配合调用 */
    @JavascriptInterface
    fun toggleImmersive() = toggleImmersiveFn()
}
