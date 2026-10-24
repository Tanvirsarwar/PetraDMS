import { useState } from 'react';
import { BrandMark, Button, Card, Tabs, useQuery } from '../ui';
import { VENDOR } from '@petra/core';
import { useI18n } from '../i18n';
import { useUi } from '../store/ui';
import { useApp } from '../store/app';
import { manualFor } from '../help/manual';
import { Markdown } from '../help/markdown';
import { SHORTCUTS } from '../tools/GlobalTools';

type Tab = 'manual' | 'keys' | 'about';

/** Help for everyone: the manual in the chosen language, the shortcut list, the tour, and About. All of it works offline. */
export function HelpPage({ onTour }: { onTour: () => void }) {
  const { t } = useI18n();
  const lang = useUi((s) => s.lang);
  const [tab, setTab] = useState<Tab>('manual');
  const [open, setOpen] = useState('s1');
  const m = manualFor(lang);
  return (
    <div>
      <div className="page-h">
        <h2>{t('help.title')}</h2>
        <Button onClick={onTour} data-testid="tour-start">{t('help.startTour')}</Button>
      </div>
      <Tabs value={tab} label={t('help.title')} onChange={setTab} tabs={[{ value: 'manual', label: t('help.tabManual') }, { value: 'keys', label: t('help.tabKeys') }, { value: 'about', label: t('help.tabAbout') }]} />
      <div style={{ marginTop: 12 }}>
        {tab === 'manual' && (
          <div className="manual-wrap" data-testid="manual">
            <nav className="manual-toc" aria-label={t('help.contents')}>
              {m.sections.map((s) => (
                <button key={s.id} type="button" className={open === s.id ? 'active' : ''} onClick={() => setOpen(s.id)} data-testid={`manual-${s.id}`}>{s.title}</button>
              ))}
            </nav>
            <Card title={m.sections.find((s) => s.id === open)?.title}>
              {open === 's1' && <p className="muted" style={{ marginTop: 0 }}>{m.intro}</p>}
              <Markdown text={m.sections.find((s) => s.id === open)?.body ?? ''} />
            </Card>
          </div>
        )}
        {tab === 'keys' && (
          <Card title={t('keys.title')}>
            <table className="keys-table" data-testid="help-keys">
              <tbody>
                {SHORTCUTS.map((s) => <tr key={s.keys}><td><kbd className="kbd">{s.keys}</kbd></td><td>{t(s.labelKey)}</td></tr>)}
              </tbody>
            </table>
            <p className="muted" style={{ marginBottom: 0 }}>{t('keys.scanner')}</p>
          </Card>
        )}
        {tab === 'about' && <About />}
      </div>
    </div>
  );
}

function About() {
  const { t } = useI18n();
  const status = useApp((s) => s.status);
  const health = useQuery('app:health', undefined);
  const h = health.data;
  return (
    <div className="grid" style={{ gap: 12 }} data-testid="about">
      <Card title={t('about.title')}>
        <dl className="kv">
          <dt>{t('about.product')}</dt><dd className="row" style={{ gap: 8 }}><BrandMark size={22} /> {VENDOR.productName}</dd>
          <dt>{t('about.publisher')}</dt><dd data-testid="about-publisher">{VENDOR.companyName}</dd>
          {VENDOR.supportPhone && <><dt>{t('about.support')}</dt><dd>{VENDOR.supportPhone}</dd></>}
          {VENDOR.supportEmail && <><dt>{t('about.support')}</dt><dd>{VENDOR.supportEmail}</dd></>}
          {VENDOR.website && <><dt>{t('about.website')}</dt><dd>{VENDOR.website}</dd></>}
          <dt>{t('bk.appVersion')}</dt><dd data-testid="about-version">{status?.appVersion}</dd>
          <dt>{t('about.business')}</dt><dd>{status?.profile.name}</dd>
          <dt>{t('bk.dataFolder')}</dt><dd className="num" style={{ textAlign: 'left' }}>{status?.dataDir}</dd>
          <dt>{t('about.engine')}</dt><dd>{h ? `Electron ${h.electronVersion} · SQLite ${h.sqliteVersion}` : '…'}</dd>
          <dt>{t('bk.integrity')}</dt><dd>{h ? (h.integrity === 'ok' ? t('bk.integrityOk') : h.integrity) : '…'}</dd>
        </dl>
      </Card>
      <Card title={t('about.game')}>
        <p style={{ margin: '0 0 8px' }}>{t('about.gameBody')}</p>
        <Button onClick={() => { window.location.hash = '#/break'; }} data-testid="open-break">Petra Break</Button>
      </Card>
      <Card title={t('about.privacyTitle')}>
        <p style={{ margin: 0 }} data-testid="about-privacy">{t('about.privacy')}</p>
      </Card>
    </div>
  );
}
