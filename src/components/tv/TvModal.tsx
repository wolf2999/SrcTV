'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * TV 通用弹窗容器（M1-7）：M2 TV 布局的标准弹窗外壳。
 *
 * 职责（业务组件只传 open / onClose / children，不感知 TV 细节）：
 * - data-tv-trap 锚点：tv-focus.ts 引擎看到该属性即把方向键候选圈定在弹窗内
 *   （现有业务弹窗 role="dialog"/"alertdialog" 已天然被引擎识别，本容器供 M2 新增 UI 使用）；
 * - 打开时焦点移入弹窗、关闭时归还来源焦点（与业务 useFocusTrap 同语义，此处独立实现，
 *   避免 TV 容器反向依赖业务组件）；
 * - 遮罩点击 / Esc 关闭。
 */
export function TvModal({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 无障碍标签（aria-label） */
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // 焦点移入弹窗第一个可聚焦元素；一个都没有则落到面板本身（面板带 tabIndex=-1）
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    (first ?? panelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.(); // 关闭后焦点归还来源元素
      restoreRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    /* 遮罩层：TV 上点击遮罩关闭（遥控器用户走 Esc/返回），保留鼠标可关性 */
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-6" data-tv-modal-root>
      <div className="absolute inset-0 bg-black/75" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-tv-trap
        tabIndex={-1}
        className="relative bg-surface-raised rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6"
      >
        {children}
      </div>
    </div>
  );
}
