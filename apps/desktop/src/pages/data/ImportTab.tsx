import { useEffect, useRef, useState } from 'react';
import { IMPORT_FIELDS, IMPORT_KINDS, type ImportKind, type ImportPreview, type ImportResult, type ImportRowReport, type Mapping, type RowIssue } from '@petra/core';
import { Badge, Button, Card, Select, Segmented, Table, toast, type Column } from '../../ui';
import { call, errorText } from '../../api';
import { useI18n } from '../../i18n';

const DB_CODES = ['DUPLICATE', 'NOT_FOUND', 'DAY_CLOSED', 'INVALID_INPUT', 'DUPLICATE_INVOICE'];
const ISSUE_CODES = ['required', 'tooLong', 'number', 'negative', 'whole', 'date', 'yesNo', 'barcode', 'minAboveRetail', 'expiryStock', 'phone', 'choice', 'nameOrPhone', 'zero', 'skuExists', 'barcodeExists', 'phoneExists', 'dupInFile', 'partyNotFound', 'partyAmbiguous', 'missingColumn', 'sameColumn', 'badColumn', 'boxSize', 'sameAsUnit', 'noQty', 'noBox', 'invoiceExists', 'invoiceHasErrors', 'productNotFound', 'db.OTHER', ...DB_CODES.map((c) => `db.${c}`)];

/** Bring a CSV in: pick the kind, load the file, check the column match, read every row's problems, try it without saving, then import. */
export function ImportTab({ initialKind }: { initialKind: ImportKind }) {
  const { t, int } = useI18n();
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const issueText = (i: RowIssue | { field: string; code: string }): string => {
    const code = ISSUE_CODES.includes(i.code) ? i.code : i.code.startsWith('db.') ? 'db.OTHER' : i.code;
    return `${i.field ? `${t(`imp.f.${i.field}`)}: ` : ''}${t(`imp.issue.${code}`)}`;
  };

  useEffect(() => {
    if (!text) return;
    const n = ++seq.current;
    setError(null);
    call('import:preview', { kind, text, mapping: mapping ?? undefined }).then(
      (p) => {
        if (n !== seq.current) return;
        setPreview(p);
        if (!mapping) setMapping(p.mapping);
      },
      (e) => {
        if (n !== seq.current) return;
        setPreview(null);
        setError(errorText(e));
      }
    );
  }, [kind, text, mapping]);

  const reset = () => {
    seq.current++;
    setText('');
    setFileName('');
    setMapping(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const pickKind = (k: ImportKind) => {
    reset();
    setKind(k);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    reset();
    setFileName(f.name);
    setText(await f.text());
  };

  const template = async () => {
    try {
      const r = await call('import:template', { kind });
      toast.ok(`${t('imp.templateSaved')}: ${r.path}`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const run = async (dryRun: boolean) => {
    if (!preview || !mapping) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call('import:run', { kind, text, mapping, dryRun, skipBad: true });
      setResult(r);
      if (!dryRun) {
        toast.ok(t('imp.done', { n: int(r.created) }));
        if (r.created > 0) {
          seq.current++;
          setPreview(null);
          setText('');
        }
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const rejects = async () => {
    if (!mapping) return;
    try {
      const messages = Object.fromEntries(ISSUE_CODES.map((c) => [c, t(`imp.issue.${c}`)]));
      const r = await call('import:rejects', { kind, text, mapping, problemHeader: t('imp.problem'), messages });
      toast.ok(`${t('imp.rejectsSaved')}: ${r.path}`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const headers = preview?.headers ?? [];
  const colLabel = (i: number) => (headers[i]?.trim() ? headers[i] : t('imp.column', { n: int(i + 1) }));
  const shown = (preview?.rows ?? []).slice(0, 300);
  const cols: Column<ImportRowReport>[] = [
    { key: 'line', header: t('imp.line'), render: (r) => int(r.line), right: true },
    { key: 'state', header: t('imp.state'), render: (r) => (r.ok ? <Badge tone="ok">{t('imp.ok')}</Badge> : <Badge tone="red">{t('imp.bad')}</Badge>) },
    { key: 'problem', header: t('imp.problem'), render: (r) => <span data-testid="imp-issue">{r.issues.map((i) => issueText(i)).join(' · ')}</span> },
    ...headers.slice(0, 6).map((_, i): Column<ImportRowReport> => ({ key: `c${i}`, header: colLabel(i), render: (r) => r.cells[i] ?? '' }))
  ];
  const stopped = !!preview && preview.mappingIssues.length > 0;

  return (
    <div className="grid" style={{ gap: 12 }}>
      <Card title={t('imp.step1')}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented label={t('imp.kind')} value={kind} options={IMPORT_KINDS.map((k) => ({ value: k, label: t(`imp.kind.${k}`) }))} onChange={pickKind} />
          <Button onClick={() => void template()} data-testid="imp-template">{t('imp.template')}</Button>
        </div>
        <p className="muted">{t(`imp.hint.${kind}`)}</p>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input ref={fileInput} type="file" accept=".csv,text/csv,.txt" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="imp-file" aria-label={t('imp.chooseFile')} />
          {fileName && <Button size="sm" onClick={reset}>{t('imp.startOver')}</Button>}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>{t('imp.utf8')}</p>
      </Card>

      {error && <div className="p-error" role="alert" data-testid="imp-error">{error}</div>}

      {preview && mapping && (
        <Card title={t('imp.step2')}>
          <p className="muted" style={{ marginTop: 0 }}>{t('imp.mapHint', { file: fileName })}</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
            {IMPORT_FIELDS[kind].map((f) => {
              const problem = preview.mappingIssues.find((p) => p.field === f.key);
              return (
                <div key={f.key} className="p-field">
                  <label className="p-label" htmlFor={`map-${f.key}`}>{t(`imp.f.${f.key}`)}{f.required && <span aria-hidden="true"> *</span>}</label>
                  <Select id={`map-${f.key}`} value={mapping[f.key] === null || mapping[f.key] === undefined ? '' : String(mapping[f.key])} invalid={!!problem} data-testid={`imp-map-${f.key}`}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">{t('imp.notInFile')}</option>
                    {headers.map((_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                  </Select>
                  {problem && <div className="p-error" role="alert">{issueText(problem)}</div>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {preview && !stopped && (
        <Card
          title={t('imp.step3')}
          actions={
            <div className="row" style={{ gap: 8 }}>
              {preview.bad > 0 && <Button onClick={() => void rejects()} data-testid="imp-rejects">{t('imp.saveRejects')}</Button>}
              <Button disabled={busy || preview.good === 0} onClick={() => void run(true)} data-testid="imp-dry">{t('imp.dry')}</Button>
              <Button variant="primary" disabled={busy || preview.good === 0} onClick={() => void run(false)} data-testid="imp-run">{t('imp.run', { n: int(preview.good) })}</Button>
            </div>
          }
        >
          <p data-testid="imp-summary" style={{ marginTop: 0 }}>{t('imp.summary', { total: int(preview.total), good: int(preview.good), bad: int(preview.bad) })}</p>
          {preview.bad > 0 && <p className="muted">{t('imp.skipNote')}</p>}
          <Table columns={cols} rows={shown} rowKey={(r) => r.line} pageSize={15} />
          {preview.truncated && <p className="muted" style={{ marginBottom: 0 }}>{t('imp.truncated')}</p>}
        </Card>
      )}

      {result && (
        <Card title={result.dryRun ? t('imp.dryResult') : t('imp.result')}>
          <div data-testid="imp-result" className="grid" style={{ gap: 6 }}>
            <div>{t(result.dryRun ? 'imp.dryLine' : 'imp.resultLine', { created: int(result.created), skipped: int(result.skipped) })}</div>
            {(result.newCategories > 0 || result.newBrands > 0 || result.newAreas > 0) && <div className="muted">{t('imp.newLookups', { c: int(result.newCategories), b: int(result.newBrands), a: int(result.newAreas) })}</div>}
            {result.stockLines > 0 && <div className="muted">{t('imp.stockLines', { n: int(result.stockLines) })}</div>}
            {result.duesPosted > 0 && <div className="muted">{t('imp.duesLines', { n: int(result.duesPosted) })}</div>}
            {result.newSuppliers > 0 && <div className="muted">{t('imp.newSuppliers', { n: int(result.newSuppliers) })}</div>}
            {result.purchasesPosted > 0 && <div className="muted" data-testid="imp-purchases">{t('imp.purchasesLines', { n: int(result.purchasesPosted) })}</div>}
            {result.dryRun && <div className="muted">{t('imp.dryNote')}</div>}
          </div>
        </Card>
      )}
    </div>
  );
}
