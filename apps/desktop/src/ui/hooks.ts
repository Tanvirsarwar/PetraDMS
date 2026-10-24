import { useCallback, useEffect, useRef, useState } from 'react';
import type { IpcChannel, IpcInput, IpcOutput } from '@petra/core';
import { call, errorText } from '../api';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Loads a channel whenever its input changes. Errors are returned as plain-language text. */
export function useQuery<C extends IpcChannel>(channel: C, input: IpcInput<C>, enabled = true): QueryState<IpcOutput<C>> {
  const [data, setData] = useState<IpcOutput<C> | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(input ?? null);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const n = ++seq.current;
    setLoading(true);
    (call as (c: IpcChannel, i?: unknown) => Promise<unknown>)(channel, input).then(
      (d) => {
        if (n === seq.current) {
          setData(d as IpcOutput<C>);
          setError(null);
          setLoading(false);
        }
      },
      (e: unknown) => {
        if (n === seq.current) {
          setError(errorText(e));
          setLoading(false);
        }
      }
    );
  }, [channel, key, tick, enabled]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, loading, error, reload };
}
