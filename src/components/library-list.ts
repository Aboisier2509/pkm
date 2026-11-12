import type { LibraryItemSummary } from '../models/library';
import { button, node, STATUS_LABELS } from './library-dom';

export function renderLibraryList(items: readonly LibraryItemSummary[], onEdit: (id: string) => void): HTMLElement {
  if (!items.length) {
    const empty = node('div', 'panel library-empty');
    empty.append(node('span', 'library-empty-mark', '↳'), node('h2', '', 'Seu próximo conhecimento começa aqui.'), node('p', '', 'Salve um prompt, uma receita ou algo que você quer estudar. Crie suas categorias do seu jeito, enquanto cadastra o primeiro conteúdo.'));
    return empty;
  }
  const wrapper = node('div', 'library-collection');
  const count = node('p', 'library-count', `${new Intl.NumberFormat('pt-BR').format(items.length)} ${items.length === 1 ? 'conteúdo salvo' : 'conteúdos salvos'} neste navegador`);
  const list = node('ul', 'library-card-list');
  const formatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
  for (const item of items) {
    const card = node('li', 'panel library-card');
    card.dataset.testid = 'item-card';
    card.dataset.itemId = item.id;
    card.dataset.revision = String(item.revision);
    const category = node('p', 'library-card-category', item.subcategoryName ? `${item.categoryName} / ${item.subcategoryName}` : item.categoryName);
    const heading = node('div', 'library-card-heading');
    const title = node('h2', '', item.title);
    heading.append(title);
    if (item.favorite) {
      const favorite = node('span', 'library-card-favorite', '★');
      favorite.setAttribute('aria-label', 'Favorito');
      heading.append(favorite);
    }
    const preview = node('p', 'library-card-preview', item.summary || item.contentPreview || 'Sem resumo ou conteúdo adicional.');
    const tags = node('ul', 'library-card-tags');
    tags.setAttribute('aria-label', 'Tags');
    for (const name of item.tags) tags.append(node('li', '', name));
    const footer = node('div', 'library-card-footer');
    const metadata = node('div', 'library-card-meta');
    const status = node('span', 'library-status-label', STATUS_LABELS[item.status]);
    const date = node('time');
    date.dateTime = item.updated_at;
    date.textContent = `Atualizado em ${formatter.format(new Date(item.updated_at))}`;
    metadata.append(status, date);
    const edit = button('Editar', 'button button-secondary');
    edit.addEventListener('click', () => onEdit(item.id));
    footer.append(metadata, edit);
    card.append(category, heading, preview, tags, footer);
    list.append(card);
  }
  wrapper.append(count, list);
  return wrapper;
}

