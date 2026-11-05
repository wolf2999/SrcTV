'use client';

import { useEffect } from 'react';
import { isTvMode, persistTvMode, clearTvMode } from '@/lib/tv-mode';
import { installTvFocus } from '@/lib/tv-focus';
import './tv.css';

/**
 * TV 模式根开关（M1-6）：唯一负责「进入/退出 TV 模式」的组件。
 * - 判定命中后：给 <html> 挂 .tv-mode class（样式隔离作用域）+ 安装空间焦点引擎；
 * - 网页模式（无标志）下本组件不渲染任何内容、不挂任何监听，零影响。
 *
 * 壳注入时序问题：Android 壳在 onPageFinished 注入 window.__TV__，可能晚于本组件
 * 挂载（SPA hydration 先完成）。这里做短轮询兜底（最多约 5s），检测到壳标志后再启用；
 * 显式 ?tv=0 时立即停轮询并清除持久化，保证开发者能随时退出 TV 模式。
 */
export function TvModeRoot() {
  useEffect(() => {
    let uninstalled: (() => void) | null = null;
    let attempts = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const enter = () => {
      persistTvMode();
      document.documentElement.classList.add('tv-mode');
      uninstalled = installTvFocus();
    };

    const exit = () => {
      clearTvMode();
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const tryActivate = () => {
      const q = new URLSearchParams(window.location.search).get('tv');
      if (q === '0') {
        exit();
        return true; // 显式退出：停止一切检测
      }
      if (isTvMode()) {
        enter();
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        return true;
      }
      return false;
    };

    // 立即试一次；未命中（可能是壳标志未到）则每 500ms 重试，最多 10 次
    if (!tryActivate()) {
      timer = setInterval(() => {
        attempts += 1;
        if (tryActivate() || attempts >= 10) {
          if (timer) clearInterval(timer);
          timer = null;
        }
      }, 500);
    }

    return () => {
      if (timer) clearInterval(timer);
      uninstalled?.();
      document.documentElement.classList.remove('tv-mode');
    };
  }, []);

  return null;
}
