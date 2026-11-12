import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('recusa OPFS indisponível e não habilita gravação em memória', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined });
  });
  await page.goto('/?view=lab');
  await expect(page.locator('#error-message')).toContainText('não disponibiliza os recursos necessários');
  await expect(page.getByRole('button', { name: 'Salvar no dispositivo' })).toBeDisabled();
  await expect(page.getByTestId('db-status')).toHaveText('Fechado');
});

test('rejeita texto vazio sem alterar os registros', async ({ page }) => {
  await page.goto('/?view=lab');
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
  await page.getByLabel('Conteúdo do registro').fill('  \n  ');
  await page.getByRole('button', { name: 'Salvar no dispositivo' }).click();
  await expect(page.locator('#error-message')).toHaveText('Digite um texto para gravar o registro.');
  await expect(page.getByTestId('record-count')).toHaveText('0');
  await expect(page.locator('#success-message')).toBeHidden();
});

test('falha de escrita OPFS simulada não produz sucesso nem perde dados anteriores', async ({ page }) => {
  await page.goto('/?view=lab');
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
  await page.getByLabel('Conteúdo do registro').fill('Este registro já está confirmado antes da falha.');
  await page.getByRole('button', { name: 'Salvar no dispositivo' }).click();
  await expect(page.locator('#success-message')).toContainText('gravado e confirmado');
  const worker = page.workers().find((item) => item.url().includes('sqlite.worker'));
  expect(worker).toBeTruthy();
  await worker!.evaluate(() => {
    const prototype = (globalThis as unknown as {
      FileSystemSyncAccessHandle: { prototype: { write: (...args: unknown[]) => number } };
    }).FileSystemSyncAccessHandle.prototype;
    const originalWrite = prototype.write;
    prototype.write = function () {
      prototype.write = originalWrite;
      throw new DOMException('Falta de espaço SIMULADA pelo teste.', 'QuotaExceededError');
    };
  });
  await page.getByLabel('Conteúdo do registro').fill('Esta gravação deve falhar de forma controlada.');
  await page.getByRole('button', { name: 'Salvar no dispositivo' }).click();
  await expect(page.locator('#error-message')).toContainText(/armazenamento local|espaço disponível/);
  await expect(page.locator('#success-message')).toBeHidden();
  await expect(page.getByTestId('db-status')).toHaveText('Fechado');
  await page.getByRole('button', { name: 'Abrir banco', exact: true }).click();
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
  await expect(page.getByTestId('record-count')).toHaveText('1');
  await expect(page.locator('.record-content')).toHaveText('Este registro já está confirmado antes da falha.');
  await page.getByRole('button', { name: 'Verificar integridade', exact: true }).click();
  await expect(page.locator('#integrity-result')).toContainText('Integridade: ok');
});

test('diagnóstico exporta evidências sem incluir o conteúdo dos registros', async ({ page }) => {
  await page.goto('/?view=lab');
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
  const content = 'Texto que não deve constar no diagnóstico público da PoC.';
  await page.getByLabel('Conteúdo do registro').fill(content);
  await page.getByRole('button', { name: 'Salvar no dispositivo' }).click();
  await expect(page.locator('#success-message')).toContainText('gravado e confirmado');
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar diagnóstico', exact: true }).click();
  const download = await pendingDownload;
  const raw = await readFile((await download.path())!, 'utf8');
  const report = JSON.parse(raw);
  expect(report.database.vfs).toBe('opfs-sahpool');
  expect(report.recordCount).toBe(1);
  expect(raw).not.toContain(content);
});

test.describe('bloqueio nativo OPFS sem Web Locks', () => {
  test.use({ serviceWorkers: 'block' });
  test('preserva o pool quando uma segunda inicialização falha', async ({ page, context }) => {
    await context.route('**/assets/sqlite.worker-*.js', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      await route.fulfill({
        response,
        body: `Object.defineProperty(navigator, 'locks', { value: undefined });\n${source}`,
      });
    });
    await page.goto('/?view=lab');
    await expect(page.getByTestId('db-status')).toHaveText('Conectado');
    await page.getByLabel('Conteúdo do registro').fill('O pool deve sobreviver à tentativa concorrente sem Web Locks.');
    await page.getByRole('button', { name: 'Salvar no dispositivo' }).click();
    await expect(page.locator('#success-message')).toContainText('gravado e confirmado');
    const second = await context.newPage();
    await second.goto('/?view=lab');
    await expect(second.locator('#error-message')).toBeVisible();
    await expect(second.getByRole('button', { name: 'Salvar no dispositivo' })).toBeDisabled();
    await page.getByRole('button', { name: 'Fechar banco', exact: true }).click();
    await second.getByRole('button', { name: 'Abrir banco', exact: true }).click();
    await expect(second.getByTestId('db-status')).toHaveText('Conectado');
    await expect(second.locator('.record-content')).toHaveText('O pool deve sobreviver à tentativa concorrente sem Web Locks.');
    await second.getByRole('button', { name: 'Verificar integridade', exact: true }).click();
    await expect(second.locator('#integrity-result')).toContainText('Integridade: ok');
  });
});
