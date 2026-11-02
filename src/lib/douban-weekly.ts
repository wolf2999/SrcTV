import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';

/**
 * 影视热榜聚合。
 * 豆瓣五个周榜：优先服务端【直连豆瓣 rexxar v2 移动端接口】
 * （m.douban.com/rexxar/api/v2/subject_collection/...，需伪装 iPhone UA），
 * 字段最新最全；仅在直连被拒/限流时降级到 60s API 代理（免 key，
 * https://github.com/vikiboss/60s）代为抓取。百度热播剧榜解析 top.baidu.com，
 * 仍经 60s 转发。这里只做服务端转发 + 内存缓存 + 字段归一。
 * 60s 默认走社区实例 crystelf.top，失败自动回退官方公共实例（每日额度有限，
 * 数据中心出口 IP 常被限流，不可依赖）；可用 60S_API_BASE 指向自部署实例。
 */

const CACHE_TTL = 60 * 60 * 1000;

// rexxar v2 直连（豆瓣移动端接口）：扁平返回 subject_collection_items[]
const DOUBAN_REXXAR = 'https://m.douban.com/rexxar/api/v2/subject_collection';
const REXXAR_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

// 60s API 代理（降级 / 百度榜用）
const UA = 'LibreTV (+https://github.com/LibreSpark/LibreTV)';
const FALLBACK_BASE = 'https://60s.viki.moe';

function apiBase(): string {
  return (process.env['60S_API_BASE'] || 'https://60s.crystelf.top').replace(/\/+$/, '');
}

/** 榜单 → 豆瓣 rexxar v2 collection 名（见 RSSHub douban 路由）；百度榜无对应 */
const REXXAR_COLLECTION: Partial<Record<HotListId, string>> = {
  douban_movie_weekly: 'movie_weekly_best',
  douban_tv_chinese: 'tv_chinese_best_weekly',
  douban_tv_global: 'tv_global_best_weekly',
  douban_show_chinese: 'show_chinese_best_weekly',
  douban_show_global: 'show_global_best_weekly',
};

/** 榜单标识：豆瓣五个周榜 + 百度热播剧榜 */
export const HOT_LIST_IDS = [
  'douban_movie_weekly',
  'douban_tv_chinese',
  'douban_tv_global',
  'douban_show_chinese',
  'douban_show_global',
  'baidu_teleplay',
] as const;

export type HotListId = (typeof HOT_LIST_IDS)[number];

export function isHotListId(id: string): id is HotListId {
  return (HOT_LIST_IDS as readonly string[]).includes(id);
}

const DOUBAN_WEEKLY_CATEGORY: Partial<Record<HotListId, string>> = {
  douban_movie_weekly: 'movie',
  douban_tv_chinese: 'tv_chinese',
  douban_tv_global: 'tv_global',
  douban_show_chinese: 'show_chinese',
  douban_show_global: 'show_global',
};

// —— 60s API 原始结构（只取用到的字段） ——

interface DoubanWeeklyRaw {
  id?: number | string;
  title?: string;
  rating?: number;
  cover_proxy?: string;
  cover?: string;
}

interface BaiduTeleplayRaw {
  title?: string;
  cover?: string | null;
}

interface SixtyResponse<T> {
  code?: number;
  data?: T;
}

/** 豆瓣周榜条目 → DoubanItem；缺标题或封面的脏数据丢弃 */
export function doubanWeeklyToItem(raw: DoubanWeeklyRaw, isTv: boolean): DoubanItem | undefined {
  // 原生 cover 是 img*.doubanio.com，命中图片代理的豆瓣白名单并带 Referer 伪装，
  // 可稳定加载；cover_proxy（doubanio.viki.moe 公共镜像）限流严重，仅作兜底
  const cover = raw.cover || raw.cover_proxy;
  if (!raw.id || !raw.title || !cover) return undefined;
  return {
    id: String(raw.id),
    title: raw.title,
    cover,
    rating: raw.rating && raw.rating > 0 ? String(raw.rating) : undefined,
    isTv,
  };
}

// —— 豆瓣 rexxar v2 直连：扁平返回 subject_collection_items[] ——

interface RexxarSubject {
  id?: number | string;
  title?: string;
  type?: string;
  rating?: { value?: number };
  cover_url?: string;
  pic?: { large?: string; normal?: string };
}

/** 豆瓣 rexxar 条目 → DoubanItem；缺标题或封面的脏数据丢弃 */
export function rexxarSubjectToItem(raw: RexxarSubject): DoubanItem | undefined {
  const cover = raw.cover_url || raw.pic?.large || raw.pic?.normal;
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

/** 服务端直连豆瓣 rexxar v2 周榜接口（优先于 60s 代理） */
async function fetchDoubanWeeklyRexxar(collection: string): Promise<DoubanItem[]> {
  const target = `${DOUBAN_REXXAR}/${collection}/items?count=25&start=0`;
  const res = await fetchUpstream(target, {
    timeoutMs: 8000,
    headers: {
      'User-Agent': REXXAR_UA,
      Referer: 'https://m.douban.com/',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`rexxar 响应异常 (${res.status})`);
  const data = (await res.json()) as { subject_collection_items?: unknown };
  const arr = data.subject_collection_items;
  if (!Array.isArray(arr)) throw new Error('rexxar 数据异常');
  return arr
    .map((s) => rexxarSubjectToItem(s as RexxarSubject))
    .filter((item): item is DoubanItem => item !== undefined);
}

/** 百度热播剧条目 → DoubanItem；无评分，海报为空的条目丢弃 */
export function baiduTeleplayToItem(raw: BaiduTeleplayRaw, index: number): DoubanItem | undefined {
  if (!raw.title || !raw.cover) return undefined;
  return {
    // 百度榜无稳定 id，用榜单内序号保证 React key 唯一
    id: `baidu_${index}`,
    title: raw.title,
    cover: raw.cover,
    isTv: true,
  };
}

function assertArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${what}数据异常`);
  return value as T[];
}

async function fetchJson(path: string): Promise<unknown> {
  const primary = apiBase();
  // 主实例失败（限流/宕机/网络不通）时回退官方实例；两者相同则只试一次
  const bases = primary === FALLBACK_BASE ? [primary] : [primary, FALLBACK_BASE];

  let lastError: unknown;
  for (const base of bases) {
    try {
      const res = await fetchUpstream(`${base}${path}`, {
        timeoutMs: 8000,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`60s API 响应异常 (${res.status})`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('60s API 请求失败');
}

export async function fetchHotList(id: HotListId): Promise<DoubanItem[]> {
  const cacheKey = `hot-list:${id}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  let items: DoubanItem[];

  const category = DOUBAN_WEEKLY_CATEGORY[id];
  if (category) {
    // 升级：优先直连豆瓣 rexxar v2 接口，失败或返回空再降级到 60s 代理
    let rexxarItems: DoubanItem[] | null = null;
    const collection = REXXAR_COLLECTION[id];
    if (collection) {
      try {
        rexxarItems = await fetchDoubanWeeklyRexxar(collection);
      } catch {
        // 直连失败（被拒/限流），下方走 60s 降级
      }
    }
    if (rexxarItems && rexxarItems.length > 0) {
      items = rexxarItems;
    } else {
      const raw = (await fetchJson(`/v2/douban/weekly/${category}`)) as SixtyResponse<DoubanWeeklyRaw[]>;
      const isTv = id !== 'douban_movie_weekly';
      items = assertArray<DoubanWeeklyRaw>(raw.data, '豆瓣周榜')
        .map((entry) => doubanWeeklyToItem(entry, isTv))
        .filter((item): item is DoubanItem => item !== undefined);
    }
  } else {
    const raw = (await fetchJson('/v2/baidu/teleplay')) as SixtyResponse<BaiduTeleplayRaw[]>;
    items = assertArray<BaiduTeleplayRaw>(raw.data, '百度热播剧榜')
      .map((entry, i) => baiduTeleplayToItem(entry, i))
      .filter((item): item is DoubanItem => item !== undefined);
  }

  if (items.length === 0) throw new Error('榜单数据为空');

  setCache(cacheKey, items, CACHE_TTL);
  return items;
}
