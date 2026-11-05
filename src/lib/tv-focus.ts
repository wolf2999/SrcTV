/**
 * TV 空间焦点引擎（M1-3）：遥控器方向键 → 基于 DOM 屏幕几何的空间导航。
 *
 * 设计要点（对齐需求文档 §3 / §3.1）：
 * - 纯 DOM 几何：不依赖任何布局结构，对现有页面零侵入；挂载/卸载由 TvModeRoot 控制。
 * - 空间导航：按「焦点元素 → 方向」在屏幕几何上找最近的可交互元素（先沿主轴前进、
 *   再按侧向偏移惩罚），替代壳内旧的一维线性循环——后者在弹窗/复杂页面下必然错乱。
 * - 弹窗 Focus Trap（M1-7 配套）：若页面存在打开的弹窗（role="dialog"/"alertdialog"/
 *   aria-modal/data-tv-trap），方向键候选被限制在弹窗内，方向键不会「跑出弹窗点到背景」。
 *   这与业务里已有的 useFocusTrap（Tab 循环）互补：那边管 Tab，这边管方向键。
 * - 可聚焦判定：收集原生可聚焦元素 + role=button 等语义元素；非原生可聚焦的 div
 *   （React onClick 卡片）通过自动补 tabindex=-1 使其可被程序 focus（不进入 Tab 序，不影响网页端）。
 * - 输入框保护：焦点在 input/textarea/contenteditable/select 内时不拦截任何按键，正常打字。
 * - 焦点可视：聚焦时给元素加 .tv-focused 类（样式见 components/tv/tv.css），
 *   并自动 scrollIntoView 保证焦点元素始终在视口内。
 */

/** 候选元素选择器：原生可聚焦 + 常见交互语义属性 */
const CANDIDATE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[data-tv-focusable]',
].join(', ');

/** 打开的弹窗容器判定选择器（Focus Trap 锚点） */
const TRAP_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-tv-trap]';

type Direction = 'up' | 'down' | 'left' | 'right';

const DIR_VEC: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** 元素是否「实际可见」：有布局盒、尺寸非零、未被 visibility/display 隐藏 */
function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return true;
}

/** 非原生可聚焦的语义元素（div[role=button] 等）补 tabindex=-1，使其可被程序 focus */
function ensureFocusable(el: HTMLElement): void {
  const native =
    el instanceof HTMLAnchorElement ||
    el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement;
  if (!native && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1'); // -1 = 可程序聚焦但不进入 Tab 序，不改变网页端行为
  }
}

/** 当前生效的 Focus Trap 容器：取 DOM 序最后一个可见弹窗（最上层）。无则返回 null */
function activeTrap(): HTMLElement | null {
  const traps = Array.from(document.querySelectorAll<HTMLElement>(TRAP_SELECTOR));
  for (let i = traps.length - 1; i >= 0; i--) {
    if (isVisible(traps[i])) return traps[i];
  }
  return null;
}

/**
 * M4-1 返回键消费：关闭当前最上层弹窗（若有），返回是否「消费了本次返回」。
 * - 有打开的弹窗：关闭它并返回 true，壳不再路由后退（FR-6.1：弹窗优先关闭）。
 * - 无弹窗：返回 false，壳按 FR-6.2 回退 WebView 历史 / 退出应用。
 *
 * 关闭策略（通用、对业务零侵入，不依赖各弹窗内部状态）：
 * 1) 在弹窗子树内派发 Escape 键盘事件（bubbles）：
 *    - 命中业务自带 React onKeyDown 的弹窗（如 TvKeyboard 的 Esc→onClose）；
 *    - 冒泡到 window 命中原生 keydown 监听的弹窗（Drawer / detail-modal / confirm-dialog）。
 * 2) 兜底：点击弹窗内「关闭 / 取消 / close / cancel」语义按钮（如 switch-source 仅此途径）。
 * 3) 再兜底：点击弹窗外侧全屏遮罩（fixed inset-0，如 auth 仅靠遮罩点击关闭）。
 * 优先用弹窗自身逻辑关闭，保证状态清理与业务一致；纯兜底手段只在前面都无效时起作用。
 */
export function closeTopModal(): boolean {
  const trap = activeTrap();
  if (trap) {
    // 1) Escape：在弹窗首个子节点派发，既能触发 React 合成 onKeyDown，也能冒泡到 window 原生监听
    const seed = trap.querySelector<HTMLElement>('*') ?? trap;
    seed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    // 2) 兜底关闭按钮（精确 aria-label 匹配，大小写不敏感）
    const closeBtn = trap.querySelector<HTMLElement>(
      '[aria-label="关闭" i], [aria-label="close" i], [aria-label="取消" i], [aria-label="cancel" i]'
    );
    closeBtn?.click();

    // 3) 再兜底：点击外侧全屏遮罩（fixed inset-0），覆盖仅靠遮罩点击关闭的弹窗（如 auth）
    const parent = trap.parentElement;
    if (parent && /\bfixed\b/.test(parent.className) && /inset-0/.test(parent.className)) {
      parent.click();
    }

    return true;
  }

  // 2026-11-05 交互顺序修正：返回键优先级 = 弹窗 → 播放控制层 → 全屏 → 路由后退。
  // 功能菜单（播放控制层）还开着时，返回键第一语义是「收起菜单」而不是「退全屏」——
  // 收起菜单不发生路由后退，不存在 tv-web-fs 泄漏黑屏问题；控制层退出（hidden）后
  // 这里不再命中，下一次返回才走下方全屏分支退出全屏（再下一次才路由后退）。
  // M5 收尾：无弹窗时，若 TV 播放控制层处于激活态（已渲染且未退出），返回键应先「退出
  // 播放控制模式」而非直接路由后退/退全屏（FR-7：进入播放页焦点默认落在控制层）。派发
  // Escape 给控制层由其 React onKeyDown 统一处理退出（与桌面 Esc 同一路径），保证状态
  // 清理一致。此分支不影响已打开的弹窗（上面的 trap 优先），也不影响网页端
  // （installTvFocus 仅在 TV 模式安装，__srctvConsumeBack / Esc 路径都不会在网页端触发）。
  // 控制层始终驻留 DOM（含非 TV 模式），但非 TV 模式不安装引擎、closeTopModal 不运行，故不会误触发。
  const controlLayer = document.querySelector<HTMLElement>('[data-tv-player-control]:not([hidden])');
  if (controlLayer) {
    controlLayer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    return true;
  }

  // 全屏态（html.tv-web-fs，TV 壳用 CSS 网页全屏）且控制层已收起：返回键退全屏——
  // TV 遥控器的直觉是「返回 = 退出当前全屏界面」。此前的顺序是「先退出
  // 控制模式（视觉上看不出任何变化）→ 再按一次才路由后退」，而后退发生时 tv-web-fs 类
  // 还挂在 html 上，其「隐藏页面内容、只显示播放器」的全屏 CSS 泄漏到目标页（搜索页），
  // 造成整页黑屏（模拟器实测复现）。player-shell 在播放器创建时注册
  // srctv:toggle-fullscreen 监听做三态还原（原生全屏/CSS 类/壳沉浸式）。
  if (document.documentElement.classList.contains('tv-web-fs')) {
    window.dispatchEvent(new CustomEvent('srctv:toggle-fullscreen'));
    return true;
  }

  return false;
}

/** 收集当前可导航候选：可见 + （有 trap 时）位于 trap 内 */
function candidates(): HTMLElement[] {
  const trap = activeTrap();
  const scope: ParentNode = trap ?? document;
  const els = Array.from(scope.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR));
  return els.filter(
    (el) =>
      isVisible(el) &&
      (!trap || trap.contains(el)) &&
      // M3 播放控制层只作为「被聚焦后处理按键」的锚点，不应成为方向键导航的候选
      // （否则焦点会跳到透明覆盖层上，破坏播放页控制语义）。
      !el.hasAttribute('data-tv-player-control')
  );
}

/**
 * 空间导航核心：从当前焦点出发，沿 dir 方向选最优候选。
 * 评分 = 主轴前进距离 + 侧向偏移 × 惩罚系数（侧向越小越「正对」，优先命中）。
 */
function pickNext(dir: Direction, from: DOMRect | null, pool: HTMLElement[]): HTMLElement | null {
  if (pool.length === 0) return null;
  const v = DIR_VEC[dir];
  // 无当前焦点：进入新区域时选第一个候选（DOM 序 = 视觉大致顺序）
  if (!from) return pool[0];
  const fcx = from.left + from.width / 2;
  const fcy = from.top + from.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of pool) {
    if (el === document.activeElement) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2 - fcx;
    const cy = r.top + r.height / 2 - fcy;
    // 主轴投影：必须沿方向前进（允许少量重叠容差，处理同行/同列相邻元素）
    const forward = v.x * cx + v.y * cy;
    if (forward < 4) continue;
    // 侧向偏移：水平移动看 |cy|，垂直移动看 |cx|
    const side = v.x !== 0 ? Math.abs(cy) : Math.abs(cx);
    // 侧向惩罚 2.5 倍：宁可沿主轴走远一点，也不要斜着跳到错行
    const score = forward + side * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** 焦点落位：补 tabindex、加可视类、滚入视口 */
function focusEl(el: HTMLElement | null): void {
  if (!el) return;
  ensureFocusable(el);
  el.focus({ preventScroll: true }); // 滚动由下面 scrollIntoView 精确控制
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
}

/** 焦点是否在文本输入控件内（此时引擎不得拦截按键） */
function inEditable(): boolean {
  const ae = document.activeElement as HTMLElement | null;
  if (!ae) return false;
  return (
    ae.tagName === 'INPUT' ||
    ae.tagName === 'TEXTAREA' ||
    ae.tagName === 'SELECT' ||
    ae.isContentEditable
  );
}

/**
 * 安装 TV 焦点引擎（幂等）。返回卸载函数。
 * 事件用 capture 挂在 window 上：先于页面自身 keydown 处理，可 preventDefault。
 */
export function installTvFocus(): () => void {
  if ((window as { __tvFocusInstalled?: boolean }).__tvFocusInstalled) return () => {};
  (window as { __tvFocusInstalled?: boolean }).__tvFocusInstalled = true;

  // M4-2 防重入：Esc 模拟返回键时，closeTopModal 会派发合成 Escape 事件，该事件冒泡到
  // window 又会触发本引擎的 keydown 处理；用此标志阻断重入，避免无限递归。
  let backHandling = false;

  // 焦点可视类：focusin/focusout 委托，兼容 React 重渲染
  const onFocusIn = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLElement) t.classList.add('tv-focused');
  };
  const onFocusOut = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLElement) t.classList.remove('tv-focused');
  };
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);

  const onKeyDown = (e: KeyboardEvent) => {
    if (inEditable()) return; // 输入框内：方向键/回车全部放行（光标移动、提交）

    // M3 播放控制豁免：焦点落在 watch 页面叠加的「播放控制层」（带 data-tv-player-control）
    // 时，所有按键放行给页面自身的 onKeyDown 处理（←/→ seek、↑/↓ 换集、Enter/空格
    // 播放暂停、Esc 退出浏览剧集）。焦点引擎不导航、不触发确认，否则会破坏播放页遥控
    // 器控制（FR-7）；且能避开与 PlayerShell 内部 document 级 shortcuts 监听的冲突。
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && activeEl.hasAttribute('data-tv-player-control')) return;

    const dirMap: Record<string, Direction> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };

    if (e.key in dirMap) {
      e.preventDefault();
      e.stopPropagation();
      const pool = candidates();
      const ae = document.activeElement as HTMLElement | null;
      const from =
        ae && pool.includes(ae) ? ae.getBoundingClientRect() : null;
      const next = pickNext(dirMap[e.key], from, pool);
      // 焦点丢失（如 React 卸载了原元素）：方向键任意方向都先落到第一个候选，保证「焦点一定能回来」
      focusEl(next ?? pool[0] ?? null);
      return;
    }

    if (e.key === 'Enter') {
      const ae = document.activeElement as HTMLElement | null;
      if (!ae || ae === document.body) return;
      // 文本类控件已在上面的 inEditable 放行；这里对按钮/卡片统一派发 click
      // （对 React 的 div onClick 同样有效）。checkbox/option 等原生语义 click 即切换/选中。
      e.preventDefault();
      ae.click();
    }

    // M4-2 桌面调试：用 Esc 模拟遥控器「返回键」，复现 M4-1 的壳-网页协调逻辑。
    // 直接复用网页侧的 closeTopModal（与 Android 壳 __srctvConsumeBack 同一函数）：
    // 有弹窗 → 关闭并消费返回；无弹窗 → 返回 false，这里改走 history.back() 路由后退
    // （真实 TV 上返回键由壳处理、不会以 keydown 抵达网页，故本分支仅桌面调试生效，
    // 不破坏真机行为）。playback-control 豁免已在上方拦截，不走到这里。
    if (e.key === 'Escape') {
      if (backHandling) return; // 阻断 closeTopModal 派发合成 Escape 引发的重入
      backHandling = true;
      try {
        e.preventDefault();
        if (!closeTopModal()) history.back();
      } finally {
        backHandling = false;
      }
      return;
    }
    // 其余按键不拦截，交给页面自身逻辑
  };

  window.addEventListener('keydown', onKeyDown, true);

  // M4-1：把「返回键消费」函数挂到 window，供 Android 壳在 onBackPressed 时优先调用
  // （弹窗优先关闭 → 否则壳路由后退）。仅 TV 模式安装，网页端无此全局。
  const w = window as unknown as { __srctvConsumeBack?: () => boolean };
  w.__srctvConsumeBack = () => closeTopModal();

  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    (window as { __tvFocusInstalled?: boolean }).__tvFocusInstalled = false;
    delete w.__srctvConsumeBack;
  };
}
