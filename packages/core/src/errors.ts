/**
 * Domain errors. The `code` is stable and is mapped to a plain-language, translated message
 * in the UI. `params` carry the values needed to fill that message. Raw SQL text never reaches users.
 */
export const ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'NEGATIVE_STOCK',
  'DAY_CLOSED',
  'DAY_NOT_CLOSED',
  'CREDIT_LIMIT',
  'APPROVAL_REQUIRED',
  'ALREADY_VOID',
  'HAS_RETURNS',
  'OVER_RETURN',
  'OVER_PAYMENT',
  'DUPLICATE_INVOICE',
  'PERMISSION',
  'DUPLICATE',
  'IN_USE',
  'PACK_SIZE_LOCKED',
  'REASON_REQUIRED',
  'AUTH_FAILED',
  'LOCKED_OUT',
  'DB_NEWER',
  'DB_CORRUPT',
  'BACKUP_FAILED',
  'BACKUP_INVALID',
  'IMPORT_INVALID',
  'IMPORT_HAS_ERRORS',
  'DEMO_UNAVAILABLE',
  'IO_FAILED',
  'UNKNOWN'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class PetraError extends Error {
  readonly code: ErrorCode;
  readonly params: Record<string, string | number | boolean | null>;

  constructor(code: ErrorCode, message?: string, params: Record<string, string | number | boolean | null> = {}) {
    super(message ?? code);
    this.name = 'PetraError';
    this.code = code;
    this.params = params;
  }
}

export function isPetraError(e: unknown): e is PetraError {
  return e instanceof PetraError;
}

export interface WireError {
  code: ErrorCode;
  message: string;
  params: Record<string, string | number | boolean | null>;
}

/** Errors cross the IPC boundary as plain data; unknown errors become UNKNOWN without leaking internals. */
export function toWireError(e: unknown): WireError {
  if (isPetraError(e)) return { code: e.code, message: e.message, params: e.params };
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e), params: {} };
}

export function fromWireError(w: WireError): PetraError {
  return new PetraError(w.code, w.message, w.params);
}
