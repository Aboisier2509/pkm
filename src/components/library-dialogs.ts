import { CATEGORY_PRESETS } from '../models/category-presets';
import type { CreateCategoryInput, CreateSubcategoryInput } from '../models/library';
import { button, field, node, option, setNotice } from './library-dom';

interface DialogOptions<T> {
  kind: 'category' | 'subcategory';
  categoryId?: string;
  onSave(input: T): Promise<void>;
  onError(error: unknown): string;
}

export function openLibraryDialog(options: DialogOptions<CreateCategoryInput> | DialogOptions<CreateSubcategoryInput>): void {
  const category = options.kind === 'category';
  const dialog = node('dialog', 'library-dialog');
  dialog.id = `${options.kind}-dialog`;
  dialog.dataset.testid = dialog.id;
  const form = node('form', 'library-dialog-form');
  const heading = node('h2', '', category ? 'Criar categoria' : 'Criar subcategoria');
  heading.id = `${options.kind}-dialog-title`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const description = node('p', 'library-dialog-description', category
    ? 'Escolha um nome e, se quiser, um modelo para os campos específicos.'
    : 'A subcategoria ficará dentro da categoria selecionada no conteúdo.');
  const name = node('input', 'library-input');
  name.type = 'text';
  name.required = true;
  name.autocomplete = 'off';
  const notes = node('textarea', 'library-input');
  notes.rows = 3;
  form.append(heading, description, field(`${options.kind}-name`, category ? 'Nome da categoria' : 'Nome da subcategoria', name));
  form.append(field(`${options.kind}-description`, category ? 'Descrição da categoria' : 'Descrição da subcategoria', notes));
  const preset = node('select', 'library-input');
  preset.append(option('Sem campos adicionais', ''));
  if (category) {
    for (const template of CATEGORY_PRESETS) preset.append(option(template.name, template.key));
    form.append(field('category-preset', 'Modelo de campos', preset));
  }
  form.append(node('p', 'library-hint', `${category ? 'Categorias criadas ficam' : 'Subcategorias criadas ficam'} disponíveis mesmo se você cancelar o conteúdo.`));
  const error = node('div', 'notice notice-error');
  error.hidden = true;
  error.setAttribute('role', 'alert');
  error.dataset.testid = `${options.kind}-dialog-error`;
  const actions = node('div', 'library-dialog-actions');
  const cancel = button('Cancelar');
  const save = button(category ? 'Criar categoria' : 'Criar subcategoria', 'button button-primary');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(error, actions);
  dialog.append(form);
  document.body.append(dialog);
  let busy = false;
  const trackChanges = (): void => {
    dialog.dataset.dirty = String(!!name.value || !!notes.value || !!preset.value);
  };
  form.addEventListener('input', trackChanges);
  form.addEventListener('change', trackChanges);
  const opener = document.activeElement;
  const finish = (): void => {
    dialog.close();
    dialog.remove();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
  cancel.addEventListener('click', () => { if (!busy) finish(); });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!busy) finish();
  });
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    [name, notes, preset, cancel, save].forEach((control) => { control.disabled = true; });
    setNotice(error, '');
    const input = category
      ? { name: name.value, description: notes.value, presetKey: preset.value || null }
      : { category_id: options.categoryId!, name: name.value, description: notes.value };
    void (options.onSave as (value: typeof input) => Promise<void>)(input).then(finish).catch((failure: unknown) => {
      setNotice(error, options.onError(failure));
      error.tabIndex = -1;
      error.focus();
    }).finally(() => {
      busy = false;
      [name, notes, preset, cancel, save].forEach((control) => { control.disabled = false; });
    });
  });
  dialog.showModal();
  name.focus();
}
