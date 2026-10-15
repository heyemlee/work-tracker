import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Db } from '../../src/db.js';

test('select a company, search jobs, view details, and persist the selection', async ({ page }) => {
  const db = new Db(),
    boardId = randomUUID();
  try {
    await db.board.create({
      data: { id: boardId, company: 'UI Test Acme', provider: 'greenhouse', slug: `test-${boardId}` },
    });
    await db.job.create({
      data: {
        boardId,
        externalId: 'one',
        title: 'Compiler Engineer',
        company: 'UI Test Acme',
        location: 'Seattle',
        department: 'Engineering',
        description: 'Build TypeScript compilers.',
        url: 'https://example.com/job/one',
        remote: true,
        seenAt: new Date(),
      },
    });
    await page.goto('/');
    await page.getByLabel('搜索公司', { exact: true }).fill('UI Test Acme');
    const company = page.getByRole('checkbox', { name: '关注 UI Test Acme（greenhouse）' });
    await expect(company).not.toBeChecked();
    await company.check();
    await expect(page.getByRole('button', { name: 'Compiler Engineer', exact: true })).toBeVisible();
    await page.getByLabel('地点', { exact: true }).fill('New York');
    await expect(page.getByText('暂时没有匹配的岗位')).toBeVisible();
    await page.getByLabel('地点', { exact: true }).fill('Seattle');
    await page.getByLabel('仅远程', { exact: true }).check();
    await page.getByRole('button', { name: 'Compiler Engineer', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Build TypeScript compilers.');
    await expect(page.getByRole('link', { name: '前往公司招聘页' })).toHaveAttribute(
      'href',
      'https://example.com/job/one',
    );
    await page.getByRole('button', { name: '关闭岗位详情' }).click();
    await page.reload();
    await page.getByLabel('搜索公司', { exact: true }).fill('UI Test Acme');
    await expect(company).toBeChecked();
    await company.uncheck();
    await expect(page.getByRole('button', { name: 'Compiler Engineer', exact: true })).toHaveCount(0);
    expect(await db.job.count({ where: { boardId } })).toBe(1);
  } finally {
    await db.board.deleteMany({ where: { id: boardId } });
    await db.$disconnect();
  }
});
