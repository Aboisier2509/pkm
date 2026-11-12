import '../styles/backup.css';
import { BACKUP_MAX_BYTES, type BackupCounts, type BackupPreview, type BackupRestoreInput, type BackupRestoreResult } from '../models/backup';
import { button, field, node, setNotice } from './library-dom';

interface BackupActions {
  run: (operation: () => Promise<void>) => void;
  exportJson: () => Promise<string>;
  exportSqlite: () => Promise<Uint8Array<ArrayBuffer>>;
  inspect: (text: string) => Promise<BackupPreview>;
  restore: (input: BackupRestoreInput) => Promise<BackupRestoreResult>;
  onRestored: (result: BackupRestoreResult) => Promise<void>;
  onBack: () => void;
}

const TABLE_LABELS: Record<keyof BackupCounts, string> = {
  knowledge_items: 'Conteúdos', categories: 'Categorias', subcategories: 'Subcategorias',
  tags: 'Tags', item_tags: 'Vínculos de tags', category_metadata_schemas: 'Modelos de campos',
  item_revisions: 'Revisões de conteúdos', change_log: 'Alterações no histórico',
  attachments: 'Metadados de anexos', persistence_probe: 'Registros do laboratório',
};

/** A download request cannot confirm that the user actually kept the file. */
function download(blob: Blob, extension: 'json' | 'sqlite3'): void {
  const url = URL.createObjectURL(blob);
  const anchor = node('a');
  anchor.href = url;
  anchor.download = `pkm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  anchor.hidden = true;
  document.body.append(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export class LibraryBackup {
  readonly element = node('div', 'backup-page');
  private readonly error = node('div', 'notice notice-error');
  private readonly success = node('div', 'notice notice-success');
  private readonly file = node('input', 'library-input backup-file');
  private readonly inspectButton = button('Validar arquivo');
  private readonly restoreButton = button('Restaurar backup', 'button button-primary');
  private readonly previewTarget = node('section', 'backup-preview');
  private readonly merge = node('input');
  private readonly replace = node('input');
  private readonly replacement = node('div', 'backup-replacement');
  private readonly replaceConfirm = node('input');
  private readonly confirmText = node('input', 'library-input');
  private readonly conflictNotice = node('p', 'backup-conflict');
  private preview?: BackupPreview;
  private text?: string;
  private busy = false;
  private databaseOpen = false;

  constructor(private readonly actions: BackupActions) {
    this.element.dataset.testid = 'backup-panel';
    const back = button('Voltar à biblioteca', 'button button-text');
    back.id = 'backup-back';
    back.addEventListener('click', () => { if (!this.busy) actions.onBack(); });
    this.error.id = 'backup-error';
    this.error.dataset.testid = 'backup-error';
    this.error.setAttribute('role', 'alert');
    this.error.hidden = true;
    this.success.id = 'backup-success';
    this.success.dataset.testid = 'backup-success';
    this.success.setAttribute('role', 'status');
    this.success.hidden = true;

    const exports = node('section', 'panel backup-card');
    exports.setAttribute('aria-labelledby', 'backup-export-heading');
    const exportHeading = node('h2', '', 'Uma cópia fora do navegador');
    exportHeading.id = 'backup-export-heading';
    const exportButtons = node('div', 'backup-actions');
    const json = button('Exportar backup JSON', 'button button-primary');
    json.id = 'backup-export-json';
    json.addEventListener('click', () => this.run(async () => {
      const text = await actions.exportJson();
      download(new Blob([text], { type: 'application/json;charset=utf-8' }), 'json');
      setNotice(this.success, 'Download do backup JSON iniciado. Confira o arquivo na pasta escolhida pelo navegador e guarde uma cópia em um lugar seguro.');
    }));
    const sqlite = button('Exportar banco SQLite');
    sqlite.id = 'backup-export-sqlite';
    sqlite.addEventListener('click', () => this.run(async () => {
      const bytes = await actions.exportSqlite();
      download(new Blob([bytes], { type: 'application/vnd.sqlite3' }), 'sqlite3');
      setNotice(this.success, 'Download do banco SQLite iniciado. Confira se o arquivo foi salvo. A restauração nesta tela utiliza o backup JSON.');
    }));
    exportButtons.append(json, sqlite);
    exports.append(exportHeading,
      node('p', '', 'Exporte conteúdos, categorias, tags, campos específicos e histórico. Use o arquivo JSON para recuperar sua biblioteca aqui ou levá-la a outro navegador.'),
      exportButtons,
      node('p', 'backup-note', 'Os arquivos contêm seus dados sem criptografia. Guarde-os fora dos dados do navegador. Não há sincronização automática entre dispositivos.'),
      node('p', 'backup-note', 'Anexos: somente os metadados são incluídos. O envio de arquivos anexos ainda não está disponível. A cópia SQLite pode ser aberta em ferramentas compatíveis com SQLite.'));

    const imports = node('section', 'panel backup-card');
    imports.setAttribute('aria-labelledby', 'backup-import-heading');
    const importHeading = node('h2', '', 'Recuperar de um backup');
    importHeading.id = 'backup-import-heading';
    this.file.type = 'file';
    this.file.accept = '.json,application/json';
    this.file.addEventListener('change', () => {
      this.invalidatePreview();
      setNotice(this.error, '');
      setNotice(this.success, '');
    });
    this.inspectButton.id = 'backup-inspect';
    this.inspectButton.addEventListener('click', () => this.run(async () => {
      const selected = this.file.files?.[0];
      if (!selected) throw new Error('Escolha um arquivo JSON de backup para validar.');
      this.invalidatePreview();
      if (selected.size > BACKUP_MAX_BYTES) throw new Error('O arquivo excede o limite de 50 MiB.');
      const text = await selected.text();
      const preview = await actions.inspect(text);
      this.text = text;
      this.preview = preview;
      this.renderPreview(selected.name);
    }));
    imports.append(importHeading,
      node('p', '', 'Escolha o JSON exportado pelo PKM. Primeiro vamos conferir o formato, a integridade e os possíveis conflitos. A validação não altera seus dados.'),
      field('backup-file', 'Arquivo de backup JSON', this.file, 'Limite de 50 MiB. Arquivos .sqlite3 não são importados por esta tela.'),
      this.inspectButton, this.previewTarget);
    this.previewTarget.dataset.testid = 'backup-preview';
    this.previewTarget.setAttribute('aria-label', 'Prévia da restauração');
    this.previewTarget.hidden = true;
    this.merge.type = this.replace.type = 'radio';
    this.merge.name = this.replace.name = 'backup-mode';
    this.merge.id = 'backup-mode-merge';
    this.replace.id = 'backup-mode-replace';
    this.merge.checked = true;
    const modeChanged = (): void => {
      this.replaceConfirm.checked = false;
      this.confirmText.value = '';
      this.updateControls();
    };
    this.merge.addEventListener('change', modeChanged);
    this.replace.addEventListener('change', modeChanged);
    this.replaceConfirm.type = 'checkbox';
    this.replaceConfirm.id = 'backup-replace-confirm';
    this.replaceConfirm.addEventListener('change', () => this.updateControls());
    this.confirmText.id = 'backup-confirm-text';
    this.confirmText.autocomplete = 'off';
    this.confirmText.spellcheck = false;
    this.confirmText.addEventListener('input', () => this.updateControls());
    this.restoreButton.id = 'backup-restore';
    this.restoreButton.addEventListener('click', () => this.run(async () => {
      const preview = this.preview;
      const text = this.text;
      if (!preview || text === undefined) throw new Error('Valide o arquivo novamente antes de restaurar.');
      const mode = this.replace.checked ? 'replace' : 'merge';
      if (mode === 'replace' && (!this.replaceConfirm.checked || this.confirmText.value !== 'RESTAURAR')) {
        throw new Error('Confirme a substituição e digite RESTAURAR.');
      }
      if (mode === 'merge' && preview.conflicts.length) throw new Error('Existem conflitos. Nenhum dado foi importado.');
      const result = await actions.restore({ text, mode, expectedState: preview.expectedState });
      // The write is committed. Remove the pending action before any refresh,
      // so a later read failure cannot lead the user to repeat this restore.
      this.file.value = '';
      this.invalidatePreview();
      await actions.onRestored(result);
    }));
    this.element.append(back, this.error, this.success, exports, imports);
    this.updateControls();
  }

  setBusy(busy: boolean, databaseOpen: boolean): void {
    this.busy = busy;
    this.databaseOpen = databaseOpen;
    this.updateControls();
  }

  showError(message: string): void { setNotice(this.error, message); }

  invalidatePreview(): void {
    this.preview = undefined;
    this.text = undefined;
    this.previewTarget.replaceChildren();
    this.previewTarget.hidden = true;
    this.merge.checked = true;
    this.replace.checked = false;
    this.replaceConfirm.checked = false;
    this.confirmText.value = '';
    this.updateControls();
  }

  private run(operation: () => Promise<void>): void {
    if (this.busy || !this.databaseOpen) return;
    setNotice(this.error, '');
    setNotice(this.success, '');
    this.actions.run(operation);
  }

  private renderPreview(filename: string): void {
    const preview = this.preview!;
    const heading = node('h3', '', 'Arquivo validado');
    heading.tabIndex = -1;
    const exported = new Date(preview.exportedAt).toLocaleString('pt-BR');
    const details = node('p', 'backup-note', `${filename} · Exportado em ${exported} · Aplicativo ${preview.appVersion} · Estrutura ${preview.schemaVersion}`);
    const table = node('table', 'backup-counts');
    const caption = node('caption', '', 'Registros incluídos no arquivo e na base local');
    const head = node('thead');
    const labels = node('tr');
    for (const label of ['Registros', 'No arquivo', 'Neste navegador']) labels.append(node('th', '', label));
    head.append(labels);
    const body = node('tbody');
    for (const name of Object.keys(TABLE_LABELS) as (keyof BackupCounts)[]) {
      const row = node('tr');
      const title = node('th', '', TABLE_LABELS[name]);
      title.scope = 'row';
      row.append(title, node('td', '', String(preview.counts[name])), node('td', '', String(preview.currentCounts[name])));
      body.append(row);
    }
    table.append(caption, head, body);
    const summary = node('p', 'backup-note', `${preview.newRows} registros novos e ${preview.identicalRows} registros idênticos. Os totais incluem histórico e vínculos, além dos conteúdos.`);
    const choices = node('fieldset', 'backup-modes');
    choices.append(node('legend', '', 'Como restaurar'));
    const mergeLabel = node('label', 'backup-choice');
    const mergeCopy = node('span');
    mergeCopy.append(node('strong', '', 'Adicionar sem sobrescrever'), node('small', '', 'Mantém os dados locais e ignora registros idênticos. Se houver conflito de identificador ou nome, a operação inteira é bloqueada.'));
    mergeLabel.append(this.merge, mergeCopy);
    const replaceLabel = node('label', 'backup-choice');
    const replaceCopy = node('span');
    replaceCopy.append(node('strong', '', 'Substituir a base local'), node('small', '', 'Recupera a fotografia exata do arquivo. Dados existentes que não estão nele serão removidos.'));
    replaceLabel.append(this.replace, replaceCopy);
    choices.append(mergeLabel, replaceLabel);
    const conflictCount = preview.conflicts.reduce((sum, entry) => sum + entry.count, 0);
    this.conflictNotice.textContent = conflictCount ? `${conflictCount} conflitos encontrados. Adicionar sem sobrescrever está bloqueado. Você pode manter a biblioteca atual ou substituir a base inteira pela cópia do arquivo, após confirmar.` : 'Nenhum conflito encontrado. Registros idênticos não serão duplicados.';
    this.conflictNotice.dataset.testid = 'backup-conflicts';
    const replacementIntro = node('p', '', `A substituição removerá os dados desta base local (${preview.currentCounts.knowledge_items} conteúdos e ${preview.currentCounts.categories} categorias) e colocará os dados do arquivo no lugar. Exporte o backup JSON acima antes de continuar para preservar a versão atual.`);
    const confirmLabel = node('label', 'backup-choice');
    confirmLabel.append(this.replaceConfirm, node('span', '', 'Entendo que todos os dados locais serão substituídos pelos dados deste arquivo.'));
    this.replacement.replaceChildren(replacementIntro, confirmLabel, field('backup-confirm-text', 'Digite RESTAURAR para confirmar', this.confirmText));
    this.previewTarget.replaceChildren(heading, details, table, summary, this.conflictNotice, choices, this.replacement, this.restoreButton);
    this.previewTarget.hidden = false;
    this.updateControls();
    requestAnimationFrame(() => heading.focus());
  }

  private updateControls(): void {
    this.element.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach((control) => {
      control.disabled = this.busy || !this.databaseOpen;
    });
    const back = this.element.querySelector<HTMLButtonElement>('#backup-back');
    if (back) back.disabled = this.busy;
    this.inspectButton.disabled = this.busy || !this.databaseOpen || !this.file.files?.length;
    this.replacement.hidden = !this.replace.checked;
    this.restoreButton.disabled = this.busy || !this.databaseOpen || !this.preview ||
      (this.replace.checked ? !this.replaceConfirm.checked || this.confirmText.value !== 'RESTAURAR' : this.preview.conflicts.length > 0);
  }
}
