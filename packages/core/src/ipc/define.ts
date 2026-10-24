import { z, type ZodType } from 'zod';

/**
 * A channel is a zod input schema plus a TypeScript output type. Inputs are validated at runtime on both
 * sides of the bridge. Outputs are typed but not re-parsed: they are produced by trusted main-process code,
 * and re-validating large result sets (reports, product lists) would cost real time on old PCs.
 */
export interface Channel<I extends ZodType = ZodType, O = unknown> {
  input: I;
  /** Phantom field that carries the output type. */
  readonly out?: O;
  /** Roles allowed to call; omitted means any signed-in user. 'public' channels work before sign-in. */
  access: 'public' | 'user' | 'manager' | 'owner';
  /** True when the call changes data. */
  write: boolean;
}

/** `ch<Output>()(inputSchema, options)`: curried so the output type can be given while the input type is inferred. */
export const ch =
  <O = null>() =>
  <I extends ZodType>(input: I, opts: { access?: Channel['access']; write?: boolean } = {}): Channel<I, O> => ({
    input,
    access: opts.access ?? 'user',
    write: opts.write ?? false
  });

export const none = z.undefined();
export const id = z.object({ id: z.number().int().positive() });
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
