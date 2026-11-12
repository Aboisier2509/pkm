import type {
  CategoryMetadataSchemaRecord,
  CategoryRecord,
  JsonObject,
  KnowledgeItemRecord,
  KnowledgeStatus,
  SubcategoryRecord,
  TagRecord,
} from './knowledge';

export interface CategoryOption {
  category: CategoryRecord;
  /** Latest definition for new items; edits receive their original in detail. */
  schema: CategoryMetadataSchemaRecord;
}

export interface LibraryCatalog {
  categories: CategoryOption[];
  subcategories: SubcategoryRecord[];
  tags: TagRecord[];
}

export interface LibraryItemDetail {
  item: KnowledgeItemRecord;
  tags: TagRecord[];
  schema: CategoryMetadataSchemaRecord;
}

export interface LibraryItemSummary {
  id: string;
  title: string;
  summary: string;
  contentPreview: string;
  categoryName: string;
  subcategoryName: string | null;
  status: KnowledgeStatus;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  revision: number;
  tags: string[];
}

export interface SaveKnowledgeInput {
  /** Omitted for creation. Update requires id and expectedRevision together. */
  id?: string;
  expectedRevision?: number;
  title: string;
  category_id: string;
  subcategory_id: string | null;
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
  /** Each array entry is a complete name, including commas if desired. */
  tag_names: string[];
}

export type LibrarySaveInput = SaveKnowledgeInput;

export interface CreateCategoryInput {
  name: string;
  description: string;
  presetKey: string | null;
}

export interface CreateSubcategoryInput {
  category_id: string;
  name: string;
  description: string;
}

export const LIBRARY_LIMITS = Object.freeze({ tagNames: 30, contentPreview: 180 });
