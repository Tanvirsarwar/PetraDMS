declare module 'jsbarcode' {
  /** Only the object renderer is used: it fills `target.encodings` with the bar pattern. */
  export default function JsBarcode(target: object, text: string, options?: Record<string, unknown>): void;
}
