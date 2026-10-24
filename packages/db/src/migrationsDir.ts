import { fileURLToPath } from 'node:url';

/** Path of the SQL migrations in the repository. Used by tests and tools; the packaged app is given its own path. */
export const REPO_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
