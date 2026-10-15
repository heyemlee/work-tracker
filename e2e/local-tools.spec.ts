import { test, expect, type Page } from '@playwright/test';
import { emptyProfile, resumeFactsSchema } from '../src/domain/profile';

/** Screenshots to look at. Playwright empties test-results/ at every run, and git ignores it. */
const shots = 'test-results/screenshots';
const boardId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const posting = {
  id: jobId,
  title: 'Software Engineer',
  company: 'Example Labs',
  location: 'San Francisco',
  department: 'Engineering',
  url: 'https://jobs.lever.co/example-labs/example-job',
  remote: true,
  active: true,
  provider: 'lever',
  description: 'Build thoughtful tools.\nWork with a small engineering team.',
};
const facts = resumeFactsSchema.parse({
  name: { first: 'Sample', last: 'Candidate' },
  phone: '555-0100',
  skills: ['TypeScript', 'SQL'],
  experience: [{ company: 'Example Employer', title: 'Engineer', start: '2022-01', end: '2025-03' }],
  summary: 'A fictional resume for interface testing.',
});
const modelStatus = {
  enabled: true,
  provider: 'openai',
  model: 'gpt-5.4-mini',
  hasKey: true,
  configuredProviders: { openai: true, anthropic: true },
  openaiBaseUrl: 'https://api.openai.com/v1',
  models: [
    { provider: 'openai', model: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  ],
  modelPolicy: { canParse: true, reason: '' },
  budgetLimitUsd: 5,
};

async function setup(page: Page, locale = 'en', theme = 'white', following = true) {
  const profile = emptyProfile();
  profile.name.first = 'Existing';
  profile.name.last = 'Owner';
  profile.skills = ['TypeScript'];
  await page.addInitScript(
    ({ profile, locale, theme }) => {
      if (localStorage.getItem('outbox.sample.v4')) return;
      localStorage.setItem(
        'outbox.prefs.v1',
        JSON.stringify({ locale, theme, setup: { guideSeen: true }, tweaks: { accent: 'blue' } }),
      );
      localStorage.setItem(
        'outbox.sample.v4',
        JSON.stringify({
          accounts: [],
          companies: [],
          jobs: [],
          applications: [],
          channels: [],
          resumes: [],
          events: [],
          deletedJobIds: [],
          profile: { profile, updatedAt: '2026-10-01T12:00:00Z' },
        }),
      );
    },
    { profile, locale, theme },
  );
  let parseCalls = 0;
  let settings = { ...modelStatus };
  let boards = [
    {
      id: boardId,
      company: 'Example Labs',
      provider: 'lever',
      enabled: following,
      activeJobs: 1,
      syncedAt: null as string | null,
      lastError: null,
    },
  ];
  let syncing = false;
  const calls: { path: string; method: string; body: unknown }[] = [];
  await page.route('**/local-tools/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/local-tools', '');
    const method = request.method();
    const body = request.headers()['content-type']?.includes('application/json')
      ? request.postDataJSON()
      : null;
    calls.push({ path, method, body });
    let json: unknown;
    if (path === '/api/boards' && method === 'GET') json = boards;
    else if (path === '/api/boards' && method === 'POST') {
      boards = [
        ...boards,
        { ...boards[0]!, id: '33333333-3333-4333-8333-333333333333', company: body.company },
      ];
      json = boards[1];
    } else if (path.startsWith('/api/boards/') && method === 'PATCH') {
      boards = boards.map((b) => (b.id === path.split('/').at(-1) ? { ...b, enabled: body.enabled } : b));
      json = {};
    } else if (path === '/api/sync') {
      if (method === 'POST') syncing = true;
      json = {
        running: syncing,
        total: 1,
        completed: syncing ? 0 : 1,
        finishedAt: syncing ? null : '2026-10-14T12:00:00Z',
        error: null,
        results: [],
      };
      if (method === 'GET') syncing = false;
    } else if (path === '/api/jobs')
      json = {
        items: url.searchParams.get('q') === 'nomatch' ? [] : [posting],
        page: Number(url.searchParams.get('page') || 1),
        hasMore: !url.searchParams.has('page'),
      };
    else if (path === `/api/jobs/${jobId}`) json = posting;
    else if (path === '/api/resumes/status') json = settings;
    else if (path === '/api/resumes/extract')
      json = { text: 'Sample Candidate\nSkills: TypeScript, SQL', warnings: [], format: 'docx', pages: null };
    else if (path === '/api/resumes/parse') {
      parseCalls++;
      json = { facts, model: settings.model, method: body.method };
    } else if (path === '/api/resumes/models')
      json = {
        models: [{ provider: 'openai', model: 'gpt-4.1-mini', label: 'GPT-4.1 mini', selectable: true }],
      };
    else if (path === '/api/resumes/settings') {
      settings = { ...settings, ...body };
      json = settings;
    } else if (path === '/api/resumes/check-connection') json = { ok: true };
    else throw new Error(`Unexpected tool request: ${method} ${path}`);
    await route.fulfill({ json });
  });
  return { calls, parseCalls: () => parseCalls };
}

test('discover → save without applying → duplicate visit; filtering and history', async ({ page }) => {
  const mock = await setup(page);
  await page.goto('/discover');
  await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Companies 1', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Add company' }).click();
  await page.getByLabel('Company name', { exact: true }).fill('Second Example');
  await page.getByLabel('Careers page URL').fill('https://jobs.ashbyhq.com/example');
  await page.getByRole('button', { name: 'Add company', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Following 2', { exact: true })).toBeVisible();
  await page.getByRole('checkbox').last().click();
  await expect(page.getByRole('dialog').getByText('Following 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sync selected companies', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sync jobs', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: posting.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`job=${jobId}`));
  await page.reload();
  await expect(page.getByText('Build thoughtful tools.', { exact: false })).toBeVisible();
  await page
    .getByRole('region', { name: 'Job details' })
    .getByRole('button', { name: 'Save to tracker' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Job details' }).getByRole('button', { name: 'View in tracker' }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Job details' })
    .getByRole('button', { name: 'View in tracker' })
    .click();
  await expect(page).toHaveURL('http://127.0.0.1:5181/');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('outbox.sample.v4')!));
  expect(saved.jobs).toHaveLength(1);
  expect(saved.applications).toHaveLength(0);
  await page.goBack();
  await expect(
    page.getByRole('region', { name: 'Job details' }).getByRole('button', { name: 'View in tracker' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Role or keyword').fill('nomatch');
  await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching roles' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: posting.title, exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('Role or keyword')).toHaveValue('nomatch');
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('outbox.sample.v4')!));
  expect(saved.jobs).toHaveLength(1);
  expect(mock.parseCalls()).toBe(0);
});

for (const width of [1440, 390]) {
  test(`read → explicit parse → JSON → selective profile draft → guarded save at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const mock = await setup(page);
    await page.goto('/resume-tools');
    await page.getByLabel('Read resume text', { exact: true }).setInputFiles({
      name: 'fictional.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('mock document'),
    });
    await expect(page.getByLabel('Resume text (editable)')).toContainText('Sample Candidate');
    expect(mock.parseCalls()).toBe(0);
    await page.getByRole('button', { name: 'Parsing settings', exact: true }).click();
    await page.getByLabel('Parsing method').selectOption('structured-output');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Parse resume', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Parsed result' })).toBeVisible();
    expect(mock.parseCalls()).toBe(1);
    await expect(page.locator('pre')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sample Candidate', exact: true })).toBeVisible();
    await expect(page.getByText('Engineer · Example Employer', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${shots}/local-tools-result-${width}.png`, fullPage: true });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    expect((await download).suggestedFilename()).toBe('resume-facts.json');
    await page.getByRole('button', { name: 'Review in profile' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByLabel('Legal first name', { exact: true })).toHaveValue('Existing');
    await page.getByRole('checkbox', { name: /Replace work experience/ }).uncheck();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByLabel('Phone', { exact: true })).toHaveValue('555-0100');
    const beforeSave = await page.evaluate(
      () => JSON.parse(localStorage.getItem('outbox.sample.v4')!).profile.profile,
    );
    expect(beforeSave.phone).toBe('');
    expect(beforeSave.skills).toEqual(['TypeScript']);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('link', { name: 'Discover', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Profile saved', { exact: true })).toBeVisible();
    const afterSave = await page.evaluate(
      () => JSON.parse(localStorage.getItem('outbox.sample.v4')!).profile.profile,
    );
    expect(afterSave.name.first).toBe('Existing');
    expect(afterSave.skills).toEqual(['TypeScript', 'SQL']);
    expect(afterSave.experience).toEqual([]);
    expect(mock.calls.filter((c) => c.path === '/api/resumes/parse')).toHaveLength(1);
  });
}

test('model settings, list and connection do not parse; dirty text navigation is protected', async ({
  page,
}) => {
  const mock = await setup(page);
  await page.goto('/resume-tools');
  await page.getByRole('button', { name: 'Parsing settings', exact: true }).click();
  await page.getByText('Connection & budget details', { exact: true }).click();
  await page.getByRole('button', { name: 'Fetch model list' }).click();
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('gpt-4.1-mini');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Paste text instead', exact: true }).click();
  await page.getByLabel('Resume text (editable)').fill('Fictional resume text');
  await expect(page.getByRole('button', { name: 'Parse resume', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Parsing settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('gpt-4.1-mini');
  await page.getByRole('button', { name: 'Save model settings' }).click();
  await expect(page.getByText('Model settings saved', { exact: true })).toBeVisible();
  await page.getByText('Connection & budget details', { exact: true }).click();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByText('The saved model is reachable. No resume was sent.')).toBeVisible();
  expect(mock.parseCalls()).toBe(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Parse resume', exact: true })).toBeEnabled();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  await expect(page).toHaveURL(/resume-tools$/);
  expect(mock.calls.some((c) => JSON.stringify(c.body).includes('apiKey'))).toBe(false);
});

test('service not started has a retry, and retry restores the page', async ({ page }) => {
  await setup(page);
  await page.route('**/local-tools/api/boards', (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
  );
  await page.goto('/discover');
  await expect(page.getByRole('alert')).toContainText('The local service is unavailable');
  await page.unroute('**/local-tools/api/boards');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: posting.title, exact: true })).toBeVisible();
});

for (const [width, locale, theme] of [
  [1440, 'en', 'white'],
  [1024, 'en', 'dark'],
  [390, 'zh', 'dark'],
  [320, 'en', 'white'],
] as const) {
  test(`navigation and layout ${width}px ${locale} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, locale, theme);
    await page.goto('/discover');
    await expect(page.getByRole('button', { name: posting.title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: `${shots}/discover-${width}-${locale}-${theme}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    const companyButton = page.getByRole('button', {
      name: locale === 'zh' ? '关注公司 1' : 'Companies 1',
      exact: true,
    });
    await companyButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({
      path: `${shots}/discover-companies-${width}-${locale}-${theme}.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(companyButton).toBeFocused();
    await page.getByRole('button', { name: posting.title, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({
      path: `${shots}/discover-detail-${width}-${locale}-${theme}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: locale === 'zh' ? '关闭' : 'Close', exact: true }).click();
    if (width < 1280) {
      await page
        .getByRole('button', { name: locale === 'zh' ? '更多页面' : 'More pages', exact: true })
        .click();
      await page.getByRole('link', { name: locale === 'zh' ? '简历' : 'Resumes', exact: true }).click();
      await expect(page).toHaveURL(/\/resumes$/);
      await page
        .getByRole('link', { name: locale === 'zh' ? '简历工具' : 'Resume tools', exact: true })
        .click();
    } else await page.getByRole('link', { name: 'Resume tools', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: locale === 'zh' ? '简历工具' : 'Resume tools', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: locale === 'zh' ? '选择文件' : 'Choose file', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: locale === 'zh' ? '简历文字（可编辑）' : 'Resume text (editable)' }),
    ).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: `${shots}/local-tools-${width}-${locale}-${theme}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page
      .getByRole('button', { name: locale === 'zh' ? '解析设置' : 'Parsing settings', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({
      path: `${shots}/local-tools-settings-${width}-${locale}-${theme}.png`,
      fullPage: true,
    });
  });
}

test('real local bridge reads health and rejects cross-origin writes and nonlocal hosts', async ({
  request,
}) => {
  // No mock and no model calls. Only a read and rejected mutations against the existing local service.
  const health = await request.get('/local-tools/health', { headers: { 'x-outbox-local': '1' } });
  expect([200, 503]).toContain(health.status());
  const crossOrigin = await request.post('/local-tools/api/resumes/parse', {
    headers: { 'x-outbox-local': '1', Origin: 'https://example.invalid' },
    data: { text: 'must never reach a model', method: 'function-calling' },
  });
  expect(crossOrigin.status()).toBe(403);
  const noHeader = await request.post('/local-tools/api/resumes/parse', {
    headers: { Origin: 'http://127.0.0.1:5181' },
    data: {},
  });
  expect(noHeader.status()).toBe(403);
  const wrongHost = await request.get('/local-tools/health', {
    headers: { Host: 'example.invalid:5181', 'x-outbox-local': '1' },
  });
  expect(wrongHost.status()).toBe(403);
});

test('first visit focuses on choosing companies; search and filters appear when followed', async ({
  page,
}) => {
  await setup(page, 'en', 'white', false);
  await page.goto('/discover');
  await expect(page.getByRole('heading', { name: 'Start with companies you want to join' })).toBeVisible();
  await expect(page.getByLabel('Role or keyword')).not.toBeVisible();
  await page.getByRole('button', { name: 'Choose companies', exact: true }).click();
  await page.getByLabel('Search companies', { exact: true }).fill('unknown company');
  await expect(page.getByText('No matching companies.', { exact: false })).toBeVisible();
  await page.getByLabel('Search companies', { exact: true }).fill('Example');
  await page.getByRole('checkbox', { name: 'Example Labs', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Example Labs', exact: true })).toBeChecked();
  await expect(page.getByRole('dialog').getByText('Following 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Role or keyword')).toBeVisible();
  await expect(page.getByLabel('Location', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Location', { exact: true }).fill('San Francisco');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/location=San\+Francisco/);
  await page.getByRole('button', { name: 'Filters 1', exact: true }).click();
  await expect(page.getByLabel('Location', { exact: true })).not.toBeVisible();
  await page.getByLabel('Role or keyword').fill('Engineer');
  await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
  await expect(page).toHaveURL(/location=San\+Francisco/);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5181/discover');
});
