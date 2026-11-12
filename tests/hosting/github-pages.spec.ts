import { test, expect } from '@playwright/test';

test('serve em /pkm/ com manifest, WASM, SQLite OPFS e reabertura offline', async ({ page, context, request }) => {
  const escaped: string[] = [];
  const errors: string[] = [];
  context.on('request', (outgoing) => {
    const url = new URL(outgoing.url());
    if (url.origin === 'http://localhost:4184' && url.pathname !== '/pkm' && !url.pathname.startsWith('/pkm/')) {
      escaped.push(url.pathname);
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  context.on('page', (opened) => opened.on('pageerror', (error) => errors.push(error.message)));

  const redirect = await request.get('/pkm', { maxRedirects: 0 });
  expect(redirect.status()).toBe(308);
  expect(redirect.headers().location).toBe('/pkm/');
  // Assert that this fixture cannot accidentally hide absolute-path bugs.
  for (const path of ['/sw.js', '/manifest.webmanifest', '/assets/missing.js', '/pkm/missing.js']) {
    expect((await request.get(path)).status()).toBe(404);
  }
  await page.goto('/pkm');
  await expect(page).toHaveURL('http://localhost:4184/pkm/');
  await expect(page.getByTestId('db-status')).toHaveText('Biblioteca conectada');
  await expect(page.getByTestId('offline-status')).toHaveText('Pronto para uso offline');

  const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((element) => (element as HTMLLinkElement).href);
  expect(new URL(manifestUrl).pathname).toBe('/pkm/manifest.webmanifest');
  const manifestResponse = await request.get(manifestUrl);
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await manifestResponse.json() as { start_url: string; scope: string; icons: { src: string }[] };
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe('/pkm/');
  expect(new URL(manifest.scope, manifestUrl).pathname).toBe('/pkm/');
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, manifestUrl);
    expect(iconUrl.pathname.startsWith('/pkm/')).toBe(true);
    expect((await request.get(iconUrl.href)).ok()).toBe(true);
  }
  const offlineState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration(location.href);
    const entries: { url: string; contentType: string | null }[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('pkm-offline-shell:')) continue;
      const cache = await caches.open(name);
      for (const cached of await cache.keys()) {
        entries.push({ url: cached.url, contentType: (await cache.match(cached))?.headers.get('content-type') ?? null });
      }
    }
    return { scope: registration?.scope, controller: navigator.serviceWorker.controller?.scriptURL, entries };
  });
  expect(offlineState.scope).toBe('http://localhost:4184/pkm/');
  expect(offlineState.controller).toBe('http://localhost:4184/pkm/sw.js');
  expect(offlineState.entries.length).toBeGreaterThan(0);
  expect(offlineState.entries.every((entry) => new URL(entry.url).pathname.startsWith('/pkm/'))).toBe(true);
  expect(offlineState.entries.some((entry) => /\/assets\/sqlite\.worker-[^/]+\.js$/.test(new URL(entry.url).pathname))).toBe(true);
  const wasm = offlineState.entries.find((entry) => new URL(entry.url).pathname.endsWith('.wasm'));
  expect(wasm?.contentType).toBe('application/wasm');

  // Follow the real navigation flow so the library closes its OPFS handles.
  await page.getByRole('link', { name: 'Diagnóstico', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:4184/pkm/?view=lab');
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
  await expect(page.locator('#diag-vfs')).toContainText('opfs-sahpool');
  const content = `Hospedagem em subpasta: ação e conhecimento 🌱 ${crypto.randomUUID()}`;
  await page.getByLabel('Conteúdo do registro').fill(content);
  await page.getByRole('button', { name: 'Salvar no dispositivo' }).click();
  await expect(page.locator('#success-message')).toContainText('gravado e confirmado no SQLite');
  await expect(page.locator('.record-content')).toHaveText(content);
  const id = await page.locator('.record-id').innerText();
  await expect(page.getByTestId('offline-status')).toHaveText('Pronto para uso offline');
  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto('/pkm/?view=lab');
  await expect(reopened.getByTestId('db-status')).toHaveText('Conectado');
  await expect(reopened.getByTestId('offline-status')).toHaveText('Pronto para uso offline');
  await expect(reopened.locator('#diag-vfs')).toContainText('opfs-sahpool');
  await expect(reopened.locator('.record-content')).toHaveText(content);
  await expect(reopened.locator('.record-id')).toHaveText(id);
  await expect(reopened.getByTestId('record-count')).toHaveText('1');
  expect(escaped).toEqual([]);
  expect(errors).toEqual([]);
});
