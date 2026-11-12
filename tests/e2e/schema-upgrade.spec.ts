import { test, expect } from '@playwright/test';
import { prepareLegacyDatabase } from '../helpers/legacy-fixture';

test('migra a base OPFS da Fase 1 preservando o registro e reabre offline', async ({ page, context }) => {
  await prepareLegacyDatabase(page, context);
  await page.goto('/?view=lab');
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
  await expect(page.locator('#diag-schema')).toHaveText('v2 · 10 tabelas da biblioteca');
  await expect(page.locator('#diag-migrations')).toHaveText('2 registradas · chaves estrangeiras ativas');
  await expect(page.locator('.record-content')).toHaveText('Registro da Fase 1 — preservar café e 🌱.');
  await expect(page.locator('.record-id')).toHaveText('ab5705cf-f1d9-403d-9650-d8cd03c4c9e1');
  await expect(page.getByTestId('offline-status')).toHaveText('Pronto para uso offline');
  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto('/?view=lab');
  await expect(reopened.getByTestId('db-status')).toHaveText('Conectado');
  await expect(reopened.locator('#diag-schema')).toHaveText('v2 · 10 tabelas da biblioteca');
  await expect(reopened.getByTestId('record-count')).toHaveText('1');
  await expect(reopened.locator('.record-content')).toHaveText('Registro da Fase 1 — preservar café e 🌱.');
  await reopened.getByRole('button', { name: 'Verificar integridade', exact: true }).click();
  await expect(reopened.locator('#integrity-result')).toContainText('Integridade: ok');
});

test('falha de escrita simulada durante o upgrade não apaga a base legada', async ({ page, context }) => {
  await prepareLegacyDatabase(page, context);
  const pattern = '**/assets/sqlite.worker-*.js';
  await context.route(pattern, async (route) => {
    const response = await route.fetch();
    const prefix = `
      const prototype = FileSystemSyncAccessHandle.prototype;
      const originalWrite = prototype.write;
      prototype.write = function() {
        prototype.write = originalWrite;
        throw new DOMException('Falha de escrita SIMULADA no upgrade.', 'QuotaExceededError');
      };
    `;
    await route.fulfill({ response, body: prefix + await response.text() });
  });
  await page.goto('/?view=lab');
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.getByTestId('db-status')).toHaveText('Fechado');
  await expect(page.locator('#success-message')).toBeHidden();
  await context.unroute(pattern);
  await page.getByRole('button', { name: 'Abrir banco', exact: true }).click();
  await expect(page.getByTestId('db-status')).toHaveText('Conectado');
  await expect(page.locator('#diag-schema')).toHaveText('v2 · 10 tabelas da biblioteca');
  await expect(page.getByTestId('record-count')).toHaveText('1');
  await expect(page.locator('.record-content')).toHaveText('Registro da Fase 1 — preservar café e 🌱.');
});
