import type { ReactNode } from 'react';

/** Just enough Markdown for the manuals: #, ##, ###, paragraphs, "- " and "1. " lists, **bold** and `code`. Never injects raw HTML. */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith('**') ? <strong key={k++}>{tok.slice(2, -2)}</strong> : <code key={k++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export interface ManualSection { id: string; title: string; body: string }

/** Splits a manual into its "## " sections (the text before the first one is the intro). */
export function splitManual(md: string): { title: string; intro: string; sections: ManualSection[] } {
  const lines = md.split(/\r?\n/);
  let title = '';
  const intro: string[] = [];
  const sections: ManualSection[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (cur) sections.push({ id: `s${sections.length + 1}`, title: cur.title, body: cur.lines.join('\n') });
      cur = { title: line.slice(3).trim(), lines: [] };
    } else if (line.startsWith('# ') && !title) title = line.slice(2).trim();
    else if (cur) cur.lines.push(line);
    else intro.push(line);
  }
  if (cur) sections.push({ id: `s${sections.length + 1}`, title: cur.title, body: cur.lines.join('\n') });
  return { title, intro: intro.join('\n').trim(), sections };
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === '') {
      i++;
    } else if (/^### /.test(line)) {
      blocks.push(<h4 key={k++}>{inline(line.slice(4))}</h4>);
      i++;
    } else if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i] as string)) items.push((lines[i++] as string).slice(2));
      blocks.push(<ul key={k++}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>);
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i] as string)) items.push((lines[i++] as string).replace(/^\d+\. /, ''));
      blocks.push(<ol key={k++}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ol>);
    } else {
      const para: string[] = [];
      while (i < lines.length && (lines[i] as string).trim() !== '' && !/^(- |\d+\. |### )/.test(lines[i] as string)) para.push(lines[i++] as string);
      blocks.push(<p key={k++}>{inline(para.join(' '))}</p>);
    }
  }
  return <div className="manual">{blocks}</div>;
}
