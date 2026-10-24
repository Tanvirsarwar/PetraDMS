import { loadSettings } from '../settings';
import { logApp } from '../applog';
import type { Dispatcher } from './dispatcher';
import { runBackup } from './safetyApp';

/**
 * Automatic backups (plan 12.3): every N minutes while data has changed, and once more when the app closes.
 * "Changed" is the dispatcher's write counter, so reading and printing never trigger a backup.
 */
export class AutoBackup {
  private lastGen: number;
  private lastAtMs: number;

  constructor(private d: Dispatcher, private clock: () => number = () => Date.now()) {
    this.lastGen = d.writeGen;
    this.lastAtMs = clock();
  }

  /** Call about once a minute. Returns true when a backup was made. */
  tick(): boolean {
    const s = loadSettings(this.d.db);
    if (!s.backupAuto || this.d.writeGen === this.lastGen) return false;
    if (this.clock() - this.lastAtMs < s.backupIntervalMinutes * 60_000) return false;
    return this.run('auto');
  }

  /** Call when the app is about to quit. */
  onClose(): boolean {
    const s = loadSettings(this.d.db);
    if (!s.backupOnClose || this.d.writeGen === this.lastGen) return false;
    return this.run('close');
  }

  /** A manual backup also counts, so the next automatic one waits for new changes. */
  noteManual(): void {
    this.lastGen = this.d.writeGen;
    this.lastAtMs = this.clock();
  }

  private run(kind: 'auto' | 'close'): boolean {
    const gen = this.d.writeGen;
    try {
      runBackup(this.d.ctx(), this.d.host, kind);
      this.lastGen = gen;
      this.lastAtMs = this.clock();
      return true;
    } catch (e) {
      // runBackup has already logged it; try again at the next tick
      logApp(this.d.ctx(), 'warn', `automatic backup (${kind}) did not complete`, e instanceof Error ? e.message : String(e));
      this.lastAtMs = this.clock();
      return false;
    }
  }
}
