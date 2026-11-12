import './styles/main.css';

const target = document.querySelector<HTMLDivElement>('#app')!;
const loading = document.createElement('p');
loading.className = 'bootstrap-note';
loading.textContent = 'Abrindo sua biblioteca local...';
target.replaceChildren(loading);

async function start(): Promise<void> {
  if (new URLSearchParams(location.search).get('view') === 'lab') {
    await import('./pages/laboratory');
  } else {
    const { mountLibrary } = await import('./pages/library');
    await mountLibrary();
  }
}

void start().catch(() => {
  const message = document.createElement('p');
  message.className = 'bootstrap-note';
  message.setAttribute('role', 'alert');
  message.textContent = 'N\u00e3o foi poss\u00edvel abrir o aplicativo. Confira se os arquivos offline foram preparados ou recarregue com conex\u00e3o.';
  const retry = document.createElement('button');
  retry.className = 'button button-primary';
  retry.textContent = 'Recarregar';
  retry.addEventListener('click', () => location.reload());
  target.replaceChildren(message, retry);
});
