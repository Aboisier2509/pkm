import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

async function opened(page: Page): Promise<void> {
  await page.goto('/?view=lab');
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
}

async function offlineReady(page: Page): Promise<void> {
  try {
    await expect(page.getByTestId('offline-status')).toHaveText('Pronto para uso offline');
  } catch (error) {
    await test.info().attach('offline-state.json', {
      contentType: 'application/json',
      body: JSON.stringify(await page.evaluate(async () => ({
        message: document.getElementById('pwa-message')?.textContent,
        registrations: await Promise.all((await navigator.serviceWorker.getRegistrations()).map(async (registration) => ({
          scope: registration.scope,
          active: registration.active?.state,
          waiting: registration.waiting?.state,
          installing: registration.installing?.state,
        }))),
        caches: await caches.keys(),
      }))),
    });
    throw error;
  }
}

async function save(page: Page, content: string): Promise<void> {
  await page.getByLabel('Conteúdo do registro').fill(content);
  await page.getByRole('button', { name: 'Salvar no dispositivo' }).click();
  await expect(page.locator('#success-message')).toContainText('gravado e confirmado no SQLite');
  await expect(page.locator('.record-content').filter({ hasText: content })).toHaveCount(1);
}

test('grava Unicode e SQL como texto, reabre a conexão e recarrega sem duplicar', async ({ page }) => {
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => logs.push(message.text()));
  await opened(page);
  await expect(page.locator('#diag-vfs')).toContainText('opfs-sahpool');
  await expect(page.locator('#diag-fts5')).toHaveText('Disponível · MATCH verificado');
  const content = `Ação e conhecimento 🌱\n'); DROP TABLE persistence_probe; --\n<img src=x onerror="window.__unsafe=true">`;
  await save(page, content);
  await page.getByRole('button', { name: 'Fechar e reabrir banco' }).click();
  await expect(page.locator('#success-message')).toContainText('recuperados do OPFS');
  await expect(page.locator('.record-content')).toHaveText(content);
  await page.reload();
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
  await expect(page.locator('.record-content')).toHaveText(content);
  await expect(page.getByTestId('record-count')).toHaveText('1');
  await expect(page.locator('#records img')).toHaveCount(0);
  expect(await page.evaluate(() => '__unsafe' in window)).toBe(false);
  expect(logs.join('\n')).not.toContain(content);
  expect(errors).toEqual([]);
});

test('confirma integridade e rollback sem alterar os registros', async ({ page }) => {
  await opened(page);
  await save(page, 'Um registro que deve sobreviver ao teste transacional.');
  await page.getByRole('button', { name: 'Testar rollback', exact: true }).click();
  await expect(page.locator('#rollback-result')).toContainText('Rollback: confirmado');
  await expect(page.getByTestId('record-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Verificar integridade', exact: true }).click();
  await expect(page.locator('#integrity-result')).toHaveText('Integridade: ok · PRAGMA integrity_check.');
});

test('abre uma nova página offline e grava novamente sem rede', async ({ page, context }) => {
  await opened(page);
  await offlineReady(page);
  await save(page, 'Gravado antes de desligar a rede.');
  await page.close();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await opened(offlinePage);
  await offlineReady(offlinePage);
  await expect(offlinePage.locator('.record-content')).toHaveText('Gravado antes de desligar a rede.');
  await save(offlinePage, 'Gravado offline — coração, ação e 🌎.');
  await offlinePage.close();
  const reopened = await context.newPage();
  await opened(reopened);
  await expect(reopened.getByTestId('record-count')).toHaveText('2');
  await expect(reopened.locator('.record-content')).toContainText(['Gravado offline — coração, ação e 🌎.', 'Gravado antes de desligar a rede.']);
});

test('preserva OPFS após encerrar o processo do navegador e iniciar offline', async ({}, testInfo) => {
  // Chromium's nested on-disk cache paths can exceed Windows path limits when
  // placed under Playwright's long, descriptive output directories.
  const profileRoot = resolve(tmpdir());
  const profile = await mkdtemp(join(profileRoot, 'pkm-poc-'));
  const options = { channel: testInfo.project.name === 'edge' ? 'msedge' : 'chrome', headless: true };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    const page = await context.newPage();
    await page.goto('http://localhost:4183/?view=lab');
    await expect(page.getByTestId('db-status')).toHaveText('Conectado');
    await offlineReady(page);
    await save(page, 'Persistência real entre processos do navegador 🧭.');
    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    await context.setOffline(true);
    const reopened = await context.newPage();
    await reopened.goto('http://localhost:4183/?view=lab');
    await expect(reopened.getByTestId('db-status')).toHaveText('Conectado');
    await expect(reopened.locator('.record-content')).toHaveText('Persistência real entre processos do navegador 🧭.');
    await offlineReady(reopened);
  } finally {
    await context.close();
    const resolvedProfile = resolve(profile);
    if (dirname(resolvedProfile) !== profileRoot || !resolvedProfile.startsWith(join(profileRoot, 'pkm-poc-'))) {
      throw new Error('O perfil de teste está fora da pasta temporária esperada.');
    }
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('bloqueia outra aba e libera a base ao fechar a conexão', async ({ page, context }) => {
  await opened(page);
  await save(page, 'O mesmo banco deve ser aberto pela segunda aba.');
  const second = await context.newPage();
  await second.goto('/?view=lab');
  await expect(second.locator('#error-message')).toContainText('outra aba ou janela');
  await expect(second.getByRole('button', { name: 'Salvar no dispositivo' })).toBeDisabled();
  await page.getByRole('button', { name: 'Fechar banco', exact: true }).click();
  await expect(page.getByTestId('db-status')).toHaveText('Fechado');
  await second.getByRole('button', { name: 'Abrir banco', exact: true }).click();
  await expect(second.getByTestId('db-status')).toHaveText('Conectado');
  await expect(second.locator('.record-content')).toHaveText('O mesmo banco deve ser aberto pela segunda aba.');
  await expect(second.getByTestId('record-count')).toHaveText('1');
});

test('não confirma offline quando falta um recurso essencial no cache', async ({ page }) => {
  await opened(page);
  await offlineReady(page);
  const removed = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (!name.startsWith('pkm-offline-shell:')) continue;
      const cache = await caches.open(name);
      const wasm = (await cache.keys()).find((request) => new URL(request.url).pathname.endsWith('.wasm'));
      if (wasm) return cache.delete(wasm);
    }
    return false;
  });
  expect(removed).toBe(true);
  await page.getByRole('button', { name: 'Verificar atualização', exact: true }).click();
  await expect(page.getByTestId('offline-status')).toHaveText('Não confirmado');
  await expect(page.locator('#pwa-message')).toContainText('Cache incompleto');
});

test('mantém a versão em espera até aplicar atualização e preserva o banco', async ({ page }) => {
  const workerPath = new URL('../../.test-dist/sw.js', import.meta.url);
  const original = await readFile(workerPath, 'utf8');
  const marker = `update-test-${Date.now()}`;
  try {
    await opened(page);
    await offlineReady(page);
    await save(page, 'A atualização dos arquivos não deve apagar o banco.');
    const before = await page.locator('#diag-version').innerText();
    const updated = original.replace(/const VERSION = "([^"]+)";/, `const VERSION = "$1-${marker}";`);
    expect(updated).not.toBe(original);
    await writeFile(workerPath, updated, 'utf8');
    await page.getByRole('button', { name: 'Verificar atualização', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Aplicar atualização', exact: true })).toBeVisible();
    await expect(page.locator('#diag-version')).toHaveText(before);
    await expect(page.getByTestId('db-status')).toHaveText('Conectado');
    await page.getByRole('button', { name: 'Aplicar atualização', exact: true }).click();
    await expect(page.locator('#diag-version')).toContainText(marker);
    await expect(page.getByTestId('db-status')).toHaveText('Conectado');
    await expect(page.locator('.record-content')).toHaveText('A atualização dos arquivos não deve apagar o banco.');
    await offlineReady(page);
  } finally { await writeFile(workerPath, original, 'utf8'); }
});

test('mantém o formulário acessível e sem rolagem horizontal em tela pequena', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await opened(page);
  await offlineReady(page);
  await save(page, 'Uma pequena ideia, guardada com cuidado. 🌱');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Laboratório de persistência.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Conteúdo do registro').focus();
  await expect(page.getByLabel('Conteúdo do registro')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});
