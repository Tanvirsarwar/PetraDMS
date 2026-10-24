import { Component, type ReactNode } from 'react';
import { Button } from './controls';
import { translate } from '../i18n';
import { useUi } from '../store/ui';

/** A screen that fails to draw shows a plain message and a way back, never a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; detail: string }> {
  state = { failed: false, detail: '' };
  static getDerivedStateFromError(e: unknown) {
    return { failed: true, detail: e instanceof Error ? e.message : String(e) };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false, detail: '' });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const lang = useUi.getState().lang;
    const t = (k: string) => translate(lang, k);
    return (
      <div className="p-error" role="alert" data-testid="screen-error" style={{ margin: 24, padding: 16 }}>
        <h2>{t('err.screenTitle')}</h2>
        <p>{t('err.screenBody')}</p>
        <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{this.state.detail}</p>
        <Button variant="primary" onClick={() => this.setState({ failed: false, detail: '' })}>{t('err.screenRetry')}</Button>
      </div>
    );
  }
}
