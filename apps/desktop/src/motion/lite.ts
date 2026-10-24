import { useUi } from '../store/ui';

/**
 * Lite mode guard (plan 9.2): sample frame times for ~2 s after launch and during the first
 * interactions. If the median frame time is above 24 ms the app drops to Reduced animations.
 */
export function medianFrameMs(samples: number[]): number {
  if (samples.length === 0) return 0;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export const LITE_THRESHOLD_MS = 24;

export function startLiteGuard(onTrip: () => void, durationMs = 2000): () => void {
  let last = performance.now();
  const start = last;
  const samples: number[] = [];
  let raf = 0;
  let stopped = false;
  const tick = (now: number) => {
    if (stopped) return;
    samples.push(now - last);
    last = now;
    if (now - start < durationMs) {
      raf = requestAnimationFrame(tick);
    } else if (samples.length >= 20 && medianFrameMs(samples.slice(2)) > LITE_THRESHOLD_MS) {
      useUi.getState().setLite(true);
      onTrip();
    }
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
