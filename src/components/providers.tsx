'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ToastProvider } from './toast';
import { AuthProvider } from './auth';
import { ThemeProvider } from './theme';
import { GlobalDownloadManager } from './download-manager';
import { I18nProvider } from '@/lib/i18n';
import { useAppStore, hydrateLiveProbeResults } from '@/lib/store';
import { api, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets, importSourceListContent } from '@/lib/subscription-sync';
import { useAuth } from './auth';
import { TvModeRoot } from './tv/TvModeRoot';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
        },
      })
  );

  // store 配置了 skipHydration：等挂载后再读 localStorage，
  // 保证 hydration 阶段客户端与服务端渲染结果一致。
  useEffect(() => {
    // 先等持久化状态恢复，再拉服务端下发数据：
    // 避免 setEnvSources/setLiveEnvSources 的勾选合并发生在 rehydrate 之前被覆盖
    Promise.resolve(useAppStore.persist.rehydrate())
      .then(() => {
        // 测活缓存从 IndexedDB 恢复（并顺带搬迁旧 localStorage 快照里的存量），
        // 与下方 /api/status 拉取互不依赖，失败静默
        void hydrateLiveProbeResults();
        // 拉取部署者通过 DEFAULT_SOURCES / DEFAULT_LIVE_SOURCES 预置的源（失败时静默忽略）
        // 与 AuthProvider 共用同一 query key，/api/status 全站只发一次
        return queryClient.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() });
      })
      .then((d) => {
        // 预置数据（DEFAULT_SOURCES / DEFAULT_LIVE_SOURCES / DEFAULT_SUBSCRIPTIONS）
        // 预置订阅要经鉴权接口拉取，首屏这次可能发生在登录之前而 401 静默失败；
        // 登录成功后由 AuthProvider 再调一次 applyEnvPresets 补齐（函数幂等）
        if (d) return applyEnvPresets(d);
      })
      .catch(() => {});
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* TV 模式根开关：判定命中后挂 .tv-mode class + 安装焦点引擎；网页模式零影响 */}
      <TvModeRoot />
      {/* i18n Provider 用同步 localStorage 初始化 locale（独立于 zustand），
          保证首帧即拿到正确语言，无闪烁 */}
      <I18nProvider>
        <ThemeProvider>
          <ToastProvider>
            {/* 全站常驻：下载事件监听（enqueueDownload）依赖它存在——
                挂在 Header 里会让 /watch 等不渲染 Header 的页面派发的事件凭空丢失 */}
            <GlobalDownloadManager />
            <AuthProvider>
              {/* 随站源自动导入依赖登录态（verified 在 AuthContext 里），
                  必须放在 AuthProvider 内部才能用 useAuth 读取 */}
              <BundledSourceImport />
              {children}
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

/**
 * 首屏自动导入随站打包的 LibreTV-SourceList.json：仅当用户尚未配置任何点播/预置源、
 * 且已登录（/api/source-list 需要鉴权）时触发一次。复用 importSourceListContent，
 * 走与「设置里手动文件导入」完全相同的服务端解析 + SSRF 校验管线，失败静默忽略。
 * 这样 Web 与 APK 首次登录后开箱即带默认点播/直播源，无需手动导入。
 *
 * （从 Providers 主体内抽出：verified 登录态在 AuthContext 中，本组件位于
 * AuthProvider 内部，能直接 useAuth 订阅；原实现误从 AppState 读 verified 且
 * 漏 import importSourceListContent，属于存量 TS 错误，此处一并修正。）
 */
function BundledSourceImport() {
  const { verified } = useAuth();
  useEffect(() => {
    if (!verified) return; // 未登录时 /api/source-list 必 401，不打无效请求
    let importing = false;
    const FLAG = 'lt_bundled_source_imported';
    const unsub = useAppStore.subscribe((s) => {
      if (importing) return;
      const hasSources = s.customAPIs.length > 0 || s.envSources.length > 0;
      if (hasSources || localStorage.getItem(FLAG)) return;
      importing = true;
      fetch('/LibreTV-SourceList.json')
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((text) => importSourceListContent(text))
        .then(() => localStorage.setItem(FLAG, '1'))
        .catch(() => {
          // 失败不写标记，下次满足条件再试；复位 importing 避免永久卡死
          importing = false;
        });
    });
    return unsub;
  }, [verified]);
  return null;
}
