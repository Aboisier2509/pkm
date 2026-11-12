import { KnowledgeValidationError, normalizeName } from '../services/knowledge-validation';
import { button, field, node } from './library-dom';

interface TokenOptions {
  id: string;
  label: string;
  values: readonly string[];
  suggestions?: readonly string[];
  mode: 'tags' | 'text_list';
  onChange(): void;
}

/** Array entries remain complete strings; existing commas are never split. */
export class LibraryTokens {
  readonly element: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly list = node('ul', 'library-token-list');
  private readonly error = node('p', 'library-inline-error');
  private readonly add: HTMLButtonElement;
  private values: string[];
  private disabled = false;

  constructor(private readonly options: TokenOptions) {
    this.values = [...options.values];
    this.input = node('input', 'library-input');
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.placeholder = options.mode === 'tags' ? 'Ex.: programação' : 'Digite um item';
    this.element = field(options.id, options.label, this.input, options.mode === 'tags'
      ? 'Adicione uma tag por vez. Pressione Enter ou use o botão ao lado.'
      : 'Adicione um item por vez. Pressione Enter ou use o botão ao lado.');
    this.element.classList.add('library-token-field');
    this.add = button(options.mode === 'tags' ? 'Adicionar tag' : `Adicionar ${options.label.toLocaleLowerCase('pt-BR')}`);
    this.add.setAttribute('aria-controls', `${options.id}-tokens`);
    const row = node('div', 'library-token-entry');
    row.append(this.input, this.add);
    this.element.insertBefore(row, this.element.querySelector('.library-hint'));
    this.list.id = `${options.id}-tokens`;
    this.list.setAttribute('aria-label', options.mode === 'tags' ? 'Tags adicionadas' : `Itens de ${options.label}`);
    this.element.append(this.list, this.error);
    this.error.hidden = true;
    this.error.setAttribute('role', 'alert');
    this.add.addEventListener('click', () => { this.tryCommit(); this.input.focus(); });
    this.input.addEventListener('input', () => { this.clearError(); options.onChange(); });
    this.input.addEventListener('keydown', (event) => {
      if (event.isComposing || (event.key !== 'Enter' && !(options.mode === 'tags' && event.key === ','))) return;
      event.preventDefault();
      this.tryCommit();
    });
    if (options.suggestions?.length) {
      const datalist = node('datalist');
      datalist.id = `${options.id}-suggestions`;
      for (const name of options.suggestions) {
        const entry = node('option');
        entry.value = name;
        datalist.append(entry);
      }
      this.input.setAttribute('list', datalist.id);
      this.element.append(datalist);
    }
    this.render();
  }

  getValues(): string[] { return [...this.values]; }
  getPending(): string { return this.input.value; }

  setPending(value: string): void { this.input.value = value; }

  commit(): void {
    const raw = this.input.value;
    if (raw.trim().length === 0) return;
    let value = raw;
    if (this.options.mode === 'tags') {
      const normalized = normalizeName(raw);
      if (this.values.some((entry) => normalizeName(entry).name_key === normalized.name_key)) {
        this.input.value = '';
        this.options.onChange();
        return;
      }
      if (this.values.length >= 30) throw new Error('Use no máximo 30 tags por conteúdo.');
      value = normalized.name;
    } else {
      if (this.values.length >= 1_000) throw new Error('A lista pode conter no máximo 1.000 itens.');
      if ([...raw].length > 10_000 || raw.includes('\u0000')) throw new Error('Cada item deve ter até 10.000 caracteres válidos.');
    }
    this.values.push(value);
    this.input.value = '';
    this.clearError();
    this.render();
    this.options.onChange();
  }

  setDisabled(value: boolean): void {
    this.disabled = value;
    this.input.disabled = value;
    this.add.disabled = value;
    this.list.querySelectorAll<HTMLButtonElement>('button').forEach((control) => { control.disabled = value; });
  }

  private clearError(): void { this.error.hidden = true; this.error.textContent = ''; }

  private tryCommit(): void {
    try { this.commit(); } catch (error) {
      this.error.textContent = error instanceof KnowledgeValidationError
        ? `${this.options.label}: ${error.message.slice(error.path.length + 2)}`
        : error instanceof Error ? error.message : 'Não foi possível adicionar o item.';
      this.error.hidden = false;
    }
  }

  private render(): void {
    this.list.replaceChildren();
    this.values.forEach((value, index) => {
      const item = node('li', 'library-token');
      const caption = node('span', '', value);
      const remove = button('×', 'library-token-remove');
      remove.setAttribute('aria-label', `Remover ${value}`);
      remove.disabled = this.disabled;
      remove.addEventListener('click', () => {
        this.values.splice(index, 1);
        this.render();
        this.options.onChange();
        this.input.focus();
      });
      item.append(caption, remove);
      this.list.append(item);
    });
  }
}
