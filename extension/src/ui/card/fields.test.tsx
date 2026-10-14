import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Count, End } from './fields';

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

/** A number kept as the settings keep the same-company limit: only a number above nothing is written. */
function Limit({ kept }: { kept: (value: number) => void }) {
  const [value, setValue] = useState<number | null>(3);
  return (
    <Count
      label="Limit"
      max={20}
      value={value}
      onChange={(next) => {
        if (next !== null && next > 0) {
          setValue(next);
          kept(next);
        }
      }}
    />
  );
}

const type = async (input: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('a number field', () => {
  it('can be emptied and typed anew, and keeps no more than its most', async () => {
    const saved: number[] = [];
    const host = document.body.appendChild(document.createElement('div'));
    await act(async () => {
      root = createRoot(host);
      root.render(<Limit kept={(value) => saved.push(value)} />);
    });
    const input = host.querySelector('input')!;
    await type(input, '');
    expect(input.value).toBe('');
    await type(input, '5');
    expect(input.value).toBe('5');
    expect(saved).toEqual([5]);
    await type(input, '35');
    expect(saved.at(-1)).toBe(20);
    // Left, it shows what was kept.
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.value).toBe('20');
  });
});

describe('when a job ended', () => {
  it('says "Present" again once the month field is left empty, and holds nothing of it for another job', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const outside = document.body.appendChild(document.createElement('button'));
    await act(async () => {
      root = createRoot(host);
      root.render(<End label="End" present="Present" value={null} onChange={() => undefined} />);
    });
    // Asked for a date: the month field shows, and takes the keyboard.
    await act(async () => host.querySelector<HTMLButtonElement>('button.input')!.click());
    const month = host.querySelector<HTMLInputElement>('input[type="month"]')!;
    expect(month).not.toBeNull();
    // Left with no month in it (the owner pressed Add job above): the job is current, as its value says.
    await act(async () => outside.focus());
    expect(host.querySelector('input[type="month"]')).toBeNull();
    expect(host.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('true');
  });
});
