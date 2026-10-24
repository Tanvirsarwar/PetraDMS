import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type Variant = 'default' | 'primary' | 'dark' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg' | 'icon';
  kbd?: string;
  /** Shows a spinner, keeps the width, and blocks clicks until the work is done. */
  loading?: boolean;
}
/**
 * The one button of the app (D23). variant: primary (the main action of an area, raised red), default (secondary),
 * danger (destructive only), ghost (tertiary), dark (print / export). Pages never style buttons themselves.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', size = 'md', kbd, loading, className, children, type = 'button', disabled, ...rest }, ref) {
  const cls = ['p-btn', variant !== 'default' ? variant : '', size !== 'md' ? size : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="p-spinner" aria-hidden="true" />}
      {children}
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
});

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}
export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId();
  const msgId = `${id}-m`;
  const describedBy = error || hint ? msgId : undefined;
  return (
    <div className="p-field">
      <label className="p-label" htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <div id={msgId} className="p-error" role="alert">{error}</div>
      ) : hint ? (
        <div id={msgId} className="p-hint">{hint}</div>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; numeric?: boolean }>(function Input({ invalid, numeric, className, ...rest }, ref) {
  return <input ref={ref} className={['p-input', numeric ? 'num' : '', invalid ? 'invalid' : '', className ?? ''].filter(Boolean).join(' ')} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ invalid, className, children, ...rest }, ref) {
  return <select ref={ref} className={['p-select', invalid ? 'invalid' : '', className ?? ''].filter(Boolean).join(' ')} aria-invalid={invalid || undefined} {...rest}>{children}</select>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={['p-textarea', className ?? ''].join(' ')} {...rest} />;
});

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="p-check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled, 'data-testid': testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; 'data-testid'?: string }) {
  return (
    <span className="row">
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="p-switch" disabled={disabled} onClick={() => onChange(!checked)} data-testid={testId} />
      <span className={disabled ? 'muted' : undefined}>{label}</span>
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="p-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="p-kbd">{children}</span>;
}
