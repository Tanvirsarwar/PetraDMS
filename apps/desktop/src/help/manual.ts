import en from '../../../../docs/USER-MANUAL.en.md?raw';
import bn from '../../../../docs/USER-MANUAL.bn.md?raw';
import { splitManual } from './markdown';

/** The manuals are the files in docs/, bundled into the app so help works offline and can never drift from the repository copy. */
export const MANUAL = { en, bn };
export const manualFor = (lang: 'en' | 'bn') => splitManual(MANUAL[lang]);
