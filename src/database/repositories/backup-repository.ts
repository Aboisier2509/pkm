import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm';
import { DatabaseError } from '../../models/database';
import { BACKUP_MAX_BYTES, BACKUP_TABLES, type BackupCounts, type BackupConflict, type BackupPreview, type BackupRestoreInput, type BackupRestoreResult, type BackupTableName } from '../../models/backup';
import type { CategoryMetadataSchema } from '../../models/knowledge';
import { KnowledgeValidationError, sqliteBooleanToBoolean, validateCategory, validateCategoryMetadataSchemaRecord, validateKnowledgeItem, validateSubcategory, validateTag, validateUtcTimestamp, validateUuid } from '../../services/knowledge-validation';
import { validateProbeContent } from '../../utils/validation';
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from '../migrations';

type Cell = string | number | null;
type Row = Record<string, Cell>;
type Tables = Record<BackupTableName, Row[]>;
interface Snapshot { tables: Tables; changeLogSequence: number }
interface BackupBody extends Snapshot {
  format: 'pkm-backup'; formatVersion: 1; schemaVersion: number;
  appVersion: string; exportedAt: string; attachmentFilesIncluded: false;
}
interface BackupFile extends BackupBody { checksum: string }

// Every interpolated identifier comes from these compile-time manifests.
const COLUMNS: Record<BackupTableName, readonly string[]> = {
  categories: ['id', 'name', 'name_key', 'description', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  category_metadata_schemas: ['category_id', 'version', 'definition_version', 'schema_json', 'created_at'],
  subcategories: ['id', 'category_id', 'name', 'name_key', 'description', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  tags: ['id', 'name', 'name_key', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  knowledge_items: ['id', 'title', 'category_id', 'subcategory_id', 'summary', 'content', 'source_url', 'source_platform', 'source_author', 'favorite', 'status', 'personal_notes', 'metadata_schema_version', 'metadata_json', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  item_tags: ['item_id', 'tag_id', 'created_at'],
  attachments: ['id', 'item_id', 'original_name', 'mime_type', 'byte_size', 'storage_key', 'sha256', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  item_revisions: ['id', 'item_id', 'revision', 'snapshot_json', 'snapshot_version', 'created_at'],
  change_log: ['sequence', 'id', 'entity_type', 'entity_id', 'operation', 'revision', 'base_revision', 'device_id', 'changed_at', 'payload_json', 'payload_version'],
  persistence_probe: ['id', 'content', 'created_at'],
};
const PRIMARY: Record<BackupTableName, readonly string[]> = {
  categories: ['id'], category_metadata_schemas: ['category_id', 'version'], subcategories: ['id'], tags: ['id'],
  knowledge_items: ['id'], item_tags: ['item_id', 'tag_id'], attachments: ['id'], item_revisions: ['id'],
  change_log: ['id'], persistence_probe: ['id'],
};
const UNIQUE: Partial<Record<BackupTableName, readonly (readonly string[])[]>> = {
  categories: [['name_key']], subcategories: [['category_id', 'name_key']], tags: [['name_key']],
  attachments: [['storage_key']], item_revisions: [['item_id', 'revision']],
};
const INTEGER_COLUMNS: Partial<Record<BackupTableName, readonly string[]>> = {
  categories: ['revision'], category_metadata_schemas: ['version', 'definition_version'], subcategories: ['revision'], tags: ['revision'],
  knowledge_items: ['favorite', 'metadata_schema_version', 'revision'], attachments: ['byte_size', 'revision'],
  item_revisions: ['revision', 'snapshot_version'], change_log: ['sequence', 'revision', 'base_revision', 'payload_version'],
};
const NULLABLE_COLUMNS: Partial<Record<BackupTableName, readonly string[]>> = {
  categories: ['deleted_at'], subcategories: ['deleted_at'], tags: ['deleted_at'],
  knowledge_items: ['subcategory_id', 'source_url', 'source_platform', 'source_author', 'deleted_at'],
  attachments: ['sha256', 'deleted_at'], change_log: ['device_id'],
};

function invalid(message = 'O arquivo de backup é inválido ou usa um formato não suportado.'): never {
  throw new DatabaseError('INVALID_INPUT', message);
}
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(value).length > 0) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length || keys.some((key) => !Object.hasOwn(descriptors, key))) invalid();
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!keys.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  }
  return value as Record<string, unknown>;
}
function safeString(value: string): void {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 0 || character.length === 1 && code >= 0xd800 && code <= 0xdfff) invalid();
  }
}
function positive(value: unknown, zero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (zero ? 0 : 1)) invalid();
  return value;
}
/** Deterministic keys, original array order. Called only after shape/size validation. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const data = value as Record<string, unknown>;
    return `{${Object.keys(data).sort().map((key) => `${JSON.stringify(key)}:${canonical(data[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function counts(tables: Tables): BackupCounts {
  return Object.fromEntries(BACKUP_TABLES.map((table) => [table, tables[table].length])) as BackupCounts;
}
function total(tables: Tables): number { return BACKUP_TABLES.reduce((sum, table) => sum + tables[table].length, 0); }
function key(row: Row, columns: readonly string[]): string { return JSON.stringify(columns.map((column) => row[column])); }
function comparable(table: BackupTableName, row: Row): string {
  // A change-log sequence belongs to this installation. IDs are global identities.
  return canonical(Object.fromEntries(COLUMNS[table].filter((column) => table !== 'change_log' || column !== 'sequence').map((column) => [column, row[column]])));
}
function snapshot(db: Database): Snapshot {
  const tables = {} as Tables;
  for (const table of BACKUP_TABLES) {
    const order = table === 'change_log' ? ['sequence'] : PRIMARY[table];
    tables[table] = db.selectObjects(`SELECT ${COLUMNS[table].join(',')} FROM ${table} ORDER BY ${order.join(',')}`) as Row[];
  }
  const sequence = db.selectValue("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'") ?? 0;
  return { tables, changeLogSequence: positive(sequence, true) };
}
function assertIntegrity(db: Database): void {
  if (db.selectValues('PRAGMA integrity_check').some((value) => value !== 'ok') || db.selectObjects('PRAGMA foreign_key_check').length !== 0) {
    throw new DatabaseError('INTEGRITY', 'A verificação de integridade encontrou dados inconsistentes. A restauração não foi aplicada.');
  }
  if (db.selectValue('PRAGMA foreign_keys') !== 1) throw new DatabaseError('INTEGRITY', 'A proteção das relações do banco não está habilitada.');
}
function insert(db: Database, table: BackupTableName, row: Row, merging = false): void {
  const columns = COLUMNS[table].filter((column) => !merging || table !== 'change_log' || column !== 'sequence');
  db.exec(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, { bind: columns.map((column) => row[column]) as SqlValue[] });
}
function setSequence(db: Database, sequence: number): void {
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'change_log'");
  db.exec('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', { bind: ['change_log', sequence] });
}
function decodeJson(value: Cell): unknown {
  if (typeof value !== 'string') invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return invalid(); }
  let budget = 0;
  const visit = (data: unknown, depth: number): void => {
    if (++budget > 1_000_000 || depth > 32) invalid('Um JSON do backup excede os limites de tamanho ou profundidade.');
    if (typeof data === 'number' && !Number.isFinite(data)) invalid();
    if (typeof data === 'string') safeString(data);
    if (Array.isArray(data)) { for (const entry of data) visit(entry, depth + 1); }
    else if (data !== null && typeof data === 'object') {
      for (const [name, entry] of Object.entries(data)) {
        if (['__proto__', 'prototype', 'constructor'].includes(name)) invalid();
        safeString(name); visit(entry, depth + 1);
      }
    }
  };
  visit(parsed, 0);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) invalid();
  return parsed;
}
function lifecycle(row: Row): void {
  validateUuid(row.id); validateUtcTimestamp(row.created_at); validateUtcTimestamp(row.updated_at);
  if (row.deleted_at !== null) validateUtcTimestamp(row.deleted_at);
  positive(row.revision);
}
function validateDomain(tables: Tables): void {
  const schemas = new Map<string, CategoryMetadataSchema>();
  for (const row of tables.categories) validateCategory(row);
  for (const row of tables.subcategories) validateSubcategory(row);
  for (const row of tables.tags) validateTag(row);
  for (const row of tables.category_metadata_schemas) {
    const schema = validateCategoryMetadataSchemaRecord({ ...row, schema_json: decodeJson(row.schema_json) });
    schemas.set(key(row, ['category_id', 'version']), schema.schema_json);
  }
  const categoriesWithSchema = new Set(tables.category_metadata_schemas.map((row) => row.category_id));
  if (tables.categories.some((row) => !categoriesWithSchema.has(row.id))) invalid('Uma categoria do backup não possui definição de metadados.');
  const checkItem = (value: unknown): ReturnType<typeof validateKnowledgeItem> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const item = value as Record<string, unknown>;
    const definition = schemas.get(JSON.stringify([item.category_id, item.metadata_schema_version]));
    if (!definition) invalid('O backup referencia uma definição de metadados ausente.');
    return validateKnowledgeItem(value, definition);
  };
  for (const row of tables.knowledge_items) checkItem({ ...row, favorite: sqliteBooleanToBoolean(row.favorite), metadata_json: decodeJson(row.metadata_json) });
  for (const row of tables.item_tags) { validateUuid(row.item_id); validateUuid(row.tag_id); validateUtcTimestamp(row.created_at); }
  for (const row of tables.attachments) { lifecycle(row); validateUuid(row.item_id); }
  const checkSnapshot = (value: unknown, itemId: Cell, revision: Cell): void => {
    const data = exactObject(value, ['item', 'tags']);
    const item = checkItem(data.item);
    if (item.id !== itemId || item.revision !== revision || !Array.isArray(data.tags)) invalid('Um histórico do backup não corresponde ao conteúdo referenciado.');
    const tagIds = new Set<string>();
    for (const tag of data.tags) {
      const valid = validateTag(tag);
      if (tagIds.has(valid.id)) invalid();
      tagIds.add(valid.id);
    }
  };
  for (const row of tables.item_revisions) {
    validateUuid(row.id); validateUuid(row.item_id); validateUtcTimestamp(row.created_at);
    checkSnapshot(decodeJson(row.snapshot_json), row.item_id, row.revision);
  }
  for (const row of tables.change_log) {
    validateUuid(row.id); validateUuid(row.entity_id); validateUtcTimestamp(row.changed_at);
    if (row.device_id !== null) validateUuid(row.device_id);
    const data = decodeJson(row.payload_json);
    if (row.entity_type === 'knowledge_item') checkSnapshot(data, row.entity_id, row.revision);
    else if (row.entity_type === 'category') {
      const value = exactObject(data, ['category', 'schema']);
      const category = validateCategory(value.category);
      const schema = validateCategoryMetadataSchemaRecord(value.schema);
      if (category.id !== row.entity_id || category.revision !== row.revision || schema.category_id !== category.id) invalid();
    } else if (row.entity_type === 'subcategory' || row.entity_type === 'tag') {
      const property = row.entity_type;
      const value = exactObject(data, [property]);
      const record = property === 'tag' ? validateTag(value[property]) : validateSubcategory(value[property]);
      if (record.id !== row.entity_id || record.revision !== row.revision) invalid();
    }
  }
  for (const row of tables.persistence_probe) { validateUuid(row.id); validateUtcTimestamp(row.created_at); validateProbeContent(row.content); }
}

function classify(current: Tables, incoming: Tables): { conflicts: BackupConflict[]; identicalRows: number; newRows: number; additions: Tables } {
  const conflicts: BackupConflict[] = [];
  const additions = {} as Tables;
  let identicalRows = 0;
  let newRows = 0;
  for (const table of BACKUP_TABLES) {
    additions[table] = [];
    const primary = new Map(current[table].map((row) => [key(row, PRIMARY[table]), row]));
    const unique = (UNIQUE[table] ?? []).map((columns) => ({ columns, values: new Set(current[table].map((row) => key(row, columns))) }));
    let primaryConflicts = 0;
    let uniqueConflicts = 0;
    for (const row of incoming[table]) {
      const existing = primary.get(key(row, PRIMARY[table]));
      if (existing) {
        if (comparable(table, existing) === comparable(table, row)) identicalRows += 1;
        else primaryConflicts += 1;
      } else if (unique.some((constraint) => constraint.values.has(key(row, constraint.columns)))) uniqueConflicts += 1;
      else { additions[table].push(row); newRows += 1; }
    }
    if (primaryConflicts > 0) conflicts.push({ table, reason: 'primary-key', count: primaryConflicts });
    if (uniqueConflicts > 0) conflicts.push({ table, reason: 'unique-key', count: uniqueConflicts });
  }
  return { conflicts, identicalRows, newRows, additions };
}

export class BackupRepository {
  constructor(private readonly db: Database, private readonly sqlite: Sqlite3Static) {}

  async exportJson(): Promise<string> {
    assertIntegrity(this.db);
    const state = snapshot(this.db);
    // Validate the full record set, including deleted items and historical JSON.
    try { validateDomain(state.tables); } catch { throw new DatabaseError('INTEGRITY', 'Os dados locais não correspondem ao formato de backup. Preserve o navegador e verifique a base.'); }
    const body: BackupBody = { format: 'pkm-backup', formatVersion: 1, schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development', exportedAt: new Date().toISOString(),
      attachmentFilesIncluded: false, ...state };
    const checksum = await sha256(canonical(body));
    const output = JSON.stringify({ ...body, checksum });
    if (new TextEncoder().encode(output).byteLength > BACKUP_MAX_BYTES) invalid('Este backup excede o limite de 50 MiB do formato JSON. Exporte o banco SQLite para preservar uma cópia.');
    return output;
  }

  async inspect(text: unknown): Promise<BackupPreview> {
    const backup = await this.validate(text);
    const current = snapshot(this.db);
    const comparison = classify(current.tables, backup.tables);
    return { exportedAt: backup.exportedAt, schemaVersion: backup.schemaVersion, appVersion: backup.appVersion,
      counts: counts(backup.tables), currentCounts: counts(current.tables), conflicts: comparison.conflicts,
      identicalRows: comparison.identicalRows, newRows: comparison.newRows,
      expectedState: await sha256(canonical({ current, checksum: backup.checksum })), attachmentFilesIncluded: false };
  }

  async restore(input: BackupRestoreInput): Promise<BackupRestoreResult> {
    const value = exactObject(input, ['text', 'mode', 'expectedState']);
    if (value.mode !== 'merge' && value.mode !== 'replace') invalid('Escolha uma forma de restauração válida.');
    if (typeof value.expectedState !== 'string' || !/^[0-9a-f]{64}$/u.test(value.expectedState)) invalid('Analise o arquivo antes de restaurar.');
    const backup = await this.validate(value.text);
    const current = snapshot(this.db);
    const serializedCurrent = canonical(current);
    const expectedState = await sha256(canonical({ current, checksum: backup.checksum }));
    if (expectedState !== value.expectedState) throw new DatabaseError('CONFLICT', 'A base local ou o arquivo mudou após a análise. Analise o backup novamente antes de restaurar.');
    const comparison = classify(current.tables, backup.tables);
    if (value.mode === 'merge' && comparison.conflicts.length > 0) throw new DatabaseError('CONFLICT', 'Existem registros em conflito. Nenhum dado foi importado. Revise a análise ou escolha a substituição completa.');
    if (value.mode === 'merge' && comparison.additions.change_log.length > Number.MAX_SAFE_INTEGER - current.changeLogSequence) invalid('O histórico local atingiu o limite de sequência suportado.');
    assertIntegrity(this.db);
    const resultCounts = counts(value.mode === 'replace' ? backup.tables : current.tables);
    if (value.mode === 'merge') for (const table of BACKUP_TABLES) resultCounts[table] += comparison.additions[table].length;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // This synchronous check closes the SHA-256 await window before any writes.
      if (canonical(snapshot(this.db)) !== serializedCurrent) throw new DatabaseError('CONFLICT', 'A base mudou durante a análise. Analise o backup novamente.');
      if (value.mode === 'replace') {
        for (const table of [...BACKUP_TABLES].reverse()) this.db.exec(`DELETE FROM ${table}`);
        for (const table of BACKUP_TABLES) for (const row of backup.tables[table]) insert(this.db, table, row);
        setSequence(this.db, backup.changeLogSequence);
      } else {
        for (const table of BACKUP_TABLES) for (const row of comparison.additions[table]) insert(this.db, table, row, true);
      }
      assertIntegrity(this.db);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {
        throw new DatabaseError('INTEGRITY', 'A restauração falhou e não foi possível confirmar a reversão. Preserve os dados do navegador e reabra a base.');
      }
      throw error;
    }
    return { mode: value.mode, addedRows: value.mode === 'replace' ? total(backup.tables) : comparison.newRows,
      skippedRows: value.mode === 'replace' ? 0 : comparison.identicalRows, counts: resultCounts };
  }

  private async validate(text: unknown): Promise<BackupFile> {
    if (typeof text !== 'string' || text.length > BACKUP_MAX_BYTES || new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES) invalid('Selecione um backup JSON de até 50 MiB.');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return invalid('O arquivo não contém um JSON de backup válido.'); }
    const file = exactObject(parsed, ['format', 'formatVersion', 'schemaVersion', 'appVersion', 'exportedAt', 'attachmentFilesIncluded', 'tables', 'changeLogSequence', 'checksum']);
    if (file.format !== 'pkm-backup' || file.formatVersion !== 1 || file.schemaVersion !== CURRENT_SCHEMA_VERSION || file.attachmentFilesIncluded !== false) invalid('A versão ou o formato deste backup não é compatível com este aplicativo.');
    if (typeof file.appVersion !== 'string' || file.appVersion.length < 1 || file.appVersion.length > 100) invalid();
    safeString(file.appVersion);
    if (typeof file.checksum !== 'string' || !/^[0-9a-f]{64}$/u.test(file.checksum)) invalid();
    const sequence = positive(file.changeLogSequence, true);
    try { validateUtcTimestamp(file.exportedAt); } catch { return invalid(); }
    const source = exactObject(file.tables, BACKUP_TABLES);
    const tables = {} as Tables;
    for (const table of BACKUP_TABLES) {
      const rows = source[table];
      if (!Array.isArray(rows) || rows.length > 500_000) invalid('O backup excede o limite de registros por tabela.');
      tables[table] = rows.map((entry) => {
        const row = exactObject(entry, COLUMNS[table]);
        for (const [column, cell] of Object.entries(row)) {
          if (cell === null) {
            if (!NULLABLE_COLUMNS[table]?.includes(column)) invalid();
          } else if (INTEGER_COLUMNS[table]?.includes(column)) {
            if (typeof cell !== 'number' || !Number.isSafeInteger(cell)) invalid();
          } else {
            if (typeof cell !== 'string') invalid();
            safeString(cell);
          }
        }
        return row as Row;
      });
    }
    const body: BackupBody = { format: 'pkm-backup', formatVersion: 1, schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: file.appVersion, exportedAt: file.exportedAt as string, attachmentFilesIncluded: false, tables, changeLogSequence: sequence };
    if (await sha256(canonical(body)) !== file.checksum) invalid('A verificação SHA-256 falhou. O backup foi alterado ou está incompleto; nenhum dado foi importado.');
    const staging = new this.sqlite.oo1.DB(':memory:', 'c');
    try {
      await migrateDatabase(staging);
      validateDomain(tables);
      staging.transaction('IMMEDIATE', () => {
        for (const table of BACKUP_TABLES) for (const row of tables[table]) insert(staging, table, row);
        const maxSequence = Number(staging.selectValue('SELECT coalesce(max(sequence), 0) FROM change_log'));
        if (sequence < maxSequence) invalid('A sequência do histórico no backup é inconsistente.');
        setSequence(staging, sequence);
        assertIntegrity(staging);
      });
    } catch (error) {
      if (error instanceof DatabaseError && error.code === 'INVALID_INPUT') throw error;
      if (error instanceof KnowledgeValidationError) invalid('Um registro ou metadado do backup não corresponde ao formato esperado.');
      invalid('O backup contém registros inválidos, duplicados ou relações ausentes. Nenhum dado local foi alterado.');
    } finally { staging.close(); }
    return { ...body, checksum: file.checksum };
  }
}
