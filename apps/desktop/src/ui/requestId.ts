import { useRef } from 'react';

/**
 * One id per "open form". The screen sends it with a money posting, so a double click, a double Enter or a retry
 * after a slow answer reaches the server as the SAME request and posts once. Make a new one after each success.
 */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Double-post protection for a screen that saves a document (sale, purchase, return, stock adjustment).
 * - `id()`: one request id per open form; the server posts at most once per id.
 * - `renew()`: call after a successful save so the next document gets its own id.
 * - `guard(fn)`: runs `fn` only if the previous call has finished. A ref, not React state, so a double click or a
 *   double Enter in the same frame cannot start two saves before the screen has re-rendered.
 */
export function useRequest() {
  const idRef = useRef<string>(newRequestId());
  const busyRef = useRef(false);
  return {
    id: (): string => idRef.current,
    renew: (): void => { idRef.current = newRequestId(); },
    guard: async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      try { return await fn(); } finally { busyRef.current = false; }
    }
  };
}
