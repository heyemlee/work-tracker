import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Framed } from './Framed';

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

describe('a window over the page with one of the extension’s pages in it', () => {
  it('asks for another ticket when its frame loads again, as when the page put the card back', async () => {
    const tickets = ['t1', 't2'];
    const ask = vi.fn(async () => ({ ticket: tickets.shift()! }));
    const host = document.body.appendChild(document.createElement('div'));
    await act(async () => {
      root = createRoot(host);
      root.render(
        <Framed
          name="settings"
          page="/options.html"
          title="Settings"
          dark={false}
          ask={ask}
          onClose={() => undefined}
          onStuck={() => undefined}
        />,
      );
    });
    const frame = () => host.querySelector('iframe')!;
    await vi.waitFor(() => expect(frame().getAttribute('src')).toContain('ticket=t1'));
    // The page draws on its ticket: the first load spends it.
    await act(async () => frame().dispatchEvent(new Event('load')));
    expect(ask).toHaveBeenCalledTimes(1);
    // Loaded again, on the spent ticket: it gets another.
    await act(async () => frame().dispatchEvent(new Event('load')));
    await vi.waitFor(() => expect(frame().getAttribute('src')).toContain('ticket=t2'));
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
