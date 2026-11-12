import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { migrateDatabase } from '../../src/database/migrations/index';
import { LibraryRepository } from '../../src/database/repositories/library-repository';
import type { LibraryItemDetail, SaveKnowledgeInput } from '../../src/models/library';
import { initQuietSqlite, withMemoryDatabase } from '../helpers/sqlite';

function input(categoryId: string, overrides: Partial<SaveKnowledgeInput> = {}): SaveKnowledgeInput {
  return {
    title: 'Referência de teste', category_id: categoryId, subcategory_id: null,
    summary: '', content: '', source_url: null, source_platform: null, source_author: null,
    favorite: false, status: 'unread', personal_notes: '', metadata_schema_version: 1,
    metadata_json: {}, tag_names: [], ...overrides,
  };
}

function edit(detail: LibraryItemDetail, overrides: Partial<SaveKnowledgeInput> = {}): SaveKnowledgeInput {
  const { id, created_at: _created, updated_at: _updated, deleted_at: _deleted, revision, ...fields } = detail.item;
  return { ...fields, id, expectedRevision: revision, tag_names: detail.tags.map((tag) => tag.name), ...overrides };
}

function expectCode(operation: () => unknown, code: string): void {
  let caught: unknown;
  try { operation(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ name: 'DatabaseError', code });
}

async function withRepository(run: (repository: LibraryRepository, db: Database) => void): Promise<void> {
  await withMemoryDatabase(async (db) => {
    await migrateDatabase(db);
    run(new LibraryRepository(db), db);
    expect(db.selectValue('PRAGMA integrity_check')).toBe('ok');
    expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
  });
}

test.describe('Cadastro e edição da biblioteca — transações SQLite WASM reais', () => {
  test.beforeAll(async () => { await initQuietSqlite(); });

  test('não cria dados automaticamente e cria categorias com definição própria ou modelo escolhido', async () => {
    await withRepository((repository, db) => {
      expect(repository.catalog()).toEqual({ categories: [], subcategories: [], tags: [] });
      expect(repository.list()).toEqual([]);
      const custom = repository.createCategory({ name: '  Estudos  ', description: 'Notas livres', presetKey: null });
      const recipes = repository.createCategory({ name: 'Minha cozinha', description: '', presetKey: 'recipes' });
      expect(custom.category.name).toBe('Estudos');
      expect(custom.schema.schema_json).toEqual({ formatVersion: 1, fields: [] });
      expect(recipes.schema.schema_json.fields.map((field) => field.key)).toContain('ingredients');
      expect(repository.catalog().categories).toHaveLength(2);
      const changes = db.selectObjects('SELECT entity_type, entity_id, operation, revision, base_revision, device_id, payload_json FROM change_log');
      expect(changes).toHaveLength(2);
      expect(changes[0]).toMatchObject({ entity_type: 'category', operation: 'create', revision: 1, base_revision: 0, device_id: null });
      expect(JSON.parse(changes[0].payload_json as string)).toEqual(custom);
    });
  });

  test('grava todos os campos, metadados, tags com vírgulas e histórico; outra instância recupera os mesmos valores', async () => {
    await withRepository((repository, db) => {
      const category = repository.createCategory({ name: 'Receitas', description: '', presetKey: 'recipes' });
      const sub = repository.createSubcategory({ category_id: category.category.id, name: 'Café da manhã', description: 'Receitas rápidas' });
      const values = input(category.category.id, {
        title: "Pão d'água 🍞", subcategory_id: sub.id, summary: 'Sem desperdício',
        content: "Ingredientes e ação 🧠\n'); DROP TABLE tags; --", source_url: 'HTTPS://example.test/receita?porcao=2',
        source_platform: 'Blog', source_author: 'Autora', favorite: true, status: 'studying',
        personal_notes: 'Testar no sábado', metadata_json: { ingredients: ['água', 'farinha'], time_minutes: 0, yield: '' },
        tag_names: [' ＳＱＬ ', 'sql', 'Café, receitas', 'CAFÉ, receitas'],
      });
      const saved = repository.save(values);
      // Compare persisted fields independently from the input-only tag_names key.
      const { tag_names: _tags, ...expected } = values;
      expect(saved.item).toMatchObject(expected);
      expect(saved.tags.map((tag) => tag.name)).toEqual(['Café, receitas', 'ＳＱＬ']);
      expect(new LibraryRepository(db).get(saved.item.id)).toEqual(saved);
      expect(db.selectValue('SELECT favorite FROM knowledge_items WHERE id = ?', [saved.item.id])).toBe(1);
      const history = db.selectObject('SELECT revision, snapshot_json FROM item_revisions WHERE item_id = ?', [saved.item.id]);
      expect(history?.revision).toBe(1);
      expect(JSON.parse(history!.snapshot_json as string)).toEqual({ item: saved.item, tags: saved.tags });
      const itemChange = db.selectObject("SELECT * FROM change_log WHERE entity_type = 'knowledge_item' AND entity_id = ?", [saved.item.id]);
      expect(itemChange).toMatchObject({ operation: 'create', base_revision: 0, revision: 1 });
      expect(itemChange!.id).not.toBe(saved.item.id);
      expect(itemChange!.payload_json).toBe(history!.snapshot_json);
    });
  });

  test('edita preservando UUID/criação, substitui vínculos de tags e mantém revisões anteriores', async () => {
    await withRepository((repository, db) => {
      const category = repository.createCategory({ name: 'Estudos', description: '', presetKey: null });
      const first = repository.save(input(category.category.id, { title: 'Primeiro', tag_names: ['Alpha', 'Beta'] }));
      const second = repository.save(input(category.category.id, { title: 'Segundo', tag_names: ['ALPHA'] }));
      const alpha = first.tags.find((tag) => tag.name_key === 'alpha')!;
      expect(second.tags[0].id).toBe(alpha.id);
      const alphaMembership = db.selectValue('SELECT created_at FROM item_tags WHERE item_id = ? AND tag_id = ?', [first.item.id, alpha.id]);
      const updated = repository.save(edit(first, { title: 'Primeiro revisado', content: 'Novo conteúdo', favorite: true, status: 'completed', tag_names: ['alpha', 'Gamma'] }));
      expect(updated.item).toMatchObject({ id: first.item.id, created_at: first.item.created_at, revision: 2, title: 'Primeiro revisado', favorite: true, status: 'completed' });
      expect(updated.tags.map((tag) => tag.name_key)).toEqual(['alpha', 'gamma']);
      expect(db.selectValue('SELECT count(*) FROM tags')).toBe(3);
      expect(db.selectValue('SELECT created_at FROM item_tags WHERE item_id = ? AND tag_id = ?', [first.item.id, alpha.id])).toBe(alphaMembership);
      const histories = db.selectObjects('SELECT revision, snapshot_json FROM item_revisions WHERE item_id = ? ORDER BY revision', [first.item.id]);
      expect(histories).toHaveLength(2);
      expect(JSON.parse(histories[0].snapshot_json as string)).toEqual({ item: first.item, tags: first.tags });
      expect(JSON.parse(histories[1].snapshot_json as string)).toEqual({ item: updated.item, tags: updated.tags });
      expect(db.selectObject("SELECT base_revision, revision FROM change_log WHERE entity_id = ? AND operation = 'update'", [first.item.id])).toEqual({ base_revision: 1, revision: 2 });
    });
  });

  test('conflito otimista não sobrescreve conteúdo nem cria tags, snapshots ou mudanças', async () => {
    await withRepository((repository, db) => {
      const category = repository.createCategory({ name: 'Estudos', description: '', presetKey: null });
      const opened = repository.save(input(category.category.id, { content: 'Original' }));
      const current = repository.save(edit(opened, { content: 'Versão atual' }));
      const beforeChanges = db.selectValue('SELECT count(*) FROM change_log');
      expectCode(() => repository.save(edit(opened, { content: 'Edição desatualizada', tag_names: ['Não criar'] })), 'CONFLICT');
      expect(repository.get(current.item.id)).toEqual(current);
      expect(db.selectValue('SELECT count(*) FROM tags')).toBe(0);
      expect(db.selectValue('SELECT count(*) FROM item_revisions')).toBe(2);
      expect(db.selectValue('SELECT count(*) FROM change_log')).toBe(beforeChanges);
    });
  });

  for (const failure of ['snapshot', 'change_log'] as const) {
    test(`falha tardia em ${failure} reverte item, vínculos, novas tags e histórico na mesma transação`, async () => {
      await withRepository((repository, db) => {
        const category = repository.createCategory({ name: 'Estudos', description: '', presetKey: null });
        const original = repository.save(input(category.category.id, { content: 'Preservar', tag_names: ['Existente'] }));
        const beforeChanges = db.selectObjects('SELECT * FROM change_log ORDER BY sequence');
        if (failure === 'snapshot') {
          db.exec("CREATE TEMP TRIGGER fail_snapshot BEFORE INSERT ON main.item_revisions WHEN NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'falha de teste'); END");
        } else {
          db.exec("CREATE TEMP TRIGGER fail_item_change BEFORE INSERT ON main.change_log WHEN NEW.entity_type = 'knowledge_item' AND NEW.operation = 'update' BEGIN SELECT RAISE(ABORT, 'falha de teste'); END");
        }
        expect(() => repository.save(edit(original, { title: 'Não persistir', tag_names: ['Nova'] }))).toThrow();
        expect(repository.get(original.item.id)).toEqual(original);
        expect(db.selectValue('SELECT count(*) FROM tags')).toBe(1);
        expect(db.selectValue('SELECT count(*) FROM item_revisions')).toBe(1);
        expect(db.selectObjects('SELECT * FROM change_log ORDER BY sequence')).toEqual(beforeChanges);
      });
    });
  }

  test('categoria e subcategoria também revertem integralmente se seu log falhar', async () => {
    await withRepository((repository, db) => {
      db.exec("CREATE TEMP TRIGGER fail_category_change BEFORE INSERT ON main.change_log WHEN NEW.entity_type = 'category' BEGIN SELECT RAISE(ABORT, 'falha de teste'); END");
      expect(() => repository.createCategory({ name: 'Não persistir', description: '', presetKey: 'recipes' })).toThrow();
      expect(db.selectValue('SELECT count(*) FROM categories')).toBe(0);
      expect(db.selectValue('SELECT count(*) FROM category_metadata_schemas')).toBe(0);
      db.exec('DROP TRIGGER temp.fail_category_change');
      const category = repository.createCategory({ name: 'Categoria válida', description: '', presetKey: null });
      db.exec("CREATE TEMP TRIGGER fail_subcategory_change BEFORE INSERT ON main.change_log WHEN NEW.entity_type = 'subcategory' BEGIN SELECT RAISE(ABORT, 'falha de teste'); END");
      expect(() => repository.createSubcategory({ category_id: category.category.id, name: 'Não persistir', description: '' })).toThrow();
      expect(repository.catalog().subcategories).toEqual([]);
      expect(db.selectValue('SELECT count(*) FROM change_log')).toBe(1);
    });
  });

  test('edição conserva definição antiga quando surge versão mais recente na mesma categoria', async () => {
    await withRepository((repository, db) => {
      const category = repository.createCategory({ name: 'Evolução', description: '', presetKey: null });
      const original = repository.save(input(category.category.id));
      const nextSchema = { formatVersion: 1, fields: [{ key: 'rating', label: 'Nota', type: 'number', required: true }] };
      db.exec('INSERT INTO category_metadata_schemas (category_id, version, definition_version, schema_json, created_at) VALUES (?, 2, 1, ?, ?)', {
        bind: [category.category.id, JSON.stringify(nextSchema), category.category.created_at],
      });
      expect(repository.catalog().categories[0].schema.version).toBe(2);
      const updated = repository.save(edit(original, { title: 'Revisado com formato original' }));
      expect(updated.schema.version).toBe(1);
      expect(updated.item.metadata_json).toEqual({});
      expectCode(() => repository.save(edit(updated, { metadata_schema_version: 2, metadata_json: { rating: 3 } })), 'INVALID_INPUT');
      expect(repository.save(input(category.category.id, { metadata_schema_version: 2, metadata_json: { rating: 0 } })).schema.version).toBe(2);
    });
  });

  test('valida categoria, pertencimento da subcategoria, versão e tipos antes de persistir', async () => {
    await withRepository((repository, db) => {
      const first = repository.createCategory({ name: 'A', description: '', presetKey: null });
      const second = repository.createCategory({ name: 'B', description: '', presetKey: 'recipes' });
      const otherSub = repository.createSubcategory({ category_id: second.category.id, name: 'Outra', description: '' });
      expectCode(() => repository.save(input(first.category.id, { subcategory_id: otherSub.id })), 'INVALID_INPUT');
      expectCode(() => repository.save(input(first.category.id, { subcategory_id: randomUUID() })), 'NOT_FOUND');
      expectCode(() => repository.save(input(randomUUID())), 'NOT_FOUND');
      expectCode(() => repository.save(input(first.category.id, { metadata_schema_version: 99 })), 'NOT_FOUND');
      expectCode(() => repository.save(input(first.category.id, { metadata_json: { unknown: true } })), 'INVALID_INPUT');
      expectCode(() => repository.save(input(second.category.id, { metadata_json: { time_minutes: 'rápido' } })), 'INVALID_INPUT');
      expect(repository.list()).toEqual([]);
      expect(db.selectValue('SELECT count(*) FROM item_revisions')).toBe(0);
    });
  });

  test('nomes Unicode duplicados são recusados e nomes excluídos não são restaurados implicitamente', async () => {
    await withRepository((repository, db) => {
      const first = repository.createCategory({ name: '  Ｅｓｔｕｄｏｓ  ', description: '', presetKey: null });
      expectCode(() => repository.createCategory({ name: 'ESTUDOS', description: '', presetKey: null }), 'CONFLICT');
      const second = repository.createCategory({ name: 'Outra', description: '', presetKey: null });
      repository.createSubcategory({ category_id: first.category.id, name: 'SQL', description: '' });
      expectCode(() => repository.createSubcategory({ category_id: first.category.id, name: 'ｓｑｌ', description: '' }), 'CONFLICT');
      expect(repository.createSubcategory({ category_id: second.category.id, name: 'SQL', description: '' }).name).toBe('SQL');
      const saved = repository.save(input(second.category.id, { tag_names: ['Reservada'] }));
      const future = '2099-01-01T00:00:00.000Z';
      db.exec('UPDATE tags SET updated_at = ?, deleted_at = ? WHERE id = ?', { bind: [future, future, saved.tags[0].id] });
      expectCode(() => repository.save(input(second.category.id, { tag_names: ['RESERVADA'] })), 'CONFLICT');
      db.exec('UPDATE categories SET updated_at = ?, deleted_at = ? WHERE id = ?', { bind: [future, future, first.category.id] });
      expectCode(() => repository.createCategory({ name: 'Estudos', description: '', presetKey: null }), 'CONFLICT');
      expectCode(() => repository.save(input(first.category.id)), 'NOT_FOUND');
      expect(repository.catalog().categories.map((entry) => entry.category.id)).toEqual([second.category.id]);
      expect(repository.catalog().tags).toEqual([]);
      expect(db.selectValue('SELECT count(*) FROM knowledge_items')).toBe(1);
    });
  });

  test('campos desconhecidos, acessores, tags inválidas e revisões malformadas não entram no domínio', async () => {
    await withRepository((repository) => {
      const category = repository.createCategory({ name: 'Categoria', description: '', presetKey: null });
      const values = input(category.category.id);
      let getterCalls = 0;
      const getterInput = { ...values };
      Object.defineProperty(getterInput, 'title', { enumerable: true, get: () => { getterCalls += 1; return 'Não ler'; } });
      const invalidValues: unknown[] = [
        null, [], { ...values, arbitrary_sql: 'DROP TABLE tags' }, { ...values, created_at: 'inventado' }, getterInput,
        { ...values, expectedRevision: 1 }, { ...values, id: randomUUID() },
        { ...values, id: randomUUID(), expectedRevision: 0 }, { ...values, favorite: 1 },
        { ...values, tag_names: new Array(1) }, { ...values, tag_names: [''] },
        { ...values, tag_names: ['x'.repeat(101)] }, { ...values, tag_names: Array.from({ length: 31 }, (_, index) => `Tag ${index}`) },
      ];
      for (const value of invalidValues) expectCode(() => repository.save(value), 'INVALID_INPUT');
      expect(getterCalls).toBe(0);
      expectCode(() => repository.get('não é UUID'), 'INVALID_INPUT');
      expectCode(() => repository.get(randomUUID()), 'NOT_FOUND');
      expectCode(() => repository.createCategory({ name: 'X', description: '', presetKey: 'desconhecido' }), 'INVALID_INPUT');
      expect(repository.list()).toEqual([]);
    });
  });

  test('lista retorna prévia Unicode curta sem conteúdo completo, notas ou metadados', async () => {
    await withRepository((repository) => {
      const category = repository.createCategory({ name: 'Lista', description: '', presetKey: null });
      const content = '🧠'.repeat(200);
      const saved = repository.save(input(category.category.id, { content, personal_notes: 'Privado', favorite: true }));
      const list = repository.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: saved.item.id, categoryName: 'Lista', subcategoryName: null, contentPreview: '🧠'.repeat(180), favorite: true, revision: 1 });
      expect(list[0]).not.toHaveProperty('content');
      expect(list[0]).not.toHaveProperty('personal_notes');
      expect(list[0]).not.toHaveProperty('metadata_json');
      expect(repository.get(saved.item.id).item.content).toBe(content);
    });
  });

  test('relógio recuado não faz atualização ou histórico antecederem os dados existentes', async () => {
    await withRepository((repository, db) => {
      const category = repository.createCategory({ name: 'Tempo', description: '', presetKey: null });
      const saved = repository.save(input(category.category.id));
      const future = '2099-01-01T00:00:00.000Z';
      db.exec('UPDATE knowledge_items SET updated_at = ? WHERE id = ?', { bind: [future, saved.item.id] });
      const opened = repository.get(saved.item.id);
      const updated = repository.save(edit(opened, { title: 'Depois do recuo', tag_names: ['Nova'] }));
      expect(updated.item.created_at).toBe(saved.item.created_at);
      expect(updated.item.updated_at >= future).toBe(true);
      expect(updated.tags[0].created_at >= future).toBe(true);
      expect((db.selectValue('SELECT created_at FROM item_revisions WHERE item_id = ? AND revision = 2', [saved.item.id]) as string) >= future).toBe(true);
    });
  });

  test('limite de JSON escapado é validado antes de gravações e não deixa histórico parcial', async () => {
    await withRepository((repository, db) => {
      const category = repository.createCategory({ name: 'Limite', description: '', presetKey: null });
      const beforeChanges = db.selectValue('SELECT count(*) FROM change_log');
      expectCode(() => repository.save(input(category.category.id, { content: '\u0001'.repeat(700_000), tag_names: ['Não criar'] })), 'INVALID_INPUT');
      expect(repository.list()).toEqual([]);
      expect(db.selectValue('SELECT count(*) FROM tags')).toBe(0);
      expect(db.selectValue('SELECT count(*) FROM item_revisions')).toBe(0);
      expect(db.selectValue('SELECT count(*) FROM change_log')).toBe(beforeChanges);
    });
  });

  test('leitura recusa JSON malformado e falhas no formato SQLite sem apresentar dados como válidos', async () => {
    await withMemoryDatabase(async (db) => {
      await migrateDatabase(db);
      const repository = new LibraryRepository(db);
      const category = repository.createCategory({ name: 'Leitura', description: '', presetKey: null });
      const saved = repository.save(input(category.category.id));
      db.exec('PRAGMA ignore_check_constraints = ON');
      db.exec('UPDATE knowledge_items SET metadata_json = ? WHERE id = ?', { bind: ['{inválido', saved.item.id] });
      expectCode(() => repository.get(saved.item.id), 'INTEGRITY');
      db.exec('UPDATE knowledge_items SET metadata_json = ?, favorite = 2 WHERE id = ?', { bind: ['{}', saved.item.id] });
      expectCode(() => repository.get(saved.item.id), 'INTEGRITY');
      expectCode(() => repository.list(), 'INTEGRITY');
    });
  });
});
