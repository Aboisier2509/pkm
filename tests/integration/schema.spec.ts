import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { type Database, type SqlValue } from '@sqlite.org/sqlite-wasm';
import { migrateProbeDatabase } from '../../src/database/migrations/001-probe';
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, migrateDatabase } from '../../src/database/migrations/index';
import { initQuietSqlite, withMemoryDatabase } from '../helpers/sqlite';

const CREATED = '2026-11-09T12:00:00.000Z';
const UPDATED = '2026-11-10T12:00:00.000Z';

function insert(db: Database, table: string, values: Record<string, SqlValue>): void {
  const columns = Object.keys(values);
  // All identifiers are test-owned constants. Values always use bindings.
  db.exec(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, {
    bind: Object.values(values),
  });
}

function tableExists(db: Database, table: string): boolean {
  return Number(db.selectValue("SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?", [table])) === 1;
}

function seedLegacyProbe(db: Database): string {
  migrateProbeDatabase(db);
  const id = randomUUID();
  insert(db, 'persistence_probe', { id, content: 'Conteúdo legado: café, ação e 🧠', created_at: CREATED });
  return id;
}

function seedCategory(db: Database, name = `Categoria ${randomUUID()}`): string {
  const id = randomUUID();
  insert(db, 'categories', { id, name, name_key: name.toLowerCase(), created_at: CREATED, updated_at: CREATED });
  insert(db, 'category_metadata_schemas', {
    category_id: id, version: 1, schema_json: '{"formatVersion":1,"fields":[]}', created_at: CREATED,
  });
  return id;
}

function seedSubcategory(db: Database, categoryId: string, name = 'Subcategoria'): string {
  const id = randomUUID();
  insert(db, 'subcategories', {
    id, category_id: categoryId, name, name_key: name.toLowerCase(), created_at: CREATED, updated_at: CREATED,
  });
  return id;
}

function itemValues(categoryId: string, extra: Record<string, SqlValue> = {}): Record<string, SqlValue> {
  return {
    id: randomUUID(), title: 'Conhecimento de teste', category_id: categoryId,
    created_at: CREATED, updated_at: CREATED, ...extra,
  };
}

function seedItem(db: Database, categoryId: string, extra: Record<string, SqlValue> = {}): string {
  const values = itemValues(categoryId, extra);
  insert(db, 'knowledge_items', values);
  return values.id as string;
}

test.describe('Modelagem relacional e migrações — SQLite WASM real', () => {
  test.beforeAll(async () => { await initQuietSqlite(); });

  test('cria o esquema completo, com ledger e checksums das migrações publicadas', async () => {
    await withMemoryDatabase(async (db) => {
      const report = await migrateDatabase(db);
      expect(report.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(report.applied).toEqual([1, 2]);
      expect(report.migrationCount).toBe(2);
      expect(report.tableNames).toHaveLength(11);
      expect(report.tableNames).toEqual(expect.arrayContaining([
        'persistence_probe', 'schema_migrations', 'categories', 'subcategories',
        'tags', 'item_tags', 'knowledge_items', 'attachments', 'category_metadata_schemas',
      ]));
      expect(Number(db.selectValue('PRAGMA user_version'))).toBe(2);
      const ledger = db.selectObjects('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
      expect(ledger).toHaveLength(MIGRATIONS.length);
      for (const [index, migration] of MIGRATIONS.entries()) {
        const expectedChecksum = createHash('sha256').update(JSON.stringify({
          version: migration.version, name: migration.name, sql: migration.sql,
        })).digest('hex');
        expect(ledger[index]).toEqual({ version: migration.version, name: migration.name, checksum: expectedChecksum });
      }
      expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
      expect(db.selectValue('PRAGMA integrity_check')).toBe('ok');
    });
  });

  test('reabrir a versão atual é idempotente e não reescreve o histórico', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const ledger = db.selectObjects('SELECT * FROM schema_migrations ORDER BY version');
      const beforeChanges = db.selectValue('SELECT total_changes()');
      const report = await migrateDatabase(db);
      expect(report.applied).toEqual([]);
      expect(db.selectObjects('SELECT * FROM schema_migrations ORDER BY version')).toEqual(ledger);
      expect(db.selectValue('SELECT total_changes()')).toBe(beforeChanges);
    });
  });

  test('atualiza o banco legado v1 sem alterar seus registros e registra a baseline', async () => {
    await withMemoryDatabase(async (db) => {
      const id = seedLegacyProbe(db);
      const before = db.selectObjects('SELECT * FROM persistence_probe');
      expect(Number(db.selectValue('PRAGMA user_version'))).toBe(1);
      const report = await migrateDatabase(db);
      expect(report.applied).toEqual([2]);
      expect(db.selectObjects('SELECT * FROM persistence_probe')).toEqual(before);
      expect(db.selectValue('SELECT id FROM persistence_probe')).toBe(id);
      expect(db.selectObjects('SELECT version FROM schema_migrations ORDER BY version')).toEqual([{ version: 1 }, { version: 2 }]);
      expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
    });
  });

  test('recusa versão futura sem criar ledger ou rebaixar user_version', async () => {
    await withMemoryDatabase(async (db) => {
      db.exec('PRAGMA user_version = 99');
      await expect(migrateDatabase(db)).rejects.toMatchObject({ code: 'SCHEMA' });
      expect(Number(db.selectValue('PRAGMA user_version'))).toBe(99);
      expect(tableExists(db, 'schema_migrations')).toBe(false);
      expect(tableExists(db, 'persistence_probe')).toBe(false);
    });
  });

  test('recusa checksum alterado sem reparar silenciosamente o ledger', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const changedChecksum = '0'.repeat(64);
      db.exec('UPDATE schema_migrations SET checksum = ? WHERE version = 1', { bind: [changedChecksum] });
      const before = db.selectObjects('SELECT * FROM schema_migrations ORDER BY version');
      await expect(migrateDatabase(db)).rejects.toMatchObject({ code: 'SCHEMA' });
      expect(db.selectObjects('SELECT * FROM schema_migrations ORDER BY version')).toEqual(before);
      expect(Number(db.selectValue('PRAGMA user_version'))).toBe(2);
    });
  });

  test('recusa lacuna no ledger e versão declarada sem histórico', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      db.exec('DELETE FROM schema_migrations WHERE version = 1');
      await expect(migrateDatabase(db)).rejects.toMatchObject({ code: 'SCHEMA' });
      expect(db.selectValue('SELECT count(*) FROM schema_migrations')).toBe(1);
    });
    await withMemoryDatabase(async (db) => {
      db.exec('PRAGMA user_version = 2');
      await expect(migrateDatabase(db)).rejects.toMatchObject({ code: 'SCHEMA' });
      expect(tableExists(db, 'schema_migrations')).toBe(false);
    });
  });

  test('recusa legado v1 sem a estrutura de origem esperada', async () => {
    await withMemoryDatabase(async (db) => {
      db.exec('PRAGMA user_version = 1');
      await expect(migrateDatabase(db)).rejects.toMatchObject({ code: 'SCHEMA' });
      expect(Number(db.selectValue('PRAGMA user_version'))).toBe(1);
      expect(tableExists(db, 'schema_migrations')).toBe(false);
      expect(tableExists(db, 'categories')).toBe(false);
    });
  });

  test('falha tardia no DDL reverte criação parcial, baseline e versão sem afetar dados preexistentes', async () => {
    await withMemoryDatabase(async (db) => {
      seedLegacyProbe(db);
      const probeBefore = db.selectObjects('SELECT * FROM persistence_probe');
      db.exec("CREATE TABLE attachments (external_note TEXT); INSERT INTO attachments VALUES ('Preservar esta tabela alheia')");
      await expect(migrateDatabase(db)).rejects.toThrow();
      expect(Number(db.selectValue('PRAGMA user_version'))).toBe(1);
      expect(db.selectObjects('SELECT * FROM persistence_probe')).toEqual(probeBefore);
      expect(db.selectValue('SELECT external_note FROM attachments')).toBe('Preservar esta tabela alheia');
      expect(tableExists(db, 'categories')).toBe(false);
      expect(tableExists(db, 'schema_migrations')).toBe(false);
      expect(db.selectValue('PRAGMA integrity_check')).toBe('ok');
    });
  });

  test('detecta drift real de tabela ou índice sem reconstruir objetos automaticamente', async () => {
    for (const drift of [
      'DROP INDEX idx_items_recent',
      'ALTER TABLE categories ADD COLUMN unexpected_column TEXT',
    ]) {
      await withMemoryDatabase(async (db) => {
        await migrateDatabase(db);
        const ledger = db.selectObjects('SELECT * FROM schema_migrations ORDER BY version');
        db.exec(drift);
        await expect(migrateDatabase(db)).rejects.toMatchObject({ code: 'SCHEMA' });
        expect(db.selectObjects('SELECT * FROM schema_migrations ORDER BY version')).toEqual(ledger);
        expect(Number(db.selectValue('PRAGMA user_version'))).toBe(2);
      });
    }
  });

  test('recusa referências incoerentes preexistentes e preserva os registros para recuperação', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      db.exec('PRAGMA foreign_keys = OFF');
      const dangling = { item_id: randomUUID(), tag_id: randomUUID(), created_at: CREATED };
      insert(db, 'item_tags', dangling);
      await expect(migrateDatabase(db)).rejects.toMatchObject({ code: 'SCHEMA' });
      expect(Number(db.selectValue('PRAGMA foreign_keys'))).toBe(1);
      expect(db.selectObjects('SELECT * FROM item_tags')).toEqual([dangling]);
      expect(Number(db.selectValue('PRAGMA user_version'))).toBe(2);
    });
  });

  test('não assume nem desfaz uma transação já aberta pelo chamador', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      db.exec('BEGIN IMMEDIATE');
      try {
        const categoryId = seedCategory(db, 'Transação pendente');
        await expect(migrateDatabase(db)).rejects.toThrow();
        expect(db.selectValue('SELECT count(*) FROM categories WHERE id = ?', [categoryId])).toBe(1);
      } finally {
        db.exec('ROLLBACK');
      }
      expect(db.selectValue('SELECT count(*) FROM categories')).toBe(0);
    });
  });

  test('habilita foreign_keys e impede subcategoria pertencente a outra categoria', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      expect(Number(db.selectValue('PRAGMA foreign_keys'))).toBe(1);
      const first = seedCategory(db, 'Programação');
      const second = seedCategory(db, 'Receitas');
      const ownSubcategory = seedSubcategory(db, first, 'SQL');
      const otherSubcategory = seedSubcategory(db, second, 'Sobremesas');
      expect(() => seedItem(db, first, { subcategory_id: otherSubcategory })).toThrow();
      expect(() => seedItem(db, randomUUID())).toThrow();
      seedItem(db, first, { subcategory_id: ownSubcategory });
      seedItem(db, first, { subcategory_id: null });
      expect(db.selectValue('SELECT count(*) FROM knowledge_items')).toBe(2);
      expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
    });
  });

  test('relacionamento item/tag rejeita órfãos e duplicatas', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const itemId = seedItem(db, seedCategory(db));
      const tagId = randomUUID();
      insert(db, 'tags', { id: tagId, name: 'SQLite', name_key: 'sqlite', created_at: CREATED, updated_at: CREATED });
      const relation = { item_id: itemId, tag_id: tagId, created_at: CREATED };
      insert(db, 'item_tags', relation);
      expect(() => insert(db, 'item_tags', relation)).toThrow();
      expect(() => insert(db, 'item_tags', { ...relation, tag_id: randomUUID() })).toThrow();
      expect(() => insert(db, 'item_tags', { ...relation, item_id: randomUUID() })).toThrow();
      expect(db.selectValue('SELECT count(*) FROM item_tags')).toBe(1);
      expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
    });
  });

  test('nomes normalizados são únicos, com subcategorias limitadas ao próprio pai', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const first = seedCategory(db, 'Programação');
      const second = seedCategory(db, 'Receitas');
      expect(() => insert(db, 'categories', {
        id: randomUUID(), name: 'Outra grafia', name_key: 'programação', created_at: CREATED, updated_at: CREATED,
      })).toThrow();
      seedSubcategory(db, first, 'Favoritos');
      expect(() => seedSubcategory(db, first, 'Favoritos')).toThrow();
      seedSubcategory(db, second, 'Favoritos');
      expect(db.selectValue('SELECT count(*) FROM subcategories')).toBe(2);
    });
  });

  test('valida os campos obrigatórios, status, favorito e metadados JSON no próprio SQLite', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const categoryId = seedCategory(db);
      const invalidRows: Record<string, SqlValue>[] = [
        { title: '' }, { title: '   ' }, { title: 'Título\0oculto' }, { title: 'x'.repeat(301) },
        { status: 'unknown' }, { favorite: 2 }, { favorite: -1 }, { favorite: 0.5 },
        { metadata_json: '{malformed' }, { metadata_json: '[]' }, { metadata_json: 'null' },
        { metadata_json: 'true' }, { metadata_json: '{"x":"' + 'x'.repeat(100000) + '"}' },
        { source_url: 'javascript:alert(1)' }, { source_url: 'https://example.com/\nunsafe' },
      ];
      for (const extra of invalidRows) {
        expect(() => insert(db, 'knowledge_items', itemValues(categoryId, extra))).toThrow();
      }
      const missingTitle = itemValues(categoryId);
      delete missingTitle.title;
      expect(() => insert(db, 'knowledge_items', missingTitle)).toThrow();
      const missingCategory = itemValues(categoryId);
      delete missingCategory.category_id;
      expect(() => insert(db, 'knowledge_items', missingCategory)).toThrow();
      expect(db.selectValue('SELECT count(*) FROM knowledge_items')).toBe(0);
      for (const status of ['unread', 'reading', 'studying', 'completed', 'archived']) {
        seedItem(db, categoryId, { status, favorite: 1, metadata_json: '{"objective":"Aprender SQL","count":2}' });
      }
      expect(db.selectValue('SELECT count(*) FROM knowledge_items')).toBe(5);
    });
  });

  test('UUID, datas UTC e revisão não aceitam formatos inválidos nem sequência temporal incoerente', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const categoryId = seedCategory(db);
      const invalidRows: Record<string, SqlValue>[] = [
        { id: 'not-a-uuid' }, { id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA' },
        { id: '11111111-1111-1111-1111-11111111111g' },
        { created_at: '2026-02-30T12:00:00.000Z' },
        { created_at: '2026-11-09T25:00:00.000Z' },
        { created_at: '2026-11-09T12:00:00Z' },
        { created_at: '2026-11-09T09:00:00.000-03:00' },
        { updated_at: '2026-11-08T12:00:00.000Z' },
        { deleted_at: UPDATED },
        { revision: 0 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
      ];
      for (const extra of invalidRows) {
        expect(() => insert(db, 'knowledge_items', itemValues(categoryId, extra))).toThrow();
      }
      seedItem(db, categoryId, { updated_at: UPDATED, deleted_at: UPDATED, revision: 2 });
      expect(db.selectValue('SELECT count(*) FROM knowledge_items')).toBe(1);
    });
  });

  test('versões de metadados coexistem e definições usadas não podem ser alteradas ou removidas', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const categoryId = seedCategory(db);
      const otherCategoryId = seedCategory(db);
      insert(db, 'category_metadata_schemas', {
        category_id: categoryId, version: 2, created_at: UPDATED,
        schema_json: '{"formatVersion":1,"fields":[{"key":"time","label":"Tempo","type":"number"}]}',
      });
      seedItem(db, categoryId, { metadata_schema_version: 1 });
      seedItem(db, categoryId, { metadata_schema_version: 2, metadata_json: '{"time":15}' });
      expect(() => seedItem(db, categoryId, { metadata_schema_version: 3 })).toThrow();
      expect(() => seedItem(db, otherCategoryId, { metadata_schema_version: 2 })).toThrow();
      expect(() => db.exec('UPDATE category_metadata_schemas SET schema_json = ? WHERE category_id = ? AND version = 1', {
        bind: ['{"formatVersion":1,"fields":[]}', categoryId],
      })).toThrow();
      expect(() => db.exec('DELETE FROM category_metadata_schemas WHERE category_id = ? AND version = 1', { bind: [categoryId] })).toThrow();
      expect(db.selectObjects('SELECT metadata_schema_version FROM knowledge_items ORDER BY metadata_schema_version'))
        .toEqual([{ metadata_schema_version: 1 }, { metadata_schema_version: 2 }]);
      expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
    });
  });

  test('metadados de anexos protegem tamanho, checksum, caminho relativo e vínculo com o item', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const itemId = seedItem(db, seedCategory(db));
      const attachment = (extra: Record<string, SqlValue> = {}): Record<string, SqlValue> => ({
        id: randomUUID(), item_id: itemId, original_name: 'referencia.txt', mime_type: 'text/plain',
        byte_size: 512, storage_key: `attachments/${randomUUID()}.txt`, sha256: 'a'.repeat(64),
        created_at: CREATED, updated_at: CREATED, ...extra,
      });
      const invalidRows: Record<string, SqlValue>[] = [
        { byte_size: -1 }, { byte_size: 0.5 }, { byte_size: Number.MAX_SAFE_INTEGER + 1 },
        { sha256: 'a'.repeat(63) }, { sha256: 'A'.repeat(64) }, { sha256: 'g'.repeat(64) },
        { storage_key: '/absolute/file.txt' }, { storage_key: '../file.txt' },
        { storage_key: 'attachments/../file.txt' }, { storage_key: 'attachments\\file.txt' },
        { storage_key: 'attachments/folder/' },
        { original_name: '../file.txt' }, { item_id: randomUUID() },
      ];
      for (const extra of invalidRows) {
        expect(() => insert(db, 'attachments', attachment(extra))).toThrow();
      }
      const valid = attachment();
      insert(db, 'attachments', valid);
      expect(() => insert(db, 'attachments', attachment({ storage_key: valid.storage_key }))).toThrow();
      expect(db.selectValue('SELECT count(*) FROM attachments')).toBe(1);
      expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
    });
  });

  test('soft delete preserva o item e seu histórico; tabelas futuras não simulam sincronização automática', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const itemId = seedItem(db, seedCategory(db));
      expect(db.selectValue('SELECT count(*) FROM item_revisions')).toBe(0);
      expect(db.selectValue('SELECT count(*) FROM change_log')).toBe(0);
      const snapshot = JSON.stringify({ title: 'Conhecimento de teste', revision: 1 });
      insert(db, 'item_revisions', {
        id: randomUUID(), item_id: itemId, revision: 1, snapshot_json: snapshot, created_at: CREATED,
      });
      insert(db, 'change_log', {
        id: randomUUID(), entity_type: 'knowledge_item', entity_id: itemId, operation: 'create',
        revision: 1, base_revision: 0, changed_at: CREATED, payload_json: snapshot,
      });
      expect(() => insert(db, 'change_log', {
        id: randomUUID(), entity_type: 'knowledge_item', entity_id: itemId, operation: 'update',
        revision: 1, base_revision: 1, changed_at: CREATED, payload_json: snapshot,
      })).toThrow();
      db.exec('UPDATE knowledge_items SET deleted_at = ?, updated_at = ?, revision = 2 WHERE id = ?', {
        bind: [UPDATED, UPDATED, itemId],
      });
      expect(db.selectValue('SELECT count(*) FROM knowledge_items WHERE deleted_at IS NULL')).toBe(0);
      expect(db.selectValue('SELECT deleted_at FROM knowledge_items WHERE id = ?', [itemId])).toBe(UPDATED);
      expect(db.selectValue('SELECT snapshot_json FROM item_revisions WHERE item_id = ?', [itemId])).toBe(snapshot);
      expect(db.selectValue('SELECT count(*) FROM change_log')).toBe(1);
      expect(() => db.exec('DELETE FROM knowledge_items WHERE id = ?', { bind: [itemId] })).toThrow();
      expect(() => insert(db, 'item_revisions', {
        id: randomUUID(), item_id: itemId, revision: 1, snapshot_json: '{}', created_at: CREATED,
      })).toThrow();
      expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
      expect(db.selectValue('PRAGMA integrity_check')).toBe('ok');
    });
  });
});
