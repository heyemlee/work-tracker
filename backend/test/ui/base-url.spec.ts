import { expect, test } from '@playwright/test';

test('discovers and saves a gateway address, restores it, and requires a key when the address changes', async ({
  page,
}) => {
  const baseUrl = 'https://gateway.example/openai/v1';
  const fakeKey = 'fake-browser-gateway-key';
  let status = {
    enabled: false,
    provider: 'openai',
    model: 'gpt-5.4-mini',
    hasKey: false,
    configuredProviders: { openai: false, anthropic: false },
    openaiBaseUrl: 'https://api.openai.com/v1',
  };
  const lists: Record<string, unknown>[] = [],
    saves: Record<string, unknown>[] = [];
  let checks = 0,
    parses = 0;
  await page.route('**/api/resumes/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/resumes/models', (route) => {
    lists.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        baseUrl,
        models: [
          {
            provider: 'openai',
            model: 'gpt-5.4-mini',
            label: 'gpt-5.4-mini',
            canParse: true,
            selectable: true,
          },
        ],
      },
    });
  });
  await page.route('**/api/resumes/settings', (route) => {
    const body = route.request().postDataJSON();
    saves.push(body);
    status = {
      ...status,
      enabled: true,
      hasKey: true,
      configuredProviders: { openai: true, anthropic: false },
      openaiBaseUrl: body.baseUrl,
    };
    return route.fulfill({ json: status });
  });
  await page.route('**/api/resumes/check-connection', (route) => {
    checks++;
    return route.fulfill({ json: { message: '密钥与模型可访问。未发送简历。' } });
  });
  await page.route('**/api/resumes/parse', (route) => {
    parses++;
    return route.abort();
  });
  await page.goto('/resume-lab');
  const base = page.getByLabel('Base URL', { exact: true }),
    key = page.getByLabel('API Key', { exact: true });
  await expect(base).toHaveValue('https://api.openai.com/v1');
  await base.fill(`${baseUrl}/`);
  await key.fill(fakeKey);
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.locator('#model-list-status')).toContainText('已从账号获取 1 个模型');
  expect(lists).toEqual([{ provider: 'openai', baseUrl, apiKey: fakeKey }]);
  expect(saves).toHaveLength(0);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('配置已保存');
  expect(saves[0]).toMatchObject({ baseUrl, apiKey: fakeKey });
  await page.reload();
  await page.locator('#model-settings > summary').click();
  await expect(base).toHaveValue(baseUrl);
  await expect(key).toHaveValue('');
  await page.getByRole('button', { name: '检查连接', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('未发送简历');
  expect(checks).toBe(1);
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.locator('#model-list-status')).toContainText('已从账号获取');
  expect(lists.at(-1)).toEqual({ provider: 'openai', baseUrl });
  await base.fill('https://other.example/v1');
  await expect(page.getByRole('button', { name: '获取模型列表', exact: true })).toBeDisabled();
  await expect(page.getByRole('searchbox', { name: '搜索模型', exact: true })).toBeHidden();
  await expect(key).toHaveAttribute('required', '');
  await expect(key).toHaveAttribute('placeholder', /此服务地址/);
  await key.fill('different-fake-browser-key');
  await expect(page.getByRole('button', { name: '获取模型列表', exact: true })).toBeEnabled();
  await page.getByLabel('服务提供方', { exact: true }).selectOption('anthropic');
  await expect(base).toBeHidden();
  await expect(base).toBeDisabled();
  expect(parses).toBe(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
    fakeKey,
  );
});
