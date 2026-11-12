/** JSON backups contain database records; attachment file bytes are not stored by this app yet. */
export const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
export const BACKUP_TABLES = [
  'categories', 'category_metadata_schemas', 'subcategories', 'tags',
  'knowledge_items', 'item_tags', 'attachments', 'item_revisions',
  'change_log', 'persistence_probe',
] as const;
export type BackupTableName = (typeof BACKUP_TABLES)[number];
export type BackupCounts = Record<BackupTableName, number>;
export interface BackupConflict {
  table: BackupTableName;
  reason: 'primary-key' | 'unique-key';
  count: number;
}
export interface BackupPreview {
  exportedAt: string;
  schemaVersion: number;
  appVersion: string;
  counts: BackupCounts;
  currentCounts: BackupCounts;
  conflicts: BackupConflict[];
  identicalRows: number;
  newRows: number;
  expectedState: string;
  attachmentFilesIncluded: false;
}
export interface BackupRestoreInput {
  text: string;
  mode: 'merge' | 'replace';
  expectedState: string;
}
export interface BackupRestoreResult {
  mode: 'merge' | 'replace';
  addedRows: number;
  skippedRows: number;
  counts: BackupCounts;
}
