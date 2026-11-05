'use client';

import { useEffect, useRef, useState } from 'react';
import {
  isVoiceAvailable,
  onVoiceResult,
  onVoiceStatus,
  startVoiceInput,
  type VoiceStatus,
} from '@/lib/tv-voice';
import { Icon } from '../icon';

/**
 * TV 虚拟键盘（英文 / 数字输入主链路，对应需求「先做英文虚拟键盘」）。
 *
 * 设计要点：
 * - 纯受控组件：父组件持有查询字符串 value，每次按键通过 onChange 追加 / 删除。
 * - 仅做字符输入，不内置拼音/中文 IME（中文交给语音方案）。键盘输出的字母、数字、
 *   空格可直接命中英文名 / 拼音串搜索（注：拼音串命中需后端放宽相关性过滤，见进度文档）。
 * - 用一个 role="dialog" + data-tv-trap 把方向键焦点限制在键盘内（M1 引擎 trap 机制），
 *   避免与顶栏 / 卡片抢焦点。打开时焦点自动落入首个按键，方向键即可逐键移动、确认键落字。
 * - 麦克风按钮调用原生语音桥；不可用或被拒时在键盘内给出轻提示，不阻断键盘输入。
 */

interface TvKeyboardProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const KEY_BASE =
  'min-w-[2.75rem] h-11 px-2 rounded-lg border border-line bg-surface text-content text-lg font-semibold inline-flex items-center justify-center hover:bg-hover focus:outline-none';

export function TvKeyboard({ value, onChange, onSubmit, onClose }: TvKeyboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 始终持有最新 value，避免语音回调闭包拿到旧值
  const valueRef = useRef(value);
  valueRef.current = value;

  const voiceReady = isVoiceAvailable();
  const [voiceError, setVoiceError] = useState<VoiceStatus | null>(null);

  // 打开瞬间把焦点放进键盘：否则焦点仍停在 header/首页 input（editable），
  // 方向键会被 inEditable 放行而无法导航键盘按键
  useEffect(() => {
    const first = containerRef.current?.querySelector<HTMLButtonElement>('button[data-kb-key]');
    first?.focus({ preventScroll: true });
  }, []);

  // 订阅原生语音结果 / 状态
  useEffect(() => {
    const offResult = onVoiceResult((text) => {
      if (text) onChange(valueRef.current + text);
    });
    const offStatus = onVoiceStatus((s) => setVoiceError(s));
    return () => {
      offResult();
      offStatus();
    };
  }, [onChange]);

  const append = (ch: string) => onChange(valueRef.current + ch);
  const backspace = () => onChange(valueRef.current.slice(0, -1));
  const clear = () => onChange('');

  const handleVoice = () => {
    setVoiceError(null);
    if (!startVoiceInput()) setVoiceError('unavailable');
  };

  // Esc / 返回键关闭键盘（M1 引擎只拦截方向键与确认，不拦截 Esc，故本地处理）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  // M4-4 联调修复：焦点在搜索框 INPUT 时，M1 引擎 inEditable() 整体放行（含 Esc），
  // 且 INPUT 不在键盘容器子树内——keydown 不冒泡经过容器，上面的 onKeyDown 收不到，
  // Esc 关闭键盘失效（真机返回键走壳 __srctvConsumeBack→closeTopModal 不受影响，
  // 但网页 ?tv=1 模式没有物理返回键，Esc 是唯一关闭手段）。补 document 级监听兜底：
  // 无论焦点在搜索框还是键盘按钮上都能关闭。setOpen(false) 幂等，与容器 onKeyDown
  // 或 closeTopModal 派发的合成 Escape 双触发无副作用。
  useEffect(() => {
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="电视输入键盘"
      data-tv-trap
      onKeyDown={handleKeyDown}
      className="fixed bottom-0 left-0 right-0 z-[60] bg-surface-raised border-t border-line shadow-2xl p-4"
    >
      <div className="max-w-5xl mx-auto">
        {/* 预览 + 控制行 */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className="flex-1 truncate rounded-md bg-surface px-3 py-2 text-lg text-content"
            aria-live="polite"
          >
            {value || <span className="text-muted">用方向键选字母，确认键输入</span>}
          </div>
          <button
            data-kb-key
            type="button"
            className={KEY_BASE}
            onClick={handleVoice}
            disabled={!voiceReady}
            title={voiceReady ? '语音输入' : '当前设备不支持语音'}
            aria-label="语音输入"
          >
            <Icon name="mic" />
          </button>
          <button
            data-kb-key
            type="button"
            className={KEY_BASE}
            onClick={backspace}
            title="删除"
            aria-label="删除"
          >
            <Icon name="backspace" />
          </button>
          <button
            data-kb-key
            type="button"
            className={KEY_BASE}
            onClick={clear}
            title="清空"
            aria-label="清空"
          >
            <Icon name="close" />
          </button>
          <button
            data-kb-key
            type="button"
            className={`${KEY_BASE} bg-accent text-white border-transparent`}
            onClick={onSubmit}
            title="搜索"
            aria-label="搜索"
          >
            <Icon name="search" />
          </button>
        </div>

        {voiceError && (
          <p className="text-xs text-warning mb-2" role="status">
            {voiceError === 'unavailable'
              ? '当前设备不支持语音输入，请用键盘'
              : '语音输入失败，请用键盘'}
          </p>
        )}

        {/* 字母 / 数字键 */}
        <div className="flex flex-col gap-2">
          {ROWS.map((row, ri) => (
            <div key={ri} className="flex justify-center gap-2">
              {row.map((ch) => (
                <button
                  key={ch}
                  data-kb-key
                  type="button"
                  className={KEY_BASE}
                  onClick={() => append(ch)}
                  aria-label={ch}
                >
                  {ch}
                </button>
              ))}
            </div>
          ))}
          <div className="flex justify-center gap-2">
            <button
              data-kb-key
              type="button"
              className={`${KEY_BASE} px-10`}
              onClick={() => append(' ')}
              aria-label="空格"
            >
              空格
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-muted mt-3">按返回 / Esc 关闭键盘</p>
      </div>
    </div>
  );
}
