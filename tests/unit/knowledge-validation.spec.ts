import { expect, test } from '@playwright/test';
import { CATEGORY_PRESETS } from '../../src/models/category-presets';
import type { CategoryMetadataSchema, CategoryRecord, KnowledgeItemRecord } from '../../src/models/knowledge';
import {
  booleanToSqlite,
  KnowledgeValidationError,
  normalizeName,
  sqliteBooleanToBoolean,
  validateCategory,
  validateCategoryMetadataSchema,
  validateCategoryMetadataSchemaRecord,
  validateKnowledgeItem,
  validateMetadata,
  validateSourceUrl,
  validateSubcategory,
  validateTag,
  validateUtcTimestamp,
  validateUuid,
} from '../../src/services/knowledge-validation';

const ITEM_ID = 'b36bf144-789c-4e02-a2f8-465b5b05257a';
const CATEGORY_ID = '6063fb76-029a-4efa-a7ca-cbc7e7e31c24';
const CREATED = '2026-11-09T12:30:00.000Z';
const UPDATED = '2026-11-10T15:40:05.123Z';
const EMPTY_SCHEMA: CategoryMetadataSchema = { formatVersion: 1, fields: [] };
const SCHEMA: CategoryMetadataSchema = {
  formatVersion: 1,
  fields: [
    { key: 'objective', label: 'Objetivo', type: 'text', required: true },
    { key: 'instructions', label: 'Instruções', type: 'multiline' },
    { key: 'quantity', label: 'Quantidade', type: 'number', required: true },
    { key: 'enabled', label: 'Habilitado', type: 'boolean', required: true },
    { key: 'variables', label: 'Variáveis', type: 'text_list' },
    { key: 'tool', label: 'Ferramenta', type: 'select', options: ['SQL', 'IA'] },
  ],
};

function item(): KnowledgeItemRecord {
  return {
    id: ITEM_ID,
    title: 'Ação e programação 🧠',
    category_id: CATEGORY_ID,
    subcategory_id: null,
    summary: '',
    content: "  <script>globalThis.executed = true</script>\nSELECT 'café';\n ",
    source_url: 'https://example.org/receita?q=caf%C3%A9#preparo',
    source_platform: null,
    source_author: '',
    created_at: CREATED,
    updated_at: UPDATED,
    deleted_at: null,
    favorite: false,
    status: 'unread',
    personal_notes: '',
    metadata_schema_version: 1,
    metadata_json: { objective: 'Estudar 🧠', quantity: 0, enabled: false, variables: [], tool: 'SQL' },
    revision: 1,
  };
}

function category(): CategoryRecord {
  return {
    id: CATEGORY_ID,
    ...normalizeName('  Prompts de IA  '),
    description: '',
    created_at: CREATED,
    updated_at: UPDATED,
    deleted_at: null,
    revision: 1,
  };
}

test('valida um DTO completo sem reescrever Unicode, whitespace, HTML ou SQL', () => {
  const input = item();
  const snapshot = structuredClone(input);
  const validated = validateKnowledgeItem(input, SCHEMA);
  expect(validated).toEqual(snapshot);
  expect(input).toEqual(snapshot);
  expect(validated).not.toBe(input);
  expect(validated.metadata_json).not.toBe(input.metadata_json);
  expect(validated.metadata_json.quantity).toBe(0);
  expect(validated.metadata_json.enabled).toBe(false);
});

test('conta pontos Unicode como SQLite e rejeita surrogates soltos e NUL', () => {
  expect(validateKnowledgeItem({ ...item(), title: '🧠'.repeat(300) }, SCHEMA).title).toHaveLength(600);
  expect(() => validateKnowledgeItem({ ...item(), title: '🧠'.repeat(301) }, SCHEMA)).toThrow(KnowledgeValidationError);
  for (const invalid of ['surrogate \ud800', 'surrogate \udfff', 'NUL\u0000']) {
    expect(() => validateKnowledgeItem({ ...item(), content: invalid }, SCHEMA)).toThrow(/Unicode|NUL/u);
    expect(() => normalizeName(invalid)).toThrow(KnowledgeValidationError);
    expect(() => validateMetadata({ objective: invalid, quantity: 1, enabled: true }, SCHEMA)).toThrow(KnowledgeValidationError);
  }
});

test('normaliza nomes por operação explícita com NFKC e locale português', () => {
  const original = '  ＰＲＯＭＰＴＳ\t de\u00a0IA  ';
  expect(normalizeName(original)).toEqual({ name: 'ＰＲＯＭＰＴＳ\t de\u00a0IA', name_key: 'prompts de ia' });
  expect(normalizeName('  AÇÃO  ').name_key).toBe('ação');
  expect(normalizeName('Ac\u0327a\u0303o').name_key).toBe('ação');
  expect(normalizeName('Exercícios\n  Físicos').name_key).toBe('exercícios físicos');
  expect(original).toBe('  ＰＲＯＭＰＴＳ\t de\u00a0IA  ');
});

test('valida categorias, subcategorias e tags sem corrigir name_key silenciosamente', () => {
  const input = category();
  expect(validateCategory(input)).toEqual(input);
  expect(() => validateCategory({ ...input, name_key: 'PROMPTS DE IA' })).toThrow(/normalize/u);
  expect(() => validateCategory({ ...input, name: ' Prompts de IA ' })).toThrow(/normalize/u);
  const subcategory = { ...input, id: ITEM_ID, category_id: CATEGORY_ID };
  expect(validateSubcategory(subcategory)).toEqual(subcategory);
  const { description: _description, ...tag } = input;
  expect(validateTag(tag)).toEqual(tag);
  expect(() => validateTag({ ...tag, description: 'extra' })).toThrow(/campos/u);
});

test('exige UUID canônico lowercase e datas UTC exatas com milissegundos', () => {
  expect(validateUuid(ITEM_ID)).toBe(ITEM_ID);
  for (const invalid of [ITEM_ID.toUpperCase(), 'not-a-uuid', ITEM_ID.replaceAll('-', ''), ` ${ITEM_ID}`]) {
    expect(() => validateUuid(invalid)).toThrow(KnowledgeValidationError);
  }
  expect(validateUtcTimestamp(UPDATED)).toBe(UPDATED);
  for (const invalid of [
    '2026-02-30T12:00:00.000Z', '2026-11-10', '2026-11-10T15:40:05Z',
    '2026-11-10T15:40:05.12Z', '2026-11-10T12:40:05.123-03:00',
    '2026-11-10T15:40:60.123Z', '2026-13-10T15:40:05.123Z',
  ]) expect(() => validateUtcTimestamp(invalid)).toThrow(KnowledgeValidationError);
});

test('mantém ordem temporal e revisões positivas sem coerção', () => {
  const validDeleted = '2026-11-10T14:00:00.000Z';
  expect(validateKnowledgeItem({ ...item(), deleted_at: validDeleted }, SCHEMA).deleted_at).toBe(validDeleted);
  expect(() => validateKnowledgeItem({ ...item(), updated_at: '2026-11-08T00:00:00.000Z' }, SCHEMA)).toThrow(/atualização/u);
  expect(() => validateKnowledgeItem({ ...item(), deleted_at: '2026-11-08T00:00:00.000Z' }, SCHEMA)).toThrow(/exclusão/u);
  expect(() => validateKnowledgeItem({ ...item(), deleted_at: '2026-11-11T00:00:00.000Z' }, SCHEMA)).toThrow(/exclusão/u);
  for (const invalid of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => validateKnowledgeItem({ ...item(), revision: invalid }, SCHEMA)).toThrow(KnowledgeValidationError);
    expect(() => validateKnowledgeItem({ ...item(), metadata_schema_version: invalid }, SCHEMA)).toThrow(KnowledgeValidationError);
  }
});

test('aceita opcionais explícitos e rejeita campos ausentes ou desconhecidos do DTO', () => {
  expect(validateKnowledgeItem({ ...item(), source_url: '', source_platform: '', source_author: null }, SCHEMA).source_url).toBe('');
  expect(validateKnowledgeItem({ ...item(), source_url: null }, SCHEMA).source_url).toBeNull();
  expect(() => validateKnowledgeItem({ ...item(), source_author: undefined }, SCHEMA)).toThrow(KnowledgeValidationError);
  expect(() => validateKnowledgeItem({ ...item(), unversioned_extra: true }, SCHEMA)).toThrow(/campos/u);
  expect(() => validateKnowledgeItem({ ...item(), category_id: null }, SCHEMA)).toThrow(KnowledgeValidationError);
  expect(() => validateKnowledgeItem({ ...item(), favorite: 1 }, SCHEMA)).toThrow(/booleano/u);
  expect(() => validateKnowledgeItem({ ...item(), status: 'done' }, SCHEMA)).toThrow(/status/u);
});

test('aplica os limites dos campos comuns sem truncar dados', () => {
  expect(validateKnowledgeItem({ ...item(), content: 'á'.repeat(1_000_000) }, SCHEMA).content.length).toBe(1_000_000);
  const oversized = [
    { title: 'a'.repeat(301) }, { summary: 'a'.repeat(2_001) },
    { content: 'a'.repeat(1_000_001) }, { personal_notes: 'a'.repeat(100_001) },
    { source_platform: 'a'.repeat(121) }, { source_author: 'a'.repeat(301) },
  ];
  for (const patch of oversized) expect(() => validateKnowledgeItem({ ...item(), ...patch }, SCHEMA)).toThrow(KnowledgeValidationError);
  expect(() => normalizeName('a'.repeat(101))).toThrow(KnowledgeValidationError);
  expect(() => normalizeName(' ')).toThrow(KnowledgeValidationError);
  expect(() => validateCategory({ ...category(), description: 'a'.repeat(2_001) })).toThrow(KnowledgeValidationError);
});

test('aceita apenas URLs HTTP/HTTPS completas, preservando a grafia válida', () => {
  const unicodeUrl = 'HTTPS://example.org/ação?emoji=🧠';
  expect(validateSourceUrl(unicodeUrl)).toBe(unicodeUrl);
  for (const invalid of [
    'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', '//example.org',
    'https:example.org', 'https://', ' https://example.org', 'https://exam\nple.org',
    'https://example.org/a b', 'https://example.org/' + 'a'.repeat(2_049),
  ]) expect(() => validateSourceUrl(invalid)).toThrow(KnowledgeValidationError);
});

test('o formato do schema é versionado e rejeita atributos ou tipos futuros', () => {
  expect(validateCategoryMetadataSchema(SCHEMA)).toEqual(SCHEMA);
  for (const invalid of [
    { ...SCHEMA, formatVersion: 2 }, { ...SCHEMA, extra: true },
    { formatVersion: 1, fields: [{ key: 'x', label: 'X', type: 'date' }] },
    { formatVersion: 1, fields: [{ key: 'x', label: 'X', type: 'text', min: 1 }] },
    { formatVersion: 1, fields: [{ key: 'x', label: 'X', type: 'text', required: 'true' }] },
    { formatVersion: 1, fields: [{ key: 'x', label: 'X', type: 'text', options: ['a'] }] },
  ]) expect(() => validateCategoryMetadataSchema(invalid)).toThrow(KnowledgeValidationError);
});

test('o schema rejeita campos duplicados e chaves que permitem prototype pollution', () => {
  const field = { key: 'objective', label: 'Objetivo', type: 'text' };
  expect(() => validateCategoryMetadataSchema({ formatVersion: 1, fields: [field, { ...field }] })).toThrow(/únicas/u);
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    expect(() => validateCategoryMetadataSchema({ formatVersion: 1, fields: [{ ...field, key }] })).toThrow(KnowledgeValidationError);
    const polluted = JSON.parse(`{"${key}": {"polluted": true}}`) as unknown;
    expect(() => validateMetadata(polluted, EMPTY_SCHEMA)).toThrow(KnowledgeValidationError);
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test('select exige opções únicas e metadados devem usar uma opção exata', () => {
  for (const options of [[], ['SQL', 'SQL'], [''], [1]]) {
    expect(() => validateCategoryMetadataSchema({ formatVersion: 1, fields: [{ key: 'tool', label: 'Ferramenta', type: 'select', options }] })).toThrow(KnowledgeValidationError);
  }
  expect(() => validateMetadata({ objective: 'Teste', quantity: 1, enabled: true, tool: 'sql' }, SCHEMA)).toThrow(/opções/u);
  expect(() => validateMetadata({ objective: 'Teste', quantity: 1, enabled: true, tool: ' SQL ' }, SCHEMA)).toThrow(/opções/u);
});

test('metadados aceitam apenas campos definidos e exigem os campos obrigatórios', () => {
  expect(() => validateMetadata({}, SCHEMA)).toThrow(/obrigatório/u);
  expect(() => validateMetadata({ objective: ' ', quantity: 1, enabled: true }, SCHEMA)).toThrow(/vazio/u);
  expect(() => validateMetadata({ objective: 'a', quantity: 1, enabled: true, unknown: 'b' }, SCHEMA)).toThrow(/não definido/u);
  expect(() => validateMetadata({ objective: 'a', quantity: null, enabled: true }, SCHEMA)).toThrow(/número/u);
  expect(() => validateMetadata({ objective: 'a', quantity: '1', enabled: true }, SCHEMA)).toThrow(/número/u);
  expect(() => validateMetadata({ objective: 'a', quantity: 1, enabled: 1 }, SCHEMA)).toThrow(/booleano/u);
});

test('listas preservam strings válidas e verificam itens, tamanho e obrigatoriedade', () => {
  const requiredList: CategoryMetadataSchema = { formatVersion: 1, fields: [{ key: 'ingredients', label: 'Ingredientes', type: 'text_list', required: true }] };
  const value = { ingredients: ['café 🧠', 'água'] };
  expect(validateMetadata(value, requiredList)).toEqual(value);
  for (const ingredients of [[], [''], [1], 'a', Array(1_001).fill('a'), ['a'.repeat(10_001)]]) {
    expect(() => validateMetadata({ ingredients }, requiredList)).toThrow(KnowledgeValidationError);
  }
  const optionalList: CategoryMetadataSchema = { formatVersion: 1, fields: [{ key: 'ingredients', label: 'Ingredientes', type: 'text_list' }] };
  expect(validateMetadata({ ingredients: [] }, optionalList)).toEqual({ ingredients: [] });
});

test('JSON rejeita números não finitos, circularidade e valores sem representação fiel', () => {
  for (const invalid of [NaN, Infinity, -Infinity, undefined, BigInt(1), Symbol('a'), () => 1, new Date()]) {
    expect(() => validateMetadata({ objective: 'a', quantity: invalid, enabled: true }, SCHEMA)).toThrow(KnowledgeValidationError);
  }
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(() => validateMetadata(circular, EMPTY_SCHEMA)).toThrow(/circulares/u);
  expect(() => validateMetadata([], EMPTY_SCHEMA)).toThrow(/objeto/u);
});

test('JSON não invoca getters nem descarta propriedades ocultas, símbolos ou listas esparsas', () => {
  let invoked = false;
  const getter = Object.defineProperty({}, 'quantity', { enumerable: true, get: () => { invoked = true; return 1; } });
  expect(() => validateMetadata(getter, SCHEMA)).toThrow(KnowledgeValidationError);
  expect(invoked).toBe(false);
  const hidden = Object.defineProperty({}, 'hidden', { value: true, enumerable: false });
  expect(() => validateMetadata(hidden, EMPTY_SCHEMA)).toThrow(KnowledgeValidationError);
  expect(() => validateMetadata({ [Symbol('hidden')]: true }, EMPTY_SCHEMA)).toThrow(KnowledgeValidationError);
  const sparse = Array(2);
  sparse[1] = 'a';
  expect(() => validateMetadata({ objective: 'a', quantity: 1, enabled: true, variables: sparse }, SCHEMA)).toThrow(/lacunas/u);
  const extra = Object.assign(['a'], { hidden: true });
  expect(() => validateMetadata({ objective: 'a', quantity: 1, enabled: true, variables: extra }, SCHEMA)).toThrow(/propriedades extras/u);
});

test('limita campos do schema, tamanho serializado e tamanho de cada texto', () => {
  const fields = Array.from({ length: 64 }, (_, index) => ({ key: `field_${index}`, label: 'Campo', type: 'text' as const }));
  expect(validateCategoryMetadataSchema({ formatVersion: 1, fields }).fields).toHaveLength(64);
  expect(() => validateCategoryMetadataSchema({ formatVersion: 1, fields: [...fields, { key: 'extra', label: 'Extra', type: 'text' }] })).toThrow(/64/u);
  const wideSchema = { formatVersion: 1, fields: [{ key: 'choice', label: 'Opção', type: 'select', options: Array.from({ length: 30 }, (_, index) => `${index}-${'a'.repeat(9_990)}`) }] };
  expect(() => validateCategoryMetadataSchema(wideSchema)).toThrow(/256 KiB/u);
  expect(() => validateMetadata({ objective: 'a'.repeat(10_001), quantity: 1, enabled: true }, SCHEMA)).toThrow(/10000/u);
  const value = Object.fromEntries(fields.slice(0, 10).map((field) => [field.key, 'a'.repeat(10_000)]));
  expect(() => validateMetadata(value, { formatVersion: 1, fields })).toThrow(/100.000/u);
});

test('versão do esquema referencia categoria sem substituir a integridade relacional do DB', () => {
  const input = { category_id: CATEGORY_ID, version: 2, definition_version: 1, schema_json: SCHEMA, created_at: CREATED };
  expect(validateCategoryMetadataSchemaRecord(input)).toEqual(input);
  expect(() => validateCategoryMetadataSchemaRecord({ ...input, version: 0 })).toThrow(KnowledgeValidationError);
  expect(() => validateCategoryMetadataSchemaRecord({ ...input, definition_version: 2 })).toThrow(KnowledgeValidationError);
  // The DTO validator checks shape; existence of category/version belongs to DB FKs.
  expect(validateKnowledgeItem({ ...item(), metadata_schema_version: 2 }, SCHEMA).metadata_schema_version).toBe(2);
});

test('favorite tem conversão explícita entre boolean e INTEGER, sem truthiness', () => {
  expect(booleanToSqlite(false)).toBe(0);
  expect(booleanToSqlite(true)).toBe(1);
  expect(sqliteBooleanToBoolean(0)).toBe(false);
  expect(sqliteBooleanToBoolean(1)).toBe(true);
  for (const invalid of [null, '1', 2, -1, true]) expect(() => sqliteBooleanToBoolean(invalid)).toThrow(KnowledgeValidationError);
  for (const invalid of [null, 'false', 0, 1]) expect(() => booleanToSqlite(invalid)).toThrow(KnowledgeValidationError);
});

test('presets propõem quatro categorias sem ids ou inserções automáticas', () => {
  expect(CATEGORY_PRESETS.map((preset) => preset.name)).toEqual(['Prompts de IA', 'Receitas', 'Exercícios', 'Ethical Hacking']);
  for (const preset of CATEGORY_PRESETS) {
    expect(validateCategoryMetadataSchema(preset.schema)).toEqual(preset.schema);
    expect(validateMetadata({}, preset.schema)).toEqual({});
    expect(preset.contentLabel.length).toBeGreaterThan(0);
    expect(Object.hasOwn(preset, 'id')).toBe(false);
  }
});

test('erros incluem caminho e código, sem copiar conteúdo pessoal para a mensagem', () => {
  const secret = 'CONTEUDO_PESSOAL_QUE_NAO_DEVE_IR_AO_LOG';
  try {
    validateKnowledgeItem({ ...item(), title: secret.repeat(20) }, SCHEMA);
    throw new Error('A validação deveria rejeitar o título.');
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeValidationError);
    const validation = error as KnowledgeValidationError;
    expect(validation.code).toBe('VALIDATION_ERROR');
    expect(validation.path).toBe('item.title');
    expect(validation.message).not.toContain(secret);
  }
});
