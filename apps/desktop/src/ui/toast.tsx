import { useEffect } from 'react';
import { create } from 'zustand';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from './controls';
import { useMotionScale } from '../motion/useMotion';
import { useT } from '../i18n';

export interface ToastItem {
  id: number;
  text: string;
  kind: 'ok' | 'error';
  /** Undo callback; when present the toast shows an Undo button for 6 s (plan 9.2). */
  undo?: () => void;
  ms: number;
}
interface ToastStore {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id' | 'ms'> & { ms?: number }) => number;
  dismiss: (id: number) => void;
}
let nextId = 1;
export const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ items: [...s.items.slice(-3), { ...t, id, ms: t.ms ?? (t.undo ? 6000 : 4000) }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
}));

export const toast = {
  ok: (text: string) => useToasts.getState().push({ text, kind: 'ok' }),
  error: (text: string) => useToasts.getState().push({ text, kind: 'error', ms: 8000 }),
  withUndo: (text: string, undo: () => void) => useToasts.getState().push({ text, kind: 'ok', undo })
};

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  const t = useT();
  const { d } = useMotionScale();
  useEffect(() => {
    const h = window.setTimeout(() => dismiss(item.id), item.ms);
    return () => window.clearTimeout(h);
  }, [item.id, item.ms, dismiss]);
  return (
    <motion.div
      layout
      role={item.kind === 'error' ? 'alert' : 'status'}
      className={`p-toast${item.kind === 'ok' ? ' ok' : ''}`}
      style={{ position: 'relative', overflow: 'hidden' }}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: d(0.24), ease: [0.2, 0.8, 0.2, 1] }}
    >
      <span style={{ flex: 1 }}>{item.text}</span>
      {item.undo && (
        <Button
          onClick={() => {
            item.undo?.();
            dismiss(item.id);
          }}
        >
          {t('act.undo')}
        </Button>
      )}
      {item.undo && <span className="p-toast-timer" style={{ animationDuration: `${item.ms}ms` }} />}
    </motion.div>
  );
}

export function Toasts() {
  const items = useToasts((s) => s.items);
  return (
    <div className="p-toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((i) => (
          <ToastView key={i.id} item={i} />
        ))}
      </AnimatePresence>
    </div>
  );
}
