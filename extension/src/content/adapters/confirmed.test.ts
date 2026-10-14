import { afterEach, describe, expect, it } from 'vitest';
import { generic } from './generic';
import { workday } from './workday';

/** A confirmation as pages draw them: behind a long menu, after a script, or in a dialog at the end of the page. */
describe('a confirmation told by its words', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const menu = `<nav>${Array.from({ length: 200 }, (_, at) => `<a href="/jobs/${at}">Open roles in team ${at}</a>`).join('')}</nav>`;

  it('is read where the page puts its main content, wherever that is in the page', () => {
    document.body.innerHTML = `${menu}<main><h1>Thank you for applying!</h1></main>`;
    expect(generic.confirmed(document, 'https://careers.example.com/apply')).toBe(true);
  });

  it('is read without the text of the page’s scripts', () => {
    const config = `<script>window.__config = ${JSON.stringify({ strings: 'x'.repeat(3200) })};</script>`;
    document.body.innerHTML = `${config}<div><p>Thank you for applying!</p></div>`;
    expect(generic.confirmed(document, 'https://careers.example.com/apply')).toBe(true);
    // Nor taken from them: a page whose script holds the words, and that says nothing of the kind.
    document.body.innerHTML = `<script>const done = "Thank you for applying!";</script><form><input></form>`;
    expect(generic.confirmed(document, 'https://careers.example.com/apply')).toBe(false);
  });

  it('is read in Workday’s note for someone applying without an account, after a long list of jobs', () => {
    const jobs = `<ul>${Array.from({ length: 150 }, (_, at) => `<li>Software Engineer ${at}, Santa Clara, CA</li>`).join('')}</ul>`;
    document.body.innerHTML = `<main>${jobs}</main><div role="dialog" data-automation-id="applicationSubmittedDialog">Congratulations! Your application was submitted.</div>`;
    expect(
      workday.confirmed(document, 'https://acme.wd5.myworkdayjobs.com/en-US/External?Job_Application_ID=1'),
    ).toBe(true);
  });
});
