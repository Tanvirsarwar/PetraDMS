import { insertIntoField } from './Calculator';

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Barcode scanners type the code like a very fast keyboard and finish with Enter. A burst of at least four
 * characters, each under 40 ms apart on average, followed by Enter is a scan, never typing.
 *
 * Once two characters arrive faster than a person can type, the rest of the burst is held back from the page
 * so a half-typed code never reaches a field. If the burst stops without Enter it was not a scanner, and
 * everything held back is typed into the field after all.
 */
export function watchBarcodeScans(onScan: (code: string) => void): () => void {
  let buf = '';
  let last = 0;
  let gaps = 0;
  let field: { el: Field; before: string } | null = null;
  let held = 0; // how many characters of `buf` were kept out of the page
  let timer = 0;
  const reset = () => {
    window.clearTimeout(timer);
    buf = '';
    gaps = 0;
    held = 0;
    field = null;
  };
  const release = () => {
    // not a scan: type what was held back
    if (field && held > 0) insertIntoField(field.el, field.before + buf);
    reset();
  };
  const fast = () => buf.length >= 2 && gaps / (buf.length - 1) < 40;
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return reset();
    // the calculators (F7 and the dock) and the dock's games take every key themselves
    if (e.target instanceof Element && e.target.closest('.calc, .dock-panel')) return reset();
    const now = performance.now();
    if (e.key === 'Enter') {
      window.clearTimeout(timer);
      if (buf.length >= 4 && fast()) {
        e.preventDefault();
        e.stopPropagation();
        if (field && held < buf.length) insertIntoField(field.el, field.before); // take back the characters that did reach the field
        const code = buf;
        reset();
        onScan(code);
        return;
      }
      if (held > 0) release();
      else reset();
      return;
    }
    if (e.key.length !== 1) return;
    if (now - last > 100) {
      if (held > 0) release();
      else reset();
    }
    if (buf.length === 0) {
      const a = document.activeElement;
      field = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement ? { el: a, before: a.value } : null;
    } else gaps += now - last;
    buf += e.key;
    last = now;
    if (fast() && buf.length >= 2) {
      // from here on the burst is held back from the page
      e.preventDefault();
      e.stopPropagation();
      held++;
      window.clearTimeout(timer);
      timer = window.setTimeout(release, 120);
    }
  };
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    reset();
  };
}
