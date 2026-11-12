export interface StorageSnapshot {
  secureContext: boolean;
  opfsAvailable: boolean;
  persistence: 'granted' | 'not-granted' | 'unavailable';
  usage: number | null;
  quota: number | null;
}

export async function inspectStorage(requestPersistence = false): Promise<StorageSnapshot> {
  const storage = navigator.storage;
  let persistence: StorageSnapshot['persistence'] = 'unavailable';
  let usage: number | null = null;
  let quota: number | null = null;
  if (storage) {
    try {
      if (typeof storage.persisted === 'function') {
        let granted = await storage.persisted();
        if (!granted && requestPersistence && typeof storage.persist === 'function') {
          granted = await storage.persist();
        }
        persistence = granted ? 'granted' : 'not-granted';
      }
    } catch { /* The browser may restrict Storage API calls; database operations remain authoritative. */ }
    try {
      if (typeof storage.estimate === 'function') {
        const estimate = await storage.estimate();
        usage = estimate.usage ?? null;
        quota = estimate.quota ?? null;
      }
    } catch { /* Estimates are optional and do not determine whether a write succeeded. */ }
  }
  return {
    secureContext: window.isSecureContext,
    opfsAvailable: typeof storage?.getDirectory === 'function',
    persistence,
    usage,
    quota,
  };
}

export function formatBytes(value: number | null): string {
  if (value === null) return 'Não informado';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(amount)} ${units[index]}`;
}
