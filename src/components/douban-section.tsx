'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { DoubanCard } from './video-card';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 首页推荐区：数据源由设置决定（豆瓣热门 / Bangumi 新番放送 / 影视热榜），二选一展示 */
export function RecommendSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiView onPick={onPick} />;
  if (recommendSource === 'hot-list') return <HotListView onPick={onPick} />;
  return <DoubanView onPick={onPick} />;
}

/**
 * 豆瓣推荐：影视切换 + 标签筛选。
 * 一次性渲染全部条目：数据本就一次拉全（50 条），卡片图片又是 lazy 加载，
 * 视口外的图不会请求，因此不需要「加载更多」这类本地切片分页来打断浏览。
 */
function DoubanView({ onPick }: { onPick: (title: string) => void }) {
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('热门');
  // 「管理标签」面板开关
  const [managing, setManaging] = useState(false);
  const { t } = useI18n();
  const doubanCustomTags = useAppStore((s) => s.doubanCustomTags);
  const addDoubanTag = useAppStore((s) => s.addDoubanTag);
  const removeDoubanTag = useAppStore((s) => s.removeDoubanTag);

  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
  });

  // 内置标签 + 用户自定义标签（自定义追加在尾部，豆瓣接口接受任意 tag）；
  // 标签词同时是请求参数，展示经 t() 翻译、请求仍用原词（豆瓣端按中文词匹配）
  const builtInTags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const tags = [...builtInTags, ...doubanCustomTags.filter((t) => !builtInTags.includes(t))];
  const items = query.data?.items ?? [];

  const switchType = (t: 'movie' | 'tv') => {
    if (t === type) return;
    setType(t);
    setTag('热门');
  };

  return (
    <section aria-label="影视推荐">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-chip rounded-lg p-0.5">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              {t('电影')}
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              {t('剧集')}
            </TypeButton>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {/* 注意：循环变量不能用 t（会遮蔽翻译函数），tag 展示经翻译、请求仍用原词 */}
        {tags.map((tg) => (
          <button
            key={tg}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs transition-colors',
              tg === tag ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
            )}
            onClick={() => setTag(tg)}
          >
            {t(tg)}
          </button>
        ))}
        {/* 管理标签入口：打开自定义标签面板 */}
        <button
          className="px-2.5 py-1 rounded-full text-xs bg-chip text-muted hover:text-content hover:bg-hover transition-colors"
          onClick={() => setManaging((v) => !v)}
        >
          {t('+ 管理标签')}
        </button>
      </div>

      {managing && (
        <TagManager onAdd={addDoubanTag} onRemove={removeDoubanTag} tags={doubanCustomTags} onClose={() => setManaging(false)} />
      )}

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">{t('推荐内容加载失败，可稍后重试或在设置中关闭')}</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">{t('该分类暂无推荐内容')}</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 自定义标签管理面板：输入添加、点击 × 删除。
 * 自定义标签会作为豆瓣接口的 tag 参数直接生效（豆瓣支持任意标签词）。
 */
function TagManager({
  tags,
  onAdd,
  onRemove,
  onClose,
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const { t } = useI18n();

  const submit = () => {
    if (!input.trim()) return;
    onAdd(input);
    setInput('');
  };

  return (
    <div className="mb-4 rounded-lg bg-chip p-3">
      <div className="flex items-center gap-2 mb-3">
        <input
          className="flex-1 min-w-0 rounded-md bg-hover px-3 py-1.5 text-sm text-content outline-none placeholder:text-faint"
          placeholder={t('输入自定义标签，如：科幻 / 悬疑 / 西部片')}
          value={input}
          maxLength={20}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          className="px-3 py-1.5 rounded-md text-sm bg-accent text-on-accent shrink-0"
          onClick={submit}
        >
          {t('添加')}
        </button>
        <button
          className="px-3 py-1.5 rounded-md text-sm text-muted hover:text-content shrink-0"
          onClick={onClose}
        >
          {t('关闭')}
        </button>
      </div>
      {tags.length === 0 ? (
        <p className="text-xs text-faint">{t('还没有自定义标签，添加后会出现在上方标签栏末尾')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-hover text-content"
            >
              {t}
              <button
                aria-label={`删除标签 ${t}`}
                className="text-faint hover:text-accent transition-colors"
                onClick={() => onRemove(t)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bangumi 每日放送：星期筛选，一次拉全量无分页 */
function BangumiView({ onPick }: { onPick: (title: string) => void }) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');
  const { t } = useI18n();

  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  let items: DoubanItem[] = [];
  if (query.data) {
    items = weekday === 'all'
      ? query.data.days.flatMap((d) => d.items)
      : (query.data.days.find((d) => d.weekday === weekday)?.items ?? []);
  }

  return (
    <section aria-label={t('新番放送推荐')}>
      <div className="flex flex-wrap gap-1.5 mb-4">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>
          {t('全部')}
        </ChipButton>
        {WEEKDAYS.map((name, i) => (
          <ChipButton key={name} active={weekday === i + 1} onClick={() => setWeekday(i + 1)}>
            {t(name)}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">{t('推荐内容加载失败，可稍后重试或在设置中关闭')}</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

const HOT_LISTS = [
  { id: 'douban_movie_weekly', label: '电影周榜' },
  { id: 'douban_tv_chinese', label: '国产剧周榜' },
  { id: 'douban_tv_global', label: '海外剧周榜' },
  { id: 'douban_show_chinese', label: '国内综艺' },
  { id: 'douban_show_global', label: '海外综艺' },
  { id: 'baidu_teleplay', label: '百度热播剧' },
];

/** 影视热榜（60s API）：豆瓣五个周榜 + 百度热播剧，chips 切换 */
function HotListView({ onPick }: { onPick: (title: string) => void }) {
  const [listId, setListId] = useState(HOT_LISTS[0].id);
  const { t } = useI18n();

  const query = useQuery({
    queryKey: ['hot-list', listId],
    queryFn: ({ signal }) => api.hotList(listId, signal),
  });

  const items = query.data?.items ?? [];

  return (
    <section aria-label={t('影视榜单推荐')}>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {HOT_LISTS.map((l) => (
          <ChipButton key={l.id} active={listId === l.id} onClick={() => setListId(l.id)}>
            {t(l.label)}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">{t('推荐内容加载失败，可稍后重试或在设置中关闭')}</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
          {items.map((item) => (
            <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
          <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'px-2.5 py-1 rounded-full text-xs transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-md text-sm transition-colors', active ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
