import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { DatabaseError } from '../../models/database';
import { PROBE_SCHEMA_OBJECTS, PROBE_SCHEMA_SQL } from './001-probe';
import { KNOWLEDGE_SCHEMA_OBJECTS, KNOWLEDGE_SCHEMA_SQL } from './002-knowledge-schema';
import type { ManagedSchemaObject, MigrationDefinition, MigrationReport } from './types';

export type { MigrationDefinition, MigrationReport } from './types';

export const CURRENT_SCHEMA_VERSION = 2;

export const MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([
  Object.freeze({ version: 1, name: '001-probe', sql: PROBE_SCHEMA_SQL }),
  Object.freeze({ version: 2, name: '002-knowledge-schema', sql: KNOWLEDGE_SCHEMA_SQL }),
]);

const LEDGER_OBJECT: ManagedSchemaObject = Object.freeze({
  type: 'table',
  name: 'schema_migrations',
  sql: `CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100 AND instr(name, char(0)) = 0),
    checksum TEXT NOT NULL CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
    applied_at TEXT NOT NULL CHECK (
      length(applied_at) = 24
      AND applied_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
      AND substr(applied_at, 12, 2) BETWEEN '00' AND '23'
      AND substr(applied_at, 15, 2) BETWEEN '00' AND '59'
      AND substr(applied_at, 18, 2) BETWEEN '00' AND '59'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', applied_at, '+0 days') IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ', applied_at, '+0 days') = applied_at
    )
  ) STRICT`,
});

const MANAGED_OBJECTS = Object.freeze([
  ...PROBE_SCHEMA_OBJECTS,
  ...KNOWLEDGE_SCHEMA_OBJECTS,
  LEDGER_OBJECT,
]);

const MANAGED_TABLE_NAMES = Object.freeze(MANAGED_OBJECTS.filter((entry) => entry.type === 'table').map((entry) => entry.name).sort());

function schemaError(message: string): DatabaseError {
  return new DatabaseError('SCHEMA', message);
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/, '').replace(/\s+/g, ' ');
}

function objectRows(db: Database, name: string): Record<string, SqlValue>[] {
  return db.selectObjects('SELECT type, name, tbl_name, sql FROM main.sqlite_schema WHERE name = ? COLLATE BINARY', [name]);
}

function assertObject(db: Database, expected: ManagedSchemaObject, legacy = false): void {
  const rows = objectRows(db, expected.name);
  const actual = rows[0];
  const normalize = (sql: string) => legacy ? normalizeSql(sql).toLowerCase() : normalizeSql(sql);
  if (rows.length !== 1 || actual?.type !== expected.type || typeof actual.sql !== 'string' || normalize(actual.sql) !== normalize(expected.sql)) {
    throw schemaError(`A estrutura de ${expected.name} diverge da migração registrada. Preserve o banco existente.`);
  }
}

function assertLegacyProbe(db: Database): void {
  for (const expected of PROBE_SCHEMA_OBJECTS) assertObject(db, expected, true);
  const columns = db.selectObjects("PRAGMA main.table_xinfo('persistence_probe')");
  const expected = [
    { name: 'id', type: 'TEXT', notnull: 1, pk: 1 },
    { name: 'content', type: 'TEXT', notnull: 1, pk: 0 },
    { name: 'created_at', type: 'TEXT', notnull: 1, pk: 0 },
  ];
  if (columns.length !== expected.length || columns.some((column, index) => {
    const match = expected[index];
    return column.name !== match.name || column.type !== match.type || column.notnull !== match.notnull ||
      column.pk !== match.pk || column.hidden !== 0 || column.dflt_value !== null;
  })) {
    throw schemaError('A tabela da prova de conceito não corresponde à versão 1 conhecida. A adoção foi interrompida.');
  }
  const table = db.selectObjects("PRAGMA main.table_list('persistence_probe')").find((row) => row.schema === 'main');
  if (!table || table.strict !== 1 || table.ncol !== 3 || table.wr !== 0) {
    throw schemaError('A estrutura STRICT da prova de conceito não corresponde à versão 1 conhecida.');
  }
}

/** Checksums detect accidental changes to released migrations, not an adversary. */
async function migrationChecksums(): Promise<Map<number, string>> {
  if (!globalThis.crypto?.subtle) {
    throw schemaError('O contexto não oferece SHA-256 para verificar as migrações. Use HTTPS ou localhost.');
  }
  const results = await Promise.all(MIGRATIONS.map(async (migration) => {
    const serialized = JSON.stringify({ version: migration.version, name: migration.name, sql: migration.sql });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return [migration.version, checksum] as const;
  }));
  return new Map(results);
}

function assertHistory(db: Database, schemaVersion: number, checksums: ReadonlyMap<number, string>): void {
  const rows = db.selectObjects('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
  if (schemaVersion < 1 || rows.length !== schemaVersion) {
    throw schemaError('O histórico de migrações e PRAGMA user_version são incoerentes. Nenhum histórico foi recriado.');
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const migration = MIGRATIONS[index];
    if (!migration || row.version !== migration.version || row.name !== migration.name) {
      throw schemaError('O histórico de migrações contém lacunas ou versões desconhecidas. Preserve o banco existente.');
    }
    if (row.checksum !== checksums.get(migration.version)) {
      throw schemaError('O checksum de uma migração já aplicada diverge do código instalado. A atualização foi interrompida.');
    }
  }
}

function recordMigration(db: Database, migration: MigrationDefinition, checksum: string, appliedAt: string): void {
  db.exec('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', {
    bind: [migration.version, migration.name, checksum, appliedAt],
  });
}

/**
 * Upgrade all pending DDL and its ledger in one synchronous SQLite transaction.
 * The only awaits (SHA-256) happen before BEGIN; no asynchronous transaction
 * callback can accidentally commit before its operations finish.
 */
export async function migrateDatabase(db: Database): Promise<MigrationReport> {
  const checksums = await migrationChecksums();
  db.exec('PRAGMA foreign_keys = ON');
  if (Number(db.selectValue('PRAGMA foreign_keys')) !== 1) {
    throw schemaError('Não foi possível habilitar as chaves estrangeiras para a migração.');
  }

  // Keep BEGIN outside the catch: a caller's existing transaction must never be
  // rolled back by this function if starting our own transaction fails.
  db.exec('BEGIN IMMEDIATE');
  try {
    let schemaVersion = Number(db.selectValue('PRAGMA user_version'));
    if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
      throw schemaError('A versão da estrutura do banco é inválida. Preserve os dados existentes.');
    }
    if (schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw schemaError('Este banco usa uma versão futura da estrutura. Atualize o aplicativo para abri-lo.');
    }

    const ledgerRows = objectRows(db, 'schema_migrations');
    const appliedAt = new Date().toISOString();
    const applied: number[] = [];
    if (ledgerRows.length === 0) {
      if (schemaVersion !== 0 && schemaVersion !== 1) {
        throw schemaError('A versão do banco não possui o histórico de migrações esperado. A adoção foi interrompida.');
      }
      if (schemaVersion === 1) assertLegacyProbe(db);
      db.exec(LEDGER_OBJECT.sql);
      if (schemaVersion === 1) {
        // The historical probe has already executed v1. Baseline its checksum
        // without recreating its table, index, UUIDs, dates or user content.
        recordMigration(db, MIGRATIONS[0], checksums.get(1)!, appliedAt);
      }
    } else {
      assertObject(db, LEDGER_OBJECT);
      assertHistory(db, schemaVersion, checksums);
      for (const expected of PROBE_SCHEMA_OBJECTS) assertObject(db, expected, true);
      if (schemaVersion >= 2) {
        for (const expected of KNOWLEDGE_SCHEMA_OBJECTS) assertObject(db, expected);
      }
    }

    for (const migration of MIGRATIONS) {
      if (migration.version <= schemaVersion) continue;
      if (migration.version !== schemaVersion + 1) {
        throw schemaError('A sequência das migrações não é contínua.');
      }
      // CREATE statements intentionally omit IF NOT EXISTS. A conflicting
      // object aborts the whole upgrade instead of silently adopting its shape.
      db.exec(migration.sql);
      recordMigration(db, migration, checksums.get(migration.version)!, appliedAt);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      schemaVersion = migration.version;
      applied.push(migration.version);
    }

    assertHistory(db, schemaVersion, checksums);
    for (const expected of MANAGED_OBJECTS) {
      assertObject(db, expected, PROBE_SCHEMA_OBJECTS.includes(expected));
    }
    for (const tableName of MANAGED_TABLE_NAMES) {
      // Names originate in the static manifest, never in imported/user content.
      if (db.selectObjects(`PRAGMA main.foreign_key_check('${tableName}')`).length !== 0) {
        throw schemaError('A verificação das chaves estrangeiras encontrou registros incoerentes. Preserve o banco existente.');
      }
    }
    db.exec('COMMIT');
    return {
      schemaVersion,
      applied,
      tableNames: [...MANAGED_TABLE_NAMES],
      migrationCount: MIGRATIONS.length,
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      throw schemaError('A migração falhou e não foi possível confirmar o rollback. Preserve os dados do navegador e reabra o aplicativo.');
    }
    if (!(error instanceof DatabaseError)) {
      const resultCode = (error as { resultCode?: number } | null)?.resultCode;
      const primaryCode = typeof resultCode === 'number' ? resultCode & 0xff : undefined;
      if (primaryCode === 1 || primaryCode === 19) {
        throw schemaError('A migração encontrou uma estrutura em conflito ou uma restrição inválida. Todas as alterações desta tentativa foram revertidas.');
      }
    }
    throw error;
  }
}
