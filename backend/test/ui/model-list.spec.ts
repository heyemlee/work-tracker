import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fakeKey = 'fake-key-browser-model-discovery';
const models = [
  {
    provider: 'openai',
    model: 'gpt-6.1-sol',
    label: 'gpt-6.1-sol',
    canParse: true,
    selectable: true,
    reason: '已核实解析方式和价格。',
  },
  {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    label: 'gpt-5.4-mini',
    canParse: true,
    selectable: true,
    reason: '已核实解析方式和价格。',
  },
  {
    provider: 'openai',
    model: 'future-text-model',
    label: 'future-text-model',
    canParse: false,
    selectable: true,
    reason: '兼容性与价格尚未核实；可保存选择，暂不发送简历。',
  },
  {
    provider: 'openai',
    model: 'text-embedding-3-small',
    label: 'text-embedding-3-small',
    canParse: false,
    selectable: false,
    reason: '其它任务型号。',
  },
];
test('fetches with an unsaved key, searches, preserves choice, saves and reloads the chosen model', async ({
  page,
}) => {
  let status = {
    enabled: false,
    provider: 'openai',
    model: 'gpt-5.4-mini',
    hasKey: false,
    configuredProviders: { openai: false, anthropic: false },
  };
  const lists: Record<string, unknown>[] = [],
    saves: Record<string, unknown>[] = [];
  await page.route('**/api/resumes/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/resumes/models', (route) => {
    lists.push(route.request().postDataJSON());
    return route.fulfill({ json: { source: 'account', provider: 'openai', models } });
  });
  await page.route('**/api/resumes/settings', (route) => {
    const body = route.request().postDataJSON();
    saves.push(body);
    status = {
      ...status,
      enabled: body.enabled,
      provider: body.provider,
      model: body.model,
      hasKey: true,
      configuredProviders: { openai: true, anthropic: false },
    };
    return route.fulfill({ json: status });
  });
  await page.goto('/resume-lab');
  await expect(page.getByRole('button', { name: '获取模型列表', exact: true })).toBeDisabled();
  await page.getByLabel('API Key', { exact: true }).fill(fakeKey);
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.locator('#model-list-status')).toContainText('已从账号获取 4 个模型');
  expect(lists).toEqual([{ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: fakeKey }]);
  expect(saves).toHaveLength(0);
  const model = page.getByLabel('模型', { exact: true });
  await expect(model).toHaveValue('gpt-5.4-mini');
  await expect(model.locator('option[value="text-embedding-3-small"]')).toBeDisabled();
  await page.getByRole('searchbox', { name: '搜索模型', exact: true }).fill('6.1');
  await expect(model.locator('option[value="future-text-model"]')).toHaveCount(0);
  await model.selectOption('gpt-6.1-sol');
  await page.getByRole('searchbox', { name: '搜索模型', exact: true }).fill('');
  await expect(model).toHaveValue('gpt-6.1-sol');
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.locator('#model-list-status')).toContainText('已从账号获取');
  await expect(model).toHaveValue('gpt-6.1-sol');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('配置已保存');
  expect(saves[0]).toMatchObject({ model: 'gpt-6.1-sol', apiKey: fakeKey });
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await page.reload();
  await page.locator('#model-settings > summary').click();
  await expect(model).toHaveValue('gpt-6.1-sol');
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.locator('#model-list-status')).toContainText('已从账号获取');
  expect(lists.at(-1)).toEqual({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' });
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
    fakeKey,
  );
});

test('can save an unverified account model but pauses parsing without a paid request', async ({ page }) => {
  let status: Record<string, unknown> = {
    enabled: false,
    provider: 'openai',
    model: 'gpt-5.4-mini',
    hasKey: false,
    configuredProviders: { openai: false, anthropic: false },
  };
  let parses = 0;
  await page.route('**/api/resumes/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/resumes/models', (route) =>
    route.fulfill({ json: { source: 'account', models } }),
  );
  await page.route('**/api/resumes/settings', (route) => {
    status = {
      enabled: true,
      provider: 'openai',
      model: 'future-text-model',
      hasKey: true,
      configuredProviders: { openai: true, anthropic: false },
      modelPolicy: models[2],
    };
    return route.fulfill({ json: status });
  });
  await page.route('**/api/resumes/parse', (route) => {
    parses++;
    return route.abort();
  });
  await page.goto('/resume-lab');
  await page.getByLabel('API Key', { exact: true }).fill(fakeKey);
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await page.getByLabel('模型', { exact: true }).selectOption('future-text-model');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('暂不发送简历');
  await page.reload();
  await page.locator('#model-settings > summary').click();
  await expect(page.getByLabel('模型', { exact: true })).toHaveValue('future-text-model');
  await page.getByLabel('选择文件', { exact: true }).setInputFiles({
    name: 'sample.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await readFile(new URL('../../evals/synthetic/sample.docx', import.meta.url)),
  });
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await expect(page.getByRole('button', { name: '解析资料', exact: true })).toBeDisabled();
  expect(parses).toBe(0);
});

test('handles permission errors, empty lists and switching providers without losing a typed key', async ({
  page,
}) => {
  let call = 0;
  await page.route('**/api/resumes/models', (route) =>
    ++call === 1
      ? route.fulfill({ status: 400, json: { message: '获取模型列表返回 403，请核对密钥及模型读取权限。' } })
      : route.fulfill({ json: { source: 'account', models: [] } }),
  );
  await page.goto('/resume-lab');
  await page.getByLabel('API Key', { exact: true }).fill(fakeKey);
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.locator('#model-list-status')).toContainText('403');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue(fakeKey);
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.locator('#model-list-status')).toContainText('账号未返回模型');
  await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
  await page.getByLabel('服务提供方', { exact: true }).selectOption('anthropic');
  await expect(page.getByRole('button', { name: '获取模型列表', exact: true })).toBeHidden();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
});
