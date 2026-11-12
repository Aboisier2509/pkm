export interface ManagedSchemaObject {
  readonly type: 'table' | 'index' | 'trigger';
  readonly name: string;
  readonly sql: string;
}

export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface MigrationReport {
  schemaVersion: number;
  /** DDL migrations executed now; adopting an existing v1 is not execution. */
  applied: number[];
  /** Application-managed tables, including the probe and migration ledger. */
  tableNames: string[];
  migrationCount: number;
}
