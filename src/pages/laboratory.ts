import '../styles/main.css';
import { DatabaseClient, DatabaseError } from '../database/client';
import type { DatabaseInfo, ProbeRecord } from '../models/database';
import { renderPersistenceProbe } from './persistence-probe';
import { registerPwa, type PwaController, type PwaState } from '../pwa/register';
import { inspectStorage, formatBytes, type StorageSnapshot } from '../services/storage-diagnostics';

const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = renderPersistenceProbe();
function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Elemento de interface ausente: ${id}`);
  return found as T;
}
function text(id: string, value: string): void { element(id).textContent = value; }

const database = new DatabaseClient();
const content = element<HTMLTextAreaElement>('probe-content');
let databaseOpen = false;
let busy = true;
let info: DatabaseInfo | null = null;
let records: ProbeRecord[] = [];
let storage: StorageSnapshot | null = null;
let pwa: PwaController | null = null;
let pwaState: PwaState = { ready: false, updateAvailable: false, message: '', version: __APP_VERSION__ };

document.querySelectorAll<HTMLElement>('[data-app-version]').forEach((item) => { item.textContent = `v${__APP_VERSION__}`; });
text('diag-origin', location.origin);

function clearNotices(): void {
  element('error-message').hidden = true;
  element('success-message').hidden = true;
}

function success(message: string): void {
  text('success-message', message);
  element('success-message').hidden = false;
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação. Tente novamente.';
  text('error-message', message);
  element('error-message').hidden = false;
  if (error instanceof DatabaseError && ['CLOSED', 'WORKER', 'TIMEOUT', 'INTEGRITY', 'SCHEMA'].includes(error.code)) {
    databaseOpen = false;
  }
  updateControls();
}

function updateControls(): void {
  for (const id of ['save-button', 'refresh-button', 'reopen-button', 'integrity-button', 'rollback-button', 'close-button']) {
    element<HTMLButtonElement>(id).disabled = busy || !databaseOpen;
  }
  content.disabled = busy || !databaseOpen;
  element<HTMLButtonElement>('open-button').disabled = busy || databaseOpen;
  element<HTMLButtonElement>('persist-button').disabled = busy;
  element<HTMLButtonElement>('update-button').disabled = busy || !pwa;
  element<HTMLButtonElement>('apply-update-button').disabled = busy || !pwaState.updateAvailable;
  text('db-status', busy ? (databaseOpen ? 'Em operação…' : 'Abrindo…') : databaseOpen ? 'Conectado' : 'Fechado');
  element('db-dot').className = `state-dot${databaseOpen ? ' good' : busy ? '' : ' bad'}`;
  text('db-description', databaseOpen ? 'SQLite real · armazenamento OPFS' : 'Use “Abrir banco” para tentar conectar');
}

async function run(operation: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  clearNotices();
  updateControls();
  try { await operation(); } catch (error) {
    await releaseAfterFailure(error);
    showError(error);
  }
  finally { busy = false; updateControls(); }
}

async function releaseAfterFailure(error: unknown): Promise<void> {
  if (error instanceof DatabaseError && ['STORAGE', 'QUOTA', 'INTEGRITY', 'DATABASE', 'SCHEMA'].includes(error.code)) {
    try { await database.close(); } catch { /* close always terminates the worker and preserves the original error. */ }
    databaseOpen = false;
  }
}

function renderRecords(): void {
  text('record-count', String(records.length));
  const target = element('records');
  target.replaceChildren();
  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Ainda não há registros. Salve sua primeira ideia para começar o teste.';
    target.append(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'records-list';
  const formatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  for (const record of records) {
    const item = document.createElement('li');
    item.className = 'record';
    const value = document.createElement('p');
    value.className = 'record-content';
    value.textContent = record.content;
    const metadata = document.createElement('div');
    metadata.className = 'record-meta';
    const date = document.createElement('time');
    date.dateTime = record.created_at;
    const parsed = new Date(record.created_at);
    date.textContent = Number.isNaN(parsed.getTime()) ? record.created_at : formatter.format(parsed);
    const identifier = document.createElement('span');
    identifier.className = 'record-id';
    identifier.textContent = record.id;
    metadata.append(date, identifier);
    item.append(value, metadata);
    list.append(item);
  }
  target.append(list);
}

async function refreshRecords(): Promise<void> {
  records = await database.list();
  renderRecords();
}

async function refreshStorage(request = false): Promise<void> {
  storage = await inspectStorage(request);
  text('diag-persist', storage.persistence === 'granted'
    ? 'Concedida pelo navegador · não é backup'
    : storage.persistence === 'not-granted' ? 'Não concedida · sujeita à política do navegador' : 'API não disponível neste contexto');
  text('diag-quota', `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`);
  text('diag-secure', storage.secureContext ? 'Sim · HTTPS ou localhost' : 'Não · use HTTPS ou localhost');
}

async function openDatabase(): Promise<void> {
  info = await database.open();
  text('diag-sqlite', info.sqliteVersion);
  text('diag-vfs', `${info.vfs} · ${info.dbName}`);
  text('diag-fts5', info.fts5 ? 'Disponível · MATCH verificado' : 'Não confirmada neste build');
  text('diag-schema', `v${info.schemaVersion} · ${info.libraryTableCount} tabelas da biblioteca`);
  text('diag-migrations', `${info.migrationCount} registradas · chaves estrangeiras ${info.foreignKeysEnabled ? 'ativas' : 'inativas'}`);
  await refreshRecords();
  await refreshStorage();
  databaseOpen = true;
}

element<HTMLFormElement>('probe-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async () => {
    const saved = await database.insert(content.value);
    content.value = '';
    text('character-count', '0 / 20.000');
    // Keep a committed record visible even if the following list refresh fails.
    records = [saved, ...records];
    renderRecords();
    success('Registro gravado e confirmado no SQLite. Agora você pode fechar e reabrir o aplicativo.');
    await refreshRecords();
    await refreshStorage();
  });
});

content.addEventListener('input', () => text('character-count', `${new Intl.NumberFormat('pt-BR').format(content.value.length)} / 20.000`));
element('refresh-button').addEventListener('click', () => { void run(async () => { await refreshRecords(); success('Consulta concluída diretamente no banco SQLite.'); }); });
element('reopen-button').addEventListener('click', () => {
  void run(async () => {
    await database.close();
    databaseOpen = false;
    await openDatabase();
    success('Banco fechado e reaberto. Os registros acima foram recuperados do OPFS.');
  });
});
element('close-button').addEventListener('click', () => {
  void run(async () => {
    try { await database.close(); } finally { databaseOpen = false; }
    element('records').replaceChildren();
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = 'Banco fechado. Abra novamente para consultar os dados salvos.';
    element('records').append(message);
    text('record-count', '—');
    success('Conexão fechada e arquivos liberados. Os registros continuam no armazenamento local.');
  });
});
element('open-button').addEventListener('click', () => { void run(async () => { await openDatabase(); success('Banco local aberto. Registros consultados no SQLite.'); }); });
element('integrity-button').addEventListener('click', () => {
  void run(async () => {
    const results = await database.integrity();
    if (results.length !== 1 || results[0] !== 'ok') {
      text('integrity-result', 'Integridade: falhou. Preserve os dados e interrompa novas gravações.');
      throw new DatabaseError('INTEGRITY', 'A verificação de integridade não retornou ok. Preserve os dados do navegador.');
    }
    text('integrity-result', 'Integridade: ok · PRAGMA integrity_check.');
    success('Integridade do banco verificada: ok.');
  });
});
element('rollback-button').addEventListener('click', () => {
  void run(async () => {
    const verified = await database.testRollback();
    if (!verified) {
      text('rollback-result', 'Rollback: não confirmado.');
      throw new DatabaseError('INTEGRITY', 'O teste não confirmou o rollback esperado. Preserve os dados do navegador.');
    }
    text('rollback-result', 'Rollback: confirmado · nenhuma inserção do teste permaneceu.');
    await refreshRecords();
    success('Rollback confirmado. A transação de teste não alterou seus registros.');
  });
});
element('persist-button').addEventListener('click', () => {
  void run(async () => {
    await refreshStorage(true);
    success(storage?.persistence === 'granted'
      ? 'O navegador concedeu a proteção de armazenamento. Limpeza manual ainda pode apagar os dados.'
      : 'A proteção não foi concedida ou não está disponível. O banco continua sujeito às políticas do navegador.');
  });
});
element('download-button').addEventListener('click', () => {
  const report = {
    generatedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    offlineVersion: pwaState.version,
    origin: location.origin,
    browser: navigator.userAgent,
    standalone: matchMedia('(display-mode: standalone)').matches,
    storage,
    database: info,
    databaseOpen,
    recordCount: databaseOpen ? records.length : null,
    offlineReady: pwaState.ready,
    integrity: element('integrity-result').textContent,
    rollback: element('rollback-result').textContent,
    physicalValidation: 'Não comprovada por este diagnóstico; execute o roteiro manual.',
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `pkm-diagnostico-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
element('update-button').addEventListener('click', () => {
  void run(async () => {
    await pwa?.checkForUpdate();
    success('Verificação solicitada. Uma nova versão será indicada quando terminar o preparo.');
  });
});
element('apply-update-button').addEventListener('click', () => {
  void run(async () => {
    if (!pwa) return;
    try { await database.close(); } finally { databaseOpen = false; }
    await pwa.applyUpdate();
    location.reload();
  });
});

function updateConnection(): void {
  const online = navigator.onLine;
  text('connection-label', online ? 'Navegador indica conexão disponível' : 'Navegador indica modo offline');
  element('connection-dot').className = `state-dot${online ? ' good' : ' bad'}`;
}
window.addEventListener('online', updateConnection);
window.addEventListener('offline', updateConnection);
updateConnection();
updateControls();

void registerPwa((state) => {
  pwaState = state;
  text('offline-status', state.ready ? 'Pronto para uso offline' : import.meta.env.DEV ? 'Modo de desenvolvimento' : 'Não confirmado');
  text('offline-description', state.ready ? 'Interface, worker e WASM em cache' : 'Aguarde o preparo ou veja o diagnóstico');
  text('pwa-message', state.message);
  text('diag-version', `v${state.version}`);
  element('apply-update-button').hidden = !state.updateAvailable;
  updateControls();
}).then((controller) => { pwa = controller; updateControls(); }).catch(() => {
  text('pwa-message', 'Não foi possível preparar os arquivos offline.');
});

void (async () => {
  try { await openDatabase(); } catch (error) { await releaseAfterFailure(error); showError(error); await refreshStorage(); }
  finally { busy = false; updateControls(); }
})();
