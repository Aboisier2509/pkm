import { expect, test, type Page } from '@playwright/test';
import { CATEGORY_PRESETS } from '../../src/models/category-presets';

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sua biblioteca', level: 1 })).toBeVisible();
  await expect(page.getByTestId('new-content')).toBeEnabled();
}

async function startItem(page: Page): Promise<void> {
  await page.getByTestId('new-content').click();
  await expect(page.getByTestId('item-editor')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Novo conteúdo', level: 1 })).toBeVisible();
}

async function createCategory(page: Page, name: string, preset?: string): Promise<string> {
  await page.getByRole('button', { name: 'Criar categoria', exact: true }).click();
  const dialog = page.getByTestId('category-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nome da categoria', { exact: true }).fill(name);
  await dialog.getByLabel('Descrição da categoria', { exact: true }).fill(`Descrição de ${name}.`);
  if (preset) await dialog.getByLabel('Modelo de campos', { exact: true }).selectOption(preset);
  await dialog.getByRole('button', { name: 'Criar categoria', exact: true }).click();
  await expect(dialog).toBeHidden();
  const id = await page.locator('#item-category').inputValue();
  expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(page.locator('#item-category option:checked')).toHaveText(name);
  return id;
}

async function createSubcategory(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Criar subcategoria', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nome da subcategoria', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Criar subcategoria', exact: true }).click();
  await expect(dialog).toBeHidden();
  const id = await page.locator('#item-subcategory').inputValue();
  expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(page.locator('#item-subcategory option:checked')).toHaveText(name);
  return id;
}

async function addToken(page: Page, inputId: string, value: string): Promise<void> {
  await page.locator(`#${inputId}`).fill(value);
  await page.locator(`#${inputId}`).press('Enter');
}

function itemCard(page: Page, title: string) {
  return page.getByTestId('item-card').filter({ hasText: title });
}

async function saveItem(page: Page, title: string, editing = false): Promise<void> {
  await page.getByRole('button', { name: editing ? 'Salvar alterações' : 'Salvar conteúdo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sua biblioteca', level: 1 })).toBeVisible();
  await expect(itemCard(page, title)).toHaveCount(1);
  await expect(itemCard(page, title)).toBeVisible();
}

async function editItem(page: Page, title: string): Promise<void> {
  await itemCard(page, title).getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Editar conteúdo', level: 1 })).toBeVisible();
  await expect(page.getByTestId('item-editor')).toBeVisible();
}

test('cadastra os campos comuns, subcategoria, tags e metadados tipados no SQLite local', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openLibrary(page);
  await startItem(page);
  const categoryId = await createCategory(page, 'Receitas da família', 'recipes');
  const subcategoryId = await createSubcategory(page, 'Almoço');
  const title = 'Salada de tomate com manjericão 🌿';
  await page.locator('#item-title').fill(title);
  await page.locator('#item-summary').fill('Uma receita rápida para dias quentes.');
  await page.locator('#item-content').fill('Corte os tomates. Junte o manjericão e tempere.');
  await page.getByText('Origem, estudo e notas pessoais', { exact: true }).click();
  await page.locator('#item-url').fill('https://example.com/receitas/salada');
  await page.locator('#item-platform').fill('Blog culinário');
  await page.locator('#item-author').fill('Autora da receita');
  await page.locator('#item-status').selectOption('studying');
  await page.locator('#item-notes').fill('Experimentar com azeite da próxima vez.');
  await page.locator('#item-favorite').check();
  await addToken(page, 'item-tags', 'prático');
  await page.locator('#item-tags').fill('almoço');
  await page.getByRole('button', { name: 'Adicionar tag', exact: true }).click();
  await addToken(page, 'metadata-ingredients', 'tomate');
  await addToken(page, 'metadata-ingredients', 'manjericão');
  await addToken(page, 'metadata-quantities', '2 unidades');
  await addToken(page, 'metadata-quantities', '1 ramo');
  await page.locator('#metadata-time_minutes').fill('15');
  await page.locator('#metadata-yield').fill('2 porções');
  await page.screenshot({ path: testInfo.outputPath('desktop-editor.png'), fullPage: true });
  await saveItem(page, title);
  const id = await itemCard(page, title).getAttribute('data-item-id');
  expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(itemCard(page, title)).toHaveAttribute('data-revision', '1');
  await editItem(page, title);
  await expect(page.locator('#item-title')).toHaveValue(title);
  await expect(page.locator('#item-category')).toHaveValue(categoryId);
  await expect(page.locator('#item-subcategory')).toHaveValue(subcategoryId);
  await expect(page.locator('#item-summary')).toHaveValue('Uma receita rápida para dias quentes.');
  await expect(page.locator('#item-content')).toHaveValue('Corte os tomates. Junte o manjericão e tempere.');
  await expect(page.locator('#item-url')).toHaveValue('https://example.com/receitas/salada');
  await expect(page.locator('#item-platform')).toHaveValue('Blog culinário');
  await expect(page.locator('#item-author')).toHaveValue('Autora da receita');
  await expect(page.locator('#item-status')).toHaveValue('studying');
  await expect(page.locator('#item-notes')).toHaveValue('Experimentar com azeite da próxima vez.');
  await expect(page.locator('#item-favorite')).toBeChecked();
  await expect(page.locator('#metadata-time_minutes')).toHaveValue('15');
  await expect(page.locator('#metadata-yield')).toHaveValue('2 porções');
  for (const token of ['prático', 'almoço']) await expect(page.locator('#item-tags-tokens')).toContainText(token);
  for (const token of ['tomate', 'manjericão']) await expect(page.locator('#metadata-ingredients-tokens')).toContainText(token);
  for (const token of ['2 unidades', '1 ramo']) await expect(page.locator('#metadata-quantities-tokens')).toContainText(token);
});

test('editar preserva UUID, incrementa revisão e funciona após reabrir offline', async ({ page, context }) => {
  await openLibrary(page);
  await expect(page.getByTestId('offline-status')).toHaveText('Pronto para uso offline');
  await startItem(page);
  await createCategory(page, 'Estudos');
  await page.locator('#item-title').fill('Versão original');
  await page.locator('#item-content').fill('Conteúdo original — ação e 🧠.');
  await saveItem(page, 'Versão original');
  const id = await itemCard(page, 'Versão original').getAttribute('data-item-id');
  await editItem(page, 'Versão original');
  await page.locator('#item-title').fill('Versão atualizada');
  await page.locator('#item-content').fill('Conteúdo atualizado antes de desligar a rede.');
  await addToken(page, 'item-tags', 'revisado');
  await saveItem(page, 'Versão atualizada', true);
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await expect(itemCard(page, 'Versão atualizada')).toHaveAttribute('data-item-id', id!);
  await expect(itemCard(page, 'Versão atualizada')).toHaveAttribute('data-revision', '2');
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  await openLibrary(offline);
  await expect(offline.getByTestId('offline-status')).toHaveText('Pronto para uso offline');
  await expect(itemCard(offline, 'Versão atualizada')).toHaveAttribute('data-item-id', id!);
  await editItem(offline, 'Versão atualizada');
  await expect(offline.locator('#item-content')).toHaveValue('Conteúdo atualizado antes de desligar a rede.');
  await expect(offline.locator('#item-tags-tokens')).toContainText('revisado');
  await offline.locator('#item-content').fill('Esta alteração foi confirmada sem internet.');
  await saveItem(offline, 'Versão atualizada', true);
  await expect(itemCard(offline, 'Versão atualizada')).toHaveAttribute('data-revision', '3');
  await offline.close();
  const reopened = await context.newPage();
  await openLibrary(reopened);
  await expect(itemCard(reopened, 'Versão atualizada')).toHaveAttribute('data-item-id', id!);
  await editItem(reopened, 'Versão atualizada');
  await expect(reopened.locator('#item-content')).toHaveValue('Esta alteração foi confirmada sem internet.');
});

test('cancelar um rascunho exige confirmação e não cadastra um item', async ({ page }) => {
  await openLibrary(page);
  await startItem(page);
  await page.locator('#item-title').fill('Rascunho que será descartado');
  await page.locator('#item-content').fill('Nada disto deve virar um registro.');
  const firstDialog = page.waitForEvent('dialog');
  const firstClick = page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const keepDraft = await firstDialog;
  expect(keepDraft.type()).toBe('confirm');
  await keepDraft.dismiss();
  await firstClick;
  await expect(page.getByTestId('item-editor')).toBeVisible();
  await expect(page.locator('#item-title')).toHaveValue('Rascunho que será descartado');
  const secondDialog = page.waitForEvent('dialog');
  const secondClick = page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await (await secondDialog).accept();
  await secondClick;
  await expect(page.getByRole('heading', { name: 'Sua biblioteca', level: 1 })).toBeVisible();
  await expect(page.getByTestId('item-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('new-content')).toBeEnabled();
  await expect(page.getByTestId('item-card')).toHaveCount(0);
  await startItem(page);
  await expect(page.locator('#item-title')).toHaveValue('');
});

test('permite categoria própria, subcategoria e os quatro modelos de campos', async ({ page }) => {
  test.setTimeout(90_000);
  await openLibrary(page);
  await startItem(page);
  await createCategory(page, 'Projetos livres');
  await createSubcategory(page, 'Referências');
  await page.locator('#item-title').fill('Uma categoria definida por mim');
  await page.locator('#item-content').fill('Um conteúdo sem campos extras obrigatórios.');
  await saveItem(page, 'Uma categoria definida por mim');
  for (const preset of CATEGORY_PRESETS) {
    await startItem(page);
    await createCategory(page, `Modelo ${preset.name}`, preset.key);
    for (const field of preset.schema.fields) {
      await expect(page.locator(`#metadata-${field.key}`)).toBeVisible();
      await expect(page.getByLabel(field.label, { exact: true })).toBeVisible();
    }
    const title = `Registro de ${preset.name}`;
    await page.locator('#item-title').fill(title);
    await page.locator('#item-content').fill(`Conteúdo do modelo ${preset.name}.`);
    await saveItem(page, title);
  }
  await expect(page.getByTestId('item-card')).toHaveCount(5);
});

test('recusa URL insegura, mantém o rascunho e permite corrigir antes de salvar', async ({ page }) => {
  await openLibrary(page);
  await startItem(page);
  await createCategory(page, 'Referências');
  await page.locator('#item-title').fill('Referência que precisa de URL válida');
  await page.locator('#item-content').fill('Este texto deve sobreviver à validação.');
  await page.getByText('Origem, estudo e notas pessoais', { exact: true }).click();
  await page.locator('#item-url').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Salvar conteúdo', exact: true }).click();
  await expect(page.getByTestId('editor-error')).toContainText(/HTTP|HTTPS|URL/);
  await expect(page.getByTestId('item-editor')).toBeVisible();
  await expect(page.locator('#item-title')).toHaveValue('Referência que precisa de URL válida');
  await expect(page.locator('#item-content')).toHaveValue('Este texto deve sobreviver à validação.');
  await expect(page.locator('#item-url')).toHaveValue('javascript:alert(1)');
  await page.locator('#item-url').fill('https://example.com/referencia');
  await saveItem(page, 'Referência que precisa de URL válida');
  await expect(page.getByTestId('item-card')).toHaveCount(1);
});

test('HTML e SQL permanecem texto no cadastro, na listagem e na edição, sem vazar nos logs', async ({ page }) => {
  const logs: string[] = [];
  const errors: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  await openLibrary(page);
  await startItem(page);
  await createCategory(page, 'Segurança e exemplos');
  const title = '<img src=x onerror="window.__libraryUnsafe=true">';
  const content = `Texto literal: '); DROP TABLE knowledge_items; --\n<script>window.__libraryUnsafe=true</script>\nAção, café e 🔐.`;
  await page.locator('#item-title').fill(title);
  await page.locator('#item-summary').fill('<b>Resumo como texto</b>');
  await page.locator('#item-content').fill(content);
  await saveItem(page, title);
  await expect(page.getByTestId('library-list').locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => '__libraryUnsafe' in window)).toBe(false);
  await editItem(page, title);
  await expect(page.locator('#item-title')).toHaveValue(title);
  await expect(page.locator('#item-summary')).toHaveValue('<b>Resumo como texto</b>');
  await expect(page.locator('#item-content')).toHaveValue(content);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('new-content')).toBeEnabled();
  await expect(itemCard(page, title)).toHaveCount(1);
  expect(logs.join('\n')).not.toContain(title);
  expect(logs.join('\n')).not.toContain(content);
  expect(errors).toEqual([]);
});

test('falha OPFS simulada preserva o rascunho e não confirma um cadastro parcial', async ({ page }) => {
  await openLibrary(page);
  await startItem(page);
  const categoryId = await createCategory(page, 'Persistência');
  await page.locator('#item-title').fill('Registro já confirmado');
  await page.locator('#item-content').fill('Este registro deve sobreviver à falha simulada.');
  await saveItem(page, 'Registro já confirmado');
  await startItem(page);
  await page.locator('#item-category').selectOption(categoryId);
  await page.locator('#item-title').fill('Rascunho após falha simulada');
  await page.locator('#item-content').fill('O aplicativo não pode anunciar sucesso para esta tentativa.');
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
  await page.getByRole('button', { name: 'Salvar conteúdo', exact: true }).click();
  await expect(page.getByTestId('editor-error')).toContainText(/armazenamento|espaço|confirmar/);
  await expect(page.getByTestId('item-editor')).toBeVisible();
  await expect(page.locator('#item-title')).toHaveValue('Rascunho após falha simulada');
  await expect(page.locator('#item-content')).toHaveValue('O aplicativo não pode anunciar sucesso para esta tentativa.');
  await expect(page.getByRole('button', { name: 'Salvar conteúdo', exact: true })).toBeDisabled();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.reload();
  await expect(page.getByTestId('new-content')).toBeEnabled();
  await expect(page.getByTestId('item-card')).toHaveCount(1);
  await expect(itemCard(page, 'Registro já confirmado')).toBeVisible();
  await expect(itemCard(page, 'Rascunho após falha simulada')).toHaveCount(0);
});

test.describe('biblioteca em tela de celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('permite foco por toque e cadastro sem rolagem horizontal', async ({ page }, testInfo) => {
    await openLibrary(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId('new-content').tap();
    await expect(page.getByTestId('item-editor')).toBeVisible();
    await page.locator('#item-title').tap();
    await expect(page.locator('#item-title')).toBeFocused();
    await page.locator('#item-title').fill('Uma ideia capturada pelo celular');
    await createCategory(page, 'Ideias móveis');
    await page.locator('#item-content').fill('Captura rápida com toque, acentos e 📱.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const save = page.getByRole('button', { name: 'Salvar conteúdo', exact: true });
    const bounds = await save.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath('mobile-editor.png'), fullPage: true });
    await save.tap();
    await expect(itemCard(page, 'Uma ideia capturada pelo celular')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('mobile-library.png'), fullPage: true });
  });
});
