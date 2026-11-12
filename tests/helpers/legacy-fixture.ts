import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { BrowserContext, Page } from '@playwright/test';

interface Fixture {
  entry: string;
  files: Map<string, { body: string | Uint8Array; contentType: string }>;
}

let built: Promise<Fixture> | undefined;

async function fixture(): Promise<Fixture> {
  const result = await build({
    configFile: false,
    publicDir: false,
    base: './',
    logLevel: 'silent',
    worker: { format: 'es' },
    build: {
      write: false,
      outDir: '.test-fixture-output',
      assetsInlineLimit: 0,
      target: 'es2022',
      rolldownOptions: {
        input: fileURLToPath(new URL('../fixtures/legacy.worker.ts', import.meta.url)),
        output: { entryFileNames: 'legacy-worker.js', assetFileNames: 'assets/[name]-[hash][extname]' },
      },
    },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('O build da fixture não produziu os arquivos esperados.');
  const files: Fixture['files'] = new Map();
  for (const output of result.output) {
    files.set(output.fileName, {
      body: output.type === 'chunk' ? output.code : output.source,
      contentType: output.fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
    });
  }
  if (!files.has('legacy-worker.js')) throw new Error('Worker legado não encontrado na fixture.');
  return { entry: 'legacy-worker.js', files };
}

/** Build only in test memory. No legacy worker or SQL execution API ships to users. */
export async function prepareLegacyDatabase(page: Page, context: BrowserContext): Promise<void> {
  built ??= fixture();
  const legacy = await built;
  await context.route('**/_test/legacy/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/_test/legacy/', '');
    if (path === 'bootstrap.html') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Fixture de migração</title><body>Preparação de teste</body></html>' });
      return;
    }
    const output = legacy.files.get(path);
    if (!output) { await route.fulfill({ status: 404, body: 'Fixture não encontrada' }); return; }
    await route.fulfill({ contentType: output.contentType, body: typeof output.body === 'string' ? output.body : Buffer.from(output.body) });
  });
  await page.goto('/_test/legacy/bootstrap.html');
  const succeeded = await page.evaluate((entry) => new Promise<boolean>((resolve, reject) => {
    const worker = new Worker(`/_test/legacy/${entry}`, { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('A fixture legada não respondeu.')); }, 20_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean }>) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data.ok);
    };
    worker.onerror = () => { clearTimeout(timeout); worker.terminate(); reject(new Error('O worker legado falhou.')); };
    worker.postMessage({ operation: 'prepare' });
  }), legacy.entry);
  if (!succeeded) throw new Error('Não foi possível criar a base legada da Fase 1.');
}
