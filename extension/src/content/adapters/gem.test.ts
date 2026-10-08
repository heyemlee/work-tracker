import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FrameHeld, FrameScan, PlannedField } from '../../model';
import { loadFixture } from '../../test/fixtures';
import { textOf } from '../dom';
import { extractFields } from '../extract';
import { heldBy } from '../held';
import { startContent } from '../main';
import { setFiles } from '../widgets';
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

/** The block of one of the form's questions, by the text set beside its control. */
const blockOf = (doc: Document, label: string) =>
  [...doc.querySelectorAll('[class*="formContainer"] [class*="bodyImportant"]')].find(
    (text) => textOf(text) === label,
  )!.parentElement!;

/**
 * An upload as Gem's own code draws it, copied from its page: while it holds a file, the file's name over the box
 * with a ✕ beside it, and the box offering to replace the file.
 */
function draw(block: Element, name: string | null): void {
  block.querySelector('[class*="fileContainer"]')?.remove();
  const box = block.querySelector('[role="presentation"]')!;
  if (name)
    box.parentElement!.parentElement!.insertAdjacentHTML(
      'beforebegin',
      `<div class="fileContainer-163"><div class="body-41 primary-44">${name}</div>` +
        '<button type="button" class="button-130 extraSmall-131 light-136" aria-label="cross">' +
        '<i class="container-11 extraSmall-12"></i></button></div>',
    );
  box.querySelector('[class*="promptText"]')!.textContent =
    `Click to ${name ? 'replace' : 'upload'} or drag and drop here`;
}

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

describe('gem: the file an upload holds', () => {
  it('is the one Gem names over the box, whatever the input holds', () => {
    const doc = page();
    const block = blockOf(doc, 'Resume');
    const input = block.querySelector<HTMLInputElement>('input[type="file"]')!;
    const read = () => {
      const { fields, handles } = extractFields(gem, doc, 0);
      const field = fields.find((item) => item.label === 'Resume')!;
      return { filled: field.filled, held: heldBy(handles.get(field.id)!) };
    };
    expect(read()).toEqual({ filled: false, held: { filled: false } });

    // Attached through the input, and named by Gem.
    setFiles(input, [pdf('Alex_Chen_Resume.pdf')]);
    draw(block, 'Alex_Chen_Resume.pdf');
    expect(read()).toEqual({ filled: true, held: { filled: true, value: 'Alex_Chen_Resume.pdf' } });

    // Its ✕ pressed: Gem has forgotten the file, which the input goes on holding.
    draw(block, null);
    expect(input.files?.[0]?.name).toBe('Alex_Chen_Resume.pdf');
    expect(read()).toEqual({ filled: false, held: { filled: false } });

    // Another dropped onto the box, or picked in the dialog the box opens: the input never gets that one.
    draw(block, 'Dropped_By_Hand.pdf');
    expect(read()).toEqual({ filled: true, held: { filled: true, value: 'Dropped_By_Hand.pdf' } });
  });

  it('is read upload by upload', () => {
    const doc = page();
    draw(blockOf(doc, 'Cover letter'), 'Cover_Letter.pdf');
    const { fields } = extractFields(gem, doc, 0);
    expect(
      fields.filter((field) => field.kind === 'file').map((field) => [field.label, field.filled]),
    ).toEqual([
      ['Resume', false],
      ['Cover letter', true],
      ['Portfolio', false],
    ]);
  });
});

describe('gem: filling again once the resume was taken out or put in by hand', () => {
  type Respond = (value: unknown) => void;
  type Listener = (message: object, sender: object, respond: Respond) => boolean;
  type Results = Record<string, { ok: boolean; value?: string; error?: string }>;

  const RESUMES: Record<string, string> = {
    'res-1': 'Alex_Chen_Resume.pdf',
    'res-2': 'Alex_Chen_Resume_AI.pdf',
  };
  const { happyDOM } = window as unknown as { happyDOM: { setURL(url: string): void } };
  const home = location.href;
  let stop = () => {};

  /** Starts the content script on Gem's page, in the test's own document, and returns a way to message it. */
  function start() {
    happyDOM.setURL(url);
    document.body.innerHTML = page().body.innerHTML;
    let listener: Listener | undefined;
    vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation(((fn: Listener) => {
      listener ??= fn;
    }) as never);
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (message: {
      type: string;
      resumeId?: string;
    }) =>
      message.type === 'resume:read'
        ? { base64: btoa('%PDF-1.4'), name: RESUMES[message.resumeId ?? ''], type: 'application/pdf' }
        : undefined) as never);
    stop = startContent();
    return <T>(message: object) =>
      new Promise<T>((resolve) => listener!(message, {}, (value) => resolve(value as T)));
  }

  /**
   * Stands in for Gem's own code round the resume's upload, as it was seen to behave: a file the input takes is
   * named a moment later, a file dropped onto the box (or picked in the dialog it opens) is named without the
   * input ever holding it, and ✕ forgets the file while the input keeps its own.
   */
  function gemResume() {
    const block = blockOf(document, 'Resume');
    const input = block.querySelector<HTMLInputElement>('input[type="file"]')!;
    const cross = () => block.querySelector<HTMLElement>('[class*="fileContainer"] button');
    const holds = (name: string | null) => {
      draw(block, name);
      cross()?.addEventListener('click', () => holds(null));
    };
    let attached = 0;
    input.addEventListener('change', () => {
      attached++;
      const name = input.files?.[0]?.name ?? null;
      setTimeout(() => holds(name), 3);
    });
    return {
      input,
      attached: () => attached,
      shown: () => textOf(block.querySelector('[class*="fileContainer"]')) || null,
      drop: (name: string) => holds(name),
      remove: () => cross()!.click(),
    };
  }

  /** Reads the page and fills the resume alone, as the card's "Fill" and "Fill again" would have it done. */
  async function fill(ask: ReturnType<typeof start>, resumeId = 'res-1') {
    const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    const field = scan.fields.find((item) => item.label === 'Resume')!;
    const entry: PlannedField = {
      fieldId: field.id,
      status: 'filled',
      answer: { type: 'file', resumeId },
      source: 'rule',
      key: 'resume',
      note: null,
      critical: false,
    };
    const results = await ask<Results>({ type: 'frame:fill', fields: [entry] });
    return { id: field.id, filled: field.filled, result: results[field.id] };
  }

  /** What the service worker was last told the resume's upload holds, for the card's list. */
  const told = (id: string) =>
    vi
      .mocked(fakeBrowser.runtime.sendMessage)
      .mock.calls.map(([message]) => message as unknown as { type: string } & FrameHeld)
      .filter((message) => message.type === 'frame:held')
      .at(-1)?.fields[id];

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    happyDOM.setURL(home);
  });

  it('attaches the resume again after Gem’s ✕, having told the card that the upload is empty', async () => {
    const ask = start();
    const resume = gemResume();

    const first = await fill(ask);
    expect(first.result).toMatchObject({ ok: true, value: 'Alex_Chen_Resume.pdf' });
    expect(resume.shown()).toBe('Alex_Chen_Resume.pdf');
    await vi.waitFor(() => expect(told(first.id)).toEqual({ filled: true, value: 'Alex_Chen_Resume.pdf' }));
    // The same resume asked for again while Gem holds it: it's there, and isn't put in a second time.
    await fill(ask);
    expect(resume.attached()).toBe(1);

    resume.remove();
    expect(resume.input.files?.[0]?.name).toBe('Alex_Chen_Resume.pdf');
    await vi.waitFor(() => expect(told(first.id)).toEqual({ filled: false }));
    const again = await fill(ask);
    expect(again.filled).toBe(false);
    expect(again.result).toMatchObject({ ok: true, value: 'Alex_Chen_Resume.pdf' });
    expect(resume.attached()).toBe(2);
    expect(resume.shown()).toBe('Alex_Chen_Resume.pdf');
    await vi.waitFor(() => expect(told(first.id)).toEqual({ filled: true, value: 'Alex_Chen_Resume.pdf' }));

    // Another resume chosen on the card takes its place, once: what Gem shows by then is this script's own.
    expect((await fill(ask, 'res-2')).result?.value).toBe('Alex_Chen_Resume_AI.pdf');
    expect(resume.shown()).toBe('Alex_Chen_Resume_AI.pdf');
    await fill(ask, 'res-2');
    expect(resume.attached()).toBe(3);
  });

  it('keeps a file the owner dropped onto the box, which the input never held', async () => {
    const ask = start();
    const resume = gemResume();
    await fill(ask);

    resume.drop('Dropped_By_Hand.pdf');
    const kept = await fill(ask);
    expect(kept.filled).toBe(true);
    expect(kept.result).toMatchObject({ ok: true, value: 'Dropped_By_Hand.pdf' });
    await vi.waitFor(() => expect(told(kept.id)).toEqual({ filled: true, value: 'Dropped_By_Hand.pdf' }));
    // Theirs, as a file they chose in any other form's upload is: another resume on the card doesn't replace it.
    await fill(ask, 'res-2');
    expect(resume.attached()).toBe(1);
    expect(resume.shown()).toBe('Dropped_By_Hand.pdf');
  });
});
