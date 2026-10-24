import { useEffect, useRef, useState } from 'react';
import { useMotionScale } from '../motion/useMotion';

/** Count-up on first mount, roll on change (plan 9.3). Disabled under Reduced/Off/Lite. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const { mode } = useMotionScale();
  const [shown, setShown] = useState(mode === 'full' ? 0 : value);
  const from = useRef(shown);
  useEffect(() => {
    if (mode !== 'full') {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 420);
      const e = 1 - Math.pow(1 - p, 3);
      const v = Math.round(a + (value - a) * e);
      setShown(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, mode]);
  return <span data-value={value}>{format(shown)}</span>;
}
