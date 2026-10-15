import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixture = (name: string) => new URL(`../../evals/synthetic/${name}`, import.meta.url);

test('reads a real DOCX upload locally, allows review, clears data and keeps AI disabled', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: '简历解析', exact: true }).click();
  await expect(page).toHaveURL(/resume-lab$/);
  await expect(page.getByText('AI 解析尚未启用；目前可以免费读取和核对文件文字。')).toBeVisible();
  await page.getByLabel('选择文件', { exact: true }).setInputFiles({
    name: 'sample.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await readFile(fixture('sample.docx')),
  });
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  const text = page.getByRole('textbox', { name: '简历原文' });
  await expect(text).toHaveValue(/Sample User/);
  await expect(page.getByText(/已读取 DOCX/)).toBeVisible();
  await expect(page.getByRole('button', { name: '解析资料', exact: true })).toBeDisabled();
  await text.fill('');
  await expect(text).toBeEnabled();
  await text.fill('Corrected source text');
  await page.getByRole('button', { name: '清空本次内容' }).click();
  await expect(text).toHaveValue('');
  await expect(text).toBeDisabled();
  expect(
    (
      await request.post('/api/resumes/parse', {
        headers: { 'X-Outbox-Local': '1' },
        data: { text: 'Sample', method: 'function-calling' },
      })
    ).status(),
  ).toBe(503);
  expect(
    (
      await request.post('/api/resumes/parse', {
        headers: { 'X-Outbox-Local': '1' },
        data: { text: '', method: 'function-calling' },
      })
    ).status(),
  ).toBe(400);
});

test('reads a PDF and rejects corrupt input without keeping the previous text', async ({ page }) => {
  await page.goto('/resume-lab');
  const input = page.getByLabel('选择文件', { exact: true });
  await input.setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(fixture('sample.pdf')),
  });
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '简历原文' })).toHaveValue(/Sample User/);
  await input.setInputFiles({
    name: 'broken.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('PKbroken'),
  });
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await expect(page.locator('#read-status')).toContainText('文件读取失败');
  await expect(page.getByRole('textbox', { name: '简历原文' })).toHaveValue('');
});

test('renders mocked model facts as text, supports download and invalidates them after edits', async ({
  page,
}) => {
  const facts = JSON.parse(await readFile(fixture('gold.json'), 'utf8'));
  facts.summary = '<script>window.compromised = true</script>';
  await page.route('**/api/resumes/status', (route) =>
    route.fulfill({ json: { enabled: true, model: 'gpt-5.4-mini' } }),
  );
  await page.route('**/api/resumes/parse', (route) =>
    route.fulfill({ json: { facts, durationMs: 100, usage: null } }),
  );
  await page.goto('/resume-lab');
  await page.getByLabel('选择文件', { exact: true }).setInputFiles({
    name: 'sample.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await readFile(fixture('sample.docx')),
  });
  await page.getByRole('button', { name: '读取文字', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '简历原文' })).toHaveValue(/Sample User/);
  await page.getByRole('button', { name: '解析资料', exact: true }).click();
  await expect(page.locator('#parsed-facts')).toContainText('Sample User');
  await expect(page.locator('#parsed-facts')).toContainText(facts.summary);
  expect(await page.evaluate(() => 'compromised' in window)).toBe(false);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载资料 JSON' }).click();
  expect((await download).suggestedFilename()).toBe('resume-facts.json');
  await page.getByRole('textbox', { name: '简历原文' }).fill('Changed');
  await expect(page.locator('#parsed-facts')).toBeHidden();
  await expect(page.getByRole('button', { name: '下载资料 JSON' })).toBeHidden();
});

test('keeps the resume page readable on a phone and shares the existing theme choice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('combobox', { name: '外观' }).selectOption('dark');
  await page.getByRole('link', { name: '简历解析', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: '读取简历', exact: true })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/resume-mobile.png', fullPage: true });
});
