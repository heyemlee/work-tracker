import { expect, test } from '@playwright/test';

test('remembers appearance and follows operating-system theme changes', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('html'),
    appearance = page.getByRole('combobox', { name: '外观' });
  await expect(root).toHaveAttribute('data-theme', 'white');
  await expect(appearance).toHaveValue('white');
  await appearance.selectOption('dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(0, 0, 0)');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(appearance).toHaveValue('dark');
  await appearance.selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await appearance.selectOption('white');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(255, 255, 255)');
  await expect(page.locator('.brand img')).toHaveJSProperty('complete', true);
  await expect
    .poll(() => page.locator('.brand img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});

test('keeps company selection accessible without pushing the job list off a phone screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const panel = page.locator('#company-panel');
  await expect(panel).not.toHaveAttribute('open');
  await expect(page.getByRole('heading', { name: '招聘岗位', exact: true })).toBeInViewport();
  await panel.locator(':scope > summary').click();
  await expect(page.getByRole('searchbox', { name: '搜索公司', exact: true })).toBeVisible();
  await panel.locator(':scope > summary').click();
  await expect(panel).not.toHaveAttribute('open');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: '外观' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(panel).toHaveAttribute('open');
  await panel.locator(':scope > summary').press('Enter');
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator(':scope > summary').press('Enter');
  await expect(panel).toHaveAttribute('open');
});
