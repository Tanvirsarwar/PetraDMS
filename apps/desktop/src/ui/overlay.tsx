import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from './controls';
import { IconClose } from './icons';
import { useMotionScale } from '../motion/useMotion';
import { useT } from '../i18n';

const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

function useDialogBehaviour(open: boolean, onClose: () => void, ref: React.RefObject<HTMLDivElement | null>) {
  // Always call the newest onClose, and attach the key handler in the layout phase: the dialog must already react to Escape
  // and Tab on the very frame it becomes visible, not a moment later.
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        const a = items[0]!;
        const z = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [open]);
}

interface PanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, title, onClose, children, footer, wide }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { d, mode } = useMotionScale();
  const move = mode === 'full';
  const t = useT();
  useDialogBehaviour(open, onClose, ref);
  // rendered on <body>: inside the page it sat under the top bar and the dock handle (the page fade is its own stacking layer)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="p-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: d(0.16) }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`p-modal${wide ? ' wide' : ''}`}
            initial={move ? { opacity: 0, scale: 0.96, y: 10 } : { opacity: 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={move ? { opacity: 0, scale: 0.98, y: 4 } : { opacity: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 34, duration: d(0.24) }}
          >
            <div className="p-modal-h">
              <h2>{title}</h2>
              <Button variant="ghost" size="icon" aria-label={t('act.close')} onClick={onClose}><IconClose /></Button>
            </div>
            <div className="p-modal-b">{children}</div>
            {footer && <div className="p-modal-f">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function Drawer({ open, title, onClose, children, footer, wide }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { d, mode } = useMotionScale();
  const move = mode === 'full';
  const t = useT();
  useDialogBehaviour(open, onClose, ref);
  // rendered on <body>: inside the page it sat under the top bar and the dock handle (the page fade is its own stacking layer)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="p-scrim right" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: d(0.16) }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={wide ? 'p-drawer wide' : 'p-drawer'}
            initial={move ? { x: 48, opacity: 0 } : { opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={move ? { x: 48, opacity: 0 } : { opacity: 0 }}
            transition={{ duration: d(0.24), ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="p-modal-h">
              <h2>{title}</h2>
              <Button variant="ghost" size="icon" aria-label={t('act.close')} onClick={onClose}><IconClose /></Button>
            </div>
            <div className="p-modal-b">{children}</div>
            {footer && <div className="p-modal-f">{footer}</div>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{t('act.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} data-autofocus onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
