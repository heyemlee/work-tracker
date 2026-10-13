import { expect } from '@playwright/test';
import { fixture, seed, serve, test } from './harness';

// An application that went through, told where the page's words can't be gone by: reworded by the browser before
// they are read, worded by the company itself, or in the page's own other language.

/**
 * Stands in for the browser's own page translation, which a spec can't switch on (it sends the page's text to a
 * translator). As Chrome was seen to do: the document is marked for as long as it is shown translated, and what
 * the page draws from then on is reworded a moment later, each text giving way to two nested <font>s. What is
 * marked translate="no" is left as the page wrote it.
 */
const TRANSLATOR = `<script>
  document.documentElement.classList.add('translated-ltr');
  new MutationObserver((records) => {
    const drawn = records
      .flatMap((record) => [...record.addedNodes])
      .filter((node) => node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'FONT');
    if (!drawn.length) return;
    setTimeout(() => {
      for (const element of drawn) {
        const texts = [];
        for (const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); walker.nextNode(); )
          texts.push(walker.currentNode);
        for (const text of texts) {
          if (!text.nodeValue.trim() || text.parentElement.closest('[translate="no"], font')) continue;
          const outer = document.createElement('font');
          outer.setAttribute('dir', 'auto');
          outer.style.verticalAlign = 'inherit';
          const inner = outer.appendChild(document.createElement('font'));
          inner.style.verticalAlign = 'inherit';
          inner.textContent = '已翻译的文字';
          text.replaceWith(outer);
        }
      }
    }, 80);
  }).observe(document, { childList: true, subtree: true });
</script>`;

/** A career site the extension has no adapter for. Its thank-you takes the form's place, in the section round it. */
const CAREERS = 'careers.acme-robotics.com';
const APPLICATION = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Robotics Engineer</title></head><body><main>
<h1>Robotics Engineer</h1>
<section id="apply"><form>
  <label for="first">First name</label><input id="first" name="first_name">
  <label for="last">Last name</label><input id="last" name="last_name">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="resume">Resume/CV</label><input id="resume" name="resume" type="file">
  <p><button type="submit">Submit application</button></p>
</form></section></main>
${TRANSLATOR}
<script>
  document.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    // Its words are put together here: whole, this script's own text would read as the page's thank-you.
    setTimeout(() => {
      document.querySelector('#apply').innerHTML = '<h2 id="thanks">Thank you for ' + 'applying!</h2>';
    }, 150);
  });
</script></body></html>`;

test('logs an application whose thank-you the browser’s translation rewords a moment after the page draws it', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, CAREERS, APPLICATION, '');
  const page = await context.newPage();
  await page.goto(`https://${CAREERS}/jobs/42/apply`);

  const card = page.locator('outbox-autofill');
  await expect(card.getByRole('button', { name: /^Fill/ })).toBeVisible({ timeout: 15_000 });
  await page.locator('#first').fill('Alex');
  await page.locator('#last').fill('Chen');
  await page.locator('#email').fill('alex@example.com');
  await page.locator('button[type="submit"]').click();

  // The thank-you stood in the page's own words for under a tenth of a second: it reads otherwise long before the
  // page is next looked at by the clock.
  await expect(page.locator('#thanks')).toHaveText('已翻译的文字');
  await expect.poll(() => outbox.quickAdds.length, { timeout: 15_000 }).toBe(1);
  expect(outbox.quickAdds[0]).toMatchObject({
    companyName: 'Acme Robotics',
    title: 'Robotics Engineer',
    accountIds: ['acc-1'],
    channelId: 'ch_company_site',
  });
  await expect(card.getByText('Logged to Outbox')).toBeVisible();
});

const ASHBY_POSTING = 'https://jobs.ashbyhq.com/acme-robotics/3f1c0d7e-8a53-4c1e-9d0b-2b7f6c1e0a11';

/**
 * Stands in for Ashby's own script where the saved page needs it: its button sends the application, and the form
 * gives way to the box that says so, drawn as that script draws it, in words this company wrote for it.
 */
const ASHBY_SENDS = `<script>
  document.querySelector('.ashby-application-form-submit-button').addEventListener('click', () =>
    setTimeout(() => {
      document.querySelector('#form').innerHTML =
        '<div role="status" aria-live="polite" tabindex="-1" class="ashby-application-form-success-container ' +
        '_positive_f7cvd_112 _highlighted_f7cvd_138 _container_f7cvd_28" data-highlight="positive">' +
        '<h2 class="_heading_f7cvd_52 ">Success</h2><p>Thanks for your interest in Acme Robotics! Our recruiting ' +
        'team will read what you sent and get back to you.</p></div>';
    }, 300),
  );
</script>`;

test('logs an Ashby application the company thanks for in words of its own', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(
    context,
    'jobs.ashbyhq.com',
    fixture('ashby/acme.html').replace('</body>', `${ASHBY_SENDS}</body>`),
    '',
  );
  const page = await context.newPage();
  await page.goto(`${ASHBY_POSTING}/application`);

  const card = page.locator('outbox-autofill');
  await expect(card.getByRole('button', { name: /^Fill/ })).toBeVisible({ timeout: 15_000 });
  await page.locator('#_systemfield_email').fill('alex@example.com');
  // The card lies over the form's right side at this width, and the button under it.
  await page
    .locator('.ashby-application-form-submit-button')
    .evaluate((button: HTMLElement) => button.click());

  await expect(page.locator('.ashby-application-form-success-container')).toContainText('Thanks for your');
  await expect.poll(() => outbox.quickAdds.length, { timeout: 15_000 }).toBe(1);
  expect(outbox.quickAdds[0]).toMatchObject({
    companyName: 'Acme Robotics',
    title: 'Software Engineer',
    url: ASHBY_POSTING,
    accountIds: ['acc-1'],
  });
  await expect(card.getByText('Logged to Outbox')).toBeVisible();
});

/**
 * Workday's forms sit behind a sign-in, so no page of its own is saved here. These two are drawn as its page code
 * (read 2026-10-08) has them: the last step of an application, with its progress bar and the button at its foot,
 * and the page someone signed in is taken to once the application is in, which draws what it says a moment after
 * it loads, under a heading of its own. Both in Chinese, as Workday shows them to a browser set to it.
 */
const WORKDAY = 'acme.wd5.myworkdayjobs.com';
const BOARD = '/zh-CN/External';
const LAST_STEP = `<!doctype html><html lang="zh-CN"><head><title>审核</title></head><body><div id="root">
<div data-automation-id="applyFlowPage">
  <h2 data-automation-id="jobTitleHeading">Software Engineer</h2>
  <div data-automation-id="progressBar">
    <div data-automation-id="progressBarCompletedStep"><label>我的信息</label></div>
    <div data-automation-id="progressBarActiveStep"><label>审核</label></div>
  </div>
  <div data-automation-id="formField-email"><label for="email">电子邮件地址*</label>
    <input id="email" data-automation-id="email" type="text" value="alex@example.com"></div>
  <div data-automation-id="pageFooter"><button type="button" data-automation-id="pageFooterBackButton">返回</button>
    <button type="button" data-automation-id="pageFooterNextButton">提交</button></div>
</div></div>
<script>
  document.querySelector('[data-automation-id="pageFooterNextButton"]').addEventListener('click', () =>
    setTimeout(() => {
      window.location.pathname = '${BOARD}/jobTasks/completed/application';
    }, 300),
  );
</script></body></html>`;
const TASKS = `<!doctype html><html lang="zh-CN"><head><title></title></head><body><div id="root"></div>
<script>
  setTimeout(() => {
    document.querySelector('#root').innerHTML =
      '<h2 data-automation-id="pageHeader">欢迎，陈先生</h2><p id="done">我们已收到您的申请。</p>';
  }, 1000);
</script></body></html>`;

test('logs a Workday application sent in the page’s own Chinese, on the page it is taken to', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await context.route(`https://${WORKDAY}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: new URL(route.request().url()).pathname.includes('/jobTasks/') ? TASKS : LAST_STEP,
    }),
  );
  const page = await context.newPage();
  const posting = `https://${WORKDAY}${BOARD}/job/San-Jose-CA/Software-Engineer_R123`;
  await page.goto(`${posting}/apply/applyManually`);

  const card = page.locator('outbox-autofill');
  await expect(card.getByRole('button', { name: /^Fill/ })).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-automation-id="pageFooterNextButton"]').click();

  await page.waitForURL(/\/jobTasks\/completed\/application$/);
  await expect.poll(() => outbox.quickAdds.length, { timeout: 15_000 }).toBe(1);
  expect(outbox.quickAdds[0]).toMatchObject({
    companyName: 'Acme',
    title: 'Software Engineer',
    url: posting,
    accountIds: ['acc-1'],
  });
  // The card says so on that page, which is no posting itself, and goes on saying so once the page has drawn
  // what it has to say in its own time and language, heading and all: that tells of nothing more.
  await expect(card.getByText('Logged to Outbox')).toBeVisible();
  await expect(page.locator('#done')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(card.getByText('Logged to Outbox')).toBeVisible();
  await expect(card.getByText('Acme · Software Engineer')).toBeVisible();
  expect(outbox.quickAdds).toHaveLength(1);
});
