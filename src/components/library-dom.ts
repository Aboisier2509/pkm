export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function button(label: string, className = 'button button-secondary'): HTMLButtonElement {
  const element = node('button', className, label);
  element.type = 'button';
  return element;
}

export function field(
  id: string,
  label: string,
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  hint?: string,
): HTMLDivElement {
  const wrapper = node('div', 'library-field');
  const caption = node('label', '', label);
  caption.htmlFor = id;
  control.id = id;
  control.name = id;
  wrapper.append(caption, control);
  if (hint) {
    const description = node('p', 'library-hint', hint);
    description.id = `${id}-hint`;
    control.setAttribute('aria-describedby', description.id);
    wrapper.append(description);
  }
  return wrapper;
}

export function option(label: string, value: string): HTMLOptionElement {
  const element = node('option', '', label);
  element.value = value;
  return element;
}

export function setNotice(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = !message;
}

export const STATUS_LABELS = {
  unread: 'Não lido',
  reading: 'Em leitura',
  studying: 'Em estudo',
  completed: 'Concluído',
  archived: 'Arquivado',
} as const;

