/** Hand-written SVG charts (plan 3: no chart library). */
export interface ChartPoint {
  label: string;
  value: number;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const W = 520;
const H = 220;
const M = { l: 44, r: 12, t: 12, b: 28 };

function Frame({ max, children, title, fmt }: { max: number; children: React.ReactNode; title: string; fmt: (n: number) => string }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      {ticks.map((t) => {
        const y = M.t + (H - M.t - M.b) * (1 - t);
        return (
          <g key={t}>
            <line className={t === 0 ? 'axis' : 'grid-line'} x1={M.l} x2={W - M.r} y1={y} y2={y} />
            <text x={M.l - 6} y={y + 3} textAnchor="end">{fmt(max * t)}</text>
          </g>
        );
      })}
      {children}
    </svg>
  );
}

export function BarChart({ data, title, fmt = (n) => String(Math.round(n)) }: { data: ChartPoint[]; title: string; fmt?: (n: number) => string }) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const bw = (W - M.l - M.r) / Math.max(1, data.length);
  return (
    <Frame max={max} title={title} fmt={fmt}>
      {data.map((d, i) => {
        const h = ((H - M.t - M.b) * Math.max(0, d.value)) / max;
        const x = M.l + i * bw + bw * 0.18;
        return (
          <g key={d.label}>
            <rect className="bar-grow" style={{ animationDelay: `${i * 40}ms` }} x={x} y={H - M.b - h} width={bw * 0.64} height={h} fill="var(--accent)" />
            <text x={x + bw * 0.32} y={H - M.b + 14} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </Frame>
  );
}

export function LineChart({ data, title, fmt = (n) => String(Math.round(n)) }: { data: ChartPoint[]; title: string; fmt?: (n: number) => string }) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const step = (W - M.l - M.r) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [M.l + i * step, H - M.b - ((H - M.t - M.b) * Math.max(0, d.value)) / max] as const);
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return (
    <Frame max={max} title={title} fmt={fmt}>
      <path className="chart-draw" style={{ ['--len' as string]: Math.ceil(len) + 2 }} d={path} fill="none" stroke="var(--brand)" strokeWidth="2.5" />
      {pts.map(([x, y], i) => (
        <g key={data[i]!.label}>
          <rect x={x - 3} y={y - 3} width="6" height="6" fill="var(--black)" />
          <text x={x} y={H - M.b + 14} textAnchor="middle">{data[i]!.label}</text>
        </g>
      ))}
    </Frame>
  );
}

export function HBarList({ data, fmt }: { data: ChartPoint[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="grid" style={{ gap: 8 }}>
      {data.map((d) => (
        <div key={d.label}>
          <div className="row"><span style={{ flex: 1 }}>{d.label}</span><span className="num">{fmt(d.value)}</span></div>
          <div className="p-progress"><div style={{ transform: `scaleX(${d.value / max})` }} /></div>
        </div>
      ))}
    </div>
  );
}
