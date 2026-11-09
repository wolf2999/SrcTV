'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { LOCALE_META, useI18n, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isTvMode } from '@/lib/tv-mode';
import { useTvKeyboard } from './tv/useTvKeyboard';

/** 顶部导航：Logo、搜索框（首页外）、语言切换、历史、设置 */
export function Header({ showSearch = false }: { showSearch?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

  // TV 模式：搜索框聚焦时弹出虚拟键盘（英文/数字 + 语音）；网页模式不弹
  const kb = useTvKeyboard({
    value: query,
    onChange: setQuery,
    onSubmit: () => submitSearch(query),
  });

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    router.push(`/?s=${encodeURIComponent(q)}`, { scroll: false });
    // 顶栏搜索一并写入最近搜索（此前只有首页会记录）
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" aria-label="SrcTV 首页" className="flex items-center shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="SrcTV" className="w-7 h-7 rounded-lg" />
          </Link>

          {showSearch && (
            <form
              className="flex-1 max-w-xl hidden sm:block"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <input
                  className={cn(
                    'input w-full h-9',
                    // 展开时：上圆角与外框沿用聚焦样式，底边改为内部分隔线，与下拉拼成同一面板
                    searchHistory.visible &&
                      'rounded-b-none border-accent border-b-line bg-surface-raised focus-visible:ring-0'
                  )}
                  aria-label={t('搜索影片')}
                  placeholder={t('搜索影片...')}
                  value={query}
                  maxLength={100}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={() => {
                    if (isTvMode()) kb.handleInputFocus();
                    else searchHistory.onFocus();
                  }}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `header-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>
          )}

          <div className="flex-1 sm:hidden" />

          <nav className="flex items-center gap-1 ml-auto">
            <HeaderLink href="/live" active={pathname === '/live'}>
              {t('直播')}
            </HeaderLink>
            <HeaderLink href="/about" active={pathname === '/about'}>
              {t('关于')}
            </HeaderLink>
            <LanguageSwitcher />
            <ThemeToggle />
            <IconButton label={t('观看历史')} onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
            </IconButton>
            {/* data-tv-hide：TV 模式隐藏标记（惰性 data 钩子，无逻辑分支）。
                下载管理与设置入口在 TV 上由 Web 端 TV 层隐藏（tv.css）：
                下载依赖鼠标/长按交互遥控器用不上；设置页表单密集不适合远距离操作。
                网页模式不挂 .tv-mode，此标记不产生任何效果。 */}
            <IconButton
              label={t('下载管理')}
              data-tv-hide="download"
              onClick={requestShowDownloadManager}
            >
              <Icon name="download" />
            </IconButton>
            <IconButton label={t('设置')} data-tv-hide="settings" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" />
            </IconButton>
          </nav>
        </div>
      </header>

      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      {kb.keyboard}
    </>
  );
}

/**
 * 语言切换下拉：简体 / 繁體 / English。
 * 选中态打点；点击面板外部关闭；切换立即生效并持久化（I18nProvider 负责）。
 */
function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击面板外关闭（mousedown 提前于 click，避免点击选项时先触发外点关闭的竞态）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (l: Locale) => {
    setLocale(l);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
        title={t('语言')}
        aria-label={t('语言')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="globe" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[9rem] rounded-lg border border-line bg-surface-raised shadow-lg py-1 z-50"
        >
          {LOCALE_META.map((m) => (
            <button
              key={m.value}
              role="menuitemradio"
              aria-checked={locale === m.value}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center justify-between',
                locale === m.value ? 'text-accent bg-hover' : 'text-content hover:bg-hover'
              )}
              onClick={() => pick(m.value)}
            >
              {m.label}
              {locale === m.value && <Icon name="check" className="w-4 h-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HeaderLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'px-2.5 py-1.5 rounded-md text-sm transition-colors',
        active ? 'text-content bg-hover' : 'text-muted hover:text-content'
      )}
    >
      {children}
    </Link>
  );
}

function IconButton({
  label,
  onClick,
  children,
  ...rest
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  /** 允许调用方附加惰性 data-* 属性（如 data-tv-hide），供 TV 层 CSS 选择器使用 */
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      title={label}
      aria-label={label}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
