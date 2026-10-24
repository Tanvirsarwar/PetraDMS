import { useState } from 'react';
import { Field, Input, Segmented } from './controls';
import { useI18n } from '../i18n';

export type SecretKind = 'pin' | 'password';

export function secretError(kind: SecretKind, secret: string): boolean {
  return kind === 'pin' ? !/^\d{4,6}$/.test(secret) : secret.length < 6;
}

export interface SecretValue {
  kind: SecretKind;
  secret: string;
  confirm: string;
}

export function secretValid(v: SecretValue): boolean {
  return !secretError(v.kind, v.secret) && v.secret === v.confirm;
}

/** Choose PIN or password, enter it twice. Shows inline problems only after the user has typed. */
export function SecretPicker({ value, onChange, showKind = true }: { value: SecretValue; onChange: (v: SecretValue) => void; showKind?: boolean }) {
  const { t } = useI18n();
  const [touched, setTouched] = useState(false);
  const bad = touched && value.secret !== '' && secretError(value.kind, value.secret);
  const mismatch = touched && value.confirm !== '' && value.secret !== value.confirm;
  return (
    <div className="grid" style={{ gap: 12 }}>
      {showKind && (
        <Segmented
          label={t('auth.secretKind')}
          value={value.kind}
          onChange={(kind) => onChange({ kind, secret: '', confirm: '' })}
          options={[{ value: 'pin', label: t('auth.kind.pin') }, { value: 'password', label: t('auth.kind.password') }]}
        />
      )}
      <Field label={t('auth.newSecret')} hint={value.kind === 'pin' ? t('auth.pinHint') : t('auth.passwordHint')} error={bad ? (value.kind === 'pin' ? t('auth.pinHint') : t('auth.passwordHint')) : null} required>
        {(a) => (
          <Input
            id={a.id}
            aria-describedby={a.describedBy}
            invalid={a.invalid}
            type="password"
            autoComplete="new-password"
            inputMode={value.kind === 'pin' ? 'numeric' : 'text'}
            maxLength={value.kind === 'pin' ? 6 : 128}
            value={value.secret}
            onBlur={() => setTouched(true)}
            onChange={(e) => onChange({ ...value, secret: value.kind === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value })}
          />
        )}
      </Field>
      <Field label={t('auth.confirmSecret')} error={mismatch ? t('auth.mismatch') : null} required>
        {(a) => (
          <Input
            id={a.id}
            aria-describedby={a.describedBy}
            invalid={a.invalid}
            type="password"
            autoComplete="new-password"
            inputMode={value.kind === 'pin' ? 'numeric' : 'text'}
            maxLength={value.kind === 'pin' ? 6 : 128}
            value={value.confirm}
            onBlur={() => setTouched(true)}
            onChange={(e) => onChange({ ...value, confirm: value.kind === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

export const emptySecret: SecretValue = { kind: 'pin', secret: '', confirm: '' };
