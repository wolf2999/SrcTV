/**
 * 脱离 React context 的独立翻译（仅供 global-error.tsx 等渲染在 Providers 之外的场景）。
 * 词典与 i18n.tsx 共用同一套聚合来源，locale 从 localStorage 同步读取；
 * 读取失败（SSR/隐私模式）按浏览器语言检测，再失败回退简体原文。
 */
import {
  EN_DICT,
  LOCALE_STORAGE_KEY,
  ZH_TW_DICT,
  type Locale,
} from './i18n';

function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of langs) {
    const lang = (raw || '').toLowerCase();
    if (lang.startsWith('zh')) {
      if (lang.includes('hant') || /-(tw|hk|mo)\b/.test(lang)) return 'zh-TW';
      return 'zh-CN';
    }
    if (lang.startsWith('en')) return 'en';
  }
  return 'en';
}

function currentLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'zh-TW' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return detectLocale();
}

/** 独立 t()：与 useI18n().t 同语义，可在任意非 React 环境调用 */
export function tStandalone(text: string): string {
  const locale = currentLocale();
  if (locale === 'zh-CN') return text;
  const dict = locale === 'en' ? EN_DICT : ZH_TW_DICT;
  return dict[text] ?? text;
}
