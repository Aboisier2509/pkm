import {
  DatabaseError,
  type DatabaseInfo,
  type DatabaseOperation,
  type DatabaseRequest,
  type DatabaseResponse,
  type ProbeRecord,
} from '../models/database';
import { validateProbeContent } from '../utils/validation';
import type { CategoryOption, CreateCategoryInput, CreateSubcategoryInput, LibraryCatalog, LibraryItemDetail, LibraryItemSummary, SaveKnowledgeInput } from '../models/library';
import type { SubcategoryRecord } from '../models/knowledge';
import type { BackupPreview, BackupRestoreInput, BackupRestoreResult } from '../models/backup';

export { DatabaseError } from '../models/database';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: DatabaseError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Only application operations cross this boundary; arbitrary SQL never does. */
export class DatabaseClient {
  private worker: Worker | undefined;
  private sequence = 0;
  private pending = new Map<number, PendingRequest>();
  private queue: Promise<unknown> = Promise.resolve();
  private info: DatabaseInfo | undefined;

  open(): Promise<DatabaseInfo> {
    return this.serialize(async () => {
      if (this.info) return this.info;
      if (!globalThis.isSecureContext) {
        throw new DatabaseError('UNSUPPORTED', 'Use HTTPS ou localhost para acessar o armazenamento local.');
      }
      if (typeof Worker === 'undefined' || !navigator.storage?.getDirectory) {
        throw new DatabaseError('UNSUPPORTED', 'Este navegador não disponibiliza os recursos necessários para SQLite com OPFS.');
      }
      this.createWorker();
      try {
        this.info = await this.send<DatabaseInfo>('open');
        return this.info;
      } catch (error) {
        this.stopWorker(new DatabaseError('CLOSED', 'O banco não foi aberto.'));
        throw error;
      }
    });
  }

  list(): Promise<ProbeRecord[]> {
    return this.serialize(() => this.send<ProbeRecord[]>('list'));
  }

  insert(content: string): Promise<ProbeRecord> {
    return this.serialize(() => this.send<ProbeRecord>('insert', validateProbeContent(content)));
  }

  integrity(): Promise<string[]> {
    return this.serialize(() => this.send<string[]>('integrity'));
  }

  testRollback(): Promise<boolean> {
    return this.serialize(() => this.send<boolean>('rollback'));
  }

  libraryCatalog(): Promise<LibraryCatalog> {
    return this.serialize(() => this.send<LibraryCatalog>('libraryCatalog'));
  }

  libraryList(): Promise<LibraryItemSummary[]> {
    return this.serialize(() => this.send<LibraryItemSummary[]>('libraryList'));
  }

  libraryGet(id: string): Promise<LibraryItemDetail> {
    return this.serialize(() => this.send<LibraryItemDetail>('libraryGet', undefined, { id }));
  }

  librarySave(input: SaveKnowledgeInput): Promise<LibraryItemDetail> {
    return this.serialize(() => this.send<LibraryItemDetail>('librarySave', undefined, input));
  }

  createCategory(input: CreateCategoryInput): Promise<CategoryOption> {
    return this.serialize(() => this.send<CategoryOption>('categoryCreate', undefined, input));
  }

  createSubcategory(input: CreateSubcategoryInput): Promise<SubcategoryRecord> {
    return this.serialize(() => this.send<SubcategoryRecord>('subcategoryCreate', undefined, input));
  }

  backupExportJson(): Promise<string> {
    return this.serialize(() => this.send<string>('backupExportJson'));
  }

  backupExportSqlite(): Promise<Uint8Array<ArrayBuffer>> {
    return this.serialize(() => this.send<Uint8Array<ArrayBuffer>>('backupExportSqlite'));
  }

  backupInspect(text: string): Promise<BackupPreview> {
    return this.serialize(() => this.send<BackupPreview>('backupInspect', undefined, text));
  }

  backupRestore(input: BackupRestoreInput): Promise<BackupRestoreResult> {
    return this.serialize(() => this.send<BackupRestoreResult>('backupRestore', undefined, input));
  }

  close(): Promise<void> {
    return this.serialize(async () => {
      if (!this.worker) return;
      try {
        await this.send<void>('close');
      } finally {
        // Termination releases OPFS handles even if pool shutdown reports an error.
        // This does not remove the VFS or its files.
        this.stopWorker(new DatabaseError('CLOSED', 'O banco está fechado. Reabra para continuar.'));
      }
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private createWorker(): void {
    if (this.worker) return;
    try {
      const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<DatabaseResponse>) => {
        const response = event.data;
        if (!response || typeof response.id !== 'number') return;
        const request = this.pending.get(response.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(response.id);
        if (response.ok) request.resolve(response.value);
        else request.reject(new DatabaseError(response.error.code, response.error.message));
      };
      worker.onerror = (event) => {
        // The native error may contain SQL/content. Present a fixed, safe message.
        event.preventDefault();
        this.stopWorker(new DatabaseError('WORKER', 'O processo do banco falhou. Uma gravação pendente pode não ter sido confirmada; reabra e consulte os registros antes de tentar novamente.'));
      };
      worker.onmessageerror = () => {
        this.stopWorker(new DatabaseError('WORKER', 'Não foi possível receber a resposta do banco. Reabra e confira os registros.'));
      };
    } catch {
      throw new DatabaseError('UNSUPPORTED', 'Não foi possível iniciar o processo local do SQLite. Verifique os recursos do navegador.');
    }
  }

  private send<T>(operation: DatabaseOperation, content?: string, payload?: unknown): Promise<T> {
    if (!this.worker || (!this.info && operation !== 'open')) {
      return Promise.reject(new DatabaseError('CLOSED', 'O banco está fechado. Reabra para continuar.'));
    }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stopWorker(new DatabaseError('TIMEOUT', 'O banco não respondeu a tempo. Uma gravação pendente pode ter sido concluída; reabra e consulte os registros antes de repetir.'));
      }, 60_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      const request: DatabaseRequest = {
        id, operation,
        ...(content === undefined ? {} : { content }),
        ...(payload === undefined ? {} : { payload }),
      };
      try {
        this.worker!.postMessage(request);
      } catch {
        this.stopWorker(new DatabaseError('WORKER', 'Não foi possível enviar a operação ao banco. Reabra e confira os registros.'));
      }
    });
  }

  private stopWorker(error: DatabaseError): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.info = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
