import { expect, type FrameLocator } from '@playwright/test';
import { seed, serve, SNAPSHOT, test } from './harness';

const THANKS = '<!doctype html><title>Thanks</title><main><h1>Thank you for applying.</h1></main>';
const FORM =
  '<!doctype html><title>Robotics Engineer</title><main><h1>Robotics Engineer</h1><form>' +
  '<label for="first">First name</label><input id="first" name="first_name">' +
  '<label for="email">Email</label><input id="email" name="email" type="email">' +
  '<label for="resume">Resume/CV</label><input id="resume" name="resume" type="file">' +
  '<p><button type="submit">Submit application</button></p></form></main>';

/** A second version on Outbox, with a PDF of its own. */
const SECOND = {
  id: 'res-2',
  name: 'Backend-v2',
  createdAt: '2026-09-02T00:00:00.000Z',
  file: { name: 'Alex_Chen_Backend.pdf', size: 600, uploadedAt: '2026-09-29T12:00:00.000Z' },
};

/**
 * A PDF of so many Letter pages, each with a dark bar an inch under its top edge and nothing else: no fonts to
 * find, so it draws the same on any machine.
 */
function pdfOf(pages: number): string {
  const bar = '0.1 g 72 648 468 72 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, at) => `${3 + at * 2} 0 R`).join(' ')}] /Count ${pages} >>`,
  ];
  for (let at = 0; at < pages; at++)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + at * 2} 0 R >>`,
      `<< /Length ${bar.length} >>\nstream\n${bar}\nendstream`,
    );
  let file = '%PDF-1.4\n';
  const offsets = objects.map((object, at) => {
    const offset = file.length;
    file += `${at + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const table = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return `${file}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`;
}

/** How dark a page is drawn at a point, given as shares of its width and height: 0 is black, 255 white or blank. */
const inkAt = (preview: FrameLocator, page: string, x: number, y: number) =>
  preview.getByRole('img', { name: page }).evaluate(
    (canvas: HTMLCanvasElement, at) => {
      const [red, , , alpha] = canvas
        .getContext('2d')!
        .getImageData(Math.round(canvas.width * at.x), Math.round(canvas.height * at.y), 1, 1).data;
      return alpha ? red! : 255;
    },
    { x, y },
  );

test('shows a resume’s pages in a window over the page, and neither chooses nor attaches it', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  outbox.snapshot = { ...SNAPSHOT, resumes: [...SNAPSHOT.resumes, SECOND] };
  outbox.pdfs = { 'res-1': pdfOf(2), 'res-2': pdfOf(1) };
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');

  const card = page.locator('outbox-autofill');
  const look = card.getByRole('button', { name: 'Preview SDE-v3' });
  await look.click({ timeout: 15_000 });
  // No tab opens: the pages are drawn by the extension's own page, in a frame inside the card's window.
  await expect(card.getByRole('dialog', { name: 'Preview SDE-v3' })).toBeVisible();
  const preview = page.frameLocator('outbox-autofill iframe');
  await expect(preview.getByRole('heading', { name: 'SDE-v3' })).toBeVisible();
  // The file an employer is sent, and how long it is.
  await expect(preview.getByText('Alex_Chen_Resume.pdf · 2 pages')).toBeVisible();
  await expect(preview.getByRole('img')).toHaveCount(2);
  expect(context.pages()).toHaveLength(2);
  // Drawn as the PDF has it: the bar an inch under the top edge, paper below it.
  await expect.poll(() => inkAt(preview, 'Page 1', 0.5, 0.14)).toBeLessThan(60);
  expect(await inkAt(preview, 'Page 1', 0.5, 0.5)).toBe(255);
  await expect.poll(() => inkAt(preview, 'Page 2', 0.5, 0.14)).toBeLessThan(60);

  // A look is only that: the resumes are folded as they were, and the form's upload is empty.
  await expect(card.getByRole('radio', { name: 'SDE-v3' })).toBeChecked();
  expect(await page.locator('#resume').evaluate((input: HTMLInputElement) => input.files!.length)).toBe(0);

  // Escape, typed into the framed page, closes the window, and the keyboard is back where the look was asked for.
  await page.keyboard.down('Escape');
  await expect(card.getByRole('dialog', { name: /^Preview/ })).toHaveCount(0);
  await expect(look).toBeFocused();
});

test('looks at a version that isn’t the chosen one, from the open list, which waits as it was', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  outbox.snapshot = { ...SNAPSHOT, resumes: [...SNAPSHOT.resumes, SECOND] };
  outbox.pdfs = { 'res-1': pdfOf(2), 'res-2': pdfOf(1) };
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');

  const card = page.locator('outbox-autofill');
  const first = card.getByRole('radio', { name: 'SDE-v3' });
  const second = card.getByRole('radio', { name: 'Backend-v2' });
  await first.click({ timeout: 15_000 });
  await expect(second).toBeVisible();
  await card.getByRole('button', { name: 'Preview Backend-v2' }).click();

  const preview = page.frameLocator('outbox-autofill iframe');
  await expect(preview.getByRole('heading', { name: 'Backend-v2' })).toBeVisible();
  await expect(preview.getByText('Alex_Chen_Backend.pdf · 1 page')).toBeVisible();
  await expect(preview.getByRole('img')).toHaveCount(1);

  // Closed by a press beside it, it leaves the list open, the choice where it was and the keyboard at the eye that
  // was pressed: choosing is the line's own press.
  await page.mouse.click(100, 500);
  await expect(card.getByRole('dialog', { name: /^Preview/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Preview Backend-v2' })).toBeFocused();
  await expect(second).toBeVisible();
  await expect(first).toBeChecked();
  await second.click();
  await expect(second).toBeChecked();
});

test('says so where a resume’s PDF can’t be shown, or can’t be read', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  await serve(context, 'careers.acme-robotics.com', FORM, THANKS);
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');

  // The harness's own resume is a PDF by its first line only.
  const card = page.locator('outbox-autofill');
  const look = card.getByRole('button', { name: 'Preview SDE-v3' });
  await look.click({ timeout: 15_000 });
  const preview = page.frameLocator('outbox-autofill iframe');
  await expect(preview.getByRole('status')).toHaveText('This PDF can’t be shown here.');
  await expect(preview.getByRole('heading', { name: 'SDE-v3' })).toBeVisible();
  await preview.getByRole('button', { name: 'Close' }).click();
  await expect(card.getByRole('dialog', { name: /^Preview/ })).toHaveCount(0);

  // Outbox has lost the file, and this browser kept no copy of it: there's nothing to draw, and the window says it.
  outbox.pdfs = {};
  await worker.evaluate(
    () =>
      new Promise<void>((done) => {
        indexedDB.deleteDatabase('outbox-autofill').onsuccess = () => done();
      }),
  );
  await look.click();
  await expect(preview.getByRole('status')).toContainText('This resume’s PDF couldn’t be read.');
});

test('draws on a page whose own rules allow it neither frames nor workers', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  outbox.pdfs = { 'res-1': pdfOf(1) };
  // What the rules say goes for the page's own markup and scripts. The preview is the extension's page.
  await context.route('https://careers.acme-robotics.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "frame-src 'none'; child-src 'none'; worker-src 'none'" },
      body: `${FORM}<iframe id="theirs" src="https://careers.acme-robotics.com/about"></iframe>`,
    }),
  );
  const page = await context.newPage();
  const refused: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') refused.push(message.text());
  });
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');
  // The page's own frame is turned away, so the rules are in force.
  expect(refused.join('\n')).toContain("frame-src 'none'");

  await page
    .locator('outbox-autofill')
    .getByRole('button', { name: 'Preview SDE-v3' })
    .click({ timeout: 15_000 });
  const preview = page.frameLocator('outbox-autofill iframe');
  await expect(preview.getByText('Alex_Chen_Resume.pdf · 1 page')).toBeVisible();
  await expect.poll(() => inkAt(preview, 'Page 1', 0.5, 0.14)).toBeLessThan(60);
});

test('draws nothing for a page that frames the preview itself, or shows its ticket a second time', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  outbox.pdfs = { 'res-1': pdfOf(1) };
  const address = new URL('/preview.html', worker.url()).href;
  await serve(
    context,
    'careers.acme-robotics.com',
    FORM.replace('</main>', `<iframe id="theirs" src="${address}#ticket=made-up&dark=0"></iframe></main>`),
    THANKS,
  );
  const page = await context.newPage();
  await page.goto('https://careers.acme-robotics.com/jobs/42/apply');
  const theirs = page.frameLocator('#theirs');
  await expect(theirs.getByText('Open a resume’s preview from the Outbox Autofill card.')).toBeVisible();

  // The card's own look draws; the address it drew at, ticket and all, draws nothing again.
  const card = page.locator('outbox-autofill');
  await card.getByRole('button', { name: 'Preview SDE-v3' }).click({ timeout: 15_000 });
  const preview = page.frameLocator('outbox-autofill iframe');
  await expect(preview.getByRole('img')).toHaveCount(1);
  const used = await card.locator('iframe').getAttribute('src');
  expect(used).toContain(`${address}#ticket=`);
  await page.evaluate((src) => {
    const again = document.createElement('iframe');
    again.id = 'again';
    again.src = src;
    document.querySelector('main')!.append(again);
  }, used!);
  const again = page.frameLocator('#again');
  await expect(again.getByText('Open a resume’s preview from the Outbox Autofill card.')).toBeVisible();
  await expect(again.getByRole('img')).toHaveCount(0);
});
