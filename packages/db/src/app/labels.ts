import JsBarcode from 'jsbarcode';
import { PetraError, toBnDigits } from '@petra/core';
import { all } from '../sql';
import type { Ctx } from '../ctx';

/** Code 128 bars as an SVG path of "1" runs; `unit` is the width of one module. */
export function code128Svg(text: string, heightPx: number): { svg: string; modules: number } {
  const out: { encodings?: { data: string }[] } = {};
  JsBarcode(out, text, { format: 'CODE128', margin: 0 });
  const bits = out.encodings?.map((e) => e.data).join('') ?? '';
  if (!bits) throw new PetraError('INVALID_INPUT', 'this code cannot be turned into a barcode', { field: 'barcode' });
  let path = '';
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let j = i;
      while (j < bits.length && bits[j] === '1') j++;
      path += `M${i} 0h${j - i}v${heightPx}h-${j - i}z`;
      i = j;
    } else i++;
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bits.length} ${heightPx}" preserveAspectRatio="none" width="100%" height="${heightPx}"><path d="${path}" fill="#000"/></svg>`, modules: bits.length };
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);

/** A4 sheet of 3 x 8 price labels with a scannable Code 128 (the first barcode of the product, or its SKU). */
export function renderLabels(ctx: Ctx, items: { productId: number; copies: number }[], opts: { fontCss: string; bnDigits: boolean; money: (p: number) => string }): string {
  const cells: string[] = [];
  for (const it of items) {
    const p = all<{ id: number; sku: string; name: string; name_bn: string; price: number }>(ctx.db, 'SELECT id, sku, name, name_bn, price_retail AS price FROM products WHERE id = ?', it.productId)[0];
    if (!p) throw new PetraError('NOT_FOUND', 'product not found', { what: 'product' });
    const code = all<{ barcode: string }>(ctx.db, 'SELECT barcode FROM product_barcodes WHERE product_id = ? AND pack_id IS NULL ORDER BY id LIMIT 1', p.id)[0]?.barcode ?? p.sku;
    // v1.1: products sold by the box also show the box price (the box's own price, else piece price x pieces per box)
    const box = all<{ name: string; factor: number; price: number | null }>(ctx.db, 'SELECT name, factor, price_retail AS price FROM product_packs WHERE product_id = ? AND factor > 1 ORDER BY factor DESC LIMIT 1', p.id)[0];
    const boxLine = box ? `<div class="bx">${esc(box.name)} (${esc(opts.bnDigits ? toBnDigits(String(box.factor)) : String(box.factor))}): ${esc(opts.money(box.price ?? p.price * box.factor))}</div>` : '';
    const bar = code128Svg(code, 40);
    for (let n = 0; n < it.copies; n++) {
      cells.push(`<div class="lb"><div class="nm">${esc(p.name)}</div>${p.name_bn ? `<div class="bn">${esc(p.name_bn)}</div>` : ''}<div class="bar">${bar.svg}</div><div class="cd">${esc(code)}</div><div class="pr">${esc(opts.money(p.price))}</div>${boxLine}</div>`);
    }
  }
  if (cells.length > 1000) throw new PetraError('INVALID_INPUT', 'too many labels in one print', { field: 'copies' });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>${opts.fontCss}
@page{size:A4;margin:8mm}*{box-sizing:border-box}html{font-synthesis:none}body{margin:0;font-family:'Nunito','Tiro Bangla','Noto Serif Bengali','Nirmala UI',sans-serif;color:#000}.cd,.pr,.bx{font-family:'JetBrains Mono','Tiro Bangla',monospace}
.sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:0}
.lb{height:34mm;border:0.3mm dashed #bbb;padding:2mm 3mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;break-inside:avoid}
.nm{font-size:9pt;font-weight:600;line-height:1.1;max-height:2.2em;overflow:hidden}.bn{font-size:8pt;line-height:1.1}
.bar{height:10mm;margin:0 2mm}.bar svg{height:100%}.cd{font-size:7pt;text-align:center;letter-spacing:.08em}.pr{font-size:11pt;font-weight:600;text-align:right}.bx{font-size:8pt;text-align:right}
</style></head><body><div class="sheet">${cells.join('')}</div></body></html>`;
}
