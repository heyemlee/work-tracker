import { expect } from '@playwright/test';
import { makeProfile } from '../src/test/profiles';
import { fixture, seed, test } from './harness';

// Only local stand-ins for page callbacks. No request reaches an employer's candidate system.
const behavior = `<script>
window.submissions=0;
document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submissions++;});
const byId=id=>document.getElementById(id);
const country='-1_PersonProfileFields.AddressCountry',state='-1_PersonProfileFields.AddressState';
const lists={};
lists[country]=['United States','Canada'];lists[state]=[];
for(const id of [country,state]) {
 const select=byId(id),anchor=byId(id+'_icimsDropdown'),menu=byId(id+'_dropdown-results');
 anchor.addEventListener('click',()=>{
  menu.replaceChildren();anchor.setAttribute('aria-expanded','true');
  for(const text of lists[id]) {
   const li=document.createElement('li');li.setAttribute('role','option');li.title=text;li.textContent=text;menu.append(li);
   li.addEventListener('click',()=>{
    select.replaceChildren(new Option(text,text,true,true));anchor.querySelector('.dropdown-text').textContent=text;
    menu.hidden=true;anchor.setAttribute('aria-expanded','false');
    if(id===country) {
     lists[state]=text==='United States'?['California','New York']:['Alberta','Ontario'];
     byId(state).replaceChildren(new Option('',''));
     byId(state+'_icimsDropdown').querySelector('.dropdown-text').innerHTML='<span class="dropdown-placeholder">— Make a Selection —</span>';
    }
   });
  }
  menu.hidden=false;
 });
}

</script>`;

for (const credentials of [true, false]) {
  test(`iCIMS candidate profile ${credentials ? 'blocks registration fields' : 'fills a derived profile with lazy country and state menus'}`, async ({
    context,
    worker,
    outbox,
  }) => {
    await seed(worker, outbox.url);
    outbox.profiles.push(
      makeProfile({
        address: {
          line1: '1 Sample Street',
          city: 'Santa Clara',
          state: 'CA',
          zip: '95050',
          country: 'United States',
        },
      }),
    );
    let html = fixture('new-ats/icims-candidate.html');
    // Derived credential-free variant; not an authenticated page capture.
    if (!credentials) html = html.replace(/<div data-local-credentials>[\s\S]*?<\/div>/, '');
    html = html.replace('</body>', behavior + '</body>');
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'careers-example.icims.com')
        return route.fulfill({
          contentType: 'text/html',
          body:
            url.pathname === '/profile-frame'
              ? html
              : '<h1>Example role</h1><iframe src="/profile-frame" style="width:100%;height:2000px"></iframe>',
        });
      if (url.hostname === '127.0.0.1' || url.protocol === 'chrome-extension:') return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(
      'https://careers-example.icims.com/jobs/123/example-role/candidate?code=private-test-code&eem=private-test-email',
    );
    const frame = page.frameLocator('iframe');
    const card = page.locator('outbox-autofill');
    await expect(frame.locator('#profileForm')).toBeVisible();
    if (credentials) {
      await expect(card.getByRole('button', { name: /^Fill/ })).toBeDisabled();
      await expect(frame.locator('[id="PersonProfileFields.Login"]')).toHaveValue('');
      await expect(frame.locator('[id="PersonProfileFields.Password"]')).toHaveValue('');
      await expect(frame.locator('[id="PersonProfileFields.FirstName"]')).toHaveValue('');
      expect(await frame.locator('input[type=file]').evaluate((e: HTMLInputElement) => e.files?.length)).toBe(
        0,
      );
    } else {
      await frame.locator('[id="PersonProfileFields.FirstName"]').fill('Manual first name');
      await card.getByRole('button', { name: /^Fill/ }).click();
      await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45000 });
      await expect(frame.locator('[id="PersonProfileFields.FirstName"]')).toHaveValue('Manual first name');
      // Email follows the selected application account under the existing fill policy.
      await expect(frame.locator('[id="PersonProfileFields.Email"]')).toHaveValue('alex@example.com');
      await expect(frame.locator('[id="-1_PersonProfileFields.AddressStreet1"]')).toHaveValue(
        '1 Sample Street',
      );
      await expect(frame.locator('[id="-1_PersonProfileFields.AddressCountry"]')).toHaveValue(
        'United States',
      );
      await expect(frame.locator('[id="-1_PersonProfileFields.AddressState"]')).toHaveValue('California');
      expect(await frame.locator('input[type=file]').evaluate((e: HTMLInputElement) => e.files?.length)).toBe(
        1,
      );
      await frame
        .locator('[id="-1_PersonProfileFields.AddressCountry_icimsDropdown"]')
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath('icims-profile.png') });
    }
    expect(
      await frame.locator('body').evaluate(() => (window as unknown as { submissions: number }).submissions),
    ).toBe(0);
    expect(outbox.quickAdds).toHaveLength(0);
  });
}

test('iCIMS real question contract uses existing authorization rules and never presses Submit or Finish Later', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  const html = fixture('new-ats/icims-questions.html').replace(
    '</body>',
    '<script>window.submissions=0;document.querySelector("form").addEventListener("submit",e=>{e.preventDefault();window.submissions++;});</script></body>',
  );
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'careers-example.icims.com')
      return route.fulfill({
        contentType: 'text/html',
        body:
          url.pathname === '/questions-frame'
            ? html
            : '<h1>Example role</h1><iframe src="/questions-frame" style="width:100%;height:600px"></iframe>',
      });
    if (url.hostname === '127.0.0.1' || url.protocol === 'chrome-extension:') return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto('https://careers-example.icims.com/jobs/123/example-role/questions?code=private-test-code');
  const frame = page.frameLocator('iframe');
  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: /^Fill/ }).click();
  await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45000 });
  await expect(frame.locator('#Q2414')).toHaveValue('yes');
  await expect(frame.locator('#Q2415')).toHaveValue('yes');
  await expect(card.getByText(/To check/)).toBeVisible();
  expect(
    await frame.locator('body').evaluate(() => (window as unknown as { submissions: number }).submissions),
  ).toBe(0);
  expect(outbox.quickAdds).toHaveLength(0);
  // Saving progress manually is not an application attempt or an automatic log.
  await frame.locator('#quesp_form_save_i').click();
  expect(
    await frame.locator('body').evaluate(() => (window as unknown as { submissions: number }).submissions),
  ).toBe(1);
  expect(outbox.quickAdds).toHaveLength(0);
  // The observed Submit is still step 2 of 3; it must not record a final submission attempt either.
  await frame.locator('#quesp_form_submit_i').click();
  expect(
    await frame.locator('body').evaluate(() => (window as unknown as { submissions: number }).submissions),
  ).toBe(2);
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const { chrome } = globalThis as unknown as {
          chrome: { storage: { session: { get(): Promise<Record<string, unknown>> } } };
        };
        const stored = await chrome.storage.session.get();
        return Object.entries(stored)
          .filter(([key]) => key.startsWith('tab-'))
          .map(([, value]) => {
            const { sends, submittedAt } = value as { sends: boolean; submittedAt: string | null };
            return { sends, submittedAt };
          });
      }),
    )
    .toEqual([{ sends: false, submittedAt: null }]);
  expect(outbox.quickAdds).toHaveLength(0);
});
