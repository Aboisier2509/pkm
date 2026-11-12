import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { DatabaseError } from '../../models/database';
import { CATEGORY_PRESETS } from '../../models/category-presets';
import { KNOWLEDGE_STATUSES, type CategoryMetadataSchemaRecord, type CategoryRecord, type KnowledgeItemRecord, type KnowledgeStatus, type SubcategoryRecord, type TagRecord } from '../../models/knowledge';
import { LIBRARY_LIMITS, type CategoryOption, type LibraryCatalog, type LibraryItemDetail, type LibraryItemSummary } from '../../models/library';
import { booleanToSqlite, KNOWLEDGE_LIMITS, KnowledgeValidationError, normalizeName, sqliteBooleanToBoolean, validateCategory, validateCategoryMetadataSchemaRecord, validateKnowledgeItem, validateSubcategory, validateTag, validateUtcTimestamp, validateUuid } from '../../services/knowledge-validation';

type Row = Record<string, SqlValue>;
const SAVE_FIELDS = [
  'title', 'category_id', 'subcategory_id', 'summary', 'content', 'source_url',
  'source_platform', 'source_author', 'favorite', 'status', 'personal_notes',
  'metadata_schema_version', 'metadata_json', 'tag_names',
] as const;
const PAYLOAD_LIMIT = 4_000_000;

function invalid(message: string): never { throw new DatabaseError('INVALID_INPUT', message); }
function corrupt(): never { throw new DatabaseError('INTEGRITY', 'Um registro da biblioteca não corresponde ao formato esperado. Preserve os dados e verifique a integridade.'); }

/** Whitelist data properties before reading unknown input, without invoking getters. */
function inputObject(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid('Informe os campos do formulário em um objeto.');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid('O formulário deve conter apenas dados.');
  if (Object.getOwnPropertySymbols(input).length > 0) invalid('O formulário contém propriedades não permitidas.');
  const allowed = new Set([...required, ...optional]);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid('O formulário contém campos não permitidos.');
  }
  if (required.some((key) => !Object.hasOwn(descriptors, key))) invalid('Preencha todos os campos esperados do formulário.');
  return input as Record<string, unknown>;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid('A versão informada deve ser um inteiro positivo.');
  return value;
}

function timestampAtLeast(...timestamps: string[]): string {
  const now = validateUtcTimestamp(new Date().toISOString());
  return timestamps.reduce((latest, timestamp) => timestamp > latest ? timestamp : latest, now);
}

function jsonFromRow(value: unknown): unknown {
  if (typeof value !== 'string') corrupt();
  try { return JSON.parse(value); } catch { return corrupt(); }
}

function serializePayload(value: object): string {
  const serialized = JSON.stringify(value);
  let length = 0;
  for (const _character of serialized) {
    if (++length > PAYLOAD_LIMIT) invalid('O conteúdo serializado excede o limite de 4.000.000 de caracteres do histórico. Reduza o conteúdo antes de salvar.');
  }
  return serialized;
}

function readText(value: unknown, maximum: number, nonblank = false): string {
  if (typeof value !== 'string') corrupt();
  let length = 0;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (++length > maximum || code === 0 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff)) corrupt();
  }
  if (nonblank && value.trim().length === 0) corrupt();
  return value;
}

function normalizedTags(input: unknown): ReturnType<typeof normalizeName>[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > LIBRARY_LIMITS.tagNames || Object.getOwnPropertySymbols(input).length > 0) {
    invalid('Informe uma lista com até 30 nomes de tags.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.keys(descriptors).length !== input.length + 1) invalid('A lista de tags contém propriedades não permitidas.');
  const unique = new Map<string, ReturnType<typeof normalizeName>>();
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid('A lista de tags deve conter apenas nomes.');
    const normalized = normalizeName(descriptor.value);
    if (!unique.has(normalized.name_key)) unique.set(normalized.name_key, normalized);
  }
  return [...unique.values()];
}

export class LibraryRepository {
  constructor(private readonly db: Database) {}

  catalog(): LibraryCatalog {
    return this.read(() => ({
      categories: this.db.selectObjects('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name_key, id').map((row) => {
        const category = validateCategory(row);
        const version = this.db.selectValue('SELECT max(version) FROM category_metadata_schemas WHERE category_id = ?', [category.id]);
        if (typeof version !== 'number') corrupt();
        return { category, schema: this.schema(category.id, version) };
      }),
      subcategories: this.db.selectObjects(`SELECT s.* FROM subcategories s JOIN categories c ON c.id = s.category_id
        WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY s.category_id, s.name_key, s.id`).map(validateSubcategory),
      tags: this.db.selectObjects('SELECT * FROM tags WHERE deleted_at IS NULL ORDER BY name_key, id').map(validateTag),
    }));
  }

  list(): LibraryItemSummary[] {
    return this.read(() => {
      const tags = new Map<string, string[]>();
      for (const row of this.db.selectObjects(`SELECT t.*, it.item_id AS owner_item_id FROM item_tags it
        JOIN tags t ON t.id = it.tag_id JOIN knowledge_items i ON i.id = it.item_id
        WHERE i.deleted_at IS NULL ORDER BY t.name_key, t.id`)) {
        const { owner_item_id: owner, ...tagRow } = row;
        const tag = validateTag(tagRow);
        const id = validateUuid(owner);
        const names = tags.get(id) ?? [];
        names.push(tag.name);
        tags.set(id, names);
      }
      // Full content, metadata and notes are deliberately not selected here.
      return this.db.selectObjects(`SELECT i.id, i.title, i.summary, substr(i.content, 1, 180) AS contentPreview,
        c.name AS categoryName, s.name AS subcategoryName, i.status, i.favorite, i.created_at, i.updated_at, i.revision
        FROM knowledge_items i JOIN categories c ON c.id = i.category_id LEFT JOIN subcategories s ON s.id = i.subcategory_id
        WHERE i.deleted_at IS NULL ORDER BY i.updated_at DESC, i.created_at DESC, i.id`).map((row) => {
        const id = validateUuid(row.id);
        const created_at = validateUtcTimestamp(row.created_at);
        const updated_at = validateUtcTimestamp(row.updated_at);
        if (updated_at < created_at || !KNOWLEDGE_STATUSES.includes(row.status as KnowledgeStatus)) corrupt();
        return {
          id, title: readText(row.title, KNOWLEDGE_LIMITS.title, true),
          summary: readText(row.summary, KNOWLEDGE_LIMITS.summary),
          contentPreview: readText(row.contentPreview, LIBRARY_LIMITS.contentPreview),
          categoryName: readText(row.categoryName, KNOWLEDGE_LIMITS.name, true),
          subcategoryName: row.subcategoryName === null ? null : readText(row.subcategoryName, KNOWLEDGE_LIMITS.name, true),
          status: row.status as KnowledgeStatus, favorite: sqliteBooleanToBoolean(row.favorite),
          created_at, updated_at, revision: positiveInteger(row.revision), tags: tags.get(id) ?? [],
        };
      });
    });
  }

  get(id: unknown): LibraryItemDetail {
    const validId = this.userValue(() => validateUuid(id));
    return this.read(() => {
      const row = this.db.selectObject('SELECT * FROM knowledge_items WHERE id = ? AND deleted_at IS NULL', [validId]);
      if (!row) throw new DatabaseError('NOT_FOUND', 'O conteúdo não foi encontrado ou não está ativo.');
      if (typeof row.category_id !== 'string' || typeof row.metadata_schema_version !== 'number') corrupt();
      const schema = this.schema(row.category_id, row.metadata_schema_version);
      const item = validateKnowledgeItem({ ...row, favorite: sqliteBooleanToBoolean(row.favorite), metadata_json: jsonFromRow(row.metadata_json) }, schema.schema_json);
      return { item, tags: this.tagsForItem(validId), schema };
    });
  }

  save(input: unknown): LibraryItemDetail {
    return this.mutate(() => {
      const value = inputObject(input, SAVE_FIELDS, ['id', 'expectedRevision']);
      const editing = Object.hasOwn(value, 'id');
      if (editing !== Object.hasOwn(value, 'expectedRevision')) invalid('Uma edição exige ID e revisão esperada; um novo cadastro omite ambos.');
      const expectedRevision = editing ? positiveInteger(value.expectedRevision) : 0;
      const prior = editing ? this.get(validateUuid(value.id)) : undefined;
      if (prior && prior.item.revision !== expectedRevision) throw new DatabaseError('CONFLICT', 'Este conteúdo foi alterado desde a abertura do formulário. Reabra a versão atual antes de salvar.');
      if (prior && prior.item.revision === Number.MAX_SAFE_INTEGER) throw new DatabaseError('CONFLICT', 'O conteúdo atingiu o limite de revisões suportado.');
      const categoryId = validateUuid(value.category_id, 'category_id');
      const category = this.activeCategory(categoryId);
      const metadataVersion = positiveInteger(value.metadata_schema_version);
      if (prior && prior.item.category_id === categoryId && prior.item.metadata_schema_version !== metadataVersion) {
        invalid('A edição deve preservar a versão de metadados do conteúdo. Não há migração automática da definição.');
      }
      const schema = this.schema(categoryId, metadataVersion, true);
      let subcategory: SubcategoryRecord | undefined;
      if (value.subcategory_id !== null) {
        const subcategoryId = validateUuid(value.subcategory_id, 'subcategory_id');
        const row = this.db.selectObject('SELECT * FROM subcategories WHERE id = ? AND deleted_at IS NULL', [subcategoryId]);
        if (!row) throw new DatabaseError('NOT_FOUND', 'A subcategoria selecionada não está disponível.');
        subcategory = this.read(() => validateSubcategory(row));
        if (subcategory.category_id !== categoryId) invalid('A subcategoria selecionada pertence a outra categoria.');
      }
      const at = timestampAtLeast(category.created_at, category.updated_at, schema.created_at,
        ...(subcategory ? [subcategory.created_at, subcategory.updated_at] : []),
        ...(prior ? [prior.item.created_at, prior.item.updated_at] : []));
      const item = validateKnowledgeItem({
        id: prior?.item.id ?? crypto.randomUUID(), title: value.title, category_id: categoryId,
        subcategory_id: subcategory?.id ?? null, summary: value.summary, content: value.content,
        source_url: value.source_url, source_platform: value.source_platform, source_author: value.source_author,
        favorite: value.favorite, status: value.status, personal_notes: value.personal_notes,
        metadata_schema_version: metadataVersion, metadata_json: value.metadata_json,
        created_at: prior?.item.created_at ?? at, updated_at: at, deleted_at: null,
        revision: prior ? prior.item.revision + 1 : 1,
      }, schema.schema_json);
      const names = normalizedTags(value.tag_names);
      const { tags, newTags } = this.resolveTags(names, at);
      // Validate escaped JSON size before the first write. Per-field limits
      // alone do not bound the size of snapshots containing control characters.
      serializePayload({ item, tags });
      for (const tag of newTags) this.insertTag(tag);
      const existingMembership = new Map(this.db.selectObjects('SELECT tag_id, created_at FROM item_tags WHERE item_id = ?', [item.id]).map((row) => [String(row.tag_id), String(row.created_at)]));
      this.writeItem(item, prior?.item.revision);
      this.db.exec('DELETE FROM item_tags WHERE item_id = ?', { bind: [item.id] });
      for (const tag of tags) {
        this.db.exec('INSERT INTO item_tags (item_id, tag_id, created_at) VALUES (?, ?, ?)', {
          bind: [item.id, tag.id, existingMembership.get(tag.id) ?? timestampAtLeast(at, tag.created_at)],
        });
      }
      const detail = this.get(item.id);
      const snapshot = serializePayload({ item: detail.item, tags: detail.tags });
      this.db.exec('INSERT INTO item_revisions (id, item_id, revision, snapshot_json, snapshot_version, created_at) VALUES (?, ?, ?, ?, 1, ?)', {
        bind: [crypto.randomUUID(), item.id, item.revision, snapshot, at],
      });
      this.change('knowledge_item', item.id, prior ? 'update' : 'create', item.revision, expectedRevision, at, snapshot);
      return detail;
    });
  }

  createCategory(input: unknown): CategoryOption {
    return this.mutate(() => {
      const value = inputObject(input, ['name', 'description', 'presetKey']);
      const normalized = normalizeName(value.name);
      if (value.presetKey !== null && typeof value.presetKey !== 'string') invalid('Selecione um modelo de categoria válido.');
      const preset = value.presetKey === null ? undefined : CATEGORY_PRESETS.find((candidate) => candidate.key === value.presetKey);
      if (value.presetKey !== null && !preset) invalid('O modelo de categoria selecionado não existe.');
      this.assertNameAvailable('category', normalized.name_key);
      const at = timestampAtLeast();
      const category = validateCategory({ id: crypto.randomUUID(), ...normalized, description: value.description,
        created_at: at, updated_at: at, deleted_at: null, revision: 1 });
      const schema = validateCategoryMetadataSchemaRecord({ category_id: category.id, version: 1, definition_version: 1,
        schema_json: preset?.schema ?? { formatVersion: 1, fields: [] }, created_at: at });
      this.db.exec('INSERT INTO categories (id, name, name_key, description, created_at, updated_at, deleted_at, revision) VALUES (?, ?, ?, ?, ?, ?, NULL, 1)', {
        bind: [category.id, category.name, category.name_key, category.description, at, at],
      });
      this.db.exec('INSERT INTO category_metadata_schemas (category_id, version, definition_version, schema_json, created_at) VALUES (?, 1, 1, ?, ?)', {
        bind: [category.id, JSON.stringify(schema.schema_json), at],
      });
      this.change('category', category.id, 'create', 1, 0, at, serializePayload({ category, schema }));
      return { category, schema };
    });
  }

  createSubcategory(input: unknown): SubcategoryRecord {
    return this.mutate(() => {
      const value = inputObject(input, ['category_id', 'name', 'description']);
      const categoryId = validateUuid(value.category_id, 'category_id');
      const category = this.activeCategory(categoryId);
      const normalized = normalizeName(value.name);
      this.assertNameAvailable('subcategory', normalized.name_key, categoryId);
      const at = timestampAtLeast(category.created_at, category.updated_at);
      const subcategory = validateSubcategory({ id: crypto.randomUUID(), category_id: categoryId, ...normalized,
        description: value.description, created_at: at, updated_at: at, deleted_at: null, revision: 1 });
      this.db.exec('INSERT INTO subcategories (id, category_id, name, name_key, description, created_at, updated_at, deleted_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)', {
        bind: [subcategory.id, categoryId, subcategory.name, subcategory.name_key, subcategory.description, at, at],
      });
      this.change('subcategory', subcategory.id, 'create', 1, 0, at, serializePayload({ subcategory }));
      return subcategory;
    });
  }

  private writeItem(item: KnowledgeItemRecord, expectedRevision: number | undefined): void {
    const values: SqlValue[] = [item.title, item.category_id, item.subcategory_id, item.summary, item.content,
      item.source_url, item.source_platform, item.source_author, booleanToSqlite(item.favorite), item.status,
      item.personal_notes, item.metadata_schema_version, JSON.stringify(item.metadata_json), item.updated_at, item.revision];
    if (expectedRevision === undefined) {
      this.db.exec(`INSERT INTO knowledge_items (title, category_id, subcategory_id, summary, content, source_url,
        source_platform, source_author, favorite, status, personal_notes, metadata_schema_version, metadata_json,
        updated_at, revision, id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`, {
        bind: [...values, item.id, item.created_at],
      });
    } else {
      this.db.exec(`UPDATE knowledge_items SET title = ?, category_id = ?, subcategory_id = ?, summary = ?, content = ?,
        source_url = ?, source_platform = ?, source_author = ?, favorite = ?, status = ?, personal_notes = ?,
        metadata_schema_version = ?, metadata_json = ?, updated_at = ?, revision = ?
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`, { bind: [...values, item.id, expectedRevision] });
      if (this.db.changes() !== 1) throw new DatabaseError('CONFLICT', 'A versão do conteúdo mudou. Reabra o registro antes de salvar.');
    }
  }

  private activeCategory(id: string): CategoryRecord {
    const row = this.db.selectObject('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) throw new DatabaseError('NOT_FOUND', 'A categoria selecionada não está disponível.');
    return this.read(() => validateCategory(row));
  }

  private schema(categoryId: string, version: number, requested = false): CategoryMetadataSchemaRecord {
    const row = this.db.selectObject('SELECT * FROM category_metadata_schemas WHERE category_id = ? AND version = ?', [categoryId, version]);
    if (!row) {
      if (requested) throw new DatabaseError('NOT_FOUND', 'A versão dos metadados selecionada não está disponível nesta categoria.');
      return corrupt();
    }
    return this.read(() => validateCategoryMetadataSchemaRecord({ ...row, schema_json: jsonFromRow(row.schema_json) }));
  }

  private tagsForItem(id: string): TagRecord[] {
    return this.db.selectObjects('SELECT t.* FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = ? ORDER BY t.name_key, t.id', [id]).map(validateTag);
  }

  private resolveTags(names: ReturnType<typeof normalizeName>[], at: string): { tags: TagRecord[]; newTags: TagRecord[] } {
    const newTags: TagRecord[] = [];
    const tags = names.map((name) => {
      const row = this.db.selectObject('SELECT * FROM tags WHERE name_key = ?', [name.name_key]);
      if (row) {
        const tag = this.read(() => validateTag(row));
        if (tag.deleted_at !== null) throw new DatabaseError('CONFLICT', 'Um nome de tag está reservado por um registro excluído. Escolha outro nome.');
        return tag;
      }
      const tag = validateTag({ id: crypto.randomUUID(), ...name, created_at: at, updated_at: at, deleted_at: null, revision: 1 });
      newTags.push(tag);
      return tag;
    });
    return { tags, newTags };
  }

  private insertTag(tag: TagRecord): void {
    this.db.exec('INSERT INTO tags (id, name, name_key, created_at, updated_at, deleted_at, revision) VALUES (?, ?, ?, ?, ?, NULL, 1)', {
      bind: [tag.id, tag.name, tag.name_key, tag.created_at, tag.updated_at],
    });
    this.change('tag', tag.id, 'create', 1, 0, tag.created_at, serializePayload({ tag }));
  }

  private assertNameAvailable(entity: 'category' | 'subcategory', nameKey: string, categoryId?: string): void {
    const exists = entity === 'category'
      ? this.db.selectValue('SELECT 1 FROM categories WHERE name_key = ?', [nameKey])
      : this.db.selectValue('SELECT 1 FROM subcategories WHERE category_id = ? AND name_key = ?', [categoryId!, nameKey]);
    if (exists !== undefined) throw new DatabaseError('CONFLICT', 'Este nome já existe ou está reservado por um registro excluído. Escolha outro nome.');
  }

  private change(entity: 'category' | 'subcategory' | 'tag' | 'knowledge_item', id: string, operation: 'create' | 'update', revision: number, baseRevision: number, at: string, payload: string): void {
    this.db.exec(`INSERT INTO change_log (id, entity_type, entity_id, operation, revision, base_revision, device_id, changed_at, payload_json, payload_version)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1)`, {
      bind: [crypto.randomUUID(), entity, id, operation, revision, baseRevision, at, payload],
    });
  }

  private userValue<T>(operation: () => T): T {
    try { return operation(); } catch (error) {
      if (error instanceof KnowledgeValidationError) throw new DatabaseError('INVALID_INPUT', error.message);
      throw error;
    }
  }

  private read<T>(operation: () => T): T {
    try { return operation(); } catch (error) {
      if (error instanceof KnowledgeValidationError) return corrupt();
      throw error;
    }
  }

  private mutate<T>(operation: () => T): T {
    try { return this.db.transaction('IMMEDIATE', operation); } catch (error) {
      if (error instanceof KnowledgeValidationError) throw new DatabaseError('INVALID_INPUT', error.message);
      const code = (error as { resultCode?: number } | null)?.resultCode;
      if (!(error instanceof DatabaseError) && typeof code === 'number' && (code & 0xff) === 19) {
        throw new DatabaseError('CONFLICT', 'A gravação encontrou um conflito de integridade. As alterações desta tentativa foram revertidas.');
      }
      throw error;
    }
  }
}
