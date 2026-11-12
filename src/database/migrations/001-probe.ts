import type { Database } from '@sqlite.org/sqlite-wasm';
import { DatabaseError } from '../../models/database';
import type { ManagedSchemaObject } from './types';

export const SCHEMA_VERSION = 1;

// Keep these definitions identical to the historical Phase 1 schema. Existing
// v1 databases are baselined only after their original structure is verified.
export const PROBE_SCHEMA_OBJECTS: readonly ManagedSchemaObject[] = Object.freeze([
  {
    type: 'table',
    name: 'persistence_probe',
    sql: `CREATE TABLE persistence_probe (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
        content TEXT NOT NULL CHECK (
          length(content) BETWEEN 1 AND 20000 AND length(trim(content)) > 0
        ),
        created_at TEXT NOT NULL CHECK (length(created_at) = 24)
      ) STRICT`,
  },
  {
    type: 'index',
    name: 'idx_probe_created_at',
    sql: `CREATE INDEX idx_probe_created_at
        ON persistence_probe(created_at DESC, id DESC)`,
  },
]);

export const PROBE_SCHEMA_SQL = PROBE_SCHEMA_OBJECTS.map((object) => `${object.sql};`).join('\n');

/** Historical v1 constructor retained for fixtures and upgrade validation. */
export function migrateProbeDatabase(db: Database): void {
  const version = Number(db.selectValue('PRAGMA user_version'));
  if (!Number.isInteger(version) || version < 0) {
    throw new DatabaseError('SCHEMA', 'A versão da estrutura do banco é inválida. Preserve os dados do navegador.');
  }
  if (version > SCHEMA_VERSION) {
    throw new DatabaseError('SCHEMA', 'Este banco foi criado por uma versão mais recente do aplicativo. Atualize a aplicação para abri-lo.');
  }
  if (version === SCHEMA_VERSION) return;
  db.transaction('IMMEDIATE', () => {
    db.exec(PROBE_SCHEMA_SQL);
    db.exec('PRAGMA user_version = 1');
  });
}
