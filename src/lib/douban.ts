import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';

/**
 * 豆瓣推荐数据获取（服务端直连，带内存缓存与降级链）。
 * 旧版在浏览器里经公共 CORS 代理请求豆瓣（隐私差且不稳定），
 * 重构后由服务端直连，仅在直连被拒时降级到公共代理。
 *
 * 年份/年代类标签（2026、90年代 等）在 search_subjects 里基本无数据，
 * 改走豆瓣移动端 rexxar v2 recommend 分类筛选接口（豆瓣 App「分类筛选」同款），
 * 该接口支持任意年份与年代词；失败仍降级回 search_subjects。
 */

const DOUBAN_API = 'https://movie.douban.com/j/search_subjects';
const DOUBAN_REXXAR_RECOMMEND = 'https://m.douban.com/rexxar/api/v2';
const CACHE_TTL = 10 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
// rexxar 移动端接口需伪装 iPhone UA
const REXXAR_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

interface DoubanRawSubject {
  id: string;
  title: string;
  cover: string;
  rate: string;
  url?: string;
}

/** rexxar recommend 扁平条目（与周榜结构同族，pic/rating 为对象） */
interface RexxarRecommendItem {
  id?: number | string;
  title?: string;
  type?: string;
  year?: string;
  rating?: { value?: number };
  pic?: { large?: string; normal?: string };
  cover_url?: string;
}

/** 年份/年代类标签：2026、1999、90年代、80年代 */
function isYearTag(tag: string): boolean {
  return /^(19|20)\d{2}$/.test(tag) || /^\d{2}年代$/.test(tag);
}

function fallbackProxies(): string[] {
  const proxies: string[] = [];
  if (process.env.FALLBACK_CORS_PROXY) proxies.push(process.env.FALLBACK_CORS_PROXY);
  return proxies;
}

/** rexxar recommend 条目 → DoubanItem；缺标题或封面的脏数据丢弃 */
function rexxarRecommendToItem(raw: RexxarRecommendItem): DoubanItem | undefined {
  const cover = raw.pic?.large || raw.pic?.normal || raw.cover_url;
  if (!raw.id || !raw.title || !cover) return undefined;
  const value = raw.rating?.value;
  return {
    id: String(raw.id),
    title: raw.title,
    cover,
    rating: value && value > 0 ? String(value) : undefined,
    isTv: raw.type === 'tv',
  };
}

/**
 * 经 rexxar v2 recommend 接口按年份/年代筛选（豆瓣 App 分类筛选同款）。
 * movie → /movie/recommend，tv → /tv/recommend；tags 直接接受年份或年代词。
 */
async function fetchDoubanByYear(
  type: 'movie' | 'tv',
  tag: string,
  pageStart: number,
  pageSize: number
): Promise<DoubanItem[]> {
  // selected_categories 固定为对应大分类，tags 承载年份/年代筛选
  const categories = encodeURIComponent(type === 'tv' ? '{"类型":"电视剧"}' : '{"类型":"电影"}');
  const target =
    `${DOUBAN_REXXAR_RECOMMEND}/${type}/recommend` +
    `?start=${pageStart}&count=${pageSize}&tags=${encodeURIComponent(tag)}` +
    `&selected_categories=${categories}&uncollect=false`;

  const res = await fetchUpstream(target, {
    timeoutMs: 8000,
    headers: { 'User-Agent': REXXAR_UA, Referer: 'https://m.douban.com/doubanapp/', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`rexxar recommend 响应异常 (${res.status})`);
  const data = (await res.json()) as { items?: unknown };
  if (!Array.isArray(data.items)) throw new Error('rexxar recommend 数据异常');
  return (data.items as RexxarRecommendItem[])
    .map(rexxarRecommendToItem)
    .filter((item): item is DoubanItem => item !== undefined);
}

export async function fetchDoubanRecommend(
  type: 'movie' | 'tv',
  tag: string,
  pageStart: number,
  pageSize: number
): Promise<DoubanItem[]> {
  const cacheKey = `douban:${type}:${tag}:${pageStart}:${pageSize}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  const target = `${DOUBAN_API}?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart}`;

  let raw: DoubanRawSubject[] | undefined;
  let rexxarItems: DoubanItem[] | null = null;

  // 0) 年份/年代类标签：优先走 rexxar recommend（search_subjects 对近年无数据）
  if (isYearTag(tag)) {
    try {
      rexxarItems = await fetchDoubanByYear(type, tag, pageStart, pageSize);
      if (rexxarItems.length > 0) {
        setCache(cacheKey, rexxarItems, CACHE_TTL);
        return rexxarItems;
      }
    } catch {
      // 失败降级到 search_subjects 链路
    }
  }

  // 1) 服务端直连
  try {
    const res = await fetchUpstream(target, {
      timeoutMs: 8000,
      headers: { 'User-Agent': UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as { subjects?: DoubanRawSubject[] };
      raw = data.subjects;
    }
  } catch {
    // 忽略，走降级
  }

  // 2) 降级：经 FALLBACK_CORS_PROXY
  if (!raw) {
    for (const proxy of fallbackProxies()) {
      try {
        const res = await fetchUpstream(proxy + encodeURIComponent(target), {
          timeoutMs: 8000,
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          const data = (await res.json()) as { subjects?: DoubanRawSubject[] };
          raw = data.subjects;
          if (raw) break;
        }
      } catch {
        // 继续尝试下一个
      }
    }
  }

  // 3) 年份标签在 search_subjects 全链路都空时，回退刚才 rexxar 的结果（可能为空数组则报错）
  if (!raw) {
    if (rexxarItems && rexxarItems.length > 0) {
      setCache(cacheKey, rexxarItems, CACHE_TTL);
      return rexxarItems;
    }
    throw new Error('豆瓣推荐获取失败');
  }

  const items: DoubanItem[] = raw.map((s) => ({
    id: s.id,
    title: s.title,
    cover: s.cover,
    rating: s.rate && s.rate !== '0' ? s.rate : undefined,
    isTv: type === 'tv',
  }));

  setCache(cacheKey, items, CACHE_TTL);
  return items;
}
