/**
 * In-memory search index (plan 3): tokens with prefix and typo-tolerant matching, plus a trigram
 * index for matches in the middle of a word. Built in the main process and rebuilt after writes.
 * It does not depend on SQLite FTS.
 */
export type SearchKind = 'product' | 'customer' | 'supplier' | 'sale' | 'purchase';

export interface SearchDoc {
  kind: SearchKind;
  id: number;
  title: string;
  subtitle: string;
  /** Everything a user might type to find it: names in both languages, SKU, barcode, phone, document number. */
  text: string[];
  /** Small boost to put more relevant kinds first on equal matches. */
  weight?: number;
}

export interface SearchHit {
  kind: SearchKind;
  id: number;
  title: string;
  subtitle: string;
  score: number;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Lower-case, Bangla digits to ASCII, strip accents and punctuation, collapse spaces. */
export function normalize(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFKD').toLowerCase()) {
    const d = BN_DIGITS.indexOf(ch);
    if (d >= 0) out += String(d);
    else if (/[̀-ͯ]/.test(ch)) continue;
    else if (/[\p{L}\p{N}\p{M}]/u.test(ch)) out += ch;
    else out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function tokenize(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Optimal-string-alignment distance (insert, delete, replace, swap), stopping early above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const A = [...a];
  const B = [...b];
  let prev2: number[] = [];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) v = Math.min(v, (prev2[j - 2] as number) + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[B.length] as number;
}

function trigrams(s: string): string[] {
  const p = `  ${s} `;
  const out: string[] = [];
  const chars = [...p];
  for (let i = 0; i + 3 <= chars.length; i++) out.push(chars.slice(i, i + 3).join(''));
  return out;
}

const maxTypos = (len: number): number => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

interface Entry {
  doc: SearchDoc;
  /** Normalised full strings, for exact and substring checks. */
  fields: string[];
}

export class SearchIndex {
  private entries: Entry[] = [];
  /** token -> doc indexes */
  private byToken = new Map<string, number[]>();
  private vocab: string[] = [];
  private vocabByLen = new Map<number, string[]>();
  private tri = new Map<string, number[]>();

  get size(): number {
    return this.entries.length;
  }

  build(docs: SearchDoc[]): void {
    this.entries = [];
    this.byToken = new Map();
    this.tri = new Map();
    docs.forEach((doc, i) => {
      const fields = doc.text.map(normalize).filter(Boolean);
      this.entries.push({ doc, fields });
      const seenTok = new Set<string>();
      const seenTri = new Set<string>();
      for (const f of fields) {
        for (const tok of f.split(' ')) {
          if (!seenTok.has(tok)) {
            seenTok.add(tok);
            let list = this.byToken.get(tok);
            if (!list) this.byToken.set(tok, (list = []));
            list.push(i);
          }
          if (tok.length >= 3) for (const g of trigrams(tok)) if (!seenTri.has(g)) {
            seenTri.add(g);
            let l = this.tri.get(g);
            if (!l) this.tri.set(g, (l = []));
            l.push(i);
          }
        }
      }
    });
    this.vocab = [...this.byToken.keys()].sort();
    this.vocabByLen = new Map();
    for (const v of this.vocab) {
      const l = [...v].length;
      let b = this.vocabByLen.get(l);
      if (!b) this.vocabByLen.set(l, (b = []));
      b.push(v);
    }
  }

  /** Index range of vocabulary words that start with `prefix`. */
  private prefixRange(prefix: string): [number, number] {
    let lo = 0;
    let hi = this.vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.vocab[mid] as string) < prefix) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;
    let end = start;
    while (end < this.vocab.length && (this.vocab[end] as string).startsWith(prefix)) end++;
    return [start, end];
  }

  /** Documents matching one query token, with how well (1 exact, 0.85 prefix, 0.6 typo, 0.5 inside a word). */
  private matchToken(tok: string): Map<number, number> {
    const hits = new Map<number, number>();
    const put = (docs: number[] | undefined, q: number) => {
      if (!docs) return;
      for (const d of docs) if ((hits.get(d) ?? 0) < q) hits.set(d, q);
    };
    put(this.byToken.get(tok), 1);
    const [s, e] = this.prefixRange(tok);
    for (let i = s; i < e && i - s < 4000; i++) put(this.byToken.get(this.vocab[i] as string), 0.85);
    const len = [...tok].length;
    const typos = maxTypos(len);
    if (typos > 0) {
      for (let l = len - typos; l <= len + typos; l++) {
        const bucket = this.vocabByLen.get(l);
        if (!bucket) continue;
        for (const w of bucket) {
          if (w === tok) continue;
          // A typo in the first letter is rare; requiring the same start keeps the scan cheap and the results sensible.
          if (w[0] !== tok[0] && len < 6) continue;
          if (editDistance(tok, w, typos) <= typos) put(this.byToken.get(w), 0.6);
        }
      }
    }
    if (hits.size < 12 && len >= 3) {
      // Inside a word ("ilk" in "milk"): every trigram of the token must be present, then confirm by substring.
      // Only the grams inside the token: the padded first and last grams exist only at a word's edge.
      const chars = [...tok];
      const grams: string[] = [];
      for (let i = 0; i + 3 <= chars.length; i++) grams.push(chars.slice(i, i + 3).join(''));
      let cand: number[] | null = null;
      for (const g of grams) {
        const list = this.tri.get(g);
        if (!list) { cand = []; break; }
        cand = cand === null ? list : cand.filter((x) => list.includes(x)).slice(0, 5000);
        if (cand.length === 0) break;
      }
      for (const d of cand ?? []) {
        if (!hits.has(d) && (this.entries[d] as Entry).fields.some((f) => f.includes(tok))) hits.set(d, 0.5);
      }
    }
    return hits;
  }

  search(query: string, limit = 20, allow?: (k: SearchKind) => boolean): SearchHit[] {
    const toks = tokenize(query);
    if (toks.length === 0 || this.entries.length === 0) return [];
    let scores: Map<number, number> | null = null;
    for (const tok of toks) {
      const m = this.matchToken(tok);
      if (scores === null) scores = m;
      else {
        const next = new Map<number, number>();
        for (const [d, q] of m) if (scores.has(d)) next.set(d, (scores.get(d) as number) + q);
        scores = next;
      }
      if (scores.size === 0) return [];
    }
    const whole = normalize(query);
    const out: SearchHit[] = [];
    for (const [i, base] of scores as Map<number, number>) {
      const e = this.entries[i] as Entry;
      if (allow && !allow(e.doc.kind)) continue;
      let score = (base / toks.length) * 100 + (e.doc.weight ?? 0);
      // exact or leading match of a whole field beats a loose match
      if (e.fields.some((f) => f === whole)) score += 60;
      else if (e.fields.some((f) => f.startsWith(whole))) score += 25;
      out.push({ kind: e.doc.kind, id: e.doc.id, title: e.doc.title, subtitle: e.doc.subtitle, score });
    }
    out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id - b.id);
    return out.slice(0, limit);
  }
}
