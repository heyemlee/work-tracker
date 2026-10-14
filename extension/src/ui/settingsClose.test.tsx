import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '../../entrypoints/options/App';
import { settingsItem } from '../storage';

vi.mock('../messages', async (original) => ({
  ...(await original<typeof import('../messages')>()),
  toBackground: vi.fn(async () => undefined),
}));

let root: Root | undefined;

beforeEach(async () => {
  fakeBrowser.reset();
  await settingsItem.setValue({ language: 'en' } as never);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

/** The settings, drawn in the card's window, with an address typed into a field and not yet kept. */
async function typed(): Promise<HTMLInputElement> {
  const host = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    root = createRoot(host);
    root.render(<App framed dark={false} />);
  });
  const field = await vi.waitFor(() => {
    const label = [...document.querySelectorAll('label')].find((one) =>
      one.textContent?.startsWith('Outbox address'),
    );
    const input = label?.closest('.field, div')?.querySelector('input');
    if (!input) throw new Error('no field yet');
    return input as HTMLInputElement;
  });
  field.focus();
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(field, 'https://outbox.example.com');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}

describe('the settings’ window, closed with something typed and not yet kept', () => {
  it('keeps it when Escape closes the window', async () => {
    await typed();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await vi.waitFor(async () =>
      expect((await settingsItem.getValue())?.outboxUrl).toBe('https://outbox.example.com'),
    );
  });

  it('keeps it when the card says the window is closing (a press beside it)', async () => {
    await typed();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'settings:closing' }, source: window }),
      );
    });
    await vi.waitFor(async () =>
      expect((await settingsItem.getValue())?.outboxUrl).toBe('https://outbox.example.com'),
    );
  });
});
