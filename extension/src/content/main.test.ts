import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FrameScan, PlannedField } from '../model';
import { startContent } from './main';

const FORM = `
<form>
  <label for="name">Full name</label><input id="name">
  <label for="email">Email</label><input id="email" type="email">
  <label for="phone">Phone</label><input id="phone">
  <label for="org">Current company</label><input id="org">
  <label for="linkedin">LinkedIn</label><input id="linkedin">
  <label for="resume">Resume</label><input id="resume" type="file">
</form>`;

type Respond = (value: unknown) => void;
type Listener = (message: object, sender: object, respond: Respond) => boolean;

/** Starts the content script on the page and returns a way to message it as the service worker does. */
function start() {
  let listener: Listener | undefined;
  vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation(((fn: Listener) => {
    listener ??= fn;
  }) as never);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (message: { type: string }) =>
    message.type === 'resume:read'
      ? { base64: btoa('%PDF-1.4'), name: 'Alex_Chen_Resume.pdf', type: 'application/pdf' }
      : undefined) as never);
  startContent();
  return <T>(message: object) =>
    new Promise<T>((resolve) => listener!(message, {}, (value) => resolve(value as T)));
}

const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;

function plan(scan: FrameScan, texts: Record<string, string>): PlannedField[] {
  return scan.fields.map((field) => {
    const id = {
      'Full name': 'name',
      Email: 'email',
      Phone: 'phone',
      'Current company': 'org',
      LinkedIn: 'linkedin',
    }[field.label];
    return {
      fieldId: field.id,
      status: 'filled',
      answer:
        field.kind === 'file'
          ? { type: 'file', resumeId: 'res-1' }
          : { type: 'text', text: texts[id ?? ''] ?? '' },
      source: 'rule',
      key: id === 'email' ? 'email' : (id ?? null),
      note: null,
      critical: false,
    };
  });
}

const ANSWERS = {
  name: 'Alex Chen',
  email: 'alex@example.com',
  phone: '+1 650 555 0199',
  org: 'Acme AI',
  linkedin: 'https://www.linkedin.com/in/alex-chen',
};

afterEach(() => vi.restoreAllMocks());

describe('filling a page that fills fields of its own', () => {
  it('keeps what the resume parser and the owner put there, and fills the rest', async () => {
    const ask = start();
    document.body.innerHTML = FORM;
    // The owner typed a phone number before filling; the page reads the resume once it's uploaded.
    input('phone').value = '+1 408 555 0100';
    input('resume').addEventListener('change', () => {
      input('name').value = 'Alexander Chen';
      input('email').value = 'alex.chen@gmail.com';
      input('org').value = 'Acme AI Labs';
    });

    const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
    const results = await ask<Record<string, { ok: boolean; value?: string }>>({
      type: 'frame:fill',
      fields: plan(scan, ANSWERS),
    });

    expect(input('resume').files?.[0]?.name).toBe('Alex_Chen_Resume.pdf');
    expect(input('name').value).toBe('Alexander Chen');
    expect(input('org').value).toBe('Acme AI Labs');
    expect(input('phone').value).toBe('+1 408 555 0100');
    // The email names the account applying, whatever the resume says.
    expect(input('email').value).toBe('alex@example.com');
    expect(input('linkedin').value).toBe('https://www.linkedin.com/in/alex-chen');
    const name = scan.fields.find((field) => field.label === 'Full name')!;
    expect(results[name.id]).toEqual({ ok: true, value: 'Alexander Chen' });
  });

  it('fills its own answers again, and still leaves the page’s alone', async () => {
    const ask = start();
    document.body.innerHTML = FORM;
    input('org').value = 'Acme AI Labs';
    const fill = async (answers: Record<string, string>) => {
      const scan = await ask<FrameScan>({ type: 'frame:scan', frameId: 0, prepare: null });
      await ask({
        type: 'frame:fill',
        fields: plan(scan, answers).filter((entry) => entry.answer?.type !== 'file'),
      });
      return scan;
    };

    const first = await fill(ANSWERS);
    expect(first.fields.find((field) => field.label === 'LinkedIn')?.filled).toBe(false);
    const second = await fill({ ...ANSWERS, linkedin: 'https://www.linkedin.com/in/alexchen' });
    // Its own answer isn't the page's: the next scan reads it as open, and the next fill replaces it.
    expect(second.fields.find((field) => field.label === 'LinkedIn')?.filled).toBe(false);
    expect(input('linkedin').value).toBe('https://www.linkedin.com/in/alexchen');
    expect(input('org').value).toBe('Acme AI Labs');
  });
});
