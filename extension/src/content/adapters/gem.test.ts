import { describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../test/fixtures';
import { extractFields } from '../extract';
import { adapterFor } from './index';
import { gem } from './gem';

// A page Gem's own code drew, from a made-up posting with each of its fields and kinds of question, and its EEOC
// section whole.
const url = 'https://jobs.gem.com/acme-robotics/am9icG9zdDr2DjIQ3bPcrRLp0z2TjYKi';
const page = () => loadFixture('gem/acme.html', url);

describe('gem', () => {
  it('is the adapter for a Gem board', () => {
    expect(adapterFor(url)).toBe(gem);
  });

  it('reads the posting, the company from the board’s name in the address', () => {
    expect(gem.posting(page(), `${url}?utm_source=linkedin`)).toMatchObject({
      ats: 'gem',
      company: 'Acme Robotics',
      title: 'Software Engineer',
      url,
      location: 'San Francisco (On-Site)',
    });
    expect(gem.posting(page(), url)?.description).toContain('We build things.');
  });

  it('takes the company’s own spelling from what the page tells search engines', () => {
    const doc = page();
    const data = doc.createElement('script');
    data.type = 'application/ld+json';
    data.textContent = JSON.stringify({ '@type': 'JobPosting', hiringOrganization: { name: '11x.ai' } });
    doc.head.append(data);
    expect(gem.posting(doc, 'https://jobs.gem.com/11x-ai/am9icG9zdDr2DjIQ3bPcrRLp0z2TjYKi')?.company).toBe(
      '11x.ai',
    );
  });

  it('says when the company’s own name came to the page after the form, and not when it never does', async () => {
    const named = (doc: Document) => {
      const data = doc.createElement('script');
      data.type = 'application/ld+json';
      data.textContent = JSON.stringify({ '@type': 'JobPosting', hiringOrganization: { name: '11x.ai' } });
      doc.head.append(data);
    };
    vi.useFakeTimers();
    try {
      const late = page();
      setTimeout(() => named(late), 400);
      const told = gem.postingLate!(late);
      await vi.advanceTimersByTimeAsync(500);
      expect(await told).toBe(true);

      // There from the start: the card has read it already.
      const early = page();
      named(early);
      expect(await gem.postingLate!(early)).toBe(false);

      // A board that tells search engines nothing.
      const never = gem.postingLate!(page());
      await vi.advanceTimersByTimeAsync(3100);
      expect(await never).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no posting on a board’s list of jobs, and no form before one is drawn', () => {
    const doc = document.implementation.createHTMLDocument('Jobs at Acme Robotics');
    doc.body.innerHTML = '<div id="content"><div class="formContainer-25"></div></div>';
    expect(gem.posting(doc, 'https://jobs.gem.com/acme-robotics')).toBeNull();
    expect(gem.form(doc)).toBeNull();
    expect(extractFields(gem, doc, 0).fields).toEqual([]);
  });

  it('names every field by the text set beside it, the controls carrying no name of their own', () => {
    const { fields } = extractFields(gem, page(), 0);
    expect(
      fields.map(
        (field) =>
          `${field.kind}${field.required ? ' *' : ''} ${field.label}${field.options.length ? ` [${field.options.join(' | ')}]` : ''}`,
      ),
    ).toEqual([
      'text * First name',
      'text * Last name',
      'text * Email',
      'text * Phone number',
      'text * Location',
      'text LinkedIn URL',
      'text Company',
      'text Job title',
      'file * Resume',
      'file Cover letter',
      'text GitHub profile',
      'textarea * Why do you want to work at Acme Robotics?',
      'radio * Will you now or in the future require sponsorship for employment visa status in the United States? [Yes | No | N/A]',
      'combobox * Are you legally authorized to work in the United States?',
      'multi How did you hear about us? [LinkedIn | Referral | Other]',
      'checkbox * Do you agree to our candidate privacy notice?',
      'radio * How would you rate your Python? [1 | 2 | 3 | 4 | 5]',
      'file Portfolio',
      'combobox Gender',
      'combobox Race',
      'combobox Veteran status',
      'combobox Disability status',
    ]);
    expect(fields.every((field) => !field.filled)).toBe(true);
    expect(fields.find((field) => /sponsorship/.test(field.label))?.description).toBe(
      'We may provide immigration and sponsorship support.',
    );
  });

  it('reads a dropdown as filled once its button shows a choice, and a rating once a number is pressed', () => {
    const doc = page();
    const { handles, fields } = extractFields(gem, doc, 0);
    const handleOf = (label: string) => handles.get(fields.find((field) => field.label === label)!.id)!;
    const gender = handleOf('Gender');
    const rating = handleOf('How would you rate your Python?');
    if (gender.type !== 'combobox' || rating.type !== 'buttons') throw new Error('not the widgets expected');
    gender.element.firstElementChild!.textContent = 'Decline to self-identify';
    rating.buttons[3]!.className += ' selected';

    const again = extractFields(gem, doc, 0).fields;
    expect(again.filter((field) => field.filled).map((field) => field.label)).toEqual([
      'How would you rate your Python?',
      'Gender',
    ]);
  });

  it('takes either of its two buttons for the one that sends the application', () => {
    const buttons = [gem.submitButton(page())].flat();
    expect(buttons.map((button) => button?.textContent)).toEqual(['Apply and save', 'Apply without saving']);
  });

  it('knows its confirmation, drawn where the form was', () => {
    const doc = page();
    expect(gem.confirmed(doc, url)).toBe(false);
    doc.querySelector('[class*="formContainer"]')!.innerHTML =
      '<div class="appSuccessContainer-9"><div class="h2-45">Congratulations!</div>' +
      '<div>Your application for Software Engineer has been received!</div><button>Save</button></div>';
    expect(gem.confirmed(doc, url)).toBe(true);
    expect(extractFields(gem, doc, 0).fields).toEqual([]);
  });
});
