import { KNOWLEDGE_STATUSES, type CategoryMetadataSchemaRecord, type JsonObject, type KnowledgeStatus } from '../models/knowledge';
import type { LibraryCatalog, LibraryItemDetail, LibrarySaveInput } from '../models/library';
import { KNOWLEDGE_LIMITS, KnowledgeValidationError, validateMetadata, validateSourceUrl } from '../services/knowledge-validation';
import { button, field, node, option, setNotice, STATUS_LABELS } from './library-dom';
import { LibraryMetadata, type MetadataDraft } from './library-metadata';
import { LibraryTokens } from './library-tokens';

interface EditorCallbacks {
  onSave(input: LibrarySaveInput): void;
  onCancel(): void;
  onChange(): void;
  onCreateCategory(): void;
  onCreateSubcategory(): void;
  onReload(): void;
}

type TextControl = HTMLInputElement | HTMLTextAreaElement;

const FIELD_LABELS: Record<string, string> = {
  title: 'Título', summary: 'Resumo', content: 'Conteúdo completo', source_url: 'URL original',
  source_platform: 'Plataforma de origem', source_author: 'Autor', personal_notes: 'Notas pessoais',
  category_id: 'Categoria', subcategory_id: 'Subcategoria', status: 'Status', favorite: 'Favorito',
};

export class LibraryEditor {
  readonly element = node('form', 'panel library-editor');
  private readonly controls = new Map<string, TextControl>();
  private readonly category = node('select', 'library-input');
  private readonly subcategory = node('select', 'library-input');
  private readonly status = node('select', 'library-input');
  private readonly favorite = node('input');
  private readonly metadataTarget = node('div', 'library-metadata-target');
  private readonly categoryHint = node('p', 'library-hint');
  private readonly error = node('div', 'notice notice-error');
  private readonly reload = button('Reabrir conteúdo');
  private readonly save: HTMLButtonElement;
  private readonly cancel = button('Cancelar');
  private readonly addCategory = button('Criar categoria', 'button button-text');
  private readonly addSubcategory = button('Criar subcategoria', 'button button-text');
  private readonly tags: LibraryTokens;
  private readonly schemas = new Map<string, CategoryMetadataSchemaRecord>();
  private readonly metadataDrafts = new Map<string, MetadataDraft>();
  private readonly subcategoryDrafts = new Map<string, string>();
  private metadata: LibraryMetadata | undefined;
  private currentCategory = '';
  private baseline = '';
  private busy = false;
  private databaseOpen = true;

  constructor(private catalog: LibraryCatalog, readonly detail: LibraryItemDetail | undefined, private readonly callbacks: EditorCallbacks) {
    this.element.dataset.testid = 'item-editor';
    this.element.id = 'item-editor';
    this.element.noValidate = true;
    for (const entry of catalog.categories) this.schemas.set(entry.category.id, entry.schema);
    if (detail) this.schemas.set(detail.item.category_id, detail.schema);
    const item = detail?.item;
    this.element.append(node('p', 'library-editor-intro', 'Título e categoria são obrigatórios. Os campos específicos indicam quando também precisam ser preenchidos.'));
    const general = node('div', 'library-form-grid');
    general.append(this.textField('title', 'Título', item?.title ?? '', true));
    const categoryField = field('item-category', 'Categoria', this.category);
    const subcategoryField = field('item-subcategory', 'Subcategoria', this.subcategory);
    categoryField.append(this.addCategory, this.categoryHint);
    subcategoryField.append(this.addSubcategory);
    this.category.required = true;
    general.append(categoryField, subcategoryField);
    general.append(this.textField('summary', 'Resumo', item?.summary ?? '', false, 3));
    const content = this.textField('content', 'Conteúdo completo', item?.content ?? '', false, 10);
    content.classList.add('library-content-field');
    general.append(content);
    this.element.append(general);
    this.tags = new LibraryTokens({ id: 'item-tags', label: 'Tags', mode: 'tags', values: detail?.tags.map((tag) => tag.name) ?? [], suggestions: catalog.tags.map((tag) => tag.name), onChange: () => this.changed() });
    this.element.append(this.tags.element, this.metadataTarget);

    const advanced = node('details', 'library-advanced');
    if (item?.source_url || item?.source_platform || item?.source_author || item?.personal_notes || item?.favorite || (item && item.status !== 'unread')) advanced.open = true;
    advanced.append(node('summary', '', 'Origem, estudo e notas pessoais'));
    const extra = node('div', 'library-form-grid');
    const url = this.textField('source_url', 'URL original', item?.source_url ?? '');
    this.controls.get('source_url')!.id = 'item-url';
    url.querySelector('label')!.htmlFor = 'item-url';
    (this.controls.get('source_url') as HTMLInputElement).type = 'url';
    extra.append(url);
    const platform = this.textField('source_platform', 'Plataforma de origem', item?.source_platform ?? '');
    this.controls.get('source_platform')!.id = 'item-platform';
    platform.querySelector('label')!.htmlFor = 'item-platform';
    const author = this.textField('source_author', 'Autor', item?.source_author ?? '');
    this.controls.get('source_author')!.id = 'item-author';
    author.querySelector('label')!.htmlFor = 'item-author';
    extra.append(platform, author);
    for (const value of KNOWLEDGE_STATUSES) this.status.append(option(STATUS_LABELS[value], value));
    this.status.value = item?.status ?? 'unread';
    extra.append(field('item-status', 'Status', this.status));
    this.favorite.type = 'checkbox';
    this.favorite.id = 'item-favorite';
    this.favorite.checked = item?.favorite ?? false;
    const favorite = node('label', 'library-checkbox');
    favorite.htmlFor = this.favorite.id;
    favorite.append(this.favorite, node('span', '', 'Favorito'));
    extra.append(favorite);
    const notes = this.textField('personal_notes', 'Notas pessoais', item?.personal_notes ?? '', false, 5);
    this.controls.get('personal_notes')!.id = 'item-notes';
    notes.querySelector('label')!.htmlFor = 'item-notes';
    extra.append(notes);
    advanced.append(extra);
    this.element.append(advanced);

    this.error.dataset.testid = 'editor-error';
    this.error.id = 'editor-error';
    this.error.hidden = true;
    this.error.setAttribute('role', 'alert');
    this.error.tabIndex = -1;
    this.reload.hidden = true;
    this.reload.dataset.testid = 'reload-conflict';
    this.reload.addEventListener('click', () => callbacks.onReload());
    this.element.append(this.error, this.reload);
    const actions = node('div', 'library-editor-actions');
    this.cancel.dataset.testid = 'cancel-edit';
    this.cancel.addEventListener('click', () => callbacks.onCancel());
    this.save = button(detail ? 'Salvar alterações' : 'Salvar conteúdo', 'button button-primary');
    this.save.type = 'submit';
    this.save.dataset.testid = 'save-item';
    actions.append(this.cancel, this.save);
    this.element.append(actions);
    this.refreshOptions(item?.category_id ?? '', item?.subcategory_id ?? '');
    this.loadMetadata();
    this.category.addEventListener('change', () => {
      this.rememberMetadata();
      if (this.currentCategory) this.subcategoryDrafts.set(this.currentCategory, this.subcategory.value);
      this.currentCategory = this.category.value;
      this.refreshSubcategories(this.subcategoryDrafts.get(this.currentCategory) ?? '');
      this.loadMetadata();
      this.changed();
    });
    this.addCategory.addEventListener('click', () => callbacks.onCreateCategory());
    this.addSubcategory.addEventListener('click', () => callbacks.onCreateSubcategory());
    this.element.addEventListener('input', () => this.changed());
    this.element.addEventListener('change', () => this.changed());
    this.element.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.busy || !this.databaseOpen) return;
      this.revealInvalidControls();
      if (!this.element.reportValidity()) return;
      try {
        const input = this.read();
        this.showError('');
        callbacks.onSave(input);
      } catch (error) { this.showError(this.errorMessage(error)); }
    });
    this.baseline = this.snapshot();
    this.updateControls();
  }

  get categoryId(): string { return this.category.value; }
  isDirty(): boolean { return this.snapshot() !== this.baseline; }
  markClean(): void { this.baseline = this.snapshot(); }
  focus(): void { this.controls.get('title')!.focus(); }

  showError(message: string, conflict = false): void {
    setNotice(this.error, message);
    this.reload.hidden = !conflict;
    if (message) this.error.focus();
  }

  errorMessage(error: unknown): string {
    if (error instanceof KnowledgeValidationError) {
      const path = error.path.replace(/^item\./u, '');
      const key = error.path.startsWith('metadata_json.') ? error.path.slice('metadata_json.'.length) : '';
      const label = FIELD_LABELS[path] ?? this.metadata?.schema.schema_json.fields.find((entry) => entry.key === key)?.label ?? 'Campos da categoria';
      return `${label}: ${error.message.slice(error.path.length + 2)}`;
    }
    return error instanceof Error ? error.message : 'Não foi possível validar os campos. Confira os dados informados.';
  }

  setBusy(busy: boolean, databaseOpen: boolean): void {
    this.busy = busy;
    this.databaseOpen = databaseOpen;
    this.element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('input, textarea, select, button').forEach((control) => { control.disabled = busy; });
    this.metadata?.setDisabled(busy);
    this.tags.setDisabled(busy);
    this.updateControls();
  }

  updateCatalog(catalog: LibraryCatalog, selectCategory?: string, selectSubcategory?: string): void {
    this.catalog = catalog;
    for (const entry of catalog.categories) if (!this.schemas.has(entry.category.id)) this.schemas.set(entry.category.id, entry.schema);
    this.rememberMetadata();
    if (this.currentCategory) this.subcategoryDrafts.set(this.currentCategory, this.subcategory.value);
    const category = selectCategory ?? this.category.value;
    const subcategory = selectSubcategory ?? (category === this.category.value ? this.subcategory.value : '');
    this.refreshOptions(category, subcategory);
    this.loadMetadata();
    this.updateControls();
    this.callbacks.onChange();
  }

  private textField(key: string, label: string, value: string, required = false, rows?: number): HTMLDivElement {
    const control = rows ? node('textarea', 'library-input') : node('input', 'library-input');
    if (control instanceof HTMLTextAreaElement) control.rows = rows!;
    else control.type = 'text';
    control.value = value;
    control.required = required;
    this.controls.set(key, control);
    const result = field(`item-${key}`, label, control, required ? 'Obrigatório' : undefined);
    if (rows || key === 'title') result.classList.add('library-full-width');
    return result;
  }

  private refreshOptions(categoryId: string, subcategoryId: string): void {
    this.category.replaceChildren(option('Selecione uma categoria', ''));
    for (const entry of this.catalog.categories) this.category.append(option(entry.category.name, entry.category.id));
    if (categoryId && !this.catalog.categories.some((entry) => entry.category.id === categoryId)) this.category.append(option('Categoria indisponível', categoryId));
    this.category.value = categoryId;
    this.currentCategory = categoryId;
    this.refreshSubcategories(subcategoryId);
    this.categoryHint.textContent = this.catalog.categories.length ? '' : 'Crie sua primeira categoria para organizar este conteúdo.';
  }

  private refreshSubcategories(selected: string): void {
    this.subcategory.replaceChildren(option('Sem subcategoria', ''));
    const entries = this.catalog.subcategories.filter((entry) => entry.category_id === this.category.value);
    for (const entry of entries) this.subcategory.append(option(entry.name, entry.id));
    this.subcategory.value = entries.some((entry) => entry.id === selected) ? selected : '';
    this.updateControls();
  }

  private rememberMetadata(): void {
    if (this.metadata) this.metadataDrafts.set(this.metadataKey(this.metadata.schema), this.metadata.capture());
  }

  private metadataKey(schema: CategoryMetadataSchemaRecord): string { return `${schema.category_id}:${schema.version}`; }

  private loadMetadata(): void {
    this.metadataTarget.replaceChildren();
    const schema = this.schemas.get(this.category.value);
    this.metadata = undefined;
    if (!schema) return;
    const original: JsonObject = this.detail?.item.category_id === schema.category_id && this.detail.item.metadata_schema_version === schema.version ? this.detail.item.metadata_json : {};
    this.metadata = new LibraryMetadata(schema, original, this.metadataDrafts.get(this.metadataKey(schema)), () => this.changed());
    this.metadataTarget.append(this.metadata.element);
    this.metadata.setDisabled(this.busy);
  }

  private snapshot(): string {
    this.rememberMetadata();
    const metadata = [...this.metadataDrafts].map(([key, entries]) => [key, Object.fromEntries(Object.entries(entries)
      .filter(([, entry]) => entry.present || (Array.isArray(entry.value) ? entry.value.length > 0 : entry.value !== '') || !!entry.pending)
      .map(([field, entry]) => [field, { value: entry.value, present: entry.present, pending: entry.pending ?? '' }]))] as const)
      .filter(([, entries]) => Object.keys(entries).length > 0);
    return JSON.stringify({ fields: Object.fromEntries([...this.controls].map(([key, control]) => [key, control.value])), category: this.category.value, subcategory: this.subcategory.value, status: this.status.value, favorite: this.favorite.checked, tags: this.tags.getValues(), pendingTag: this.tags.getPending(), metadata });
  }

  private read(): LibrarySaveInput {
    this.tags.commit();
    const schema = this.metadata?.schema;
    if (!schema || !this.category.value) throw new Error('Escolha uma categoria para o conteúdo.');
    const get = (key: string): string => this.controls.get(key)!.value;
    const limits: Record<string, number> = { title: KNOWLEDGE_LIMITS.title, summary: KNOWLEDGE_LIMITS.summary, content: KNOWLEDGE_LIMITS.content, source_platform: KNOWLEDGE_LIMITS.sourcePlatform, source_author: KNOWLEDGE_LIMITS.sourceAuthor, personal_notes: KNOWLEDGE_LIMITS.personalNotes };
    for (const [key, limit] of Object.entries(limits)) {
      let length = 0;
      for (const _character of get(key)) { length += 1; if (length > limit) throw new Error(`${FIELD_LABELS[key]}: use até ${new Intl.NumberFormat('pt-BR').format(limit)} caracteres.`); }
    }
    if (!get('title').trim()) throw new Error('Preencha o título do conteúdo.');
    let sourceUrl: string | null;
    try { sourceUrl = validateSourceUrl(this.optionalValue('source_url')); }
    catch { throw new Error('URL original: informe um endereço completo começando com http:// ou https://.'); }
    const metadata = validateMetadata(this.metadata!.read(), schema.schema_json);
    return {
      ...(this.detail ? { id: this.detail.item.id, expectedRevision: this.detail.item.revision } : {}),
      title: get('title'), category_id: this.category.value, subcategory_id: this.subcategory.value || null,
      summary: get('summary'), content: get('content'), source_url: sourceUrl,
      source_platform: this.optionalValue('source_platform'), source_author: this.optionalValue('source_author'),
      favorite: this.favorite.checked, status: this.status.value as KnowledgeStatus, personal_notes: get('personal_notes'),
      metadata_schema_version: schema.version, metadata_json: metadata, tag_names: this.tags.getValues(),
    };
  }

  private optionalValue(key: 'source_url' | 'source_platform' | 'source_author'): string | null {
    const value = this.controls.get(key)!.value;
    return value === '' && (this.detail?.item[key] === null || !this.detail) ? null : value;
  }

  private revealInvalidControls(): void {
    for (const control of this.element.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')) {
      if (!control.validity.valid) {
        const details = control.closest('details');
        if (details) details.open = true;
      }
    }
  }

  private changed(): void { this.callbacks.onChange(); }

  private updateControls(): void {
    if (!this.save) return;
    this.save.disabled = this.busy || !this.databaseOpen;
    this.save.textContent = this.busy ? 'Salvando…' : this.detail ? 'Salvar alterações' : 'Salvar conteúdo';
    this.cancel.disabled = this.busy;
    this.addCategory.disabled = this.busy || !this.databaseOpen;
    this.addSubcategory.disabled = this.busy || !this.databaseOpen || !this.category.value;
    this.subcategory.disabled = this.busy || !this.category.value;
    this.reload.disabled = this.busy || !this.databaseOpen;
  }
}
