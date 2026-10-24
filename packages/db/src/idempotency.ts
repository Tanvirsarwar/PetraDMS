import { PetraError } from '@petra/core';
import { type Ctx, tx } from './ctx';
import { get, run } from './sql';

/** Request ids are kept this long; they exist to absorb double clicks and retries, not to be a history. */
const KEEP_DAYS = 30;

/**
 * Runs `post` at most once per request id.
 *
 * - No request id: `post` runs as before (two identical expenses can be two real expenses).
 * - First time with an id: `post` runs and its result is stored under the id in the SAME transaction, so the
 *   posting and its key commit or roll back together.
 * - Same id again: nothing is posted and the first result is returned, even if that document was voided since.
 * - Same id with different data, or used for another kind of event: refused, never silently merged.
 */
export function postOnce<T extends object>(ctx: Ctx, scope: string, requestId: string | undefined, fingerprint: object, post: () => T): T {
  if (requestId === undefined) return post();
  const fp = JSON.stringify(fingerprint);
  return tx(ctx, () => {
    const hit = get<{ scope: string; fingerprint: string; result_json: string }>(ctx.db, 'SELECT scope, fingerprint, result_json FROM idempotency_keys WHERE key = ?', requestId);
    if (hit) {
      if (hit.scope !== scope || hit.fingerprint !== fp) {
        throw new PetraError('INVALID_INPUT', 'this request id was already used for different data', { field: 'requestId' });
      }
      return JSON.parse(hit.result_json) as T;
    }
    const result = post();
    const now = ctx.now();
    run(ctx.db, 'INSERT INTO idempotency_keys(key, scope, fingerprint, result_json, created_at) VALUES(?,?,?,?,?)', requestId, scope, fp, JSON.stringify(result), now);
    run(ctx.db, 'DELETE FROM idempotency_keys WHERE created_at < ?', new Date(Date.parse(now) - KEEP_DAYS * 86_400_000).toISOString());
    return result;
  });
}
