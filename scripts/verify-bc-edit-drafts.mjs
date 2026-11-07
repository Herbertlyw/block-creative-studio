import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

await mkdir('outputs', { recursive: true });
const output = await mkdtemp(resolve('outputs/bc-edit-drafts-'));
const server = await createServer({
  cacheDir: join(output, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
    acceptDownloads: true,
  });
  let accept = false;
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/#bc`);
  await page.getByRole('button', { name: '打开落消示例' }).click();
  const ready = () =>
    page.waitForFunction(() => document.querySelector('canvas[data-ready="true"]'));
  const column = () => page.locator('.bc-actions form').first().locator('input[name="column"]');
  const applyAction = () =>
    page.locator('.bc-actions form').first().getByRole('button', { name: '应用' });
  const save = async (name) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /保存 JSON/ }).click();
    await (await download).saveAs(join(output, name));
    return JSON.parse(await readFile(join(output, name), 'utf8'));
  };
  await ready();
  assert.equal(await column().inputValue(), '4');
  await column().fill('5');
  await page.getByLabel('BC 颜色 1').fill('#df8470');
  await page.getByRole('button', { name: '应用配色' }).click();
  assert.equal(await column().inputValue(), '5', '取消丢弃应保留动作输入');
  accept = true;
  await page.getByRole('button', { name: '应用配色' }).click();
  await ready();
  await page.waitForFunction(
    () => document.querySelector('.bc-actions input[name="column"]')?.value === '4',
  );
  let saved = await save('after-colour.json');
  assert.equal(saved.takes[0].actions[0].action.release.x, 4);

  await column().fill('5');
  accept = false;
  await page.getByRole('button', { name: /保存 JSON/ }).click();
  assert.equal(await column().inputValue(), '5', '取消保存时必须保留动作输入');
  accept = true;
  saved = await save('after-discard-save.json');
  assert.equal(saved.takes[0].actions[0].action.release.x, 4);
  assert.equal(await column().inputValue(), '4', '确认保存后输入应恢复');

  await column().fill('5');
  accept = false;
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await column().inputValue(), '5', '取消撤销时必须保留动作输入');
  accept = true;
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.bc-actions input[name="column"]')?.value === '4',
  );

  await page.getByRole('button', { name: '生成合法路线' }).click();
  await ready();
  const select = page.getByLabel('BC Take');
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="BC Take"]').options.length === 2,
  );
  const firstTake = await select.inputValue();
  const nextTake =
    (await select.locator('option').nth(1).getAttribute('value')) ??
    (await select.locator('option').nth(1).textContent());
  await column().fill('5');
  accept = false;
  await select.selectOption(nextTake);
  assert.equal(await select.inputValue(), firstTake);
  assert.equal(await column().inputValue(), '5');
  accept = true;
  await select.selectOption(nextTake);
  await select.selectOption(firstTake);
  assert.equal(await column().inputValue(), '4', '切换 Take 后不应恢复已丢弃的草稿');

  const bound = await page.evaluate(async () => {
    const { createBCDemo } = await import('/src/games/block-crush/demo.ts');
    const { makeClearEffect } = await import(
      '/src/nativeReference/games/block-crush-drop/presentation/clearEffectLibrary.ts'
    );
    const project = createBCDemo();
    project.direction.style.clearEffectLibrary = {
      version: '1.0.0',
      effects: [makeClearEffect('first-clear', {})],
      bindings: [{ effectId: 'first-clear', takeId: 'demo', actionIndex: 0, cycleIndex: 0 }],
    };
    return project;
  });
  assert.equal(bound.direction.production.clips, undefined);
  await column().fill('5');
  accept = false;
  await page.locator('input[accept="application/json,.json"]').setInputFiles({
    name: 'bound.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bound)),
  });
  assert.equal(await column().inputValue(), '5', '取消导入时必须保留动作输入');
  accept = true;
  await page.locator('input[accept="application/json,.json"]').setInputFiles({
    name: 'bound.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bound)),
  });
  await ready();
  await page.waitForFunction(
    () => document.querySelector('.bc-actions input[name="column"]')?.value === '4',
  );
  await column().fill('5');
  await applyAction().click();
  await page.getByRole('alert').waitFor();
  assert.match(
    await page.getByRole('alert').textContent(),
    /first-clear.*demo.*第 1 步.*CLEAR_EFFECT_TARGET_HAS_NO_CLEAR/,
  );
  assert.equal(await column().inputValue(), '5', '失败的动作草稿必须保留');
  assert.equal(await page.locator('canvas').getAttribute('data-ready'), 'true');
  saved = await save('after-rejected-edit.json');
  assert.equal(saved.takes[0].actions[0].action.release.x, 4);
  assert.deepEqual(
    saved.direction.style.clearEffectLibrary,
    bound.direction.style.clearEffectLibrary,
  );
  assert.equal(await column().inputValue(), '4');
  await writeFile(join(output, 'result.json'), JSON.stringify({ dialogs, passed: true }, null, 2));
  console.log(`BC 事务与草稿回归通过：${output}`);
} finally {
  await browser?.close();
  await server.close();
}
