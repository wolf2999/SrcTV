'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { isTvMode } from '@/lib/tv-mode';
import type { PlayerSkipApi } from '@/components/player-shell';

/** 遥控器方向键单次 seek 步进（秒）。TV 遥控无鼠标拖拽，固定步进更可控 */
const SEEK_STEP = 10;

/** 控制层无操作自动收起的空闲时长（毫秒）：TV 观影场景下功能菜单常驻会挡画面 */
const IDLE_HIDE_MS = 5000;

/**
 * TV 播放控制（M3 / FR-7 / FR-7.2）：把遥控方向键映射到播放器操作，解决「遥控器无法在
 * 播放页控制播放」的问题。逻辑全部集中在此钩子，watch 页面只负责渲染返回的
 * element（零业务分支）。
 *
 * 行为（焦点落在返回的播放控制层时，FR-7.2 改为可见控制条）：
 * - 控制层底部渲染一条可见工具条（快退 / 上一集 / 播放暂停 / 下一集 / 快进 / 全屏），
 *   当前高亮按钮由 .tv-focused 类标记 → 满足「播放控制条焦点可见」；
 * - ← / →：在可见控制条按钮间左右导航（不触发 seek，seek 改为点对应按钮 Enter 触发）；
 * - ↑ / ↓：上一集 / 下一集（多集时，受 hasPrev/hasNext 约束，沿用 M3 语义）；
 * - Enter / 空格：触发当前高亮按钮（含「全屏切换」→ FR-7.2 全屏遥控器可达）；
 * - Esc：退出播放控制（隐藏控制层并把焦点交给剧集列表，便于遥控浏览选集）。
 *
 * 与焦点引擎的协作：tv-focus.ts 对带 data-tv-player-control 的元素放行所有按键
 * （不导航、不触发确认），由本钩子的 onKeyDown 接管；按钮不抢真实焦点（tabIndex=-1），
 * 焦点始终在控制层自身，保证豁免持续生效、且不会误触发 M4 的弹窗关闭（已移除
 * data-tv-trap，避免 watch 页按返回被控制层永久消费、无法路由后退）。
 */
export function useTvPlayerControls(opts: {
  playerApiRef: RefObject<PlayerSkipApi | null>;
  onPrevEpisode: () => void;
  onNextEpisode: () => void;
  hasPrevEpisode: boolean;
  hasNextEpisode: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // exited：退出播放控制后隐藏控制层（不再接收焦点/按键），转为常规页面导航
  const [exited, setExited] = useState(false);
  // active：当前高亮的可见控制按钮下标（FR-7.2：用 .tv-focused 类手动标记，焦点始终在控制层）
  const [active, setActive] = useState(2); // 默认聚焦「播放/暂停」
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = (text: string) => {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2000);
  };

  // 进入播放页且为 TV 模式时，自动把焦点落到播放控制层（无需用户先点播放器）。
  // 元素始终渲染、显隐由 tv.css 的 .tv-mode 作用域控制（避免 hydration 不匹配）。
  // M4-3 真机联调修复（焦点锁定）：单次聚焦会被页面加载期的 Toast / 动态挂载的
  // header 按钮 / WebView 自动 focus 冲掉（实测播放页加载后焦点反复漂移到
  // 「下载本集」「切换资源」，遥控器误触）。策略：每 800ms 检查夺回，直到
  // 用户第一次按键（handleKeyDown 置 userInteracted）或用户 Esc 退出（层 hidden），
  // 之后完全停止干预——保证「进入播放页焦点必在控制条，且用户一操作就放权」。
  const userInteracted = useRef(false);
  // 最近一次按键时间戳：驱动「长时间不操作自动收起控制层」（TV 观影场景菜单常驻挡画面）
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (!isTvMode()) return;
    const id = setInterval(() => {
      const el = ref.current;
      if (!el || userInteracted.current || el.hidden) return;
      if (document.activeElement !== el) el.focus({ preventScroll: true });
    }, 800);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 无操作自动收起：控制层激活期间（未 exited）任何按键都会刷新 lastActivity
  // （handleKeyDown 内统一置位），空闲超过 IDLE_HIDE_MS 即按 Esc 同路径退出
  // （setExited + 焦点交给剧集列表），保证与手动退出完全一致的状态清理。
  // 仅 TV 模式启用；网页端控制层不显示，无需此逻辑。
  useEffect(() => {
    if (!isTvMode() || exited) return;
    lastActivity.current = Date.now();
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current < IDLE_HIDE_MS) return;
      setExited(true);
      requestAnimationFrame(focusEpisodeList);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exited]);

  /** Esc 退出后把焦点移到剧集列表首个可交互元素，便于遥控选集 */
  const focusEpisodeList = () => {
    const list = document.querySelector('[data-tv-episode-list]');
    if (!list) return;
    const target = list.querySelector<HTMLElement>(
      'button, [role="button"], [data-tv-focusable], a[href]'
    );
    target?.focus({ preventScroll: true });
  };

  // FR-7.2 可见控制条按钮定义（顺序即左右导航顺序）
  const CONTROLS = [
    { id: 'rew', label: '⏪', title: '快退 10 秒', hint: '快退 10 秒' },
    { id: 'prev', label: '⏮', title: '上一集', hint: '上一集' },
    { id: 'play', label: '⏯', title: '播放 / 暂停', hint: '播放 / 暂停' },
    { id: 'next', label: '⏭', title: '下一集', hint: '下一集' },
    { id: 'fwd', label: '⏩', title: '快进 10 秒', hint: '快进 10 秒' },
    { id: 'fs', label: '⛶', title: '全屏切换', hint: '全屏切换' },
  ] as const;

  /** 激活指定下标按钮对应的播放控制动作 */
  const activate = (index: number) => {
    const c = CONTROLS[index];
    const api = opts.playerApiRef.current;
    switch (c.id) {
      case 'rew':
        if (api) api.seek(Math.max(0, api.getCurrentTime() - SEEK_STEP));
        break;
      case 'fwd':
        if (api) {
          const dur = api.getDuration();
          const t = api.getCurrentTime();
          api.seek(dur > 0 ? Math.min(dur, t + SEEK_STEP) : t + SEEK_STEP);
        }
        break;
      case 'prev':
        if (opts.hasPrevEpisode) opts.onPrevEpisode();
        break;
      case 'next':
        if (opts.hasNextEpisode) opts.onNextEpisode();
        break;
      case 'play':
        if (api) {
          if (api.isPaused()) api.play();
          else api.pause();
        }
        break;
      case 'fs':
        // FR-7.2：全屏切换遥控器可达（壳已支持 CustomView，网页端走 ArtPlayer 全屏，与 'f' 键一致）
        api?.toggleFullscreen();
        break;
    }
    showHint(c.hint);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 用户已与控制层交互：焦点锁定（初始夺回轮询）停止，后续焦点完全由用户/引擎支配；
    // 同时刷新无操作空闲计时（自动收起以最后一次按键起算）
    userInteracted.current = true;
    lastActivity.current = Date.now();
    const N = CONTROLS.length;
    switch (e.key) {
      // ←/→ 在可见控制条按钮间导航（焦点可见）；seek 改为对应按钮 Enter 触发
      case 'ArrowLeft':
        setActive((i) => (i - 1 + N) % N);
        e.preventDefault();
        e.stopPropagation();
        break;
      case 'ArrowRight':
        setActive((i) => (i + 1) % N);
        e.preventDefault();
        e.stopPropagation();
        break;
      // ↑/↓ 保持「切换上下集」语义（M3）
      case 'ArrowUp':
        if (opts.hasPrevEpisode) {
          opts.onPrevEpisode();
          showHint('上一集');
        }
        e.preventDefault();
        e.stopPropagation();
        break;
      case 'ArrowDown':
        if (opts.hasNextEpisode) {
          opts.onNextEpisode();
          showHint('下一集');
        }
        e.preventDefault();
        e.stopPropagation();
        break;
      // Enter/空格 触发当前高亮按钮（含全屏切换）
      case 'Enter':
      case ' ':
        activate(active);
        e.preventDefault();
        e.stopPropagation();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setExited(true);
        // 退出后焦点交给剧集列表，下一帧再 focus（等 React 把 hidden 生效、列表可聚焦）
        requestAnimationFrame(focusEpisodeList);
        break;
      default:
        break;
    }
  };

  // 重新进入播放控制的入口（TV 模式）：按 Esc/返回退出控制模式后，控制层被 hidden
  // 且 tabIndex=-1 不参与焦点导航——此前没有任何途径回到控制条，用户在全屏里会
  // 「怎么按都出不来」。这个悬浮按钮在退出态渲染、可被遥控器方向键导航到
  // （真实焦点 + data-tv-focusable 供引擎收录），按确认即恢复控制模式。
  const reenter = () => {
    setExited(false);
    // 等 React 把 hidden 摘掉后再聚焦控制层（同 Esc 退出的下一帧策略）
    requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
  };

  const element = (
    <>
      <div
        data-tv-player-control
        tabIndex={-1}
        ref={ref}
        onKeyDown={handleKeyDown}
        hidden={exited}
        className="tv-player-control-layer"
      >
        {/* FR-7.2 可见播放控制条：按钮不抢真实焦点（tabIndex=-1），焦点始终在控制层，
            当前高亮按钮用 .tv-focused 手动标记（复用全局 TV 焦点描边，保证 10-foot UI 焦点可见）。
            全屏按钮使遥控器可达全屏切换（壳已支持 CustomView）。 */}
        <div className="tv-player-control-bar" role="toolbar" aria-label="播放控制">
          {CONTROLS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              title={c.title}
              tabIndex={-1}
              className={`tv-player-btn${i === active ? ' tv-focused' : ''}`}
              onClick={() => activate(i)}
            >
              <span aria-hidden="true" className="tv-player-btn-icon">{c.label}</span>
              <span className="tv-player-btn-label">{c.title}</span>
            </button>
          ))}
        </div>
        {hint && <div className="tv-player-hint">{hint}</div>}
      </div>
      {/* 退出态的重新入口：仅在 TV 模式渲染（web 端本来不显示控制层，无此需求）。
          pointer-events:auto 以支持鼠标点击；样式见 tv.css 的 .tv-player-reenter。 */}
      {isTvMode() && exited && (
        <button
          type="button"
          tabIndex={0}
          data-tv-focusable
          className="tv-player-reenter"
          onClick={reenter}
          onKeyDown={(e) => {
            // TV 引擎已装时 Enter 由引擎派发 click；这里只兜 Space 与非 TV 环境
            const tvEngine = (window as unknown as { __tvFocusInstalled?: boolean })
              .__tvFocusInstalled;
            if (e.key === ' ' || (!tvEngine && e.key === 'Enter')) {
              e.preventDefault();
              reenter();
            }
          }}
        >
          ⌨ 播放控制
        </button>
      )}
    </>
  );

  return { element };
}
