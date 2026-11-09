# TV 版 UI 改造开发进度

> 版本：v1.0 ｜ 最后更新：2026-11-04
> 状态图例：⬜ 待开始 ｜ 🔄 进行中 ｜ ✅ 完成 ｜ ⛔ 阻塞/搁置

## 里程碑一：焦点引擎与基础设施（M1，不改布局，套在现有页面上）

> 落地思路（遵循需求 §3.1）：M1 阶段**不抽离布局、不改业务组件**，只在现有页面之上挂「引擎层 + 样式隔离根 + 通用 Modal 容器」，最小成本解决「二级界面点不到」。布局抽离留到 M2。

| 编号 | 任务 | 状态 | 备注 |
|---|---|---|---|
| M1-1 | 壳注入 `window.__TV__` 标志（tv flavor 下） | ✅ | `MainActivity.kt` `onPageFinished` 中 tv flavor 注入 |
| M1-2 | Web 端 `isTvMode()` 判定（壳注入 / `?tv=1` / localStorage） | ✅ | `src/lib/tv-mode.ts`；`?tv=0` 显式退出并清持久化 |
| M1-3 | 新建 `src/lib/tv-focus.ts` 空间焦点引擎 | ✅ | 几何空间导航 + Enter 派发 click + 输入框保护；对 div[role=button] 自动补 tabindex=-1 |
| M1-4 | 停用壳内旧 `injectTvNav` 线性逻辑（tv 模式） | ✅ | `injectTvNav` 方法已整体删除，避免双导航冲突 |
| M1-5 | `.tv-mode` 根作用域焦点可视态 CSS | ✅ | `components/tv/tv.css`：`.tv-focused` 描边+放大，输入框不放大，TV 基础字号 18px |
| M1-6 | TV 模式根节点挂载 `.tv-mode` class | ✅ | `components/tv/TvModeRoot.tsx` 挂 `<html>`；含壳标志晚到的轮询兜底（~5s） |
| M1-7 | 通用 `TvModal` 容器 + Focus Trap | ✅ | `components/tv/TvModal.tsx`（供 M2 新 UI 用）；现有业务弹窗经 `role="dialog"/alertdialog` 已被引擎 trap 识别，业务零改动 |

## 里程碑二：TV 布局抽离（M2，按 §3.1 布局层隔离，替换布局而非改业务）

> 落地思路：M2 才动布局。每个页面**新建 `Tv*Layout` 容器**，复用现有业务子组件（搜索卡片、播放器等）作为 children 塞入；原网页 `Layout` 不动。业务组件零 TV 分支。

| 编号 | 任务 | 状态 | 备注 |
|---|---|---|---|
| M2-1 | 首页横向焦点行布局 | ❌（用户裁决：不做） | 2026-11-04 实测横排方案有缺陷（卡片宽度失控变巨图），且用户确认**布局方式与网页版统一即可**——M1 空间焦点引擎对原网格已能左右/上下正确导航。原 CSS 与钩子类已回滚 |
| M2-2 | 顶栏 TV 大点击区 | ❌（随之取消） | 顶栏沿用网页版布局，仅保留 FR-8 隐藏设置/下载 |
| M2-3 | 搜索结果网格/横行 D-pad 导航 | ❌（用户裁决：不做） | 结果区同 M2-1，保持网页版网格 + M1 引擎焦点导航 |
| M2-4 | 新建 `TvSettingsLayout`（设置 / 源管理页放大、间距、全功能可达） | ⬜ | 设置入口在 TV 上已被 FR-8 隐藏；若后续落地 TV 专属设置页再建此布局（顺延） |
| M2-5 | TV 模式屏蔽顶栏「设置」「下载管理」入口（需求 FR-8） | ✅ | `header.tsx` 两个按钮挂惰性 `data-tv-hide`（零逻辑分支）；`tv.css` 新增 `.tv-mode [data-tv-hide]{display:none}`。display:none 元素被焦点引擎可见性过滤天然排除 |

## 里程碑三：播放页 TV 操作

| 编号 | 任务 | 状态 | 备注 |
|---|---|---|---|
| M3-1 | 播放页方向键 seek（左右）与换集（上下） | ✅ | 见 `components/tv/useTvPlayerControls.tsx`；焦点引擎对带 `data-tv-player-control` 的元素放行方向键（不导航不触发确认），由页面 onKeyDown 接管：←/→ seek（±10s）、↑/↓ 换集（受 `hasPrev/hasNext` 约束） |
| M3-2 | 确认键播放/暂停 + 控制条焦点可见 | ✅ | 进入播放页自动聚焦控制层；Enter/空格 播放暂停（`PlayerSkipApi.play()` 新增）。FR-7.2 落地后控制层改为**可见控制条**（底部工具条：快退/上一集/播放暂停/下一集/快进/全屏），当前高亮按钮用 `.tv-focused` 绿描边标记，满足「播放控制条焦点可见」（10-foot UI 3 米外可辨） |
| M3-3 | 播放控制模式与通用焦点导航协调（防冲突） | ✅ | 焦点引擎对带 `data-tv-player-control` 的元素豁免（方向键/Enter 放行给页面 onKeyDown，不导航不触发确认）；按钮不抢真实焦点（tabIndex=-1），焦点始终在控制层自身，保证豁免持续生效。注意：控制层**已移除 `data-tv-trap`**（原 M3 加的），否则 `tv-focus.ts` 的 `activeTrap()` 会把控制层当成弹窗、watch 页按返回被永久消费、无法路由后退（M4 回归）；控制层本就被 `data-tv-player-control` 豁免，移除 `data-tv-trap` 不影响播放控制语义。Esc 退出控制模式把焦点交给剧集列表（`[data-tv-episode-list]`） |
| M3-4 | 全屏切换遥控器映射（FR-7.2） | ✅ | 可见控制条新增「全屏切换」按钮，遥控器 ←/→ 导航到该按钮、Enter 触发；`PlayerSkipApi` 新增 `toggleFullscreen()`（复用 ArtPlayer 全屏 setter `current.fullscreen = !current.fullscreen`，与桌面 `f` 键完全一致），网页端走浏览器/播放器全屏、Android 侧由壳 `CustomView` 承接 HTML5 视频全屏。遥控器无 `f` 键且控制层此前吞掉按键，故此前全屏不可达；现经控制条按钮可达 |

## 里程碑四：返回导航与联调

| 编号 | 任务 | 状态 | 备注 |
|---|---|---|---|
| M4-1 | 返回键协调：弹窗优先关闭 → 否则路由后退 | ✅ | 原生 `MainActivity.kt` 的 `handleOnBackPressed` 在 TV 风味下先 `evaluateJavascript` 调用网页注册的 `window.__srctvConsumeBack`：弹窗打开时网页关闭最上层弹窗（role=dialog/alertdialog/aria-modal/data-tv-trap，见 `tv-focus.ts` 的 `closeTopModal`）并消费返回；无弹窗返回 false，壳再 `webView.goBack()` 或 `finish()`（FR-6.2）。关闭策略通用零侵入：优先派发 Escape 命中弹窗自带关闭逻辑（Drawer/detail-modal/confirm-dialog 的 window 原生监听、TvKeyboard 的 React onKeyDown），兜底点关闭按钮、再兜底点全屏遮罩（如 auth）。移动端风味保持原行为 |
| M4-2 | 桌面浏览器键盘模拟 TV 操作调试验证 | ✅ | TV 模式本就可用 `?tv=1` 在桌面进入（D-pad/Enter 已可模拟）；M4-2 补齐**返回键**模拟：焦点引擎 `tv-focus.ts` 新增 Esc→返回分支，直接复用 `closeTopModal()`（与 Android 壳 `__srctvConsumeBack` 同一函数），复现「弹窗优先关闭→否则路由后退」的 M4-1 协调；加 `backHandling` 防重入守卫，避免 `closeTopModal` 派发的合成 Escape 触发引擎自身 keydown 递归。真机上返回键由壳处理、不会以 keydown 抵达网页，故该分支仅桌面调试生效，不破坏真机。验证方式见下方更新记录 |
| M4-3 | TV 模拟器（Android Studio AVD）真机联调 | ✅ | 用已有 `Television_4K` AVD（android-36/android-tv/x86 镜像，hw.gpu.mode=host）联调：`assembleTvDebug` 构建 → adb 安装 `app-tv-debug.apk` → 启动后 WebView 成功加载 START_URL（本机 next dev -p 8090），TV 焦点引擎绿描边、D-Pad 空间导航、CENTER 触发、M4-1 返回键（弹窗优先关闭 + 无弹窗路由后退）全部真机验证通过。联调发现并修复 3 个真机级问题（详见文末 2026-11-04 M4-3 记录）：①控制条初始焦点被页面动态元素/WebView 抢走 → 焦点锁定轮询；②TV WebView 拒绝 Element Fullscreen 且 ArtPlayer 状态乐观置位 → toggleFullscreen 按环境分流（bridge→fullscreenWeb+沉浸式，桌面→原生）；③TV 下「下载本集」按钮无意义且其 http 提示 toast 抢焦点 → `data-tv-hide` 隐藏。验证手段：`adb shell input keyevent` 模拟遥控 + `screencap`/`pull` 截图目视 |
| M4-4 | 网页版（非 TV）回归验证 | ✅ | 零回归。结构层面：全部 TV 改动均被 `isTvMode()` / `.tv-mode` class 隔离（`[data-tv-hide]` 仅在 `.tv-mode` 下隐藏、控制层默认 `display:none`、字体覆盖限 `.tv-mode` 作用域），网页路径不触发任何 TV 逻辑；`tsc --noEmit` EXIT=0。运行时层面（agent-browser 无头 Chromium 实测）：网页主页密码门→海报墙/筛选/评分徽章正常渲染，顶栏设置/下载图标正常显示（`dataTvHideVisibleOnWeb=2`）、`html` 无 `tv-mode` class、聚焦搜索框**不弹** TV 虚拟键盘（走原生输入+历史下拉）；`/?s=` 搜索路由正常（空态「先添加一个点播源」为未配置源的正常行为，非回归）。验证手段：agent-browser（`open`/`eval -b base64`/`click`/`screenshot`） |

## 里程碑五：TV 搜索文字输入（M5，虚拟键盘 + 语音）

> 背景：Android TV 遥控器无 QWERTY 键盘，原生软键盘在 WebView 下不可用，纯 `<input>` 无法遥控输入。
> 方案经用户确认：**A 英文虚拟键盘（Web 自绘，方向键选键 + 确认落字）打通主链路**；
> **C 原生语音输入（Kotlin SpeechRecognizer）负责中文**（纯网页键盘无法产出汉字，拼音串也会被本后端相关性过滤裁掉，见下方风险）。两者互补。
> 实现仍遵守 §3.1：Web 侧只在搜索框聚焦时挂覆盖层，业务组件零 TV 分支；原生只增桥方法 + 权限。

| 编号 | 任务 | 状态 | 备注 |
|---|---|---|---|
| M5-1 | Web：`TvKeyboard` 英文/数字虚拟键盘（QWERTY + 数字 + 空格/删除/清空/搜索） | ✅ | `components/tv/TvKeyboard.tsx`；`role="dialog" data-tv-trap` 把方向键焦点限制在键盘内（M1 trap 机制）；受控组件，按键通过 onChange 写查询串 |
| M5-2 | Web：`useTvKeyboard` 钩子 + 搜索框聚焦自动弹出 | ✅ | `components/tv/useTvKeyboard.ts`；仅 TV 模式（`isTvMode()` 守卫）聚焦时弹出，网页模式不弹；提交/关闭即卸载 |
| M5-3 | Web：首页 + 顶栏搜索接入 TV 键盘 | ✅ | `page.tsx` 首页搜索、`header.tsx` live 搜索均接钩子；TV 下聚焦不展开历史下拉（避免与键盘抢焦点） |
| M5-4 | 原生：`SpeechRecognizer` 语音桥 + `RECORD_AUDIO` 权限 | ✅ | `MainActivity.kt` 增 `isVoiceAvailable`/`startVoiceInput`（含运行时权限申请，授权后自动开始）；识别结果经 `evaluateJavascript` 派发 `srctv-voice-result` CustomEvent；`AndroidManifest.xml` 加权限 + 麦克风 `required=false` |
| M5-5 | Web：`tv-voice.ts` 语音桥订阅（结果 / 状态） | ✅ | `src/lib/tv-voice.ts`；`onVoiceResult`/`onVoiceStatus` 订阅；语音不可用 / 权限被拒 / 出错在键盘内轻提示，不阻断键盘输入 |

## 阻塞与风险（M5 相关）

| 项 | 影响 | 处理 |
|---|---|---|
| 模拟器默认无麦 + 无 Google 语音服务 | 语音 C 在 AVD 上可能 `isRecognitionAvailable=false`，只能用虚拟键盘 | 真机 / 外接麦验证；键盘作为保底 |
| 拼音串命中后端（中文影片名） | 本后端 `filterRelevantResults` 用子串匹配，拼音对中文名恒 false，会裁掉拼音命中结果 | 当前虚拟键盘仅稳覆盖英文/数字/拼音串若上游匹配也难落地；中文强依赖语音 C。后续若需拼音可用，需放宽 `cms-parser.ts` 对非中文查询的相关性过滤（待评估） |

## 验收清单（对照需求文档 §6）

- [ ] 主链路遥控器完整可用（首页→搜索→结果→播放→返回）
- [ ] 二级界面（设置/源管理/弹窗）遥控器全操作
- [ ] 焦点可视态符合 TV 习惯
- [ ] 网页版无回归
- [ ] 桌面键盘可复现全部 TV 操作

## 阻塞与风险

| 项 | 影响 | 处理 |
|---|---|---|
| workers.dev 国内可达性 | 调试期模拟器需代理常开 | 部署侧域名方案另议 |
| 待确认事项（需求文档 §8） | 影响 M1 实现细节 | 待评审确认 |

## 更新记录

- 2026-11-04：初始化进度文档，拆分四个里程碑。
- 2026-11-04：M1 全部完成（M1-1~M1-7）。TV 代码落点：`src/lib/tv-mode.ts`、`src/lib/tv-focus.ts`、`src/components/tv/{TvModeRoot.tsx,TvModal.tsx,tv.css}`、`MainActivity.kt`。顺带修复 `providers.tsx` 两个存量 TS 错误（`verified` 误从 AppState 读取 → 抽出 `BundledSourceImport` 子组件用 `useAuth`；漏 import `importSourceListContent`）。验证：`tsc --noEmit` EXIT=0；`next build` 因 dev server 占用 `.next` 暂未跑（EPERM 与本次改动无关）。模拟器验收待部署后进行。
- 2026-11-04：新增需求 FR-8（TV 模式屏蔽顶栏「设置」「下载管理」，用户确认这两项在 TV 上无使用场景），对应 M2-5 已完成。另：首页推荐数据源出厂默认从 hot-list 改为 douban（不在 TV 范畴，属全站行为）。
- 2026-11-04：M2-1~M2-3 完成（布局抽离采用 §3.1 样式层隔离，非复制业务组件）。首页推荐区与搜索结果区在 `.tv-mode` 下转为横向焦点行（Leanback 风格），卡片放大、方向键 + scrollIntoView 自动适配。业务组件仅挂惰性布局钩子 class（tv-recommend-grid / tv-results-grid），零逻辑分支。验证：tsc --noEmit EXIT=0；浏览器/模拟器实机验收待进行。M2-4 因 FR-8 隐藏设置入口顺延。
- 2026-11-04：**M2 布局改动整体回滚（用户裁决）**。实测横排方案推荐区卡片宽度失控（变成一张巨图卡片），且用户明确「布局方式和网页版统一就行」——M1 空间焦点引擎在原网页网格上左右/上下导航已验证 OK，无需改布局。已删除横排 CSS 与 tv-recommend-grid / tv-results-grid 钩子类，TV 布局差异仅保留 FR-8 的设置/下载隐藏。
- 2026-11-04：新增 **M5（TV 搜索文字输入）**：经用户确认方案为「英文虚拟键盘（A）打通主链路 + 原生语音（C）负责中文」。已落地 Web 侧 `TvKeyboard`/`useTvKeyboard`/`tv-voice.ts` 并接入首页与顶栏搜索（仅 TV 模式聚焦弹出，零业务分支）；原生侧 `MainActivity.kt` 接入 `SpeechRecognizer` + `RECORD_AUDIO` 权限 + JS 桥，识别结果经 CustomEvent 回传网页。验证：lint 0 错误；`tsc --noEmit` 待用户本地跑（命令被拒）。模拟器无麦时语音退化、键盘保底；拼音命中后端受相关性过滤限制（见风险表）。
- 2026-11-04：完成 **M3（播放页 TV 操作）**：焦点引擎 `tv-focus.ts` 新增「播放控制豁免」——焦点落在带 `data-tv-player-control` 的透明控制层时，方向键/Enter 全部放行给页面 onKeyDown（不再导航/触发确认），解决了此前引擎在 window capture 阶段拦截方向键、导致 `PlayerShell` 内部 document 级 `shortcuts` 监听器收不到按键、遥控器在播放页完全失控的问题。新增 `useTvPlayerControls` 钩子（逻辑集中、业务零分支）：←/→ seek ±10s、↑/↓ 换集、Enter/空格 播放暂停、`PlayerSkipApi` 补 `play()`；Esc 退出控制模式并把焦点交给剧集列表（`[data-tv-episode-list]`），避免与通用焦点导航冲突。已接入 `watch/page.tsx`（控制层覆盖在播放器容器内，仅 TV 模式显隐）。验证：`tsc --noEmit` EXIT=0、lint 0 错误。FR-7.2 的「全屏切换遥控器直达」因遥控器无 F 键暂未单独映射，仍可用系统/设备键或剧集页内逻辑触发，列为后续评估项。
- 2026-11-04：完成 **M4（返回键协调）**：核心难点是 Android 返回键不会以 keydown 形式派发给网页，必须由壳先问网页。方案：原生 `MainActivity.kt` 的 `handleOnBackPressed` 在 TV 风味下先 `evaluateJavascript` 调网页注册的 `window.__srctvConsumeBack`（在 `tv-focus.ts` 引擎安装时挂上），网页端 `closeTopModal()` 关闭最上层弹窗（`activeTrap()` 取 DOM 序最后一个可见 role=dialog/alertdialog/aria-modal/data-tv-trap）并返回 true 消费返回；无弹窗则返回 false，壳再 `webView.goBack()` 或 `finish()`（FR-6.2）。关闭策略通用零侵入：优先派发 Escape（命中 TvKeyboard 的 React onKeyDown 与 Drawer/detail-modal/confirm-dialog 的 window 原生监听），兜底点关闭按钮（switch-source 等），再兜底点全屏遮罩（auth 等仅靠遮罩关闭）。移动端风味保持原行为。验证：`tsc --noEmit` EXIT=0、Web lint 0 错误；Kotlin 改动语法已核对（无本机 Android SDK/_gradle，未跑 assemble，待你本地 `./gradlew` 编译）。注意点：watch 页处于播放控制模式时按返回仍直接路由后退（未先退出控制模式），属可接受的后续优化项。
- 2026-11-04：完成 **M4-2（桌面浏览器键盘模拟 TV 操作调试验证）**：TV 模式本就可用 `?tv=1` 在桌面进入（D-pad 方向键 / Enter 确认已能模拟遥控器）。本次补齐**返回键**模拟——焦点引擎 `tv-focus.ts` 新增 Esc→返回分支，直接复用 `closeTopModal()`（与 Android 壳 `__srctvConsumeBack` 同一函数），复现「弹窗优先关闭 → 否则 `history.back()` 路由后退」的 M4-1 协调逻辑；加模块级 `backHandling` 防重入守卫，阻断 `closeTopModal` 派发合成 Escape 时引擎自身 keydown 重入递归。真机上返回键由壳处理、不以 keydown 抵达网页，故该分支仅桌面调试生效、不破坏真机。桌面验证步骤：① `npm run dev` 后开 `http://localhost:5173/?tv=1`；② 方向键可在卡片/按钮间空间导航、Enter 触发点击；③ 打开任一弹窗（设置/换源/详情/虚拟键盘），按 Esc 应先关闭弹窗（验证 closeTopModal 的 Escape/关闭按钮/遮罩兜底），再按一次 Esc（无弹窗）应路由后退；④ watch 页进播放控制模式后 Esc 由播放控制层自身处理（退出控制模式），不走引擎返回分支。验证：`tsc --noEmit` EXIT=0、lint 0 错误。
- 2026-11-04：完成 **FR-7.2（全屏切换遥控器映射 + 控制条焦点可见，M3-4）**：此前 M3 的播放控制层是透明层（仅 hint），且全屏靠 `f` 键——遥控器无 `f` 键、控制层又吞掉按键，全屏不可达。本次把控制层改为**可见底部控制条**（快退/上一集/播放暂停/下一集/快进/全屏），当前高亮按钮用 `.tv-focused` 绿描边标记（满足「焦点可见」）；←/→ 在按钮间导航、Enter/空格 触发当前按钮、↑/↓ 仍换集、Esc 退出。关键修复：控制层**移除 `data-tv-trap`**——否则 `tv-focus.ts` 的 `activeTrap()`（M4 返回键协调）会把常驻控制层当弹窗，watch 页按返回被永久消费、无法路由后退（M4 回归）。`PlayerSkipApi` 新增 `toggleFullscreen()`（复用 ArtPlayer 全屏 setter `current.fullscreen = !current.fullscreen`，与桌面 `f` 键一致；Android 侧由壳 `CustomView` 承接视频全屏），全屏按钮即遥控器可达全屏。改动文件：`useTvPlayerControls.tsx`（重写，可见条+焦点管理）、`player-shell.tsx`（接口+实现）、`tv.css`（控制条/按钮样式，控制层 `.tv-focused` 不再放大）、`watch/page.tsx`（注释更新）。验证：`tsc --noEmit` EXIT=0、lint 0 错误。注意行为变化：←/→ 由「直接 seek」改为「控制条按钮导航」，seek 改由快退/快进按钮 Enter 触发（更符合 10-foot UI 可见控制条语义）。
- 2026-11-04：完成 **M4-3（TV 模拟器真机联调）**。环境：本机已有 `Television_4K` AVD（`system-images/android-36/android-tv/x86` 镜像、hw.gpu.mode=host）、JDK17（`C:\Users\Administrator\AppData\Local\Java\jdk-17.0.20.1+1`）、Gradle 8.7 缓存（`f:\xui\gradle-home`）、主机 `next dev -p 8090` 正在跑（即 START_URL 目标）。流程：`gradlew.bat assembleTvDebug`（EXIT=0，产物 `app/build/outputs/apk/tv/debug/app-tv-debug.apk`）→ `adb install` → `am start com.srctv.apptv` → `adb shell input keyevent KEYCODE_DPAD_*` 模拟遥控 + `screencap`/`pull` 截图目视（无头环境验证模拟器画面的可靠手段）。**联调通过项**：WebView 加载 START_URL 成功、自动登录、TV 焦点引擎绿描边与空间导航（含页面自动滚动）、CENTER 触发（海报→详情弹窗、筛选切换、header 导航）、M4-1 返回键两场景（弹窗优先关闭、无弹窗路由后退）、FR-7.2 控制条焦点可见 + D-Pad 按钮导航、全屏进入/退出。**联调发现并修复 3 个真机级问题**：
  ① **播放页初始焦点漂移**：单次 rAF 聚焦会被页面加载期动态元素（header 按钮 hydration、WebView 自动 focus）冲掉，实测焦点反复落到「下载本集/切换资源」，遥控器误触。修复：`useTvPlayerControls` 加「焦点锁定」——每 800ms 夺回焦点直到用户首次按键（`userInteracted` ref 置位）或 Esc 退出（层 hidden），之后完全放权不干预。
  ② **TV WebView 全屏不可达**（FR-7.2 的 Android 缺口）：Android WebView 静默拒绝容器 div 的 Element Fullscreen API（`onShowCustomView` 不触发、无拒绝日志），且 ArtPlayer 的 `fullscreen` setter 被拒后内部状态乐观置位，「先试原生再读回」会误判跳过降级。修复：`toggleFullscreen` 按环境分流（不再读回）——有 `SrctvBridge`（Android 壳）→ ArtPlayer `fullscreenWeb`（CSS 网页全屏，无 gesture 限制）+ `documentElement.tv-web-fs` 类 + 壳沉浸式（`SrctvBridge.toggleImmersive`，`WindowInsetsControllerCompat` 隐藏系统栏）；无 bridge（桌面调试）→ 原生 fullscreen（与 `f` 键一致）。退出时还原全部全屏态。`tv.css` 增 `html.tv-web-fs` 规则把 TV 控制层提升 fixed 覆盖（z-index 10000 > ArtPlayer fullscreenWeb 的 9999），保证全屏态控制条仍可遥控操作。壳侧：`SrcTvBridge` 增 `@JavascriptInterface toggleImmersive()`（JS 线程调用，UI 操作 `runOnUiThread`）。
  ③ **TV 下「下载本集」按钮无意义且有害**：TV 环境不支持下载缓存（http 环境 toast「当前环境不支持下载缓存」还抢焦点），已加 `data-tv-hide` 在 TV 模式隐藏。
  联调手段备忘：临时改 `START_URL` 直达播放页需带 `sourceUrl` 参数（直连模式 `resolveSource` 兜底构造源，否则报「点播源不存在」）；联调后已恢复 `START_URL` 原值。模拟器遥控按键映射：`KEYCODE_DPAD_CENTER`=确认、`KEYCODE_BACK`=返回（由壳 `__srctvConsumeBack` 协调）。遗留：AVD 外网拉视频流慢/失败（网络重试提示），不影响壳与 TV 逻辑验证；全屏态下控制层自身有一圈淡绿描边（fixed 时贴屏四周），轻微视觉噪点待后续优化。
- 2026-11-04：完成 **M4-4（网页版非 TV 回归验证）+ M5 收尾**（agent-browser 无头 Chromium 实测，非纯代码审读）。**M4-4 零回归结论**：结构层面全部 TV 改动被 `isTvMode()` / `.tv-mode` class 隔离；`tsc --noEmit` EXIT=0。运行时：网页主页密码门→海报墙/筛选正常渲染、顶栏设置/下载图标正常显示（`data-tv-hide` 元素 computed display 非 none，共 2 个）、`html` 无 `tv-mode` class、聚焦搜索框不弹 TV 虚拟键盘（原生输入+历史下拉路径）；`/?s=流浪地球` 搜索路由正常（空态「先添加一个点播源」为未配置源的正常行为）。**M5 收尾（TV 模式 `?tv=1` 实测）**：TV 模式生效（顶栏设置/下载隐藏、18px 字体）；聚焦搜索框虚拟键盘正确弹出（QWERTY+数字行+麦克风/删除/清空/搜索工具栏，初始焦点「空格」绿描边）；字母键点击写入搜索框（值 "c"）、删除键退格生效（"c"→""）；**语音按钮在无 `SrctvBridge` 的网页环境正确降级为 `disabled:true`**（桥存在性由 `isVoiceAvailable()` 判定）。**发现并修复 1 个 bug**：焦点在搜索框 INPUT 时按 Esc 关不掉键盘——根因：M1 引擎 `inEditable()` 对输入焦点整体放行（含 Esc），且 INPUT 不在键盘容器子树内、keydown 不冒泡经过容器，容器上的 React onKeyDown 永远收不到（真机返回键走壳 `__srctvConsumeBack`→`closeTopModal` 派发合成 Escape 能触发容器 onKeyDown，不受影响；仅网页 `?tv=1` 无物理返回键、Esc 是唯一关闭手段时暴露）。修复：`TvKeyboard.tsx` 补 document 级 keydown 监听（Escape→onClose，卸载时移除）；`setOpen(false)` 幂等，与容器 onKeyDown / closeTopModal 合成 Escape 双触发无副作用。修复后复验：Esc 收起键盘、焦点回搜索框（绿描边）、TSC=0。调试手段备忘：agent-browser 首次 `open` 若等待 networkidle 会因 Next HMR 长连接挂起，改用 `wait <selector>` 快速返回；eval 大输出走 `-b base64` 脚本文件（.NET `ReadAllBytes` 转 base64，避免 Get-Content 编码坑）；React 受控组件点击后读值需异步（同步 eval 读到旧值）；探针选择器误报时以截图为准。
- 2026-11-04：完成 **M4-3/M4 遗留小项收尾（agent-browser 无头 Chromium 实测）**，共修 3 处（1 项 CSS 噪点 + 1 项返回键逻辑 + 1 项连带发现的隐藏失效）：
  ① **全屏态控制层四周淡绿描边（视觉噪点）**：`.tv-mode .tv-focused.tv-player-control-layer` 的 `border: 2px solid rgba(34,197,94,0.35)` 在非全屏时是「处于播放控制态」的有益指示（环绕播放器区域），但全屏态（`html.tv-web-fs` 下控制层提升 `fixed inset:0`）该边框会绕整个电视屏幕一圈成为噪点。修复：`tv.css` 新增 `html.tv-web-fs .tv-focused.tv-player-control-layer { border: 0 }`（特异性 0,3,1 > 原 0,3,0，规则成立）；全屏态的焦点提示由底部控制条按钮级 `.tv-focused` 绿描边承担。实测：非全屏 computed border `2px rgba(34,197,94,0.35)`、手动加 `tv-web-fs` 后 `0px`。
  ② **watch 页播放控制模式下返回键直接路由后退（未先退出控制模式）**：Android 壳返回键调 `__srctvConsumeBack()` → `closeTopModal()`，但控制层无 `role="dialog"`/`data-tv-trap`（M3-4 特意移除避免常驻层永久消费返回），`activeTrap()` 落空即返回 false → 壳直接路由后退，跳过「退出控制模式」步骤。修复：`closeTopModal()`（tv-focus.ts）在无弹窗时检查 `[data-tv-player-control]:not([hidden])`，命中则向控制层派发合成 `Escape`（由其 React onKeyDown 统一走退出路径，与桌面 Esc 一致）并返回 true 消费返回；控制层退出（hidden）后不再命中、返回正常路由后退。优先级不受影响：弹窗（如换源 `role="dialog"`）仍由 `activeTrap()` 先关闭。桌面 Esc 分支不受影响——焦点在控制层时引擎在 `data-tv-player-control` 检查处提前 return，Esc 由控制层自身处理，不经过 closeTopModal。
  ③ **连带发现并修复：Esc 退出控制模式后控制条视觉不消失**：`tv-mode` 下 `.tv-player-control-layer { display:block }`（特异性 0,2,0）覆盖了 `hidden` 属性的 UA `display:none`（0,1,0），`setExited(true)` 后 hidden 属性加上了但控制条仍在屏幕上（query/逻辑层 hidden 正确、纯视觉 bug）。修复：`tv.css` 新增 `.tv-mode .tv-player-control-layer[hidden] { display:none }`（0,3,0）。这是②能被用户感知的前提——否则返回键「退出」后控制条仍挂着，体验割裂。
- 2026-11-04：修复 **TV 模式搜索结果页「第一张卡绿框在但确认无效」**（agent-browser 无头 Chromium 实测定位根因，非现象层猜测）。
  **根因**：全局 TV 焦点引擎（`src/lib/tv-focus.ts`）是 `window` 捕获阶段监听；按遥控器「确认」= `Enter` 时引擎先 `ae.click()` 触发一次 `activate()`（卡片 `onClick`），而 keydown 事件**继续冒泡**到卡片自身的 `onKeyDown`（它也对 `Enter` 调 `activate()`），于是 `activate` 被**触发两次**——多源聚合卡表现为「展开↔收起」相互抵消（视觉上确认键无效），单源卡则重复跳转。`Space` 引擎不处理，仅卡片自身触发一次，故正常（这也解释了为何只有确认键异常）。
  **修复**：`src/components/video-card.tsx` 三处 `onKeyDown`（聚合卡内层、来源行、单源卡，共 4 个片段）改为**条件处理**——当 TV 焦点引擎已安装（`window.__tvFocusInstalled===true`，即 TV 模式）时，处理器只保留 `Space`（引擎不处理 Space），`Enter` 完全交给引擎统一 `click` 走 `onClick`；引擎未安装（网页端）时仍自行处理 `Enter`/`Space`，保证无遥控器的网页键盘可用、且 `role=button` 的 div 在网页端也能回车激活。来源行的 `stopPropagation` 保留（防冒泡到整卡再触发 `activate`）。
  **实测（dev 8090 + agent-browser，`?tv=1&s=璀璨之城` 注入 5 个相同源构造多源聚合卡）**：修复前确认键对第一张卡来回抵消（`aria-expanded` 始终 false）；修复后**单次确认键即展开**（`aria-expanded:"true"`），`↓` 焦点进入展开的来源行（落在 `A540P` 来源，y=422），再按确认键打开详情弹窗（焦点落到弹窗内 BUTTON，路径未变属正常——详情为弹窗而非整页跳转）。`tsc --noEmit` EXIT=0。注意：此 bug 仅影响 TV 模式确认键交互；网页端回车因改动对 `__tvFocusInstalled` 取反、行为不变。`video-card.tsx` 的 `onKeyDown` 现依赖引擎全局变量名，若日后重构引擎请同步。
- 2026-11-05：修复 **TV 模式详情弹窗选集按钮焦点只剩一条竖线（绿框没包住按钮）**（agent-browser 实测复现定位）。
  **现象**：焦点确实落在选集按钮上（`activeElement===按钮`、`.tv-focused` 已挂、computed `outline: 3px solid` 正常），但屏幕上只显示按钮右侧一条竖绿线，其余三边不可见。
  **根因**：选集网格容器是 `max-h-[40vh] overflow-y-auto`——`overflow-y: auto` 会把子孙的绘制（含 outline）**裁剪到容器 padding box**。TV 焦点样式 `.tv-focused` 的 outline 外扩 `offset 2px + 宽 3px ≈ 5px`，首行/首列按钮三边紧贴容器边缘 → 左/上/下三边被整体裁掉；只有右侧因容器横向很宽、按钮右侧留有空间而幸存 → 视觉上只剩一条竖线。网页端无 `.tv-focused` 放大描边故无此问题。
  **修复**：`detail-modal.tsx` 选集网格容器 `pr-1` 改为 `p-2`（8px ≥ 5px outline 外扩量），给描边留出绘制空间，并留注释说明原因。
  **通用启示**：凡 TV 模式下可聚焦元素位于 `overflow` 容器边缘（滚动列表/网格首行首列），焦点 outline 会被裁剪；容器需预留 ≥5px 内边距（或改用 inset 型焦点样式，观感较差未采用）。实测修复后截图：绿框完整包住选集按钮，HMR 生效无需重启。`tsc --noEmit` EXIT=0。
- 2026-11-05：修复 **TV 模式全屏播放按返回键黑屏**（模拟器实测复现 + agent-browser 全链路验证）。
  **根因**：TV 壳全屏 = CSS 网页全屏（`html.tv-web-fs`，CSS 规则隐藏页面内容只显示播放器）。返回键走壳 `__srctvConsumeBack` → `closeTopModal`，其顺序是「弹窗 → 播放控制层（派发 Escape=隐形退出控制模式）→ 否则路由后退」。全屏态下第一次返回只是**隐形退出控制模式**（用户看不出任何变化），第二次返回发生时 `tv-web-fs` 类**还挂在 html 上**，带着它路由后退到搜索页后，「隐藏页面内容」的全屏 CSS 泄漏到目标页 → 整页黑屏（对应模拟器截图：黑屏 + Next.js dev 报错角标）。
  **修复（两处配合）**：
  ① `tv-focus.ts` `closeTopModal` 最前面新增全屏分支：`html.tv-web-fs` 时派发 `srctv:toggle-fullscreen` 自定义事件并消费返回（return true）——返回键在全屏态的第一语义是「退全屏」，不再隐形退控制模式、更不路由后退；
  ② `player-shell.tsx` 播放器创建时注册 `srctv:toggle-fullscreen` 监听 `exitAllFullscreen`（做原生全屏/`tv-web-fs` 类/壳沉浸式三态还原，与 `toggleFullscreen` 退出分支一致），卸载时成对移除监听。
  **实测（agent-browser 走完整链路：搜索→聚合卡展开→来源行→详情弹窗→选集→/watch，强挂 `tv-web-fs`）**：调 `window.__srctvConsumeBack()` 返回 `true`（壳不路由后退）、`tv-web-fs` 被播放器监听摘除、停留在 `/watch`。非全屏态返回键行为不变（弹窗→控制层→路由后退顺序保留）。`tsc --noEmit` EXIT=0。注意：非播放页若被强挂 `tv-web-fs` 类则事件无人消费（真实使用中该类只在播放页存在，不构成问题）。
  实测（dev 8090 + agent-browser，TV 模式 watch 页用 `?sourceUrl=` 直连兜底构造源进入）：`window.__srctvConsumeBack()` 首调 `{beforeHidden:false, ret:true}`（消费返回、退出控制模式）→ 900ms 后 `{afterHidden:true}`（控制层隐藏）→ 再调 `ret:false`（壳正常路由后退）；截图确认控制条与绿边完全消失、播放器区域恢复干净。调试坑备忘：① 密码门 auth 有 window 级 Escape 监听，按 Esc 关 TV 键盘会顺带关掉密码门（避开：全程不按 Esc，用 `input[type=password]` 精确填写+Enter）；② TV 模式下 header 搜索框可能自动聚焦导致 `fill 'input'` 命中搜索框而非密码框、TV 键盘弹出遮挡——一律用具体 type/placeholder 选择器；③ 登录会话靠 `/api/status` + cookie，agent-browser 重启后 cookie 丢失需重登；④ 模拟返回键无需真机，直接 eval `window.__srctvConsumeBack()` 即为 Android 壳同一路径。`tsc --noEmit` EXIT=0。至此 M4-3/M4 遗留项全部清零。
- 2026-11-05：修复 **进首页左下角出现「1 Issue」红标（React hydration mismatch）**（adb 截屏逐屏点开 dev overlay 定位）。
  **现象**：模拟器一进首页就有 Next.js dev overlay 的「1 Issue」徽标；桌面浏览器不复现（桌面无搜索历史数据）。
  **定位**：点开为 React hydration error，diff 指向 `src/app/page.tsx 269:17` 搜索提交按钮的 className（overlay 截断显示，调用栈 HomeContent→button）。该按钮圆角类依赖 `searchHistory.visible`，而 `visible = open && matches.length>0 && …`，`matches` 来自 react-query **异步数据**——hydration 首帧客户端判定与 SSR 可能不一致（TV WebView 恢复焦点等场景），其派生的 className/aria-expanded/下拉子树触发 mismatch。
  **修复**：`src/components/search-history.tsx` 的 `useSearchHistory` 加挂载门：新增 `mounted` state（useEffect 置 true），`visible = mounted && open && …`——首帧恒 false 与 SSR 渲染严格一致，挂载后再按真实状态展开。header 与首页两处使用点（含 `SearchHistoryDropdown` 子树渲染、`aria-expanded`）一并被门住。
  **实测**：force-stop 重启 app 后徽标消失；`tsc --noEmit` EXIT=0。诊断坑备忘：① 模拟器 4K 屏（3840×2160），screencap 显示为 1080 宽缩略图，adb `input tap` 坐标须按 3.556/3.506 倍换算；② dev overlay 的 diff 字符串被 React 截断（"..."），行尾看不到，靠调用栈 `page.tsx 269:17` + 代码里唯一非确定性表达式（visible 条件）反推根因；③ 点徽标（1 Issue）可直开面板，N 图标展开无效。
- 2026-11-05：修复 **播放控制菜单返回优先级 + 无操作不自动消失**。
  **现象**：全屏播放时功能菜单（播放控制层）常驻不消失；且菜单开着按返回直接退全屏，用户期望「先收菜单 → 再按才退全屏」。
  **根因**：tv-focus.ts 的 closeTopModal 里全屏分支（tv-web-fs）排在控制层分支**之前**，控制层激活态下返回键被全屏分支抢先消费。
  **修复**：① closeTopModal 返回优先级改为「弹窗 → 播放控制层（派发 Escape 收起）→ 全屏（tv-web-fs）→ 路由后退」——收菜单不发生后退，不触发此前的 tv-web-fs 泄漏黑屏路径，原黑屏修复语义不变；② useTvPlayerControls 加无操作自动收起：`lastActivity` ref 在 handleKeyDown 统一刷新，空闲超 `IDLE_HIDE_MS=5000ms` 按 Esc 同路径退出（setExited + 焦点交剧集列表），仅 TV 模式启用，重进（reenter）后计时自动重置。
  **实测**：桌面 ?tv=1 eval 模拟——伪造 `[data-tv-player-control]` + `html.tv-web-fs`，第一次 `__srctvConsumeBack()` 返回 true 且全屏类保留（菜单优先收起 ✓）；移除控制层后再调返回 true 并派发 srctv:toggle-fullscreen（全屏分支 ✓，桌面首页无播放器监听故类残留属预期，播放页由 player-shell 三态还原）。`tsc --noEmit` EXIT=0。返回键语义现为三段式：收菜单 → 退全屏 → 路由后退。
- 2026-11-06：修复 **搜索结果聚合卡片有焦点但无绿框**。
  **现象**：搜索结果列表聚合卡片（电影海报+来源聚合）聚焦后没有任何焦点描边。
  **根因**（桌面复现 + computed style 链路排查）：焦点落在卡片**内层 div**（`flex h-full cursor-pointer …`，自身 overflow visible），其**父级 `.card` 是 overflow:hidden**——`.tv-focused` 的描边画在元素 border box 外 2px，被祖先的 overflow 裁剪（outline 计算值正确 rgb(34,197,94) 3px 但整圈不可见）。此前选集网格修复（p-2 留边）只解决了「祖先容器贴边裁剪」，没覆盖「祖先 overflow:hidden 且内层元素填满」的场景。
  **修复**：tv-focus.ts 的 focusin 委托新增 `needsInsetOutline`——从焦点元素自身向上最多 6 层，任一层 overflow 非 visible 即追加 `.tv-focused-inset` 类；tv.css 新增 `.tv-mode .tv-focused.tv-focused-inset { outline-offset: -4px }`，负 offset 把描边画进边框内侧（跟随 border-radius 内缩），不受任何祖先 overflow 裁剪。focusout 时成对移除。
  **实测**：桌面 ?tv=1&s=黑球 合成 ArrowDown 导航到聚合卡：`tv-focused-inset=true`、`outline-offset=-4px`；强制 6px 红描边内缩可清晰画出卡片内缘整圈（机制验证 ✓，3px 绿色在 1080 缩放截图下偏细属正常，4K 模拟器原分辨率下清晰可见）。`tsc --noEmit` EXIT=0。
- 2026-11-06：修复 **inset 负 offset 描边在 Android WebView 上只显示一条边（豆瓣/首页海报卡）**。
  **现象**：上一条负 offset 方案在桌面 Chrome 完整，但模拟器 WebView 上聚焦豆瓣卡（`.card` 自身 overflow:hidden）只见右侧一条绿线。
  **根因**：WebView 的 outline 绘制顺序与桌面 Chrome 不同，内缩 outline 会被卡片内部的海报图/文字块盖住，只有未被内容覆盖的边缘露出。
  **修复**：tv.css 的 `.tv-focused-inset` 不再用 outline-offset，改为 `outline: none` + 伪元素 `::after`（`position:absolute; inset:0; border:3px solid #22c55e; border-radius:inherit; z-index:10; pointer-events:none`）——落在 border box 内不受 overflow 裁剪，且 z-index 必然盖在内容之上，跨引擎渲染一致。
  **实测**：桌面 ?tv=1 聚焦首页第一张豆瓣卡截图：整圈绿框盖在海报之上完整可见；类挂载逻辑（tv-focus.ts）未动。模拟器待刷新页面确认。
- 2026-11-06：修复 **播放控制层自动收起后无键可唤回**。
  **现象**：控制层空闲 5 秒自动收起后，遥控器按任何键都无法把菜单按出来（用户实测「没有键可以按出来」）。
  **根因**：自动收起路径沿用手动 Esc 语义——`focusEpisodeList()` 抢焦点去剧集列表，且唯一的重入途径是播放器右上角「⌨ 播放控制」小悬浮按钮，遥控器方向键在页面里导航几乎不可能到达。且实测自动收起后焦点还会漂到页面 header 按钮上（浏览器把 hidden 层的焦点还给页面），按键全部变成页面导航。
  **修复**：区分退出方式（useTvPlayerControls.tsx）：① 自动收起不再把焦点交给剧集列表，焦点随 hidden 层回落；② 新增 `autoHidden` ref 标记——空闲收起置 true、手动 Esc/reenter 置 false；③ exited 态挂 window **捕获阶段** keydown 监听：仅 `autoHidden=true` 时生效，焦点在 `[data-tv-episode-list]` 内不劫持（保留手动退出后的选集浏览），媒体键放行（收起态仍可直接播放/暂停），方向键/Enter/空格 → `reenter()` 唤回控制层并消费事件（阻止焦点引擎页面导航）。手动 Esc 退出仍是纯浏览模式，行为不变。
  **实测**：桌面 ?tv=1 播放页（黑球）——控制层激活 → 按键标记交互 → 8 秒后自动收起（hidden=true）→ 合成 ArrowRight → 400ms 后 hidden=false、焦点回到控制层（唤醒 ✓，探针 dbgWakeHit 命中）。StrictMode 下双监听为 dev 现象不影响逻辑。`tsc --noEmit` EXIT=0（临时探针已移除）。模拟器刷新后生效。
