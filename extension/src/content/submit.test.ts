import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../test/fixtures';
import { ashby } from './adapters/ashby';
import { gem } from './adapters/gem';
import { greenhouse } from './adapters/greenhouse';
import { lever } from './adapters/lever';
import type { Adapter } from './adapters/types';
import { extractFields } from './extract';
import { emailsIn, watchSubmission } from './submit';

/** As much of an adapter as watching a submission asks of one, on a page that confirms once it says "Thank you". */
const adapter = {
  form: (doc: Document) => doc.querySelector('form'),
  submitButton: (doc: Document) => doc.querySelector<HTMLElement>('#send'),
  confirmed: (doc: Document) => /thank you/i.test(doc.body.textContent ?? ''),
} as unknown as Adapter;

const FORM = `<form>
  <input id="name" type="text" value="Alex Chen">
  <input id="email" type="email" value="  alex@example.com ">
  <button id="send" type="button"><span>Submit application</span></button>
</form>`;

describe('watching for a submission', () => {
  let stop = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = FORM;
  });
  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('tells of the owner’s press of Submit, with the emails the form holds as it’s sent', () => {
    const attempt = vi.fn();
    stop = watchSubmission(adapter, document, attempt, vi.fn());
    // Typed since the page was first read: the form is read as it stands when it's sent.
    document.querySelector<HTMLInputElement>('#email')!.value = 'alex.chen@example.org';
    document.querySelector<HTMLElement>('#send span')!.click();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith(['alex.chen@example.org']);
  });

  it('takes a form sent with the Enter key for an attempt too', () => {
    const attempt = vi.fn();
    stop = watchSubmission(adapter, document, attempt, vi.fn());
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(attempt).toHaveBeenCalledWith(['alex@example.com']);
  });

  it('tells of the confirmation once the page shows it, and only once', async () => {
    const confirmed = vi.fn();
    stop = watchSubmission(adapter, document, vi.fn(), confirmed);
    document.querySelector<HTMLElement>('#send')!.click();
    await vi.advanceTimersByTimeAsync(1300);
    expect(confirmed).not.toHaveBeenCalled();

    document.body.innerHTML = '<h1>Thank you for applying.</h1>';
    await vi.advanceTimersByTimeAsync(3000);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it('doesn’t take another form on the page for the application, though it watches what the page says next', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<form id="search"><input name="q" value="engineer"></form>',
    );
    const attempt = vi.fn();
    const confirmed = vi.fn();
    stop = watchSubmission(adapter, document, attempt, confirmed);
    document
      .querySelector('#search')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(attempt).not.toHaveBeenCalled();

    // Whether what the page then says is an application's doing is for the service worker to tell.
    document.body.innerHTML = '<h1>Thank you for applying.</h1>';
    await vi.advanceTimersByTimeAsync(1300);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it('tells of the next application sent from the same document, once the last one’s confirmation has left the page', async () => {
    const attempt = vi.fn();
    const confirmed = vi.fn();
    stop = watchSubmission(adapter, document, attempt, confirmed);
    document.querySelector<HTMLElement>('#send')!.click();
    document.body.innerHTML = '<h1>Thank you for applying.</h1>';
    await vi.advanceTimersByTimeAsync(1300);
    expect(confirmed).toHaveBeenCalledTimes(1);

    // The board moves on to another posting without loading a page, and that one's form is sent too.
    document.body.innerHTML = FORM;
    await vi.advanceTimersByTimeAsync(1300);
    document.querySelector<HTMLElement>('#send')!.click();
    await vi.advanceTimersByTimeAsync(1300);
    expect(confirmed).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '<h1>Thank you for applying.</h1>';
    await vi.advanceTimersByTimeAsync(1300);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(confirmed).toHaveBeenCalledTimes(2);
  });

  it('doesn’t tell of a confirmation again for a form sent while it still stands', async () => {
    const confirmed = vi.fn();
    stop = watchSubmission(adapter, document, vi.fn(), confirmed);
    document.querySelector<HTMLElement>('#send')!.click();
    document.body.insertAdjacentHTML('afterbegin', '<h1>Thank you for applying.</h1>');
    await vi.advanceTimersByTimeAsync(1300);
    document.querySelector<HTMLElement>('#send')!.click();
    await vi.advanceTimersByTimeAsync(3000);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it('says nothing of a confirmation while no form was sent', async () => {
    const confirmed = vi.fn();
    stop = watchSubmission(adapter, document, vi.fn(), confirmed);
    document.body.innerHTML = '<h1>Thank you for applying.</h1>';
    await vi.advanceTimersByTimeAsync(3000);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('reads a thank-you in the turn the page draws it, before the browser’s translation has reworded it', async () => {
    const confirmed = vi.fn();
    stop = watchSubmission(adapter, document, vi.fn(), confirmed);
    document.querySelector<HTMLElement>('#send')!.click();
    await vi.advanceTimersByTimeAsync(100);

    document.body.innerHTML = '<h1>Thank you for applying.</h1>';
    // Chrome's translation puts its words where the page's stood within a tenth of a second: long before the page
    // is next looked at by the clock.
    await vi.advanceTimersByTimeAsync(80);
    document.querySelector('h1')!.innerHTML =
      '<font dir="auto" style="vertical-align: inherit;"><font>感谢您的申请。</font></font>';
    await vi.advanceTimersByTimeAsync(3000);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });

  it('looks when the page draws something, not when it only takes something away or marks it', async () => {
    const looks = vi.spyOn(adapter, 'confirmed');
    stop = watchSubmission(adapter, document, vi.fn(), vi.fn());
    document.querySelector<HTMLElement>('#send')!.click();
    await vi.advanceTimersByTimeAsync(0);
    looks.mockClear();

    document.querySelector('#name')!.remove();
    document.querySelector('form')!.className = 'sending';
    await vi.advanceTimersByTimeAsync(0);
    expect(looks).not.toHaveBeenCalled();

    document.body.insertAdjacentHTML('beforeend', '<p>Sending…</p>');
    await vi.advanceTimersByTimeAsync(0);
    expect(looks).toHaveBeenCalledTimes(1);
    // Words changed where they stand are drawn too.
    document.querySelector('p')!.firstChild!.nodeValue = 'Sent.';
    await vi.advanceTimersByTimeAsync(0);
    expect(looks).toHaveBeenCalledTimes(2);
  });

  it('no longer looks at what the page draws once the confirmation is told, two minutes are up, or it is stopped', async () => {
    const looks = vi.spyOn(adapter, 'confirmed');
    const draw = async () => {
      looks.mockClear();
      document.body.insertAdjacentHTML('beforeend', '<p>We will be in touch.</p>');
      await vi.advanceTimersByTimeAsync(5000);
      return looks.mock.calls.length;
    };
    stop = watchSubmission(adapter, document, vi.fn(), vi.fn());
    document.querySelector<HTMLElement>('#send')!.click();
    document.body.insertAdjacentHTML('afterbegin', '<h1>Thank you for applying.</h1>');
    await vi.advanceTimersByTimeAsync(0);
    expect(await draw()).toBe(0);

    stop();
    document.body.innerHTML = FORM;
    stop = watchSubmission(adapter, document, vi.fn(), vi.fn());
    document.querySelector<HTMLElement>('#send')!.click();
    await vi.advanceTimersByTimeAsync(121_000);
    expect(await draw()).toBe(0);

    document.querySelector<HTMLElement>('#send')!.click();
    stop();
    expect(await draw()).toBe(0);
  });

  it('tells of a confirmation page it starts on: the form was sent from the page before', async () => {
    document.body.innerHTML = '<h1>Thank you for applying.</h1>';
    const confirmed = vi.fn();
    stop = watchSubmission(adapter, document, vi.fn(), confirmed);
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });
});

describe('the emails a form holds', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('are read from its text and email fields, each once', () => {
    document.body.innerHTML = `<form>
      <input value="Alex Chen">
      <input value="alex@example.com">
      <input type="email" value="alex@example.com">
      <input type="email" value="alex.chen@example.org">
      <input type="email" value="not an email">
      <input type="hidden" value="hidden@example.com">
      <input type="password" value="pass@word.example">
      <textarea>written@example.com</textarea>
    </form>
    <input type="email" value="newsletter@example.com">`;
    expect(emailsIn(document.querySelector('form')!)).toEqual(['alex@example.com', 'alex.chen@example.org']);
  });
});

// The application pages saved as their sites served them, and the two drawn from made-up postings: each under its
// own adapter, at an address of that system's.
const SYSTEMS: Record<string, [Adapter, string]> = {
  greenhouse: [greenhouse, 'https://job-boards.greenhouse.io/acme/jobs/123'],
  lever: [lever, 'https://jobs.lever.co/acme/123/apply'],
  ashby: [ashby, 'https://jobs.ashbyhq.com/acme/123/application'],
  gem: [gem, 'https://jobs.gem.com/acme/123'],
};
const SAVED = resolve(__dirname, '../../test/fixtures');
const pages = Object.keys(SYSTEMS).flatMap((system) =>
  readdirSync(resolve(SAVED, system))
    .filter((name) => name.endsWith('.html'))
    .map((name) => `${system}/${name}`),
);

describe.each(pages)('the saved page %s', (path) => {
  const [system, url] = SYSTEMS[path.split('/')[0]!]!;

  // A page's long lists (Lever's countries and universities) take a second or two to read here.
  it(
    'is no confirmation while it shows its form, and gives up the email typed into it',
    { timeout: 30_000 },
    () => {
      const doc = loadFixture(path, url);
      expect(system.confirmed(doc, url)).toBe(false);

      const { fields, handles } = extractFields(system, doc, 0);
      const email = fields.find(
        (field) => field.hint === 'email' || field.kind === 'email' || /^e-?mail/i.test(field.label),
      );
      const handle = email && handles.get(email.id);
      if (handle?.type !== 'input') throw new Error('No email field was read on this page.');
      handle.element.value = ' alex@example.com ';
      const form = system.form(doc);
      expect(form).not.toBeNull();
      expect(emailsIn(form!)).toEqual(['alex@example.com']);
    },
  );
});
