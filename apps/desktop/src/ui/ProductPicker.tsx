import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { ProductDto } from '@petra/core';
import { Input } from './controls';
import { useI18n } from '../i18n';
import { productName, stockText } from './format';

/** Type-ahead product chooser (name, Bangla name, SKU, barcode). Arrow keys and Enter work; Esc clears. */
export function ProductPicker({ products, onPick, placeholder, autoFocus, id, resetOnPick = true, inputRef, testId }: { products: ProductDto[]; onPick: (p: ProductDto) => void; placeholder?: string; autoFocus?: boolean; id?: string; resetOnPick?: boolean; inputRef?: Ref<HTMLInputElement>; testId?: string }) {
  const i18n = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products.slice(0, 8);
    const out: ProductDto[] = [];
    for (const p of products) {
      if (p.name.toLowerCase().includes(s) || p.nameBn.includes(q.trim()) || p.sku.toLowerCase().includes(s) || p.barcodes.some((b) => b === q.trim())) out.push(p);
      if (out.length >= 8) break;
    }
    return out;
  }, [q, products]);
  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  const pick = (p: ProductDto) => {
    onPick(p);
    setQ(resetOnPick ? '' : productName(i18n.lang, p));
    setOpen(false);
  };
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <Input
        id={id}
        ref={inputRef}
        data-testid={testId}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={q}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(matches.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter' && open && matches[hi]) {
            e.preventDefault();
            pick(matches[hi]!);
          } else if (e.key === 'Escape' && (open || q)) {
            e.stopPropagation();
            setOpen(false);
            setQ('');
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul role="listbox" className="picker-list">
          {matches.map((p, idx) => (
            <li key={p.id} role="option" aria-selected={idx === hi} className={idx === hi ? 'hi' : ''} onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setHi(idx)}>
              <span style={{ flex: 1 }}>{productName(i18n.lang, p)} <small>{p.sku}</small></span>
              <small>{stockText(i18n, p, p.stockQty)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
