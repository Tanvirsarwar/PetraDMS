import { PetraError, fromWireError, type IpcChannel, type IpcInput, type IpcOutput, type PetraApi, type WireError } from '@petra/core';
import { translate } from './i18n';
import { useUi } from './store/ui';

declare global {
  interface Window {
    petra: PetraApi;
  }
}

function toPetraError(e: unknown): PetraError {
  if (e instanceof PetraError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const i = msg.indexOf('PETRA_ERR:');
  if (i >= 0) {
    try {
      return fromWireError(JSON.parse(msg.slice(i + 'PETRA_ERR:'.length)) as WireError);
    } catch {
      /* fall through */
    }
  }
  return new PetraError('UNKNOWN', msg);
}

/** Typed call into the main process. Failures throw PetraError with a stable `code`. */
export async function call<C extends IpcChannel>(channel: C, ...args: undefined extends IpcInput<C> ? [input?: IpcInput<C>] : [input: IpcInput<C>]): Promise<IpcOutput<C>> {
  try {
    return await window.petra.invoke(channel, ...args);
  } catch (e) {
    throw toPetraError(e);
  }
}

/** Plain-language, translated message for any error (plan 8.2: errors say what happened and what to do). */
export function errorText(e: unknown, lang = useUi.getState().lang): string {
  const err = toPetraError(e);
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(err.params)) if (v !== null && typeof v !== 'boolean') params[k] = v;
  if (err.code === 'AUTH_FAILED' && typeof params.remaining === 'number') return `${translate(lang, 'err.AUTH_FAILED')} (${translate(lang, 'auth.attemptsLeft', { n: params.remaining })})`;
  return translate(lang, `err.${err.code}`, params);
}

export function errorCode(e: unknown): string {
  return toPetraError(e).code;
}

export function errorParams(e: unknown): Record<string, string | number | boolean | null> {
  return toPetraError(e).params;
}
