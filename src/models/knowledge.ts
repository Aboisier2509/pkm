/** Canonical lowercase UUID strings are checked at the service boundary. */
export type UUID = string;
/** UTC ISO-8601 with milliseconds: YYYY-MM-DDTHH:mm:ss.sssZ. */
export type UtcTimestamp = string;

export const KNOWLEDGE_STATUSES = [
  'unread',
  'reading',
  'studying',
  'completed',
  'archived',
] as const;

export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type MetadataFieldType =
  | 'text'
  | 'multiline'
  | 'number'
  | 'boolean'
  | 'text_list'
  | 'select';

interface MetadataFieldBase {
  readonly key: string;
  readonly label: string;
  readonly required?: boolean;
}

export type MetadataField = MetadataFieldBase &
  (
    | { readonly type: Exclude<MetadataFieldType, 'select'>; readonly options?: never }
    | { readonly type: 'select'; readonly options: readonly string[] }
  );

/** Version of this definition format, separate from a category's schema revision. */
export interface CategoryMetadataSchema {
  readonly formatVersion: 1;
  readonly fields: readonly MetadataField[];
}

/** Existing schema revisions are immutable; category/version is the database FK. */
export interface CategoryMetadataSchemaRecord {
  category_id: UUID;
  version: number;
  definition_version: 1;
  schema_json: CategoryMetadataSchema;
  created_at: UtcTimestamp;
}

export interface RevisionedRecord {
  id: UUID;
  created_at: UtcTimestamp;
  updated_at: UtcTimestamp;
  deleted_at: UtcTimestamp | null;
  revision: number;
}

export interface NamedRecord extends RevisionedRecord {
  name: string;
  /** NFKC, trim, collapse whitespace, then lowercase with the pt-BR locale. */
  name_key: string;
}

export interface CategoryRecord extends NamedRecord {
  description: string;
}

export interface SubcategoryRecord extends NamedRecord {
  category_id: UUID;
  description: string;
}

export interface TagRecord extends NamedRecord {}

/**
 * Application DTO. The repository serializes metadata_json and maps favorite
 * explicitly to/from SQLite INTEGER 0/1. Optional values use null or an empty
 * string where documented, never implicit undefined in a persisted DTO.
 */
export interface KnowledgeItemRecord extends RevisionedRecord {
  title: string;
  category_id: UUID;
  subcategory_id: UUID | null;
  summary: string;
  content: string;
  source_url: string | null;
  source_platform: string | null;
  source_author: string | null;
  favorite: boolean;
  status: KnowledgeStatus;
  personal_notes: string;
  metadata_schema_version: number;
  metadata_json: JsonObject;
}

export interface ItemTagRecord {
  item_id: UUID;
  tag_id: UUID;
  created_at: UtcTimestamp;
}

export interface NormalizedName {
  /** Original spelling with only the outer whitespace removed. */
  name: string;
  name_key: string;
}

export interface CategoryPreset {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** Label for knowledge_items.content, which is not duplicated in metadata. */
  readonly contentLabel: string;
  readonly schema: CategoryMetadataSchema;
}

