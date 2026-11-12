import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { DatabaseError, type ProbeRecord } from '../../models/database';
import { validateProbeContent } from '../../utils/validation';

const INSERT_SQL = 'INSERT INTO persistence_probe (id, content, created_at) VALUES (?, ?, ?)';

function toRecord(row: Record<string, SqlValue>): ProbeRecord {
  if (typeof row.id !== 'string' || typeof row.content !== 'string' || typeof row.created_at !== 'string') {
    throw new DatabaseError('INTEGRITY', 'O banco retornou um registro inválido. Execute a verificação de integridade.');
  }
  return { id: row.id, content: row.content, created_at: row.created_at };
}

export class ProbeRepository {
  constructor(private readonly db: Database) {}

  list(): ProbeRecord[] {
    return this.db.selectObjects('SELECT id, content, created_at FROM persistence_probe ORDER BY created_at DESC, id DESC').map(toRecord);
  }

  insert(content: unknown): ProbeRecord {
    const record: ProbeRecord = {
      id: crypto.randomUUID(),
      content: validateProbeContent(content),
      created_at: new Date().toISOString(),
    };
    this.db.transaction('IMMEDIATE', () => {
      this.db.exec(INSERT_SQL, { bind: [record.id, record.content, record.created_at] });
    });
    // This read occurs after COMMIT. No success response is sent before it.
    const stored = this.db.selectObject('SELECT id, content, created_at FROM persistence_probe WHERE id = ?', [record.id]);
    if (!stored) {
      throw new DatabaseError('INTEGRITY', 'Não foi possível confirmar a gravação. Consulte os registros antes de repetir.');
    }
    const recovered = toRecord(stored);
    if (recovered.id !== record.id || recovered.content !== record.content || recovered.created_at !== record.created_at) {
      throw new DatabaseError('INTEGRITY', 'A consulta não confirmou os valores gravados. Preserve os dados e execute a verificação de integridade.');
    }
    return recovered;
  }

  integrity(): string[] {
    const results = this.db.selectValues('PRAGMA integrity_check').map(String);
    if (this.db.selectObjects('PRAGMA foreign_key_check').length > 0) {
      results.push('Relacionamentos inconsistentes: a verificação de chaves estrangeiras falhou.');
    }
    return results;
  }

  testRollback(): boolean {
    const beforeCount = Number(this.db.selectValue('SELECT count(*) FROM persistence_probe'));
    const id = crypto.randomUUID();
    const date = new Date().toISOString();
    let constraintRejected = false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(INSERT_SQL, { bind: [id, 'Registro temporário do teste de rollback', date] });
      // The second statement must fail because of the duplicate primary key.
      this.db.exec(INSERT_SQL, { bind: [id, 'Esta segunda inserção deve falhar', date] });
    } catch (error) {
      const code = Number((error as { resultCode?: number }).resultCode);
      if ((code & 0xff) !== 19) throw error;
      constraintRejected = true;
    } finally {
      // Never commit this diagnostic transaction, even if its assertion fails.
      this.db.exec('ROLLBACK');
    }
    const remaining = Number(this.db.selectValue('SELECT count(*) FROM persistence_probe WHERE id = ?', [id]));
    const afterCount = Number(this.db.selectValue('SELECT count(*) FROM persistence_probe'));
    return constraintRejected && remaining === 0 && beforeCount === afterCount;
  }
}
