import { create } from 'zustand';
import type { AppStatus, SessionDto } from '@petra/core';
import { call } from '../api';
import { useUi } from './ui';

interface AppState {
  status: AppStatus | null;
  loading: boolean;
  fatal: string | null;
  refresh: () => Promise<void>;
  setSession: (s: SessionDto | null) => void;
}

const modeKey = (userId: number) => `petra.mode.${userId}`;

export function savedModeFor(userId: number): 'simple' | 'full' | null {
  try {
    const v = localStorage.getItem(modeKey(userId));
    return v === 'simple' || v === 'full' ? v : null;
  } catch {
    return null;
  }
}

export function rememberMode(userId: number, mode: 'simple' | 'full'): void {
  try {
    localStorage.setItem(modeKey(userId), mode);
  } catch {
    /* ignore */
  }
  useUi.getState().set({ mode });
}

/** Staff start in Simple mode, Owner and Manager in Full mode (plan 8.1); a choice made later is remembered per user. */
export function applySessionPrefs(s: SessionDto): void {
  useUi.getState().set({ mode: savedModeFor(s.userId) ?? (s.role === 'staff' ? 'simple' : 'full') });
}

export const useApp = create<AppState>((set, get) => ({
  status: null,
  loading: true,
  fatal: null,
  refresh: async () => {
    try {
      const hadSession = !!get().status?.session;
      const status = await call('app:status');
      set({ status, loading: false, fatal: null });
      if (status.session && !hadSession) applySessionPrefs(status.session);
    } catch (e) {
      set({ loading: false, fatal: e instanceof Error ? e.message : String(e) });
    }
  },
  setSession: (session) => {
    const st = get().status;
    if (st) set({ status: { ...st, session } });
    if (session) applySessionPrefs(session);
  }
}));
