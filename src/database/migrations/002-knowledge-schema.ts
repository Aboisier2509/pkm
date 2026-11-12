import type { ManagedSchemaObject } from './types';

const MAX_SAFE_INTEGER = '9007199254740991';

// SQL identifiers below are compile-time constants, never user-controlled.
function uuidCheck(column: string): string {
  return `length(${column}) = 36
    AND ${column} GLOB '????????-????-????-????-????????????'
    AND length(replace(${column}, '-', '')) = 32
    AND replace(${column}, '-', '') NOT GLOB '*[^0-9a-f]*'`;
}

function textCheck(column: string, maximum: number, required = false): string {
  return `length(${column}) ${required ? `BETWEEN 1 AND ${maximum}` : `<= ${maximum}`}
    AND instr(${column}, char(0)) = 0${required ? ` AND length(trim(${column})) > 0` : ''}`;
}

function utcCheck(column: string): string {
  // The modifier forces calendar normalization, rejecting e.g. February 30.
  // Explicit IS NOT NULL prevents SQLite CHECK's NULL-success semantics.
  return `length(${column}) = 24
    AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
    AND substr(${column}, 12, 2) BETWEEN '00' AND '23'
    AND substr(${column}, 15, 2) BETWEEN '00' AND '59'
    AND substr(${column}, 18, 2) BETWEEN '00' AND '59'
    AND strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '+0 days') IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '+0 days') = ${column}`;
}

function jsonObjectCheck(column: string, maximum: number): string {
  return `length(${column}) <= ${maximum}
    AND CASE WHEN json_valid(${column}) THEN json_type(${column}) = 'object' ELSE 0 END`;
}

const LIFECYCLE_COLUMNS = `
  created_at TEXT NOT NULL CHECK (${utcCheck('created_at')}),
  updated_at TEXT NOT NULL CHECK (${utcCheck('updated_at')}),
  deleted_at TEXT CHECK (deleted_at IS NULL OR (${utcCheck('deleted_at')})),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND ${MAX_SAFE_INTEGER})`;

const LIFECYCLE_CHECKS = `
  CHECK (updated_at >= created_at),
  CHECK (deleted_at IS NULL OR (deleted_at >= created_at AND deleted_at <= updated_at))`;

const object = (type: ManagedSchemaObject['type'], name: string, sql: string): ManagedSchemaObject => Object.freeze({ type, name, sql });

export const KNOWLEDGE_SCHEMA_OBJECTS: readonly ManagedSchemaObject[] = Object.freeze([
  object('table', 'categories', `CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL CHECK (${uuidCheck('id')}),
    name TEXT NOT NULL CHECK (${textCheck('name', 100, true)}),
    name_key TEXT NOT NULL UNIQUE CHECK (${textCheck('name_key', 100, true)} AND name_key = trim(name_key)),
    description TEXT NOT NULL DEFAULT '' CHECK (${textCheck('description', 2000)}),
    ${LIFECYCLE_COLUMNS},
    ${LIFECYCLE_CHECKS}
  ) STRICT`),

  object('table', 'category_metadata_schemas', `CREATE TABLE category_metadata_schemas (
    category_id TEXT NOT NULL CHECK (${uuidCheck('category_id')}),
    version INTEGER NOT NULL CHECK (version BETWEEN 1 AND ${MAX_SAFE_INTEGER}),
    definition_version INTEGER NOT NULL DEFAULT 1 CHECK (definition_version = 1),
    schema_json TEXT NOT NULL CHECK (${jsonObjectCheck('schema_json', 262144)}),
    created_at TEXT NOT NULL CHECK (${utcCheck('created_at')}),
    PRIMARY KEY (category_id, version),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON UPDATE RESTRICT ON DELETE RESTRICT
  ) STRICT`),

  object('table', 'subcategories', `CREATE TABLE subcategories (
    id TEXT PRIMARY KEY NOT NULL CHECK (${uuidCheck('id')}),
    category_id TEXT NOT NULL CHECK (${uuidCheck('category_id')}),
    name TEXT NOT NULL CHECK (${textCheck('name', 100, true)}),
    name_key TEXT NOT NULL CHECK (${textCheck('name_key', 100, true)} AND name_key = trim(name_key)),
    description TEXT NOT NULL DEFAULT '' CHECK (${textCheck('description', 2000)}),
    ${LIFECYCLE_COLUMNS},
    UNIQUE (category_id, name_key),
    UNIQUE (category_id, id),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    ${LIFECYCLE_CHECKS}
  ) STRICT`),

  object('table', 'tags', `CREATE TABLE tags (
    id TEXT PRIMARY KEY NOT NULL CHECK (${uuidCheck('id')}),
    name TEXT NOT NULL CHECK (${textCheck('name', 100, true)}),
    name_key TEXT NOT NULL UNIQUE CHECK (${textCheck('name_key', 100, true)} AND name_key = trim(name_key)),
    ${LIFECYCLE_COLUMNS},
    ${LIFECYCLE_CHECKS}
  ) STRICT`),

  object('table', 'knowledge_items', `CREATE TABLE knowledge_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (${uuidCheck('id')}),
    title TEXT NOT NULL CHECK (${textCheck('title', 300, true)}),
    category_id TEXT NOT NULL CHECK (${uuidCheck('category_id')}),
    subcategory_id TEXT CHECK (subcategory_id IS NULL OR (${uuidCheck('subcategory_id')})),
    summary TEXT NOT NULL DEFAULT '' CHECK (${textCheck('summary', 2000)}),
    content TEXT NOT NULL DEFAULT '' CHECK (${textCheck('content', 1000000)}),
    source_url TEXT CHECK (source_url IS NULL OR source_url = '' OR (
      ${textCheck('source_url', 2048, true)}
      AND (lower(substr(source_url, 1, 7)) = 'http://' OR lower(substr(source_url, 1, 8)) = 'https://')
      AND length(source_url) > CASE WHEN lower(substr(source_url, 1, 8)) = 'https://' THEN 8 ELSE 7 END
      AND instr(source_url, ' ') = 0 AND instr(source_url, char(9)) = 0
      AND instr(source_url, char(10)) = 0 AND instr(source_url, char(13)) = 0
    )),
    source_platform TEXT CHECK (source_platform IS NULL OR (${textCheck('source_platform', 120)})),
    source_author TEXT CHECK (source_author IS NULL OR (${textCheck('source_author', 300)})),
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'studying', 'completed', 'archived')),
    personal_notes TEXT NOT NULL DEFAULT '' CHECK (${textCheck('personal_notes', 100000)}),
    metadata_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (metadata_schema_version BETWEEN 1 AND ${MAX_SAFE_INTEGER}),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (${jsonObjectCheck('metadata_json', 100000)}),
    ${LIFECYCLE_COLUMNS},
    FOREIGN KEY (category_id) REFERENCES categories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (category_id, subcategory_id) REFERENCES subcategories(category_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (category_id, metadata_schema_version) REFERENCES category_metadata_schemas(category_id, version) ON UPDATE RESTRICT ON DELETE RESTRICT,
    ${LIFECYCLE_CHECKS}
  ) STRICT`),

  object('table', 'item_tags', `CREATE TABLE item_tags (
    item_id TEXT NOT NULL CHECK (${uuidCheck('item_id')}),
    tag_id TEXT NOT NULL CHECK (${uuidCheck('tag_id')}),
    created_at TEXT NOT NULL CHECK (${utcCheck('created_at')}),
    PRIMARY KEY (item_id, tag_id),
    FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON UPDATE RESTRICT ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE RESTRICT ON DELETE CASCADE
  ) STRICT`),

  object('table', 'attachments', `CREATE TABLE attachments (
    id TEXT PRIMARY KEY NOT NULL CHECK (${uuidCheck('id')}),
    item_id TEXT NOT NULL CHECK (${uuidCheck('item_id')}),
    original_name TEXT NOT NULL CHECK (${textCheck('original_name', 255, true)}
      AND instr(original_name, '/') = 0 AND instr(original_name, char(92)) = 0
      AND original_name NOT IN ('.', '..')),
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream' CHECK (${textCheck('mime_type', 255, true)}
      AND instr(mime_type, '/') > 1 AND substr(mime_type, -1) <> '/' AND instr(mime_type, ' ') = 0),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    storage_key TEXT NOT NULL UNIQUE CHECK (${textCheck('storage_key', 1024, true)}
      AND storage_key = trim(storage_key) AND substr(storage_key, 1, 1) <> '/' AND substr(storage_key, -1, 1) <> '/'
      AND instr(storage_key, char(92)) = 0 AND instr(storage_key, ':') = 0
      AND instr('/' || storage_key || '/', '/../') = 0
      AND instr('/' || storage_key || '/', '/./') = 0
      AND instr(storage_key, '//') = 0),
    sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
    ${LIFECYCLE_COLUMNS},
    FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    ${LIFECYCLE_CHECKS}
  ) STRICT`),

  object('table', 'item_revisions', `CREATE TABLE item_revisions (
    id TEXT PRIMARY KEY NOT NULL CHECK (${uuidCheck('id')}),
    item_id TEXT NOT NULL CHECK (${uuidCheck('item_id')}),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND ${MAX_SAFE_INTEGER}),
    snapshot_json TEXT NOT NULL CHECK (${jsonObjectCheck('snapshot_json', 4000000)}),
    snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK (snapshot_version = 1),
    created_at TEXT NOT NULL CHECK (${utcCheck('created_at')}),
    UNIQUE (item_id, revision),
    FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON UPDATE RESTRICT ON DELETE RESTRICT
  ) STRICT`),

  object('table', 'change_log', `CREATE TABLE change_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK (sequence > 0),
    id TEXT NOT NULL UNIQUE CHECK (${uuidCheck('id')}),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('knowledge_item', 'category', 'subcategory', 'tag', 'attachment')),
    entity_id TEXT NOT NULL CHECK (${uuidCheck('entity_id')}),
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND ${MAX_SAFE_INTEGER}),
    base_revision INTEGER NOT NULL CHECK (base_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    device_id TEXT CHECK (device_id IS NULL OR (${uuidCheck('device_id')})),
    changed_at TEXT NOT NULL CHECK (${utcCheck('changed_at')}),
    payload_json TEXT NOT NULL CHECK (${jsonObjectCheck('payload_json', 4000000)}),
    payload_version INTEGER NOT NULL DEFAULT 1 CHECK (payload_version = 1),
    CHECK (base_revision < revision)
  ) STRICT`),

  // Definition rows are immutable; category-specific changes create a new version.
  // History/change-log records themselves will be written transactionally in Phase 4.
  object('trigger', 'trg_category_metadata_schemas_immutable', `CREATE TRIGGER trg_category_metadata_schemas_immutable
    BEFORE UPDATE ON category_metadata_schemas
    BEGIN
      SELECT RAISE(ABORT, 'Definicoes de metadados sao imutaveis; crie uma nova versao.');
    END`),

  object('index', 'idx_categories_active_name', 'CREATE INDEX idx_categories_active_name ON categories(deleted_at, name_key)'),
  object('index', 'idx_subcategories_active_name', 'CREATE INDEX idx_subcategories_active_name ON subcategories(category_id, deleted_at, name_key)'),
  object('index', 'idx_tags_active_name', 'CREATE INDEX idx_tags_active_name ON tags(deleted_at, name_key)'),
  object('index', 'idx_items_category_status', 'CREATE INDEX idx_items_category_status ON knowledge_items(category_id, deleted_at, status, updated_at DESC)'),
  object('index', 'idx_items_subcategory', 'CREATE INDEX idx_items_subcategory ON knowledge_items(category_id, subcategory_id)'),
  object('index', 'idx_items_metadata_schema', 'CREATE INDEX idx_items_metadata_schema ON knowledge_items(category_id, metadata_schema_version)'),
  object('index', 'idx_items_status', 'CREATE INDEX idx_items_status ON knowledge_items(status, deleted_at, updated_at DESC)'),
  object('index', 'idx_items_favorite', 'CREATE INDEX idx_items_favorite ON knowledge_items(favorite, deleted_at, updated_at DESC)'),
  object('index', 'idx_items_recent', 'CREATE INDEX idx_items_recent ON knowledge_items(deleted_at, created_at DESC)'),
  object('index', 'idx_items_updated', 'CREATE INDEX idx_items_updated ON knowledge_items(deleted_at, updated_at DESC)'),
  object('index', 'idx_item_tags_tag', 'CREATE INDEX idx_item_tags_tag ON item_tags(tag_id, item_id)'),
  object('index', 'idx_attachments_item', 'CREATE INDEX idx_attachments_item ON attachments(item_id, deleted_at, created_at DESC)'),
  object('index', 'idx_item_revisions_created', 'CREATE INDEX idx_item_revisions_created ON item_revisions(created_at DESC)'),
  object('index', 'idx_change_log_entity', 'CREATE INDEX idx_change_log_entity ON change_log(entity_type, entity_id, revision)'),
  object('index', 'idx_change_log_changed', 'CREATE INDEX idx_change_log_changed ON change_log(changed_at, sequence)'),
]);

export const KNOWLEDGE_SCHEMA_SQL = KNOWLEDGE_SCHEMA_OBJECTS.map((entry) => `${entry.sql};`).join('\n');
