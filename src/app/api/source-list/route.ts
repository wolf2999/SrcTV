import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkLiveUrlAllowed, checkUpstreamAllowed, isValidProxyUrl } from '@/lib/ssrf';
import { fetchUpstream } from '@/lib/fetch-utils';
import { describeParseStats, parseSubscriptionJson, parseSubscriptionPayload, withSkipped } from '@/lib/tvbox-parser';
import type { SourceListPayload } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * 拉取远程数据源订阅，自动识别两种格式：
 * 1. LibreTV-SourceList JSON：{ name?, sources: [点播源], liveSources: [直播源] }（也接受裸数组与老格式）；
 * 2. TVBOX 配置 JSON：{ sites: [站点], lives: [直播源] }，仅导入直连类条目
 *    （type=1 的 Apple CMS 接口与 M3U 直播），Spider / XML 等跳过并计入统计。
 *
 * 点播源与直播源的地址放行策略不同（点播一律拒绝内网，直播可用 LIVE_ALLOW_PRIVATE 放行），
 * 因此两类分别校验，不能共用一把尺子；被校验拦下的条目同样计入统计，便于前端说明导入结果。
 */
/**
 * 订阅文本 → 解析 + 安全校验的共享管线（GET 远程拉取与 POST 本地文件导入共用）：
 * - LibreTV-SourceList JSON / TVBOX 配置 / 接口目录由 parseSubscriptionPayload 自动识别；
 * - 点播源拒绝内网地址，直播源按直播策略校验，EPG 地址非法时丢弃该字段而非整条源。
 */
async function processSubscriptionText(text: string): Promise<
  { ok: true; payload: SourceListPayload } | { ok: false; status: number; error: string }
> {
  let parsed;
  try {
    parsed = parseSubscriptionPayload(parseSubscriptionJson(text));
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : '订阅内容格式不正确' };
  }

  // 点播源：拒绝非公网地址（DNS 层校验在搜索/详情请求时另有兜底）
  const sources = parsed.sources.filter((s) => isValidProxyUrl(s.url));

  // 直播源：按直播策略校验，EPG 地址非法时丢弃该字段而非整条源
  const checkedLive = await Promise.all(
    parsed.liveSources.map(async (s) => {
      if (!(await checkLiveUrlAllowed(s.url)).ok) return null;
      if (s.epg && !(await checkLiveUrlAllowed(s.epg)).ok) return { ...s, epg: undefined };
      return s;
    })
  );
  const liveSources = checkedLive.filter((s): s is NonNullable<typeof s> => s !== null);

  // 被服务端校验拦下的条目也计入统计，用户能看清「配置里有 N 条却只导入 M 条」的原因
  const dropped = parsed.sources.length - sources.length + (parsed.liveSources.length - liveSources.length);
  const stats = withSkipped(parsed.stats, 'invalidUrl', dropped);

  if (sources.length === 0 && liveSources.length === 0) {
    const detail = describeParseStats(stats);
    return { ok: false, status: 400, error: detail ? `订阅未导入任何可用源：${detail}` : '订阅内容为空' };
  }

  const payload: SourceListPayload = { name: parsed.name, sources, liveSources, stats };
  return { ok: true, payload };
}

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const requestUrl = new URL(req.url);
  const target = (requestUrl.searchParams.get('url') || '').trim();
  if (!/^https?:\/\//.test(target)) {
    return NextResponse.json({ error: '无效的订阅地址' }, { status: 400 });
  }

  const verdict = await checkUpstreamAllowed(target);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 403 });
  }

  try {
    const res = await fetchUpstream(target, { timeoutMs: 8000, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return NextResponse.json({ error: `订阅地址返回 HTTP ${res.status}` }, { status: 502 });
    }
    // 读文本而非 res.json()：部分配置带注释/尾随逗号，需要宽容解析
    const text = await res.text();

    const result = await processSubscriptionText(text);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '订阅拉取失败' },
      { status: 502 }
    );
  }
}

/**
 * 本地文件导入：客户端读取用户选择的 JSON 文本后 POST 上来，走与 GET 完全相同的
 * 解析与安全校验管线。之所以放服务端而不是客户端解析：SSRF 白名单校验（内网地址
 * 判定、DNS 检查）都在服务端，客户端导入也必须过同一道闸。
 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let content: string;
  try {
    const body = (await req.json()) as { content?: unknown };
    if (typeof body.content !== 'string' || !body.content.trim()) {
      return NextResponse.json({ error: '缺少文件内容' }, { status: 400 });
    }
    // 2MB 上限：TVBOX 配置通常几十 KB，超限基本是选错文件
    if (body.content.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: '文件过大（上限 2MB）' }, { status: 413 });
    }
    content = body.content;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const result = await processSubscriptionText(content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.payload);
}
