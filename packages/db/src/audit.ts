import { run } from './sql';
import type { Ctx } from './ctx';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: number | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export function audit(ctx: Ctx, e: AuditEntry): void {
  run(
    ctx.db,
    'INSERT INTO audit_log(at, user_id, action, entity, entity_id, before_json, after_json, reason) VALUES(?,?,?,?,?,?,?,?)',
    ctx.now(), ctx.userId, e.action, e.entity, e.entityId ?? null,
    e.before === undefined ? null : JSON.stringify(e.before),
    e.after === undefined ? null : JSON.stringify(e.after),
    e.reason ?? ''
  );
}
