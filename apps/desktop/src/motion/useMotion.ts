import { effectiveMotion, useUi } from '../store/ui';

/** Duration multiplier for the `motion` library, matching the Animations setting (plan 9.2). */
export function useMotionScale(): { mode: 'full' | 'reduced' | 'off'; d: (seconds: number) => number } {
  const animations = useUi((s) => s.animations);
  const liteActive = useUi((s) => s.liteActive);
  const mode = effectiveMotion({ animations, liteActive });
  return { mode, d: (s) => (mode === 'off' ? 0 : mode === 'reduced' ? Math.min(s, 0.1) : s) };
}
