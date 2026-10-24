import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchHit, SearchKind } from '@petra/core';
import { Badge, Modal } from '../ui';
import { call } from '../api';
import { useI18n } from '../i18n';

const ROUTE: Record<SearchKind, string> = { product: '/products', customer: '/customers', supplier: '/suppliers', sale: '/sales', purchase: '/purchases' };

/** Ctrl+K: one box that finds products, customers, suppliers, invoices and purchases. */
export function SearchPalette({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: string }) {
  const { t, n } = useI18n();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [info, setInfo] = useState<{ ms: number; size: number } | null>(null);
  const [hi, setHi] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (open) setQ(initial);
  }, [open, initial]);
  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    if (!q.trim()) {
      setHits([]);
      setInfo(null);
      return;
    }
    const h = window.setTimeout(() => {
      void call('search:query', { q, limit: 12 }).then((r) => {
        if (my !== seq.current) return;
        setHits(r.hits);
        setInfo({ ms: r.ms, size: r.size });
        setHi(0);
      }, () => undefined);
    }, 60);
    return () => window.clearTimeout(h);
  }, [q, open]);
  const go = (h: SearchHit) => {
    onClose();
    nav(ROUTE[h.kind], { state: { open: h.id, at: Date.now() } });
  };
  return (
    <Modal open={open} title={t('search.title')} onClose={onClose}>
      <input
        data-autofocus
        className="p-input"
        style={{ width: '100%' }}
        placeholder={t('search.placeholder')}
        aria-label={t('search.title')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="palette-input"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((x) => Math.min(hits.length - 1, x + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((x) => Math.max(0, x - 1)); }
          else if (e.key === 'Enter' && hits[hi]) { e.preventDefault(); go(hits[hi]); }
        }}
      />
      <ul className="palette-list" role="listbox" aria-label={t('search.title')}>
        {hits.map((h, i) => (
          <li key={`${h.kind}-${h.id}`} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''} onMouseEnter={() => setHi(i)} onClick={() => go(h)} data-testid={`palette-hit-${i}`}>
            <Badge tone={h.kind === 'product' ? 'dark' : 'default'}>{t(`search.kind.${h.kind}`)}</Badge>
            <span className="t">{h.title}</span>
            <span className="s">{n(h.subtitle)}</span>
          </li>
        ))}
      </ul>
      {q.trim() && hits.length === 0 && info && <p className="muted" data-testid="palette-empty">{t('search.none')}</p>}
      {!q.trim() && <p className="muted">{t('search.hint')}</p>}
      {info && hits.length > 0 && <p className="muted palette-foot" data-testid="palette-foot">{t('search.foot', { ms: Math.max(1, Math.round(info.ms)), size: info.size })}</p>}
    </Modal>
  );
}
