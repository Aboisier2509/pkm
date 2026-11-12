export interface PwaState {
  ready: boolean;
  updateAvailable: boolean;
  message: string;
  version: string;
}

export interface PwaController {
  checkForUpdate(): Promise<void>;
  /** The caller must close its database before this call, then reload on success. */
  applyUpdate(): Promise<void>;
}

interface WorkerStatus {
  type: 'STATUS';
  ready: boolean;
  version: string;
}

function requestStatus(worker: ServiceWorker): Promise<WorkerStatus> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error('O Service Worker não respondeu ao diagnóstico offline.'));
    }, 10_000);
    channel.port1.onmessage = (event: MessageEvent<WorkerStatus>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.type !== 'STATUS') {
        reject(new Error('Resposta inesperada do Service Worker.'));
        return;
      }
      resolve(event.data);
    };
    worker.postMessage({ type: 'STATUS' }, [channel.port2]);
  });
}

export async function registerPwa(onState: (state: PwaState) => void): Promise<PwaController> {
  let state: PwaState = {
    ready: false,
    updateAvailable: false,
    message: 'Preparando os arquivos para uso offline…',
    version: __APP_VERSION__,
  };
  function publish(patch: Partial<PwaState>): void {
    state = { ...state, ...patch };
    onState({ ...state });
  }
  const unavailable: PwaController = {
    async checkForUpdate() { throw new Error('Atualizações da PWA estão indisponíveis neste contexto.'); },
    async applyUpdate() { throw new Error('Nenhuma atualização da PWA está disponível.'); },
  };
  if (import.meta.env.DEV) {
    publish({ message: 'Modo de desenvolvimento: valide o offline com npm run build e npm run preview.' });
    return unavailable;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    publish({ message: 'Offline indisponível. Use HTTPS confiável ou localhost em navegador compatível.' });
    return unavailable;
  }
  publish({});
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  const workerUrl = new URL('sw.js', base).href;
  let registration: ServiceWorkerRegistration;
  try {
    // Reopening an installed application must not depend on fetching sw.js.
    // Reuse its local registration before attempting an initial registration.
    const existing = await navigator.serviceWorker.getRegistration(base.href);
    const existingWorker = existing?.active ?? existing?.waiting ?? existing?.installing;
    if (existing && existing.scope === base.href && existingWorker?.scriptURL === workerUrl) {
      registration = existing;
    } else {
      registration = await navigator.serviceWorker.register(workerUrl, {
        scope: base.pathname,
        updateViaCache: 'none',
      });
    }
  } catch {
    publish({ message: 'Não foi possível preparar o uso offline. Verifique a conexão e o armazenamento.' });
    return unavailable;
  }

  async function refresh(): Promise<void> {
    const controlled = navigator.serviceWorker.controller;
    const updateAvailable = !!registration.waiting;
    if (!controlled || controlled.scriptURL !== workerUrl) {
      publish({ ready: false, updateAvailable, message: 'Preparando o cache e o controle da página para uso offline…' });
      return;
    }
    try {
      const status = await requestStatus(controlled);
      publish({
        ready: status.ready,
        updateAvailable,
        version: status.version,
        message: status.ready
          ? 'Arquivos preparados. Pronto para abrir e usar sem internet.'
          : 'Cache incompleto. Reconecte e verifique as atualizações antes de testar offline.',
      });
    } catch {
      publish({ ready: false, updateAvailable, message: 'Não foi possível confirmar se os arquivos offline estão completos.' });
    }
  }

  function watch(worker: ServiceWorker | null): void {
    if (!worker) return;
    let hasActivated = worker.state === 'activated';
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') hasActivated = true;
      if (worker.state === 'installed' || worker.state === 'activated') void refresh();
      if (worker.state === 'redundant' && !hasActivated) {
        publish({ message: 'O preparo ou a atualização offline falhou. Verifique conexão e espaço disponível.' });
      }
    });
  }
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));
  navigator.serviceWorker.addEventListener('controllerchange', () => { void refresh(); });
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
    if (event.data?.type === 'PKM_CACHE_READY') void refresh();
  });
  void navigator.serviceWorker.ready.then(() => refresh());
  await refresh();
  // Navigation normally triggers a soft update too. This best-effort check is
  // deliberately not awaited, so an offline launch never waits for the network.
  if (navigator.onLine && registration.active) void registration.update().catch(() => {});

  return {
    async checkForUpdate(): Promise<void> {
      await registration.update();
      await refresh();
    },
    async applyUpdate(): Promise<void> {
      const waiting = registration.waiting;
      if (!waiting) throw new Error('Nenhuma atualização está aguardando instalação.');
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', changed);
          reject(new Error('A atualização não pôde ser confirmada. Reabra o aplicativo para verificar.'));
        }, 15_000);
        function changed(): void {
          window.clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('controllerchange', changed);
          resolve();
        }
        navigator.serviceWorker.addEventListener('controllerchange', changed);
        waiting.postMessage({ type: 'ACTIVATE' });
      });
    },
  };
}
