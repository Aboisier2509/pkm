/** Historical phase-1 fixture. Keep this DDL independent of current migrations. */
import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';

const LEGACY_SQL = `
  CREATE TABLE persistence_probe (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    content TEXT NOT NULL CHECK (
      length(content) BETWEEN 1 AND 20000 AND length(trim(content)) > 0
    ),
    created_at TEXT NOT NULL CHECK (length(created_at) = 24)
  ) STRICT;
  CREATE INDEX idx_probe_created_at
    ON persistence_probe(created_at DESC, id DESC);
  PRAGMA user_version = 1;
`;

globalThis.onmessage = async () => {
  const quiet = () => {};
  (globalThis as typeof globalThis & { sqlite3ApiConfig?: object }).sqlite3ApiConfig = {
    debug: quiet, log: quiet, warn: quiet, error: quiet,
  };
  const initialize = sqlite3InitModule as unknown as (options: object) => Promise<Sqlite3Static>;
  try {
    const sqlite = await initialize({
      print: quiet,
      printErr: quiet,
      locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? sqliteWasmUrl : `${prefix}${path}`,
    });
    const pool = await sqlite.installOpfsSAHPoolVfs({
      name: 'opfs-sahpool', directory: '/pkm-poc-sahpool', initialCapacity: 6,
      clearOnInit: false, preserveOnInitFailure: true,
    });
    const db = new pool.OpfsSAHPoolDb('/pkm-poc.sqlite3');
    try {
      if (Number(db.selectValue('PRAGMA user_version')) !== 0) throw new Error('A fixture exige uma base vazia.');
      db.exec('PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
      db.transaction('IMMEDIATE', () => {
        db.exec(LEGACY_SQL);
        db.exec('INSERT INTO persistence_probe(id, content, created_at) VALUES (?, ?, ?)', {
          bind: ['ab5705cf-f1d9-403d-9650-d8cd03c4c9e1', 'Registro da Fase 1 — preservar café e 🌱.', '2026-11-09T15:00:00.000Z'],
        });
      });
    } finally {
      db.close();
      pool.pauseVfs();
    }
    globalThis.postMessage({ ok: true });
  } catch {
    globalThis.postMessage({ ok: false });
  }
};
