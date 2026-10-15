import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('configures OpenAI in the page without browser storage or key echo, checks connection, and removes it', async ({
  page,
}) => {
  let status = {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    hasKey: false,
    configuredProviders: { openai: false, anthropic: false },
  };
  const saves: Record<string, unknown>[] = [],
    checks: string[] = [],
    parses: Record<string, unknown>[] = [];
  const fakeKey = 'fake-browser-test-key-never-real';
  await page.route('**/api/resumes/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/resumes/settings', async (route) => {
    const body = route.request().postDataJSON();
    if (route.request().method() === 'PUT') {
      saves.push(body);
      status = {
        enabled: body.enabled,
        provider: body.provider,
        model: body.model,
        hasKey: true,
        configuredProviders: { openai: true, anthropic: false },
      };
    } else {
      status = {
        ...status,
        enabled: false,
        hasKey: false,
        configuredProviders: { openai: false, anthropic: false },
      };
    }
    await route.fulfill({ json: status });
  });
  await page.route('**/api/resumes/check-connection', (route) => {
    checks.push(route.request().url());
    return route.fulfill({
      json: { ok: true, message: '密钥与模型可访问。未发送简历；实际解析能力以解析结果为准。' },
    });
  });
  const facts = JSON.parse(
    await readFile(new URL('../../evals/synthetic/gold.json', import.meta.url), 'utf8'),
  );
  await page.route('**/api/resumes/parse', (route) => {
    parses.push(route.request().postDataJSON());
    return route.fulfill({ json: { facts, durationMs: 100, usage: null } });
  });
  await page.goto('/resume-lab');
  await expect(page.getByLabel('服务提供方', { exact: true })).toHaveValue('openai');
  await expect(page.getByLabel('模型', { exact: true })).toHaveValue('gpt-5.4-mini');
  const key = page.getByLabel('API Key', { exact: true });
  await key.fill(fakeKey);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('配置已保存');
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    enabled: true,
    apiKey: fakeKey,
  });
  await expect(key).toHaveValue('');
  await expect(page.locator('#key-state')).toHaveText('密钥已配置');
  expect(await page.content()).not.toContain(fakeKey);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
    fakeKey,
  );
  expect(parses).toHaveLength(0);
  await page.getByRole('button', { name: '检查连接', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('未发送简历');
  expect(checks).toHaveLength(1);
  expect(parses).toHaveLength(0);
  await page.reload();
  await page.locator('#model-settings > summary').click();
  await expect(key).toHaveValue('');
  await expect(key).toHaveAttribute('placeholder', /留空保留/);
  await page
    .getByLabel('选择文件', { exact: true })
    .setInputFiles(new URL('../../evals/synthetic/sample.docx', import.meta.url).pathname);
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await expect(page.getByRole('button', { name: '解析资料', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '解析资料', exact: true }).click();
  await expect(page.locator('#parsed-facts')).toContainText('Sample User');
  expect(parses).toHaveLength(1);
  expect(JSON.stringify(parses)).not.toContain(fakeKey);
  await page.getByLabel('启用 AI 解析', { exact: true }).uncheck();
  await expect(page.getByRole('button', { name: '解析资料', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('配置已保存');
  expect(saves[1]).not.toHaveProperty('apiKey');
  await page.getByRole('button', { name: '移除密钥', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('密钥已从本地配置中移除');
  await expect(page.getByRole('button', { name: '检查连接', exact: true })).toBeDisabled();
});

test('shows a failed save and leaves parsing disabled', async ({ page }) => {
  await page.route('**/api/resumes/settings', (route) =>
    route.fulfill({ status: 400, json: { message: '本地配置保存失败，请检查文件权限后重试。' } }),
  );
  await page.goto('/resume-lab');
  await page.getByLabel('API Key', { exact: true }).fill('fake-key-for-failure-test');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('#settings-status')).toContainText('本地配置保存失败');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '解析资料', exact: true })).toBeDisabled();
});
