import { expect } from '@playwright/test';
import { fixture, seed, test } from './harness';

const hydrate = `<script>
function hydrate(root) {
 for(const t of root.querySelectorAll('template[data-shadow]')) {
  const s=t.parentElement.attachShadow({mode:'open'});s.append(t.content.cloneNode(true));t.remove();hydrate(s);
 }
}
hydrate(document);
window.advances=0;
for(const button of document.querySelectorAll('oc-button')) button.addEventListener('click',()=>window.advances++);
for(const host of document.querySelectorAll('spl-autocomplete')) {
 const input=host.shadowRoot.querySelector('spl-input').shadowRoot.querySelector('input');
 const menu=host.shadowRoot.querySelector('[role=listbox]');
 input.addEventListener('input',()=>{
  const option=document.createElement('spl-autocomplete-option');option.setAttribute('role','option');
  option.setAttribute('label',input.value);option.textContent=input.value;menu.replaceChildren(option);
  option.addEventListener('click',()=>{input.value=option.getAttribute('label');menu.replaceChildren();});
 });
}
</script>`;

for (const step of ['entries', 'screening'] as const) {
  test(`SmartRecruiters ${step} keeps entry boundaries and stays on the current step`, async ({
    context,
    worker,
    outbox,
  }) => {
    await seed(worker, outbox.url);
    const url = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Example/publication/local-test';
    const html = fixture(`new-ats/smartrecruiters-${step}.html`).replace('</body>', hydrate + '</body>');
    await context.route('**/*', (route) => {
      const target = new URL(route.request().url());
      if (target.hostname === 'jobs.smartrecruiters.com')
        return route.fulfill({ contentType: 'text/html', body: html });
      if (target.hostname === '127.0.0.1' || target.protocol === 'chrome-extension:') return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(url);
    if (step === 'screening')
      await page.locator('sr-question-field-text:not([hidden]) input').fill('Manual working hours');
    const card = page.locator('outbox-autofill');
    await card.getByRole('button', { name: /^Fill/ }).click();
    await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45000 });
    if (step === 'entries') {
      // One already saved entry precedes the editor: index 1 must use Beta Labs' start, not Acme AI's.
      await expect(page.locator('[data-test="experience-date-from"] input[data-input]')).toHaveValue(
        'May 2024',
      );
      // The editors ask for nothing else: what isn't asked for is left to the owner.
      for (const field of [
        '[data-test="company-autocomplete"] input',
        '[data-test="job-title-autocomplete"] input',
        '[data-test="experience-date-to"] input',
        '[data-test="institution-autocomplete"] input',
        '[data-test="education-major"] input',
        '[data-test="education-degree"] input',
        '[data-test="education-date-from"] input',
        'oc-education [data-test="location-autocomplete"] input',
      ])
        await expect(page.locator(field)).toHaveValue('');
    } else {
      await expect(page.locator('sr-question-field-text:not([hidden]) input')).toHaveValue(
        'Manual working hours',
      );
      await expect(page.locator('spl-radio[label="Yes"] input')).toBeChecked();
      await expect(page.locator('spl-radio[label="No"] input')).not.toBeChecked();
    }
    expect(await page.evaluate(() => (window as unknown as { advances: number }).advances)).toBe(0);
    expect(outbox.quickAdds).toHaveLength(0);
  });
}

test('iCIMS login inside an iframe is never filled as an application', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'careers-example.icims.com')
      return route.fulfill({
        contentType: 'text/html',
        body:
          url.pathname === '/gate'
            ? '<form id="enterEmailForm"><label for="email">Email</label><input id="email" type="email"><button>Next</button></form>'
            : '<h1>Example role</h1><iframe src="/gate"></iframe>',
      });
    if (url.hostname === '127.0.0.1' || url.protocol === 'chrome-extension:') return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto('https://careers-example.icims.com/jobs/123/job');
  await expect(page.frameLocator('iframe').locator('#email')).toBeVisible();
  await expect(page.frameLocator('iframe').locator('outbox-autofill')).toHaveCount(0);
  // A posting may still show the tracking card; its presence must not turn a login gate into fillable fields.
  await expect(page.locator('outbox-autofill')).toHaveCount(1);
  await expect(page.locator('outbox-autofill').getByRole('button', { name: /^Fill/ })).toHaveCount(0);
  await expect(page.frameLocator('iframe').locator('#email')).toHaveValue('');
  expect(outbox.quickAdds).toHaveLength(0);
});
