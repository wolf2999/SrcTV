'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * 轻量 i18n：简体中文（zh-CN，源语言）/ 繁体中文（zh-TW）/ 英文（en）。
 *
 * 设计取舍：全站文案以简体中文内联书写，词典以「简体中文原文 → 译文」为键，
 * t() 在 zh-CN 下原样返回、其余语言查表，缺条目时回退原文。
 * 这样组件改造只需把字符串包一层 t()，不必为每条文案造 key，增量补词典即可。
 *
 * locale 持久化在 localStorage（libretv-lang），早于 zustand rehydrate 可同步读取，
 * 避免语言闪烁；未存储时按 navigator.language 自动检测：
 * zh-TW/zh-HK/zh-Hant/zh-MO → zh-TW，zh-* → zh-CN，其余 → en（按需求默认英文）。
 */

export type Locale = 'zh-CN' | 'zh-TW' | 'en';

export const LOCALE_STORAGE_KEY = 'libretv-lang';

export const LOCALE_META: { value: Locale; label: string; htmlLang: string }[] = [
  { value: 'zh-CN', label: '简体中文', htmlLang: 'zh-CN' },
  { value: 'zh-TW', label: '繁體中文', htmlLang: 'zh-TW' },
  { value: 'en', label: 'English', htmlLang: 'en' },
];

/** 按 navigator.language 推断初始 locale（无匹配默认英文） */
function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of langs) {
    const lang = (raw || '').toLowerCase();
    if (!lang) continue;
    if (lang.startsWith('zh')) {
      // 繁体地区/书写系统优先判定，再回落简体
      if (lang.includes('hant') || /-(tw|hk|mo)\b/.test(lang)) return 'zh-TW';
      return 'zh-CN';
    }
    if (lang.startsWith('en')) return 'en';
  }
  return 'en';
}

/** 同步读取初始 locale：已存 > 浏览器语言检测（SSR 期间返回简体默认，客户端 hydrate 后校正） */
function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'zh-TW' || saved === 'en') return saved;
  } catch {
    /* 隐私模式等场景 localStorage 不可读，走检测 */
  }
  return detectLocale();
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** 翻译：zh-CN 原样返回；zh-TW / en 查词典，缺条目回退原文（原文即简体中文） */
  t: (text: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh-CN',
  setLocale: () => {},
  t: (text) => text,
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());

  // 首帧同步 <html lang>，供无障碍与浏览器翻译识别
  useEffect(() => {
    const meta = LOCALE_META.find((m) => m.value === locale);
    document.documentElement.lang = meta?.htmlLang ?? 'zh-CN';
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* 持久化失败不影响本会话切换 */
    }
  }, []);

  const t = useCallback(
    (text: string) => {
      if (locale === 'zh-CN') return text;
      const dict = locale === 'en' ? EN_DICT : ZH_TW_DICT;
      return dict[text] ?? text;
    },
    [locale]
  );

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

// —— 词典（以简体中文原文为键；增量维护，缺条目自动回退简体） ——

// 各域词典分文件维护（src/lib/i18n-dicts/），此处聚合；
// 键冲突时后展开的覆盖前者——各域键来自不同组件文案，正常不会冲突
import { EN_SETTINGS, ZH_TW_SETTINGS } from './i18n-dicts/en-settings';
import { EN_PLAYER, ZH_TW_PLAYER } from './i18n-dicts/en-player';
import { EN_LIVE, ZH_TW_LIVE } from './i18n-dicts/en-live';
import { EN_COMMON, ZH_TW_COMMON } from './i18n-dicts/en-common';

// 繁体词典（核心域：header / 首页 / 豆瓣区 / 认证 / 页脚）
const ZH_TW_CORE: Record<string, string> = {
  // 通用
  '搜索': '搜尋',
  '搜索影片': '搜尋影片',
  '搜索影片...': '搜尋影片...',
  '输入影片名称...': '輸入影片名稱...',
  '清空': '清空',
  '直播': '直播',
  '关于': '關於',
  '观看历史': '觀看歷史',
  '下载管理': '下載管理',
  '设置': '設定',
  '加载更多': '載入更多',
  '没有找到匹配的结果': '沒有找到符合的結果',
  '请尝试其他关键词或更换点播源': '請嘗試其他關鍵詞或更換點播源',
  '请输入搜索内容': '請輸入搜尋內容',
  '请先在设置中添加并勾选点播源': '請先在設定中新增並勾選點播源',
  '请求失败': '請求失敗',
  '超时': '逾時',
  '以下源暂时无响应：': '以下源暫時無回應：',
  '部分点播源请求失败：': '部分點播源請求失敗：',
  '尚未勾选点播源': '尚未勾選點播源',
  '先添加一个点播源': '先新增一個點播源',
  // 首页搜索结果
  '的搜索结果': '的搜尋結果',
  '个源失败': '個源失敗',
  '部影片': '部影片',
  '条结果': '條結果',
  '已就绪': '已就緒',
  '个源…': '個源…',
  // 认证
  '需要配置密码': '需要設定密碼',
  '访问验证': '存取驗證',
  '请输入密码继续访问': '請輸入密碼繼續存取',
  '密码': '密碼',
  '验证中...': '驗證中...',
  '进入': '進入',
  '验证失败': '驗證失敗',
  '密码错误': '密碼錯誤',
  '已退出登录': '已登出',
  '验证成功': '驗證成功',
  // 豆瓣推荐区
  '电影': '電影',
  '剧集': '劇集',
  '热门': '熱門',
  '最新': '最新',
  '经典': '經典',
  '豆瓣高分': '豆瓣高分',
  '冷门佳片': '冷門佳片',
  '华语': '華語',
  '欧美': '歐美',
  '韩国': '韓國',
  '日本': '日本',
  '动画': '動畫',
  '美剧': '美劇',
  '英剧': '英劇',
  '韩剧': '韓劇',
  '日剧': '日劇',
  '国产剧': '國產劇',
  '港剧': '港劇',
  '日本动画': '日本動畫',
  '综艺': '綜藝',
  '纪录片': '紀錄片',
  '全部': '全部',
  '周一': '週一',
  '周二': '週二',
  '周三': '週三',
  '周四': '週四',
  '周五': '週五',
  '周六': '週六',
  '周日': '週日',
  '电影周榜': '電影週榜',
  '国产剧周榜': '國產劇週榜',
  '海外剧周榜': '海外劇週榜',
  '国内综艺': '國內綜藝',
  '海外综艺': '海外綜藝',
  '百度热播剧': '百度熱播劇',
  '推荐内容加载失败，可稍后重试或在设置中关闭': '推薦內容載入失敗，可稍後重試或在設定中關閉',
  '该分类暂无推荐内容': '該分類暫無推薦內容',
  '新番放送推荐': '新番放送推薦',
  '影视榜单推荐': '影視榜單推薦',
  '影视推荐': '影視推薦',
  '+ 管理标签': '+ 管理標籤',
  '输入自定义标签，如：科幻 / 悬疑 / 西部片': '輸入自訂標籤，如：科幻 / 懸疑 / 西部片',
  '添加': '新增',
  '关闭': '關閉',
  '还没有自定义标签，添加后会出现在上方标签栏末尾': '還沒有自訂標籤，新增後會出現在上方標籤列末尾',
  // 页脚
  '发现新版本': '發現新版本',
  '已是最新版本': '已是最新版本',
  '正在检测更新…': '正在檢測更新…',
  // 语言切换
  '语言': '語言',
  '界面语言': '介面語言',
  // 源健康度提示 / 加载更多
  '多次失败，已停止参与搜索，可在设置中恢复': '多次失敗，已停止參與搜尋，可在設定中恢復',
  '连续超时/失败，已停用': '連續逾時/失敗，已停用',
  '还有': '還有',
  '部': '部',
};

// 英文词典（缺条目回退简体中文，逐步补全）
const EN_CORE: Record<string, string> = {
  // 通用
  '搜索': 'Search',
  '搜索影片': 'Search videos',
  '搜索影片...': 'Search videos...',
  '输入影片名称...': 'Enter a title...',
  '清空': 'Clear',
  '直播': 'Live',
  '关于': 'About',
  '观看历史': 'Watch history',
  '下载管理': 'Downloads',
  '设置': 'Settings',
  '加载更多': 'Load more',
  '没有找到匹配的结果': 'No matching results',
  '请尝试其他关键词或更换点播源': 'Try other keywords or change sources',
  '请输入搜索内容': 'Please enter a search term',
  '请先在设置中添加并勾选点播源': 'Add and select video sources in Settings first',
  '请求失败': 'Request failed',
  '超时': 'timeout',
  '以下源暂时无响应：': 'Sources not responding: ',
  '部分点播源请求失败：': 'Some sources failed: ',
  '尚未勾选点播源': 'No sources selected',
  '先添加一个点播源': 'Add your first source',
  // 首页搜索结果
  '的搜索结果': '" search results',
  '个源失败': ' sources failed',
  '部影片': ' titles',
  '条结果': ' results',
  '已就绪': 'ready ',
  '个源…': ' sources…',
  '个源因连续超时/失败已暂停参与搜索（临时停用的到期自动恢复，长期停用的需在设置中手动恢复）：': ' sources paused after repeated timeouts/failures (temporary pauses auto-resume; permanent ones must be restored in Settings): ',
  '个源所属的订阅已停用，未参与本次搜索（在设置 → 数据源订阅中可重新启用）：': ' sources skipped because their subscription is disabled (re-enable in Settings → Subscriptions): ',
  '加载更多（还有': 'Load more (',
  '部）': ' left)',
  // NoSourceGuide
  '，勾选要参与搜索的点播源后重新搜索。': '". Select sources to search, then search again.',
  '填入一个': 'Paste an ',
  '采集站地址（如': 'CMS API endpoint (e.g. ',
  '勾选后即可开始搜索。': '), select it and start searching.',
  // 认证
  '需要配置密码': 'Password required',
  '为确保安全，必须设置': 'For security, the ',
  '环境变量才能使用本服务。': ' environment variable must be set before using this service. ',
  '请联系管理员在部署配置中添加该变量后重启服务。': 'Please ask the administrator to add it to the deployment config and restart.',
  '访问验证': 'Access verification',
  '请输入密码继续访问': 'Enter the password to continue',
  '密码': 'Password',
  '验证中...': 'Verifying...',
  '进入': 'Enter',
  '验证失败': 'Verification failed',
  '密码错误': 'Wrong password',
  '已退出登录': 'Logged out',
  '验证成功': 'Verified',
  // 豆瓣推荐区
  '电影': 'Movies',
  '剧集': 'TV',
  '热门': 'Hot',
  '最新': 'Latest',
  '经典': 'Classics',
  '豆瓣高分': 'Top rated',
  '冷门佳片': 'Hidden gems',
  '华语': 'Chinese',
  '欧美': 'Western',
  '韩国': 'Korean',
  '日本': 'Japanese',
  '动画': 'Anime',
  '美剧': 'US',
  '英剧': 'UK',
  '韩剧': 'K-drama',
  '日剧': 'J-drama',
  '国产剧': 'C-drama',
  '港剧': 'HK',
  '日本动画': 'Anime',
  '综艺': 'Variety',
  '纪录片': 'Documentary',
  '全部': 'All',
  '周一': 'Mon',
  '周二': 'Tue',
  '周三': 'Wed',
  '周四': 'Thu',
  '周五': 'Fri',
  '周六': 'Sat',
  '周日': 'Sun',
  '电影周榜': 'Movie weekly',
  '国产剧周榜': 'C-drama weekly',
  '海外剧周榜': 'Global drama weekly',
  '国内综艺': 'CN variety',
  '海外综艺': 'Global variety',
  '百度热播剧': 'Baidu hot',
  '推荐内容加载失败，可稍后重试或在设置中关闭': 'Failed to load recommendations. Retry later or disable in Settings',
  '该分类暂无推荐内容': 'No recommendations in this category',
  '新番放送推荐': 'Seasonal anime',
  '影视榜单推荐': 'Ranked lists',
  '影视推荐': 'Recommendations',
  '+ 管理标签': '+ Manage tags',
  '输入自定义标签，如：科幻 / 悬疑 / 西部片': 'Custom tag, e.g. Sci-Fi / Mystery / Western',
  '添加': 'Add',
  '关闭': 'Close',
  '还没有自定义标签，添加后会出现在上方标签栏末尾': 'No custom tags yet. Added tags appear at the end of the tag bar',
  // 页脚
  '发现新版本': 'New version available: v',
  '已是最新版本': 'Up to date',
  '正在检测更新…': 'Checking for updates…',
  // 语言切换
  '语言': 'Language',
  '界面语言': 'Interface language',
  // 源健康度提示 / 加载更多
  '多次失败，已停止参与搜索，可在设置中恢复': ' failed repeatedly and has been excluded from search. Restore it in Settings',
  '连续超时/失败，已停用': ' timed out / failed repeatedly; paused for',
  '还有': '',
  '部': 'more',
};

// 聚合各域词典：核心域在前，其余域按文件追加（缺条目回退简体，各域键互不重叠）
// 导出聚合词典（i18n-standalone.ts 等脱离 context 的场景直接查表用）
export const ZH_TW_DICT: Record<string, string> = {
  ...ZH_TW_CORE,
  ...ZH_TW_SETTINGS,
  ...ZH_TW_PLAYER,
  ...ZH_TW_LIVE,
  ...ZH_TW_COMMON,
};
export const EN_DICT: Record<string, string> = {
  ...EN_CORE,
  ...EN_SETTINGS,
  ...EN_PLAYER,
  ...EN_LIVE,
  ...EN_COMMON,
};

// 词条里含插值/拼接的动态文案（如「“xxx” 的搜索结果」）由调用方分段包 t() 处理，
// 词典只收录固定片段；新增组件文案时按同样方式收录即可。
