/**
 * TV 模式判定（M1-2）：全站唯一的模式判定入口，UI 层只看 isTvMode()，
 * 不关心标志来自哪里。三源优先级：
 * 1. URL 参数：?tv=1 强制开启 / ?tv=0 强制关闭（开发调试用，浏览器里方向键模拟遥控器）；
 * 2. 壳注入：tv flavor 的 Android 壳在 onPageFinished 注入 window.__TV__ = true；
 * 3. 持久化：一旦激活过（URL 或壳），写 localStorage，后续访问不带参数也保持 TV 模式
 *    （TV 上没键盘，不能每次手输参数）。
 *
 * 注意：判定只在客户端生效（依赖 window / localStorage），SSR 渲染的 HTML 不含 TV 分支，
 * TV 专属视觉全部通过根节点 .tv-mode class 作用域实现（见 tv.css），避免 hydration 不匹配。
 */

const LS_KEY = 'srctv-tv-mode';

/** 是否处于 TV 模式（纯函数，每次调用实时判定，不做缓存） */
export function isTvMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('tv');
    if (q === '1') return true;
    if (q === '0') return false;
  } catch {
    /* URL 解析失败不致命，继续走其它来源 */
  }
  if ((window as { __TV__?: boolean }).__TV__ === true) return true;
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

/** 激活 TV 模式并持久化（URL ?tv=1 首次命中时调用） */
export function persistTvMode(): void {
  try {
    localStorage.setItem(LS_KEY, '1');
  } catch {
    /* localStorage 不可用（隐私模式等）则仅本次会话生效 */
  }
}

/** 关闭并清除 TV 模式持久化（URL ?tv=0 命中时调用） */
export function clearTvMode(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* 同上，静默忽略 */
  }
}
