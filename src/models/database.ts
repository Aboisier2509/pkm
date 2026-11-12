export interface ProbeRecord {
  id: string;
  content: string;
  created_at: string;
}

export interface DatabaseInfo {
  sqliteVersion: string;
  vfs: string;
  dbName: string;
  fts5: boolean;
  schemaVersion: number;
  migrationCount: number;
  libraryTableCount: number;
  foreignKeysEnabled: boolean;
}

export type DatabaseOperation = 'open' | 'list' | 'insert' | 'close' | 'integrity' | 'rollback'
  | 'libraryCatalog' | 'libraryList' | 'libraryGet' | 'librarySave' | 'categoryCreate' | 'subcategoryCreate'
  | 'backupExportJson' | 'backupExportSqlite' | 'backupInspect' | 'backupRestore';

export interface DatabaseRequest {
  id: number;
  operation: DatabaseOperation;
  content?: string;
  payload?: unknown;
}

export interface SerializedDatabaseError {
  code: string;
  message: string;
}

export type DatabaseResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: SerializedDatabaseError };

export class DatabaseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}
