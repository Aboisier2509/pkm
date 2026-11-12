import initializeSqlite, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let initialization: Promise<Sqlite3Static> | undefined;

/** The package's Node export loads the same bundled sqlite3.wasm as the PWA. */
export function initQuietSqlite(): Promise<Sqlite3Static> {
  if (!initialization) {
    const quiet = () => {};
    // Upstream's declarations currently omit the supported initialization options.
    const initialize = initializeSqlite as unknown as (options: {
      print: () => void;
      printErr: () => void;
    }) => Promise<Sqlite3Static>;
    (globalThis as typeof globalThis & { sqlite3ApiConfig?: object }).sqlite3ApiConfig = {
      debug: quiet,
      log: quiet,
      warn: quiet,
      error: quiet,
    };
    initialization = initialize({ print: quiet, printErr: quiet });
  }
  return initialization;
}

/** Each case gets an isolated real WASM database, always closed after success or failure. */
export async function withMemoryDatabase(run: (db: Database) => void | Promise<void>): Promise<void> {
  const sqlite = await initQuietSqlite();
  const db = new sqlite.oo1.DB(':memory:', 'c');
  try {
    await run(db);
  } finally {
    db.close();
  }
}
