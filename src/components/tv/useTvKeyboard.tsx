'use client';

import { useState } from 'react';
import { isTvMode } from '@/lib/tv-mode';
import { TvKeyboard } from './TvKeyboard';

/**
 * TV 搜索键盘钩子：把「搜索输入框」与「虚拟键盘」连接起来。
 *
 * 行为：
 * - 仅 TV 模式下，输入框获得焦点时自动弹出虚拟键盘（网页模式不弹，保持原样）。
 * - 键盘为受控覆盖层：父组件持有查询字符串 value，按键通过 onChange 写入。
 * - 提交（搜索键）后关闭键盘；关闭 / Esc 后键盘卸载，焦点回到页面（方向键引擎接管）。
 *
 * 用法：在搜索输入框的 onFocus 里调用 handleInputFocus；在组件树下渲染 {keyboard}。
 */
export function useTvKeyboard(opts: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const [open, setOpen] = useState(false);

  const handleInputFocus = () => {
    if (isTvMode()) setOpen(true);
  };

  const keyboard = open ? (
    <TvKeyboard
      value={opts.value}
      onChange={opts.onChange}
      onSubmit={() => {
        opts.onSubmit();
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
    />
  ) : null;

  return { open, setOpen, handleInputFocus, keyboard };
}
