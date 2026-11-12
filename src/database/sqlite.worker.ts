import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import {
  DatabaseError,
  type DatabaseInfo,
  type DatabaseRequest,
  type DatabaseResponse,
  type SerializedDatabaseError,
} from '../models/database';
import { migrateDatabase } from './migrations';
import { ProbeRepository } from './repositories/probe-repository';
import { LibraryRepository } from './repositories/library-repository';
import { BackupRepository } from './repositories/backup-repository';
import type { BackupRestoreInput } from '../models/backup';
import { KnowledgeValidationError } from '../services/knowledge-validation';

// These names identify the durable database. Changing them hides existing data.
const DATABASE_NAME = '/pkm-poc.sqlite3';
const POOL_DIRECTORY = '/pkm-poc-sahpool';
const OWNER_LOCK = 'pkm-poc-sahpool-owner';

let sqlite: Sqlite3Static | undefined;
let pool: SAHPoolUtil | undefined;
let db: Database | undefined;
let repository: ProbeRepository | undefined;
let library: LibraryRepository | undefined;
let backup: BackupRepository | undefined;
let releaseOwnership: (() => void) | undefined;
let info: DatabaseInfo | undefined;
let operationQueue: Promise<void> = Promise.resolve();

function safeError(error: unknown): SerializedDatabaseError {
  if (error instanceof DatabaseError) return { code: error.code, message: error.message };
  if (error instanceof KnowledgeValidationError) return { code: 'INVALID_INPUT', message: error.message };
  const native = error as { name?: string; resultCode?: number; message?: string } | null;
  const code = typeof native?.resultCode === 'number' ? native.resultCode & 0xff : undefined;
  if (native?.name === 'QuotaExceededError' || code === 13) {
    return { code: 'QUOTA', message: 'Não há espaço disponível para confirmar a operação. Libere espaço e confira os registros antes de tentar novamente.' };
  }
  if (native?.name === 'NoModificationAllowedError' || code === 5 || code === 6 || /access handle|locked|lock is held/i.test(native?.message ?? '')) {
    return { code: 'BUSY', message: 'O banco está em uso em outra aba ou janela. Feche o outro acesso e tente abrir novamente.' };
  }
  if (native?.name === 'NotAllowedError' || native?.name === 'SecurityError' || native?.name === 'NotSupportedError' || code === 10 || code === 14 || code === 8) {
    return { code: 'STORAGE', message: 'O armazenamento local está indisponível ou recusou a operação. Confira permissões, espaço e os registros antes de tentar novamente.' };
  }
  if (code === 11 || code === 26) {
    return { code: 'INTEGRITY', message: 'O SQLite encontrou um problema de integridade. Preserve os dados do navegador e interrompa novas gravações.' };
  }
  return { code: 'DATABASE', message: 'Não foi possível confirmar a operação no banco local. Reabra e consulte os registros antes de repetir uma gravação.' };
}

async function acquireOwnership(): Promise<void> {
  if (!navigator.locks?.request) return; // OPFS handles still enforce exclusivity.
  await new Promise<void>((resolve, reject) => {
    void navigator.locks.request(OWNER_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        reject(new DatabaseError('BUSY', 'O banco está em uso em outra aba ou janela. Feche o outro acesso e tente abrir novamente.'));
        return;
      }
      const lifetime = new Promise<void>((release) => { releaseOwnership = release; });
      resolve();
      await lifetime;
    }).catch(reject);
  });
}

async function openDatabase(): Promise<DatabaseInfo> {
  if (info && db) return info;
  if (!globalThis.isSecureContext || !navigator.storage?.getDirectory ||
      typeof FileSystemFileHandle === 'undefined' ||
      !('createSyncAccessHandle' in FileSystemFileHandle.prototype)) {
    throw new DatabaseError('UNSUPPORTED', 'Este contexto não oferece OPFS com acesso síncrono. Use um navegador compatível em HTTPS ou localhost.');
  }
  await acquireOwnership();
  try {
    await navigator.storage.getDirectory();
    const quiet = () => {};
    // The upstream .d.mts currently omits Emscripten initialization options.
    // The bundled implementation supports locateFile/print/printErr directly.
    const initialize = sqlite3InitModule as unknown as (options: {
      locateFile: (path: string, prefix: string) => string;
      print: () => void;
      printErr: () => void;
    }) => Promise<Sqlite3Static>;
    (globalThis as typeof globalThis & { sqlite3ApiConfig?: object }).sqlite3ApiConfig = {
      debug: quiet, log: quiet, warn: quiet, error: quiet,
    };
    sqlite = await initialize({
      locateFile: (path, prefix) => path.endsWith('.wasm') ? sqliteWasmUrl : `${prefix}${path}`,
      print: quiet,
      printErr: quiet,
    });
    const poolOptions = {
      name: 'opfs-sahpool',
      directory: POOL_DIRECTORY,
      initialCapacity: 6,
      clearOnInit: false,
      // SQLite 3.54 otherwise may remove pool files after initialization failure.
      preserveOnInitFailure: true,
      verbosity: 0,
    };
    pool = await sqlite.installOpfsSAHPoolVfs(poolOptions);
    db = new pool.OpfsSAHPoolDb(DATABASE_NAME);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA temp_store = MEMORY;');
    const migration = await migrateDatabase(db);
    repository = new ProbeRepository(db);
    library = new LibraryRepository(db);
    backup = new BackupRepository(db, sqlite);
    const vfs = db.dbVfsName();
    if (vfs !== 'opfs-sahpool') {
      throw new DatabaseError('STORAGE', 'O SQLite não confirmou o uso do OPFS esperado. A gravação foi bloqueada.');
    }
    info = {
      sqliteVersion: sqlite.version.libVersion,
      vfs,
      dbName: DATABASE_NAME,
      fts5: verifyFts5(db),
      schemaVersion: migration.schemaVersion,
      migrationCount: migration.migrationCount,
      libraryTableCount: migration.tableNames.filter((name) => name !== 'persistence_probe').length,
      foreignKeysEnabled: Number(db.selectValue('PRAGMA foreign_keys')) === 1,
    };
    return info;
  } catch (error) {
    try { closeDatabase(); } catch { /* Parent terminates this worker after failure. */ }
    throw error;
  }
}

function verifyFts5(connection: Database): boolean {
  if (Number(connection.selectValue("SELECT sqlite_compileoption_used('ENABLE_FTS5')")) !== 1) return false;
  try {
    connection.exec('CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(content)');
    connection.exec('INSERT INTO temp.fts5_probe(content) VALUES (?)', { bind: ['persistencia offline'] });
    return Number(connection.selectValue('SELECT count(*) FROM temp.fts5_probe WHERE fts5_probe MATCH ?', ['persistencia'])) === 1;
  } catch {
    return false;
  } finally {
    connection.exec('DROP TABLE IF EXISTS temp.fts5_probe');
  }
}

function closeDatabase(): void {
  repository = undefined;
  library = undefined;
  backup = undefined;
  info = undefined;
  try {
    db?.close();
    db = undefined;
    // Releasing handles preserves all files. removeVfs() would DELETE them.
    pool?.pauseVfs();
    pool = undefined;
  } finally {
    releaseOwnership?.();
    releaseOwnership = undefined;
  }
}

async function execute(request: DatabaseRequest): Promise<unknown> {
  if (request.operation === 'open') return openDatabase();
  if (request.operation === 'close') { closeDatabase(); return undefined; }
  if (!repository) throw new DatabaseError('CLOSED', 'O banco está fechado. Reabra para continuar.');
  switch (request.operation) {
    case 'list': return repository.list();
    case 'insert': return repository.insert(request.content);
    case 'integrity': return repository.integrity();
    case 'rollback': return repository.testRollback();
    case 'libraryCatalog': return library!.catalog();
    case 'libraryList': return library!.list();
    case 'libraryGet': {
      const payload = request.payload;
      if (!payload || typeof payload !== 'object' || !('id' in payload)) {
        throw new DatabaseError('INVALID_INPUT', 'Informe o conteúdo que deseja abrir.');
      }
      return library!.get(payload.id);
    }
    case 'librarySave': return library!.save(request.payload);
    case 'categoryCreate': return library!.createCategory(request.payload);
    case 'subcategoryCreate': return library!.createSubcategory(request.payload);
    case 'backupExportJson': return backup!.exportJson();
    case 'backupInspect': return backup!.inspect(request.payload);
    case 'backupRestore': return backup!.restore(request.payload as BackupRestoreInput);
    case 'backupExportSqlite': {
      if (repository.integrity().some((result) => result !== 'ok')) {
        throw new DatabaseError('INTEGRITY', 'A verificação do banco falhou. A exportação foi interrompida.');
      }
      return sqlite!.capi.sqlite3_js_db_export(db!);
    }
    default: throw new DatabaseError('INVALID_INPUT', 'Operação de banco desconhecida.');
  }
}

globalThis.onmessage = (event: MessageEvent<DatabaseRequest>) => {
  const request = event.data;
  if (!request || !Number.isSafeInteger(request.id) || typeof request.operation !== 'string') return;
  operationQueue = operationQueue.then(async () => {
    let response: DatabaseResponse;
    try {
      response = { id: request.id, ok: true, value: await execute(request) };
    } catch (error) {
      response = { id: request.id, ok: false, error: safeError(error) };
    }
    // The portable image is copied by SQLite, then transferred without another
    // full-sized structured-clone allocation. The live OPFS database stays open.
    if (response.ok && response.value instanceof Uint8Array) {
      globalThis.postMessage(response, { transfer: [response.value.buffer] });
    } else {
      globalThis.postMessage(response);
    }
  });
};
