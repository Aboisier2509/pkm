import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { initQuietSqlite } from '../helpers/sqlite';

const TITLE = 'Receita que merece uma cópia 🌿';
const CONTENT = 'Corte os tomates. Acrescente manjericão e uma pitada de sal.';
const UPDATED = `${CONTENT}\nRevisão: servir com azeite e pão.`;

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('new-content')).toBeEnabled();
}

function card(page: Page) { return page.getByTestId('item-card').filter({ hasText: TITLE }); }

async function createRecipe(page: Page, withHistory = false): Promise<string> {
  await page.getByTestId('new-content').click();
  await page.getByRole('button', { name: 'Criar categoria', exact: true }).click();
  const dialog = page.getByTestId('category-dialog');
  await dialog.getByLabel('Nome da categoria', { exact: true }).fill('Receitas para guardar');
  await dialog.getByLabel('Modelo de campos', { exact: true }).selectOption('recipes');
  await dialog.getByRole('button', { name: 'Criar categoria', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Criar subcategoria', exact: true }).click();
  const subcategory = page.getByRole('dialog');
  await subcategory.getByLabel('Nome da subcategoria', { exact: true }).fill('Almoço');
  await subcategory.getByRole('button', { name: 'Criar subcategoria', exact: true }).click();
  await expect(subcategory).toBeHidden();
  await page.locator('#item-title').fill(TITLE);
  await page.locator('#item-summary').fill('Receita simples, com acentos e 🌿.');
  await page.locator('#item-content').fill(CONTENT);
  await page.locator('#item-tags').fill('prático');
  await page.locator('#item-tags').press('Enter');
  await page.locator('#metadata-ingredients').fill('tomate');
  await page.locator('#metadata-ingredients').press('Enter');
  await page.locator('#metadata-time_minutes').fill('15');
  await page.getByText('Origem, estudo e notas pessoais', { exact: true }).click();
  await page.locator('#item-url').fill('https://example.com/receita');
  await page.locator('#item-notes').fill('Preparar novamente no sábado.');
  await page.locator('#item-favorite').check();
  await page.getByRole('button', { name: 'Salvar conteúdo', exact: true }).click();
  await expect(card(page)).toBeVisible();
  const id = await card(page).getAttribute('data-item-id');
  expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  if (withHistory) await updateRecipe(page, UPDATED);
  return id!;
}

async function updateRecipe(page: Page, content: string): Promise<void> {
  await card(page).getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByTestId('item-editor')).toBeVisible();
  await page.locator('#item-content').fill(content);
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(card(page)).toBeVisible();
}

async function openBackup(page: Page): Promise<void> {
  await page.getByTestId('backup-open').click();
  await expect(page.getByTestId('backup-panel')).toBeVisible();
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(await download.failure()).toBeNull();
  return readFile(path!);
}

async function exportJson(page: Page): Promise<string> {
  const pending = page.waitForEvent('download');
  await page.locator('#backup-export-json').click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/u);
  return (await downloadBytes(download)).toString('utf8');
}

async function inspect(page: Page, text: string): Promise<void> {
  await page.locator('#backup-file').setInputFiles({ name: 'copia-pessoal.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.locator('#backup-inspect').click();
  await expect(page.getByTestId('backup-preview')).toBeVisible();
}

async function confirmReplace(page: Page): Promise<void> {
  await page.locator('#backup-mode-replace').check();
  await page.locator('#backup-replace-confirm').check();
  await page.locator('#backup-confirm-text').fill('RESTAURAR');
  await expect(page.locator('#backup-restore')).toBeEnabled();
}

test('JSON restaura em outro navegador isolado com UUID, revisão, tags, metadados e histórico; repetir não duplica', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await openLibrary(page);
  const id = await createRecipe(page, true);
  await openBackup(page);
  const original = await exportJson(page);
  const source = JSON.parse(original) as { tables: Record<string, unknown[]>; changeLogSequence: number };
  expect(source.tables.knowledge_items).toHaveLength(1);
  expect(source.tables.item_revisions).toHaveLength(2);
  expect(source.tables.change_log.length).toBeGreaterThanOrEqual(5);
  const destination = await browser.newContext({ baseURL: 'http://localhost:4183', acceptDownloads: true });
  try {
    const restored = await destination.newPage();
    await openLibrary(restored);
    await expect(restored.getByTestId('item-card')).toHaveCount(0);
    await openBackup(restored);
    await inspect(restored, original);
    await restored.screenshot({ path: testInfo.outputPath('desktop-backup-preview.png'), fullPage: true });
    await expect(restored.locator('#backup-mode-merge')).toBeChecked();
    await restored.locator('#backup-restore').click();
    await expect(card(restored)).toHaveAttribute('data-item-id', id);
    await expect(card(restored)).toHaveAttribute('data-revision', '2');
    await card(restored).getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(restored.locator('#item-content')).toHaveValue(UPDATED);
    await expect(restored.locator('#item-subcategory option:checked')).toHaveText('Almoço');
    await expect(restored.locator('#item-tags-tokens')).toContainText('prático');
    await expect(restored.locator('#metadata-ingredients-tokens')).toContainText('tomate');
    await expect(restored.locator('#metadata-time_minutes')).toHaveValue('15');
    await expect(restored.locator('#item-notes')).toHaveValue('Preparar novamente no sábado.');
    await expect(restored.locator('#item-favorite')).toBeChecked();
    await restored.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await openBackup(restored);
    const roundTrip = JSON.parse(await exportJson(restored)) as { tables: Record<string, unknown[]>; changeLogSequence: number };
    expect(roundTrip.tables).toEqual(source.tables);
    expect(roundTrip.changeLogSequence).toBe(source.changeLogSequence);
    await inspect(restored, original);
    await restored.locator('#backup-restore').click();
    await expect(restored.getByTestId('item-card')).toHaveCount(1);
    await expect(card(restored)).toHaveAttribute('data-revision', '2');
    await restored.close();
    const reopened = await destination.newPage();
    await openLibrary(reopened);
    await expect(card(reopened)).toHaveAttribute('data-item-id', id);
  } finally { await destination.close(); }
});

test('arquivo inválido ou alterado é recusado sem modificar a biblioteca', async ({ page }) => {
  await openLibrary(page);
  const id = await createRecipe(page);
  await openBackup(page);
  const original = await exportJson(page);
  const changed = original.replace(CONTENT, 'Texto adulterado que não corresponde ao checksum.');
  expect(changed).not.toBe(original);
  for (const text of ['{"format":"outro-aplicativo"}', changed, '{json incompleto']) {
    await page.locator('#backup-file').setInputFiles({ name: '<img src=x>.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.locator('#backup-inspect').click();
    await expect(page.getByTestId('backup-error')).toBeVisible();
    await expect(page.locator('#backup-restore')).toBeHidden();
    expect(await page.evaluate(() => document.querySelectorAll('[data-testid="backup-panel"] img, [data-testid="backup-panel"] script').length)).toBe(0);
  }
  await page.locator('#backup-back').click();
  await expect(card(page)).toHaveAttribute('data-item-id', id);
  await expect(card(page)).toHaveAttribute('data-revision', '1');
  await card(page).getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.locator('#item-content')).toHaveValue(CONTENT);
});

test('conflitos bloqueiam adição; substituir exige confirmação explícita e recupera a versão do arquivo', async ({ page }) => {
  await openLibrary(page);
  const id = await createRecipe(page);
  await openBackup(page);
  const original = await exportJson(page);
  await page.locator('#backup-back').click();
  await updateRecipe(page, UPDATED);
  await expect(card(page)).toHaveAttribute('data-revision', '2');
  await openBackup(page);
  await inspect(page, original);
  await expect(page.getByTestId('backup-preview')).toContainText(/conflito/iu);
  await expect(page.locator('#backup-restore')).toBeDisabled();
  await page.locator('#backup-mode-replace').check();
  await expect(page.locator('#backup-restore')).toBeDisabled();
  await page.locator('#backup-replace-confirm').check();
  await page.locator('#backup-confirm-text').fill('restaurar');
  await expect(page.locator('#backup-restore')).toBeDisabled();
  await page.locator('#backup-confirm-text').fill('RESTAURAR');
  await page.locator('#backup-restore').click();
  await expect(card(page)).toHaveAttribute('data-item-id', id);
  await expect(card(page)).toHaveAttribute('data-revision', '1');
  await card(page).getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.locator('#item-content')).toHaveValue(CONTENT);
});

test('exporta e restaura sem internet após reabrir a aplicação offline', async ({ page, context }) => {
  await openLibrary(page);
  await expect(page.getByTestId('offline-status')).toHaveText('Pronto para uso offline');
  const id = await createRecipe(page);
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  await openLibrary(offline);
  await openBackup(offline);
  const original = await exportJson(offline);
  await offline.locator('#backup-back').click();
  await updateRecipe(offline, UPDATED);
  await openBackup(offline);
  await inspect(offline, original);
  await confirmReplace(offline);
  await offline.locator('#backup-restore').click();
  await expect(card(offline)).toHaveAttribute('data-item-id', id);
  await expect(card(offline)).toHaveAttribute('data-revision', '1');
});

test('exporta SQLite portátil que reabre com integridade, relacionamentos e histórico', async ({ page }) => {
  await openLibrary(page);
  const id = await createRecipe(page, true);
  await openBackup(page);
  const pending = page.waitForEvent('download');
  await page.locator('#backup-export-sqlite').click();
  const download = await pending;
  const bytes = await downloadBytes(download);
  expect(download.suggestedFilename()).toMatch(/\.sqlite3$/u);
  expect(bytes.subarray(0, 16).toString('utf8')).toBe('SQLite format 3\u0000');
  const sqlite = await initQuietSqlite();
  const db = new sqlite.oo1.DB(':memory:', 'c');
  const memory = sqlite.wasm.allocFromTypedArray(new Uint8Array(bytes));
  let owned = true;
  try {
    const rc = sqlite.capi.sqlite3_deserialize(db, 'main', memory, bytes.length, bytes.length,
      sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_READONLY);
    expect(rc).toBe(sqlite.capi.SQLITE_OK);
    owned = false;
    expect(db.selectValue('PRAGMA integrity_check')).toBe('ok');
    expect(db.selectObjects('PRAGMA foreign_key_check')).toEqual([]);
    expect(db.selectValue('SELECT content FROM knowledge_items WHERE id=?', [id])).toBe(UPDATED);
    expect(db.selectValue('SELECT count(*) FROM item_revisions WHERE item_id=?', [id])).toBe(2);
    expect(db.selectValue('SELECT count(*) FROM item_tags WHERE item_id=?', [id])).toBe(1);
    expect(db.selectValue('PRAGMA user_version')).toBe(2);
  } finally {
    if (owned) sqlite.wasm.dealloc(memory);
    db.close();
  }
});

test('falha de escrita durante restauração não confirma sucesso e preserva os registros anteriores', async ({ page }) => {
  await openLibrary(page);
  const id = await createRecipe(page);
  await openBackup(page);
  const original = await exportJson(page);
  await page.locator('#backup-back').click();
  await updateRecipe(page, UPDATED);
  await openBackup(page);
  await inspect(page, original);
  await confirmReplace(page);
  const worker = page.workers().find((candidate) => candidate.url().includes('sqlite.worker'));
  expect(worker).toBeTruthy();
  await worker!.evaluate(() => {
    const prototype = (globalThis as unknown as {
      FileSystemSyncAccessHandle: { prototype: { write: (...args: unknown[]) => number } };
    }).FileSystemSyncAccessHandle.prototype;
    const originalWrite = prototype.write;
    prototype.write = function () {
      prototype.write = originalWrite;
      throw new DOMException('Falha de escrita SIMULADA pelo teste.', 'QuotaExceededError');
    };
  });
  await page.locator('#backup-restore').click();
  await expect(page.getByTestId('backup-error')).toBeVisible();
  await expect(page.getByTestId('backup-panel')).toBeVisible();
  await expect(page.getByTestId('library-success')).toBeHidden();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.reload();
  await expect(page.getByTestId('new-content')).toBeEnabled();
  await expect(card(page)).toHaveAttribute('data-item-id', id);
  await expect(card(page)).toHaveAttribute('data-revision', '2');
  await card(page).getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.locator('#item-content')).toHaveValue(UPDATED);
});

test.describe('backup em tela pequena', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('controles são acessíveis por toque sem rolagem horizontal', async ({ page }, testInfo) => {
    await openLibrary(page);
    const open = page.getByTestId('backup-open');
    expect((await open.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await open.tap();
    await expect(page.getByTestId('backup-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const id of ['backup-export-json', 'backup-export-sqlite', 'backup-inspect', 'backup-back']) {
      expect((await page.locator(`#${id}`).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    const empty = await exportJson(page);
    await inspect(page, empty);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#backup-mode-replace').check();
    await expect(page.locator('#backup-confirm-text')).toBeVisible();
    expect((await page.locator('#backup-restore').boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath('mobile-backup.png'), fullPage: true });
  });
});
