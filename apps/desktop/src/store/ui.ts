import { create } from 'zustand';

export type Lang = 'bn' | 'en';
export type Mode = 'simple' | 'full';
export type Animations = 'full' | 'reduced' | 'off';
export type FontSize = 'normal' | 'large' | 'xlarge';

export interface UiPrefs {
  lang: Lang;
  mode: Mode;
  animations: Animations;
  fontSize: FontSize;
  contrast: boolean;
}

interface UiState extends UiPrefs {
  /** Set by the Lite-mode frame-time guard; downgrades Full to Reduced without changing the saved choice. */
  liteActive: boolean;
  set: (p: Partial<UiPrefs>) => void;
  setLite: (v: boolean) => void;
}

const KEY = 'petra.ui.v1';
const defaults: UiPrefs = { lang: 'bn', mode: 'simple', animations: 'full', fontSize: 'normal', contrast: false };

function readPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<UiPrefs>) };
  } catch {
    /* storage unavailable: fall back to defaults */
  }
  return defaults;
}

export const useUi = create<UiState>((set, get) => ({
  ...readPrefs(),
  liteActive: false,
  set: (p) => {
    set(p);
    const { lang, mode, animations, fontSize, contrast } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ lang, mode, animations, fontSize, contrast }));
    } catch {
      /* ignore */
    }
  },
  setLite: (v) => set({ liteActive: v })
}));

export function effectiveMotion(s: Pick<UiState, 'animations' | 'liteActive'>): Animations {
  if (s.animations === 'off') return 'off';
  const osReduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (s.animations === 'reduced' || osReduce || s.liteActive) return 'reduced';
  return 'full';
}

/** Mirror prefs onto <html> so the CSS variants in tokens.css apply. */
export function applyUiToDocument(): void {
  const s = useUi.getState();
  const el = document.documentElement;
  el.lang = s.lang === 'bn' ? 'bn' : 'en';
  el.dataset.motion = effectiveMotion(s);
  el.dataset.lite = s.liteActive ? '1' : '0';
  el.dataset.fontsize = s.fontSize;
  el.dataset.contrast = s.contrast ? 'high' : 'normal';
}
