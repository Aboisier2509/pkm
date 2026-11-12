import '../styles/library.css';
import { DatabaseClient, DatabaseError } from '../database/client';
import type { CreateCategoryInput, CreateSubcategoryInput, LibraryCatalog, LibraryItemDetail, LibraryItemSummary, LibrarySaveInput } from '../models/library';
import { registerPwa, type PwaController, type PwaState } from '../pwa/register';
import { KnowledgeValidationError } from '../services/knowledge-validation';
import { openLibraryDialog } from '../components/library-dialogs';
import { node, setNotice } from '../components/library-dom';
import { LibraryEditor } from '../components/library-editor';
import { renderLibraryList } from '../components/library-list';
import { renderLibraryShell } from '../components/library-shell';
import { LibraryBackup } from '../components/library-backup';

export async function mountLibrary(): Promise<void> {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) throw new Error('Não foi possível abrir a interface da biblioteca.');
  root.innerHTML = renderLibraryShell();
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = document.getElementById(id);
    if (!found) throw new Error('Um controle da biblioteca não está disponível.');
    return found as T;
  };
  const database = new DatabaseClient();
  const list = get('library-list');
  const target = get('library-editor-container');
  const newButton = get<HTMLButtonElement>('new-content');
  const backupButton = get<HTMLButtonElement>('library-backup-open');
  const retry = get<HTMLButtonElement>('library-retry');
  const errorNotice = get('library-error');
  const successNotice = get('library-success');
  let catalog: LibraryCatalog = { categories: [], subcategories: [], tags: [] };
  let items: LibraryItemSummary[] = [];
  let editor: LibraryEditor | undefined;
  let backup: LibraryBackup | undefined;
  let busy = false;
  let databaseOpen = false;
  let loaded = false;
  let navigationApproved = false;
  let pwa: PwaController | undefined;
  let pwaState: PwaState = { ready: false, updateAvailable: false, message: '', version: __APP_VERSION__ };
  get('library-version').textContent = `v${__APP_VERSION__}`;

  function updateControls(): void {
    newButton.disabled = busy || !databaseOpen;
    backupButton.disabled = busy || !databaseOpen;
    backupButton.hidden = !!backup;
    retry.disabled = busy;
    retry.hidden = databaseOpen;
    get('library-db-state').textContent = busy ? 'Aguarde…' : databaseOpen ? 'Biblioteca conectada' : 'Biblioteca indisponível';
    get('library-db-dot').className = `state-dot${databaseOpen ? ' good' : busy ? '' : ' bad'}`;
    get<HTMLButtonElement>('library-check-update').disabled = busy || !pwa;
    get<HTMLButtonElement>('library-apply-update').disabled = busy || !pwaState.updateAvailable;
    list.querySelectorAll<HTMLButtonElement>('button').forEach((control) => { control.disabled = busy || !databaseOpen; });
    editor?.setBusy(busy, databaseOpen);
    backup?.setBusy(busy, databaseOpen);
  }

  function clearNotices(): void {
    setNotice(errorNotice, '');
    setNotice(successNotice, '');
    editor?.showError('');
    backup?.showError('');
  }

  function errorMessage(error: unknown): string {
    if (error instanceof DatabaseError && error.code === 'CONFLICT') return error.message;
    if (error instanceof DatabaseError && error.code === 'NOT_FOUND') return 'Este conteúdo não está mais disponível. Volte à biblioteca e consulte a lista novamente.';
    if (error instanceof KnowledgeValidationError) return editor?.errorMessage(error) ?? 'Confira os nomes e os campos informados antes de salvar.';
    return error instanceof Error ? error.message : 'Não foi possível concluir a operação. Tente novamente.';
  }

  async function releaseAfterFailure(error: unknown): Promise<void> {
    if (error instanceof DatabaseError && ['CLOSED', 'WORKER', 'TIMEOUT', 'INTEGRITY', 'SCHEMA', 'STORAGE', 'QUOTA', 'DATABASE'].includes(error.code)) {
      try { await database.close(); } catch { /* Keep the original, safe failure. */ }
      databaseOpen = false;
    }
  }

  async function reportError(error: unknown): Promise<void> {
    await releaseAfterFailure(error);
    const message = errorMessage(error);
    if (backup) backup.showError(message);
    else if (editor) editor.showError(message, !!editor.detail && error instanceof DatabaseError && error.code === 'CONFLICT');
    else setNotice(errorNotice, message);
    if (!loaded && !editor && !backup) {
      const unavailable = node('div', 'panel library-loading');
      unavailable.append(node('p', '', 'Não foi possível carregar a biblioteca. Use “Tentar novamente” para abrir seus dados locais.'));
      list.replaceChildren(unavailable);
    }
  }

  async function run(operation: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    clearNotices();
    updateControls();
    try { await operation(); } catch (error) { await reportError(error); }
    finally { busy = false; updateControls(); }
  }

  function renderItems(): void {
    list.replaceChildren(renderLibraryList(items, (id) => {
      void run(async () => {
        const detail = await database.libraryGet(id);
        showEditor(detail);
      });
    }));
    get('sidebar-count').textContent = String(items.length);
    updateControls();
  }

  function showList(): void {
    editor = undefined;
    backup = undefined;
    target.replaceChildren();
    target.hidden = true;
    list.hidden = false;
    newButton.hidden = false;
    get('library-title').textContent = 'Sua biblioteca';
    get('library-description').textContent = 'Guarde, organize e retome o que você quer aprender.';
    get('library-breadcrumb').textContent = 'Biblioteca';
    document.title = 'Sua biblioteca · PKM';
    renderItems();
  }

  function showBackup(): void {
    if (busy || !databaseOpen || !allowDiscard()) return;
    clearNotices();
    editor = undefined;
    list.hidden = true;
    newButton.hidden = true;
    target.hidden = false;
    target.setAttribute('aria-label', 'Backup e restauração');
    get('library-title').textContent = 'Backup e restauração';
    get('library-description').textContent = 'Uma cópia segura para recuperar seu conhecimento depois.';
    get('library-breadcrumb').textContent = 'Backup';
    document.title = 'Backup e restauração · PKM';
    backup = new LibraryBackup({
      run: (operation) => { void run(operation); },
      exportJson: () => database.backupExportJson(),
      exportSqlite: () => database.backupExportSqlite(),
      inspect: (text) => database.backupInspect(text),
      restore: (input) => database.backupRestore(input),
      onBack: () => {
        if (busy) return;
        clearNotices();
        showList();
        backupButton.focus();
      },
      onRestored: async () => {
        // The commit is confirmed. Hide the pending restore and old contents
        // before refreshing, even if a later read fails.
        catalog = { categories: [], subcategories: [], tags: [] };
        items = [];
        loaded = false;
        showList();
        setNotice(successNotice, 'Restauração concluída. Seus dados foram gravados neste navegador.');
        await reopen();
        get('library-title').focus();
      },
    });
    target.replaceChildren(backup.element);
    updateControls();
    get('library-title').focus();
  }

  function allowDiscard(): boolean {
    return !editor?.isDirty() || window.confirm('Descartar as alterações que ainda não foram salvas?');
  }

  function savedSummary(detail: LibraryItemDetail): LibraryItemSummary {
    const item = detail.item;
    return {
      id: item.id, title: item.title, summary: item.summary, contentPreview: [...item.content].slice(0, 180).join(''),
      categoryName: catalog.categories.find((entry) => entry.category.id === item.category_id)?.category.name ?? 'Categoria',
      subcategoryName: catalog.subcategories.find((entry) => entry.id === item.subcategory_id)?.name ?? null,
      favorite: item.favorite, status: item.status, created_at: item.created_at, updated_at: item.updated_at,
      revision: item.revision, tags: detail.tags.map((tag) => tag.name),
    };
  }

  function showEditor(detail?: LibraryItemDetail): void {
    backup = undefined;
    target.setAttribute('aria-label', 'Cadastro de conteúdo');
    list.hidden = true;
    newButton.hidden = true;
    target.hidden = false;
    get('library-title').textContent = detail ? 'Editar conteúdo' : 'Novo conteúdo';
    get('library-description').textContent = detail ? 'Retome a ideia e acrescente o que você aprendeu.' : 'Uma ideia, uma referência ou algo para retomar depois.';
    get('library-breadcrumb').textContent = detail ? 'Editar' : 'Novo conteúdo';
    document.title = `${detail ? 'Editar conteúdo' : 'Novo conteúdo'} · PKM`;
    const instance = new LibraryEditor(catalog, detail, {
      onChange: () => {},
      onCancel: () => {
        if (busy || !allowDiscard()) return;
        clearNotices();
        showList();
        newButton.focus();
      },
      onSave: (input: LibrarySaveInput) => {
        void run(async () => {
          const saved = await database.librarySave(input);
          // Commit is confirmed. Remove the creation draft before any refresh
          // that can fail, and retain the committed identity in the local list.
          instance.markClean();
          items = [savedSummary(saved), ...items.filter((item) => item.id !== saved.item.id)];
          showList();
          setNotice(successNotice, input.id ? 'Alterações salvas neste dispositivo.' : 'Conteúdo salvo na sua biblioteca.');
          const nextCatalog = await database.libraryCatalog();
          const nextItems = await database.libraryList();
          catalog = nextCatalog;
          items = nextItems;
          renderItems();
          get('library-title').focus();
        });
      },
      onCreateCategory: () => createCategory(),
      onCreateSubcategory: () => createSubcategory(),
      onReload: () => {
        if (!detail || busy || !allowDiscard()) return;
        void run(async () => showEditor(await database.libraryGet(detail.item.id)));
      },
    });
    editor = instance;
    target.replaceChildren(instance.element);
    instance.setBusy(busy, databaseOpen);
    instance.focus();
    requestAnimationFrame(() => {
      if (editor === instance && !busy && !document.querySelector('dialog[open]')) instance.focus();
    });
  }

  async function catalogMutation(operation: () => Promise<void>): Promise<void> {
    if (busy || !databaseOpen) throw new Error('Aguarde a abertura da biblioteca para continuar.');
    busy = true;
    updateControls();
    try { await operation(); }
    catch (error) { await releaseAfterFailure(error); throw error; }
    finally { busy = false; updateControls(); }
  }

  function createCategory(): void {
    if (busy || !databaseOpen) return;
    openLibraryDialog({
      kind: 'category',
      onError: errorMessage,
      onSave: async (input: CreateCategoryInput) => {
        await catalogMutation(async () => {
          const created = await database.createCategory(input);
          catalog = { ...catalog, categories: [...catalog.categories, created] };
          editor?.updateCatalog(catalog, created.category.id);
        });
      },
    });
  }

  function createSubcategory(): void {
    const categoryId = editor?.categoryId;
    if (busy || !databaseOpen || !categoryId) return;
    openLibraryDialog({
      kind: 'subcategory',
      categoryId,
      onError: errorMessage,
      onSave: async (input: CreateSubcategoryInput) => {
        await catalogMutation(async () => {
          const created = await database.createSubcategory(input);
          catalog = { ...catalog, subcategories: [...catalog.subcategories, created] };
          editor?.updateCatalog(catalog, categoryId, created.id);
        });
      },
    });
  }

  async function reopen(): Promise<void> {
    await database.open();
    const nextCatalog = await database.libraryCatalog();
    const nextItems = await database.libraryList();
    catalog = nextCatalog;
    items = nextItems;
    databaseOpen = true;
    loaded = true;
    if (backup) backup.invalidatePreview();
    else if (editor) editor.updateCatalog(catalog);
    else renderItems();
  }

  newButton.addEventListener('click', () => {
    if (busy || !databaseOpen) return;
    clearNotices();
    showEditor();
  });
  backupButton.addEventListener('click', showBackup);
  retry.addEventListener('click', () => { void run(reopen); });

  const dirtyDialog = (): boolean => !!document.querySelector('dialog[open][data-dirty="true"]');
  const hasUnsaved = (): boolean => !!editor?.isDirty() || dirtyDialog();
  window.addEventListener('beforeunload', (event) => {
    if (!navigationApproved && (busy || hasUnsaved())) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  root.addEventListener('click', (event) => {
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.hash === '#main' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (busy) return;
    if (hasUnsaved() && !window.confirm('Descartar as alterações e sair desta tela?')) return;
    void run(async () => {
      await database.close();
      databaseOpen = false;
      navigationApproved = true;
      location.assign(anchor.href);
    });
  });

  const connection = (): void => { get('library-connection').textContent = navigator.onLine ? 'Conexão disponível' : 'Sem conexão'; };
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  connection();
  get('library-check-update').addEventListener('click', () => {
    void run(async () => {
      await pwa?.checkForUpdate();
      setNotice(successNotice, 'Verificação de atualização solicitada.');
    });
  });
  get('library-apply-update').addEventListener('click', () => {
    if (busy || !pwa || (hasUnsaved() && !window.confirm('Descartar as alterações e atualizar o aplicativo?'))) return;
    void run(async () => {
      try { await database.close(); } finally { databaseOpen = false; }
      await pwa!.applyUpdate();
      navigationApproved = true;
      location.reload();
    });
  });
  void registerPwa((state) => {
    pwaState = state;
    get('offline-status').textContent = state.ready ? 'Pronto para uso offline' : import.meta.env.DEV ? 'Modo de desenvolvimento' : 'Offline ainda não preparado';
    get('pwa-message').textContent = state.message;
    get('library-apply-update').hidden = !state.updateAvailable;
    updateControls();
  }).then((controller) => { pwa = controller; updateControls(); }).catch(() => { get('pwa-message').textContent = 'Não foi possível preparar os arquivos offline.'; });

  updateControls();
  await run(reopen);
}
