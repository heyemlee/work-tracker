import { expect } from '@playwright/test';
import { fixture, seed, test } from './harness';

// Every target-host request is intercepted; candidate data stays inside the test browser.
const pages = [
  {
    ats: 'workable',
    url: 'https://apply.workable.com/example/j/123/apply/',
    first: '#firstname',
    email: '#email',
    resume: '#upload-b',
  },
  {
    ats: 'jobvite',
    url: 'https://jobs.jobvite.com/example/job/123/apply',
    first: '#random-first',
    email: '#random-email',
    resume: '#resume-file',
  },
  {
    ats: 'icims',
    url: 'https://careers-example.icims.com/jobs/123/software-engineer/job?mode=apply',
    first: '[id="PersonProfileFields.FirstName"]',
    email: '[id="PersonProfileFields.EmailFieldSet.Email"]',
    resume: '#cv',
  },
  {
    ats: 'smartrecruiters',
    url: 'https://jobs.smartrecruiters.com/oneclick-ui/company/ExampleLabs/publication/uuid?dcr_ci=ExampleLabs',
    first: 'spl-input#first-name-input input',
    email: 'spl-input#email-input input',
    resume: '[data-test="resume-upload"] input',
  },
];
const behavior = `<script>
function hydrate(root) {
 for(const t of root.querySelectorAll('template[data-shadow]')) {
  const s=t.parentElement.attachShadow({mode:'open'});s.append(t.content.cloneNode(true));t.remove();hydrate(s);
 }
}
hydrate(document);
window.attempts=0;
for(const f of document.forms) f.addEventListener('submit',e=>{e.preventDefault();window.attempts++;});
const root=document.querySelector('oc-oneclick-form');
if(root){
 const city=root.querySelector('spl-autocomplete');
 const input=city.shadowRoot.querySelector('spl-input').shadowRoot.querySelector('input');
 const menu=city.shadowRoot.querySelector('[role=listbox]');
 input.addEventListener('input',()=>{
  menu.innerHTML='<spl-autocomplete-option role="option" label="Santa Clara, California, United States">Santa Clara, California, United States</spl-autocomplete-option>';
  menu.firstElementChild.addEventListener('click',()=>{input.value=menu.textContent;menu.innerHTML='';});
 });
 const select=root.querySelector('spl-phone-field').shadowRoot.querySelector('spl-select');
 for(const option of select.querySelectorAll('spl-select-option')) option.addEventListener('click',()=>{select.setAttribute('value',option.getAttribute('value'));select.shadowRoot.querySelector('button').textContent=option.getAttribute('label');});
}
const select=document.querySelector('select');
if(select){
 const anchor=document.querySelector('a[role=combobox]'),menu=document.querySelector('ul');
 anchor.addEventListener('click',()=>{menu.hidden=false;});
 for(const li of menu.querySelectorAll('li')) li.addEventListener('click',()=>{select.value=li.dataset.value;anchor.textContent=li.textContent;menu.hidden=true;});
}
</script>`;
for (const spec of pages)
  test(`fills ${spec.ats}, keeps manual answers and never submits`, async ({ context, worker, outbox }) => {
    await seed(worker, outbox.url);
    const html = fixture(`new-ats/${spec.ats}.html`).replace('</body>', behavior + '</body>');
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === new URL(spec.url).hostname)
        return route.fulfill({ contentType: 'text/html', body: html });
      if (url.hostname === '127.0.0.1' || url.protocol === 'chrome-extension:') return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(spec.url);
    await page.locator(spec.first).fill('Manual name');
    const card = page.locator('outbox-autofill');
    await card.getByRole('button', { name: /^Fill/ }).click();
    await expect(card.getByText(/^Filled \d+/)).toBeVisible({ timeout: 45000 });
    await expect(page.locator(spec.first)).toHaveValue('Manual name');
    await expect(page.locator(spec.email)).toHaveValue('alex@example.com');
    expect(await page.locator(spec.resume).evaluate((i: HTMLInputElement) => i.files?.length)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { attempts: number }).attempts)).toBe(0);
    expect(outbox.quickAdds).toHaveLength(0);
    if (spec.ats === 'workable')
      expect(await page.locator('#upload-a').evaluate((i: HTMLInputElement) => i.files?.length)).toBe(0);
    if (spec.ats === 'jobvite')
      expect(await page.locator('#cover-file').evaluate((i: HTMLInputElement) => i.files?.length)).toBe(0);
    if (spec.ats === 'icims') await expect(page.locator('select')).toHaveValue('US');
    if (spec.ats === 'smartrecruiters') {
      await expect(page.locator('spl-autocomplete input')).toHaveValue(
        'Santa Clara, California, United States',
      );
      expect(
        await page
          .locator('[data-test="apply-with-resume-container"] input')
          .evaluate((i: HTMLInputElement) => i.files?.length),
      ).toBe(0);
    }
  });
