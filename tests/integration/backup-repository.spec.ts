import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { migrateDatabase } from '../../src/database/migrations';
import { BackupRepository } from '../../src/database/repositories/backup-repository';
import { LibraryRepository } from '../../src/database/repositories/library-repository';
import { ProbeRepository } from '../../src/database/repositories/probe-repository';
import { BACKUP_MAX_BYTES, BACKUP_TABLES } from '../../src/models/backup';
import type { LibraryItemDetail, SaveKnowledgeInput } from '../../src/models/library';
import { initQuietSqlite } from '../helpers/sqlite';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonical(source[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function rewrite(text: string, change: (file: any) => void): string {
  const file = JSON.parse(text);
  change(file);
  delete file.checksum;
  file.checksum = createHash('sha256').update(canonical(file)).digest('hex');
  return JSON.stringify(file);
}
function item(categoryId: string, overrides: Partial<SaveKnowledgeInput> = {}): SaveKnowledgeInput {
  return { title: 'Conteúdo de backup', category_id: categoryId, subcategory_id: null, summary: '',
    content: 'Ação, ç, emoji 🌱 e SQL literal: "); DROP TABLE tags; --', source_url: 'https://example.test/fonte',
    source_platform: 'Referência', source_author: 'Autora', favorite: true, status: 'studying', personal_notes: 'Notas privadas de teste',
    metadata_schema_version: 1, metadata_json: {}, tag_names: [], ...overrides };
}
function edit(detail: LibraryItemDetail, overrides: Partial<SaveKnowledgeInput> = {}): SaveKnowledgeInput {
  const { created_at: _created, updated_at: _updated, deleted_at: _deleted, revision, ...fields } = detail.item;
  return { ...fields, expectedRevision: revision, tag_names: detail.tags.map((tag) => tag.name), ...overrides };
}
async function pair(run: (source: Database, target: Database, sqlite: Sqlite3Static) => Promise<void>): Promise<void> {
  const sqlite = await initQuietSqlite();
  const source = new sqlite.oo1.DB(':memory:', 'c');
  const target = new sqlite.oo1.DB(':memory:', 'c');
  try { await migrateDatabase(source); await migrateDatabase(target); await run(source, target, sqlite); }
  finally { source.close(); target.close(); }
}
function simple(db: Database, name: string): LibraryItemDetail {
  const library = new LibraryRepository(db);
  const category = library.createCategory({ name, description: '', presetKey: null });
  return library.save(item(category.category.id));
}
async function restore(repository: BackupRepository, text: string, mode: 'merge' | 'replace' = 'merge') {
  const preview = await repository.inspect(text);
  return repository.restore({ text, mode, expectedState: preview.expectedState });
}
async function exportedState(repository: BackupRepository): Promise<unknown> {
  const file = JSON.parse(await repository.exportJson());
  return { tables: file.tables, changeLogSequence: file.changeLogSequence };
}

test.describe('Backup e restauração — SQLite WASM real', () => {
  test('restauração completa preserva IDs, campos, versões, tags, anexos metadata, histórico e sequência', async () => {
    await pair(async (source, target, sqlite) => {
      const library = new LibraryRepository(source);
      const category = library.createCategory({ name: 'Receitas 🌿', description: 'Minhas receitas', presetKey: 'recipes' });
      const sub = library.createSubcategory({ category_id: category.category.id, name: 'Café', description: '' });
      const first = library.save(item(category.category.id, { subcategory_id: sub.id, metadata_json: { ingredients: ['Água', 'Farinha, integral'], time_minutes: 0, yield: '' }, tag_names: ['Casa', 'Com vírgula, literal'] }));
      const second = library.save(edit(first, { title: 'Receita revisada', personal_notes: 'Minha segunda versão' }));
      source.exec('INSERT INTO category_metadata_schemas (category_id, version, definition_version, schema_json, created_at) VALUES (?, 2, 1, ?, ?)', { bind: [category.category.id, '{"formatVersion":1,"fields":[]}', category.category.created_at] });
      new ProbeRepository(source).insert('Registro da prova de conceito 🌱');
      source.exec('INSERT INTO attachments (id,item_id,original_name,mime_type,byte_size,storage_key,sha256,created_at,updated_at,deleted_at,revision) VALUES (?,?,?,?,?,?,NULL,?,?,NULL,1)', { bind: [randomUUID(), first.item.id, 'referencia.txt', 'text/plain', 12, 'attachments/referencia.txt', first.item.created_at, first.item.updated_at] });
      const deletedCategory = library.createCategory({ name: 'Categoria excluída', description: '', presetKey: null });
      source.exec('UPDATE categories SET deleted_at = updated_at WHERE id = ?', { bind: [deletedCategory.category.id] });
      source.exec("UPDATE sqlite_sequence SET seq = 9999 WHERE name = 'change_log'");
      const backup = new BackupRepository(source, sqlite);
      const receiver = new BackupRepository(target, sqlite);
      simple(target, 'Temporária');
      const text = await backup.exportJson();
      const preview = await receiver.inspect(text);
      expect(preview).toMatchObject({ schemaVersion: 2, attachmentFilesIncluded: false, counts: { knowledge_items: 1, item_revisions: 2, attachments: 1, persistence_probe: 1, category_metadata_schemas: 3 } });
      const result = await receiver.restore({ text, mode: 'replace', expectedState: preview.expectedState });
      expect(result.counts).toEqual(preview.counts);
      expect(new LibraryRepository(target).get(first.item.id)).toEqual(second);
      expect(await exportedState(receiver)).toEqual(await exportedState(backup));
      expect(target.selectValue("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'")).toBe(9999);
      new LibraryRepository(target).createCategory({ name: 'Posterior', description: '', presetKey: null });
      expect(target.selectValue('SELECT max(sequence) FROM change_log')).toBe(10000);
      expect(target.selectValue('PRAGMA integrity_check')).toBe('ok');
      expect(target.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
    });
  });

  test('combina bibliotecas distintas, renumera cursor local e repetir arquivo é idempotente', async () => {
    await pair(async (source, target, sqlite) => {
      const incoming = simple(source, 'Importada');
      const local = simple(target, 'Local');
      const exporter = new BackupRepository(source, sqlite);
      const receiver = new BackupRepository(target, sqlite);
      const text = await exporter.exportJson();
      const first = await restore(receiver, text);
      expect(first.addedRows).toBeGreaterThan(0);
      expect(new LibraryRepository(target).list().map((value) => value.id).sort()).toEqual([incoming.item.id, local.item.id].sort());
      expect(target.selectValues('SELECT sequence FROM change_log ORDER BY sequence')).toEqual([1, 2, 3, 4]);
      const before = await exportedState(receiver);
      const preview = await receiver.inspect(text);
      expect(preview.conflicts).toEqual([]);
      expect(preview.newRows).toBe(0);
      expect(preview.identicalRows).toBe(first.addedRows);
      const repeat = await receiver.restore({ text, mode: 'merge', expectedState: preview.expectedState });
      expect(repeat).toMatchObject({ addedRows: 0, skippedRows: first.addedRows });
      expect(await exportedState(receiver)).toEqual(before);
    });
  });

  test('conflitos de UUID ou nome normalizado bloqueiam toda combinação sem alterações parciais', async () => {
    await pair(async (source, target, sqlite) => {
      const saved = simple(source, 'Comum');
      const exporter = new BackupRepository(source, sqlite);
      const receiver = new BackupRepository(target, sqlite);
      await restore(receiver, await exporter.exportJson());
      const localLibrary = new LibraryRepository(target);
      localLibrary.save(edit(localLibrary.get(saved.item.id), { title: 'Edição local' }));
      const before = await exportedState(receiver);
      const older = await exporter.exportJson();
      const preview = await receiver.inspect(older);
      expect(preview.conflicts).toContainEqual({ table: 'knowledge_items', reason: 'primary-key', count: 1 });
      await expect(receiver.restore({ text: older, mode: 'merge', expectedState: preview.expectedState })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await exportedState(receiver)).toEqual(before);
    });
    await pair(async (source, target, sqlite) => {
      simple(source, 'Ｅｓｔｕｄｏｓ');
      simple(target, 'ESTUDOS');
      const receiver = new BackupRepository(target, sqlite);
      const text = await new BackupRepository(source, sqlite).exportJson();
      const before = await exportedState(receiver);
      const preview = await receiver.inspect(text);
      expect(preview.conflicts).toContainEqual({ table: 'categories', reason: 'unique-key', count: 1 });
      await expect(receiver.restore({ text, mode: 'merge', expectedState: preview.expectedState })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await exportedState(receiver)).toEqual(before);
    });
  });

  test('recusa arquivo alterado, versões futuras, colunas desconhecidas e excesso de tamanho', async () => {
    await pair(async (source, target, sqlite) => {
      simple(source, 'Origem');
      simple(target, 'Destino');
      const receiver = new BackupRepository(target, sqlite);
      const text = await new BackupRepository(source, sqlite).exportJson();
      const before = await exportedState(receiver);
      const tampered = JSON.parse(text);
      tampered.tables.knowledge_items[0].title = 'Alterado sem checksum';
      const malformed = [
        '{JSON incompleto', JSON.stringify(tampered),
        rewrite(text, (file) => { file.schemaVersion = 999; }),
        rewrite(text, (file) => { file.formatVersion = 99; }),
        rewrite(text, (file) => { file.tables.knowledge_items[0].sql = 'DROP TABLE categories'; }),
        rewrite(text, (file) => { file.tables.untrusted_table = []; }),
        rewrite(text, (file) => { delete file.tables.tags; }),
        rewrite(text, (file) => { file.extra = true; }),
        ' '.repeat(BACKUP_MAX_BYTES + 1),
      ];
      for (const invalid of malformed) await expect(receiver.inspect(invalid)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(await exportedState(receiver)).toEqual(before);
    });
  });

  test('checksum correto não dispensa validação semântica de metadados, histórico, UUIDs e relações', async () => {
    await pair(async (source, target, sqlite) => {
      const library = new LibraryRepository(source);
      const category = library.createCategory({ name: 'Receitas', description: '', presetKey: 'recipes' });
      library.save(item(category.category.id, { tag_names: ['Culinária'], metadata_json: { time_minutes: 10 } }));
      simple(target, 'Intocada');
      const receiver = new BackupRepository(target, sqlite);
      const text = await new BackupRepository(source, sqlite).exportJson();
      const before = await exportedState(receiver);
      const malformed = [
        rewrite(text, (file) => { file.tables.knowledge_items[0].metadata_json = '{"time_minutes":"inválido"}'; }),
        rewrite(text, (file) => { file.tables.knowledge_items[0].favorite = true; }),
        rewrite(text, (file) => { file.tables.knowledge_items[0].source_url = 'javascript:alert(1)'; }),
        rewrite(text, (file) => { file.tables.item_tags[0].tag_id = randomUUID(); }),
        rewrite(text, (file) => { file.tables.categories[0].id = 'não-é-uuid'; }),
        rewrite(text, (file) => { file.tables.categories[0].name_key = 'não normalizado'; }),
        rewrite(text, (file) => { file.tables.item_revisions[0].snapshot_version = 2; }),
        rewrite(text, (file) => { file.tables.item_revisions[0].snapshot_json = '{"item":{},"tags":[]}'; }),
        rewrite(text, (file) => { file.tables.change_log[0].payload_json = '{"__proto__":{"polluted":true}}'; }),
        rewrite(text, (file) => { file.tables.change_log[0].sequence = Number.MAX_SAFE_INTEGER + 1; }),
        rewrite(text, (file) => { file.tables.change_log[0].sequence = '001'; }),
        rewrite(text, (file) => { file.tables.change_log[0].base_revision = '0'; }),
        rewrite(text, (file) => { file.tables.item_revisions[0].snapshot_version = '1'; }),
        rewrite(text, (file) => { file.changeLogSequence = 0; }),
        rewrite(text, (file) => { file.tables.tags.push({ ...file.tables.tags[0] }); }),
      ];
      for (const invalid of malformed) await expect(receiver.inspect(invalid)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(await exportedState(receiver)).toEqual(before);
    });
  });

  test('tipos dos metadados de anexos não são convertidos pela afinidade SQLite', async () => {
    await pair(async (source, target, sqlite) => {
      const saved = simple(source, 'Arquivos');
      source.exec('INSERT INTO attachments (id,item_id,original_name,mime_type,byte_size,storage_key,sha256,created_at,updated_at,deleted_at,revision) VALUES (?,?,?,?,?,?,NULL,?,?,NULL,1)', { bind: [randomUUID(), saved.item.id, 'referencia.txt', 'text/plain', 1, 'attachments/referencia.txt', saved.item.created_at, saved.item.updated_at] });
      const receiver = new BackupRepository(target, sqlite);
      const text = await new BackupRepository(source, sqlite).exportJson();
      for (const invalid of [
        rewrite(text, (file) => { file.tables.attachments[0].byte_size = '001'; }),
        rewrite(text, (file) => { file.tables.attachments[0].original_name = 123; }),
      ]) await expect(receiver.inspect(invalid)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(target.selectValue('SELECT count(*) FROM attachments')).toBe(0);
    });
  });

  test('categoria sem conteúdos também exige definição de metadados para ser restaurada', async () => {
    await pair(async (source, target, sqlite) => {
      new LibraryRepository(source).createCategory({ name: 'Categoria vazia', description: '', presetKey: null });
      const receiver = new BackupRepository(target, sqlite);
      const text = await new BackupRepository(source, sqlite).exportJson();
      const malformed = rewrite(text, (file) => { file.tables.category_metadata_schemas = []; });
      await expect(receiver.inspect(malformed)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(new LibraryRepository(target).catalog()).toEqual({ categories: [], tags: [], subcategories: [] });
    });
  });

  test('análise expira se a base ou o arquivo mudar antes da confirmação', async () => {
    await pair(async (source, target, sqlite) => {
      simple(source, 'Importada');
      const receiver = new BackupRepository(target, sqlite);
      const text = await new BackupRepository(source, sqlite).exportJson();
      const preview = await receiver.inspect(text);
      new ProbeRepository(target).insert('Mudança após análise');
      const before = await exportedState(receiver);
      await expect(receiver.restore({ text, mode: 'replace', expectedState: preview.expectedState })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await exportedState(receiver)).toEqual(before);
      const currentPreview = await receiver.inspect(text);
      const changedFile = rewrite(text, (file) => { file.appVersion = 'alterada'; });
      await expect(receiver.restore({ text: changedFile, mode: 'replace', expectedState: currentPreview.expectedState })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await exportedState(receiver)).toEqual(before);
    });
  });

  test('falha após apagar e reinserir registros reverte substituição inteira, inclusive sequência', async () => {
    await pair(async (source, target, sqlite) => {
      simple(source, 'Importada');
      new ProbeRepository(source).insert('Falhar na última tabela');
      simple(target, 'Biblioteca a preservar');
      new ProbeRepository(target).insert('Meu registro original');
      const receiver = new BackupRepository(target, sqlite);
      const text = await new BackupRepository(source, sqlite).exportJson();
      const preview = await receiver.inspect(text);
      const before = await exportedState(receiver);
      target.exec("CREATE TRIGGER reject_backup_probe BEFORE INSERT ON persistence_probe BEGIN SELECT RAISE(ABORT, 'Falha controlada'); END");
      await expect(receiver.restore({ text, mode: 'replace', expectedState: preview.expectedState })).rejects.toThrow();
      expect(await exportedState(receiver)).toEqual(before);
      expect(target.selectValue('PRAGMA integrity_check')).toBe('ok');
      expect(target.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
      target.exec('DROP TRIGGER reject_backup_probe');
      await restore(receiver, text, 'replace');
      expect(new LibraryRepository(target).list()[0].categoryName).toBe('Importada');
    });
  });

  test('banco vazio também é restaurável e restauração não reescreve migrações locais', async () => {
    await pair(async (source, target, sqlite) => {
      simple(target, 'Removida pela substituição');
      const receiver = new BackupRepository(target, sqlite);
      const ledgerBefore = target.selectObjects('SELECT * FROM schema_migrations ORDER BY version');
      const text = await new BackupRepository(source, sqlite).exportJson();
      const result = await restore(receiver, text, 'replace');
      for (const table of BACKUP_TABLES) expect(result.counts[table]).toBe(0);
      expect(target.selectObjects('SELECT * FROM schema_migrations ORDER BY version')).toEqual(ledgerBefore);
      expect(target.selectValue('PRAGMA user_version')).toBe(2);
    });
  });

  test('limite de sequência local bloqueia combinação antes de qualquer escrita', async () => {
    await pair(async (source, target, sqlite) => {
      simple(source, 'Importada');
      simple(target, 'Local');
      target.exec("UPDATE sqlite_sequence SET seq = ? WHERE name = 'change_log'", { bind: [Number.MAX_SAFE_INTEGER] });
      const receiver = new BackupRepository(target, sqlite);
      const text = await new BackupRepository(source, sqlite).exportJson();
      const before = await exportedState(receiver);
      await expect(restore(receiver, text)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(await exportedState(receiver)).toEqual(before);
    });
  });
});
