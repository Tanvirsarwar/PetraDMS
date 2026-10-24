import { run } from './sql';
import type { Ctx } from './ctx';

/** One line in the diagnostics log. Never throws: logging must not break the thing being logged. */
export function logApp(ctx: Ctx, level: 'info' | 'warn' | 'error', message: string, detail = ''): void {
  try {
    run(ctx.db, 'INSERT INTO app_log(at, level, message, detail) VALUES(?,?,?,?)', ctx.now(), level, message.slice(0, 300), detail.slice(0, 4000));
  } catch {
    /* the database itself may be the problem */
  }
}
