import {
  KNOWLEDGE_STATUSES,
  type CategoryMetadataSchema,
  type CategoryMetadataSchemaRecord,
  type CategoryRecord,
  type JsonObject,
  type JsonValue,
  type KnowledgeItemRecord,
  type KnowledgeStatus,
  type MetadataField,
  type NamedRecord,
  type NormalizedName,
  type RevisionedRecord,
  type SubcategoryRecord,
  type TagRecord,
} from '../models/knowledge';

/** Text limits count Unicode code points, matching SQLite length(TEXT). */
export const KNOWLEDGE_LIMITS = {
  name: 100,
  title: 300,
  description: 2_000,
  summary: 2_000,
  content: 1_000_000,
  personalNotes: 100_000,
  sourceUrl: 2_048,
  sourcePlatform: 120,
  sourceAuthor: 300,
  metadataJson: 100_000,
  schemaJsonBytes: 256 * 1_024,
  metadataFields: 64,
  metadataKey: 64,
  metadataText: 10_000,
  metadataListItems: 1_000,
} as const;

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REVISION_KEYS = ['id', 'created_at', 'updated_at', 'deleted_at', 'revision'];
const NAME_KEYS = [...REVISION_KEYS, 'name', 'name_key'];
const ITEM_KEYS = [
  ...REVISION_KEYS,
  'title', 'category_id', 'subcategory_id', 'summary', 'content', 'source_url',
  'source_platform', 'source_author', 'favorite', 'status', 'personal_notes',
  'metadata_schema_version', 'metadata_json',
];

export class KnowledgeValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'KnowledgeValidationError';
  }
}

function fail(path: string, message: string): never {
  throw new KnowledgeValidationError(path, message);
}

function unicodeLength(value: string, path: string, maximum?: number, limitMessage?: string): number {
  let length = 0;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 0 || (character.length === 1 && code >= 0xd800 && code <= 0xdfff)) {
      fail(path, 'o texto contém NUL ou uma sequência Unicode inválida.');
    }
    length += 1;
    if (maximum !== undefined && length > maximum) {
      fail(path, limitMessage ?? `o limite é ${maximum} caracteres Unicode.`);
    }
  }
  return length;
}

function text(value: unknown, path: string, limit: number, nonblank = false): string {
  if (typeof value !== 'string') fail(path, 'informe um texto.');
  unicodeLength(value, path, limit);
  if (nonblank && value.trim().length === 0) fail(path, 'o texto não pode ficar vazio.');
  return value;
}

function safeKey(key: string, path: string): void {
  unicodeLength(key, path);
  if (UNSAFE_KEYS.has(key)) fail(path, 'esta chave não é permitida.');
}

/** Reject accessors, symbols and non-JSON objects instead of invoking/coercing them. */
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'informe um objeto.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, 'o objeto deve conter apenas dados.');
  if (Object.getOwnPropertySymbols(value).length > 0) fail(path, 'chaves Symbol não são permitidas.');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    safeKey(key, path);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(path, 'propriedades ocultas ou de acesso não são permitidas.');
    }
  }
  return value as Record<string, unknown>;
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(path, 'há campos não definidos no formato.');
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(path, 'informe um inteiro positivo representável sem perda.');
  }
  return value;
}

export function validateUuid(value: unknown, path = 'id'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    fail(path, 'informe um UUID canônico em letras minúsculas.');
  }
  return value;
}

export function validateUtcTimestamp(value: unknown, path = 'timestamp'): string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value)) {
    fail(path, 'use uma data UTC no formato YYYY-MM-DDTHH:mm:ss.sssZ.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(path, 'a data UTC não é válida.');
  }
  return value;
}

/** Explicit normalization only. Record validation itself never rewrites names. */
export function normalizeName(value: unknown): NormalizedName {
  if (typeof value !== 'string') fail('name', 'informe um texto.');
  unicodeLength(value, 'name');
  const name = text(value.trim(), 'name', KNOWLEDGE_LIMITS.name, true);
  const name_key = name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
  text(name_key, 'name_key', KNOWLEDGE_LIMITS.name, true);
  return { name, name_key };
}

export function validateSourceUrl(value: unknown, path = 'source_url'): string | null {
  if (value === null || value === '') return value;
  const candidate = text(value, path, KNOWLEDGE_LIMITS.sourceUrl, true);
  if (!/^https?:\/\//iu.test(candidate) || /[\s\u0000-\u001f\u007f]/u.test(candidate)) {
    fail(path, 'use uma URL completa HTTP ou HTTPS, sem espaços ou controles.');
  }
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.length === 0) {
      fail(path, 'use uma URL completa HTTP ou HTTPS.');
    }
  } catch {
    fail(path, 'a URL HTTP ou HTTPS não é válida.');
  }
  return candidate;
}

function optionalText(value: unknown, path: string, limit: number): string | null {
  return value === null ? null : text(value, path, limit);
}

function revisioned(value: Record<string, unknown>, path: string): RevisionedRecord {
  const id = validateUuid(value.id, `${path}.id`);
  const created_at = validateUtcTimestamp(value.created_at, `${path}.created_at`);
  const updated_at = validateUtcTimestamp(value.updated_at, `${path}.updated_at`);
  const deleted_at = value.deleted_at === null ? null : validateUtcTimestamp(value.deleted_at, `${path}.deleted_at`);
  if (updated_at < created_at) fail(`${path}.updated_at`, 'a atualização não pode anteceder a criação.');
  if (deleted_at !== null && (deleted_at < created_at || deleted_at > updated_at)) {
    fail(`${path}.deleted_at`, 'a exclusão deve estar entre a criação e a atualização.');
  }
  return { id, created_at, updated_at, deleted_at, revision: positiveInteger(value.revision, `${path}.revision`) };
}

function named(value: Record<string, unknown>, path: string): NamedRecord {
  const name = text(value.name, `${path}.name`, KNOWLEDGE_LIMITS.name, true);
  const name_key = text(value.name_key, `${path}.name_key`, KNOWLEDGE_LIMITS.name, true);
  const normalized = normalizeName(name);
  if (name !== normalized.name || name_key !== normalized.name_key) {
    fail(path, 'normalize o nome explicitamente antes de validar o registro.');
  }
  return { ...revisioned(value, path), name, name_key };
}

export function validateCategory(input: unknown): CategoryRecord {
  const value = object(input, 'category');
  allowedKeys(value, [...NAME_KEYS, 'description'], 'category');
  return {
    ...named(value, 'category'),
    description: text(value.description, 'category.description', KNOWLEDGE_LIMITS.description),
  };
}

export function validateSubcategory(input: unknown): SubcategoryRecord {
  const value = object(input, 'subcategory');
  allowedKeys(value, [...NAME_KEYS, 'category_id', 'description'], 'subcategory');
  return {
    ...named(value, 'subcategory'),
    category_id: validateUuid(value.category_id, 'subcategory.category_id'),
    description: text(value.description, 'subcategory.description', KNOWLEDGE_LIMITS.description),
  };
}

export function validateTag(input: unknown): TagRecord {
  const value = object(input, 'tag');
  allowedKeys(value, NAME_KEYS, 'tag');
  return named(value, 'tag');
}

interface JsonBudget {
  used: number;
  limit: number;
  message: string;
}

function consumeJsonBudget(budget: JsonBudget, amount: number, path: string): void {
  budget.used += amount;
  if (budget.used > budget.limit) fail(path, budget.message);
}

function jsonValue(value: unknown, path: string, ancestors: Set<object>, depth: number, budget: JsonBudget): JsonValue {
  if (depth > 32) fail(path, 'o JSON excede a profundidade permitida.');
  // Lower bound on serialized size: bound traversal before allocating a full
  // clone. The exact serialized character/byte limit is checked afterwards.
  consumeJsonBudget(budget, 1, path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    consumeJsonBudget(budget, unicodeLength(value, path, budget.limit - budget.used, budget.message), path);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'o JSON exige números finitos.');
    return value;
  }
  if (typeof value !== 'object') fail(path, 'o valor não pertence ao formato JSON.');
  if (ancestors.has(value)) fail(path, 'referências circulares não são permitidas.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
        fail(path, 'a lista deve conter apenas dados JSON.');
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.keys(descriptors).length !== value.length + 1) fail(path, 'a lista não pode ter lacunas ou propriedades extras.');
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          fail(path, 'a lista não pode ter lacunas ou propriedades de acesso.');
        }
        result.push(jsonValue(descriptor.value, `${path}[${index}]`, ancestors, depth + 1, budget));
      }
      return result;
    }
    const source = object(value, path);
    const result: JsonObject = {};
    for (const key of Object.keys(source)) {
      consumeJsonBudget(budget, unicodeLength(key, path, budget.limit - budget.used, budget.message) + 3, path);
      result[key] = jsonValue(source[key], path, ancestors, depth + 1, budget);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function jsonObject(input: unknown, path: string, limit: number, message: string): JsonObject {
  object(input, path);
  return jsonValue(input, path, new Set(), 0, { used: 0, limit, message }) as JsonObject;
}

function stringList(input: unknown, path: string, nonempty: boolean): string[] {
  if (!Array.isArray(input) || input.length > KNOWLEDGE_LIMITS.metadataListItems || (nonempty && input.length === 0)) {
    fail(path, 'informe uma lista com a quantidade permitida de textos.');
  }
  return input.map((entry, index) => text(entry, `${path}[${index}]`, KNOWLEDGE_LIMITS.metadataText, true));
}

export function validateCategoryMetadataSchema(input: unknown): CategoryMetadataSchema {
  const value = jsonObject(input, 'schema', KNOWLEDGE_LIMITS.schemaJsonBytes, 'a definição serializada excede 256 KiB.');
  allowedKeys(value, ['formatVersion', 'fields'], 'schema');
  if (value.formatVersion !== 1) fail('schema.formatVersion', 'esta versão do formato não é suportada.');
  if (!Array.isArray(value.fields) || value.fields.length > KNOWLEDGE_LIMITS.metadataFields) {
    fail('schema.fields', 'informe uma lista de até 64 campos.');
  }
  const seen = new Set<string>();
  const fields = value.fields.map((entry, index): MetadataField => {
    const path = `schema.fields[${index}]`;
    const field = object(entry, path);
    allowedKeys(field, ['key', 'label', 'type', 'required', 'options'], path);
    const key = text(field.key, `${path}.key`, KNOWLEDGE_LIMITS.metadataKey, true);
    safeKey(key, `${path}.key`);
    if (key.trim() !== key) fail(`${path}.key`, 'a chave não pode ter espaços nas extremidades.');
    if (seen.has(key)) fail(`${path}.key`, 'as chaves dos campos devem ser únicas.');
    seen.add(key);
    const label = text(field.label, `${path}.label`, KNOWLEDGE_LIMITS.name, true);
    if (Object.hasOwn(field, 'required') && typeof field.required !== 'boolean') {
      fail(`${path}.required`, 'informe um booleano.');
    }
    const base = { key, label, ...(Object.hasOwn(field, 'required') ? { required: field.required as boolean } : {}) };
    if (field.type === 'select') {
      const options = stringList(field.options, `${path}.options`, true);
      if (new Set(options).size !== options.length) fail(`${path}.options`, 'as opções devem ser únicas.');
      return { ...base, type: 'select', options };
    }
    if (Object.hasOwn(field, 'options')) fail(`${path}.options`, 'opções pertencem apenas ao tipo select.');
    if (!['text', 'multiline', 'number', 'boolean', 'text_list'].includes(field.type as string)) {
      fail(`${path}.type`, 'o tipo de campo não é suportado.');
    }
    return { ...base, type: field.type as Exclude<MetadataField['type'], 'select'> };
  });
  const result: CategoryMetadataSchema = { formatVersion: 1, fields };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > KNOWLEDGE_LIMITS.schemaJsonBytes) {
    fail('schema', 'a definição serializada excede 256 KiB.');
  }
  return result;
}

export function validateMetadata(input: unknown, schemaInput: CategoryMetadataSchema): JsonObject {
  const schema = validateCategoryMetadataSchema(schemaInput);
  const value = jsonObject(input, 'metadata_json', KNOWLEDGE_LIMITS.metadataJson, 'o JSON serializado excede 100.000 caracteres Unicode.');
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) fail('metadata_json', 'há um campo não definido no esquema da categoria.');
  }
  for (const field of schema.fields) {
    const path = `metadata_json.${field.key}`;
    if (!Object.hasOwn(value, field.key)) {
      if (field.required) fail(path, 'este campo é obrigatório.');
      continue;
    }
    const entry = value[field.key];
    switch (field.type) {
      case 'text':
      case 'multiline':
        text(entry, path, KNOWLEDGE_LIMITS.metadataText, field.required);
        break;
      case 'number':
        if (typeof entry !== 'number' || !Number.isFinite(entry)) fail(path, 'informe um número finito.');
        break;
      case 'boolean':
        if (typeof entry !== 'boolean') fail(path, 'informe um booleano.');
        break;
      case 'text_list':
        stringList(entry, path, field.required ?? false);
        break;
      case 'select':
        if (typeof entry !== 'string' || !field.options.includes(entry)) fail(path, 'selecione uma das opções definidas.');
        break;
    }
  }
  if (unicodeLength(JSON.stringify(value), 'metadata_json') > KNOWLEDGE_LIMITS.metadataJson) {
    fail('metadata_json', 'o JSON serializado excede 100.000 caracteres Unicode.');
  }
  return value;
}

export function validateCategoryMetadataSchemaRecord(input: unknown): CategoryMetadataSchemaRecord {
  const value = object(input, 'category_schema');
  allowedKeys(value, ['category_id', 'version', 'definition_version', 'schema_json', 'created_at'], 'category_schema');
  if (value.definition_version !== 1) fail('category_schema.definition_version', 'esta versão do formato não é suportada.');
  return {
    category_id: validateUuid(value.category_id, 'category_schema.category_id'),
    version: positiveInteger(value.version, 'category_schema.version'),
    definition_version: 1,
    schema_json: validateCategoryMetadataSchema(value.schema_json),
    created_at: validateUtcTimestamp(value.created_at, 'category_schema.created_at'),
  };
}

/** Validates a complete DTO; relational existence/version checks remain database FKs. */
export function validateKnowledgeItem(input: unknown, schema: CategoryMetadataSchema): KnowledgeItemRecord {
  const value = object(input, 'item');
  allowedKeys(value, ITEM_KEYS, 'item');
  if (typeof value.favorite !== 'boolean') fail('item.favorite', 'informe um booleano.');
  if (!KNOWLEDGE_STATUSES.includes(value.status as KnowledgeStatus)) fail('item.status', 'o status não é permitido.');
  return {
    ...revisioned(value, 'item'),
    title: text(value.title, 'item.title', KNOWLEDGE_LIMITS.title, true),
    category_id: validateUuid(value.category_id, 'item.category_id'),
    subcategory_id: value.subcategory_id === null ? null : validateUuid(value.subcategory_id, 'item.subcategory_id'),
    summary: text(value.summary, 'item.summary', KNOWLEDGE_LIMITS.summary),
    content: text(value.content, 'item.content', KNOWLEDGE_LIMITS.content),
    source_url: validateSourceUrl(value.source_url, 'item.source_url'),
    source_platform: optionalText(value.source_platform, 'item.source_platform', KNOWLEDGE_LIMITS.sourcePlatform),
    source_author: optionalText(value.source_author, 'item.source_author', KNOWLEDGE_LIMITS.sourceAuthor),
    favorite: value.favorite,
    status: value.status as KnowledgeStatus,
    personal_notes: text(value.personal_notes, 'item.personal_notes', KNOWLEDGE_LIMITS.personalNotes),
    metadata_schema_version: positiveInteger(value.metadata_schema_version, 'item.metadata_schema_version'),
    metadata_json: validateMetadata(value.metadata_json, schema),
  };
}

export function sqliteBooleanToBoolean(value: unknown, path = 'favorite'): boolean {
  if (value !== 0 && value !== 1) fail(path, 'o valor SQLite deve ser 0 ou 1.');
  return value === 1;
}

export function booleanToSqlite(value: unknown, path = 'favorite'): 0 | 1 {
  if (typeof value !== 'boolean') fail(path, 'informe um booleano.');
  return value ? 1 : 0;
}
