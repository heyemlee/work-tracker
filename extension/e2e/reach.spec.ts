import { expect, type Page, type Worker } from '@playwright/test';
import { seed, serve, test } from './harness';

// What a page can reach of the card on it, in the build Chrome loads: there the card's shadow root is closed, to
// Playwright's locators as much as to the page. So what's in the card is read here on the extension's side of the
// page, and pressed with the mouse where it is.
test.use({ build: 'production' });

const HOST = 'careers.acme-robotics.com';
const APPLY = `https://${HOST}/jobs/42/apply`;
const THANKS = '<!doctype html><title>Thanks</title><main><h1>Thank you for applying.</h1></main>';
const FORM =
  '<!doctype html><title>Robotics Engineer</title><main><h1>Robotics Engineer</h1><form>' +
  '<label for="first">First name</label><input id="first" name="first_name" required>' +
  '<label for="email">Email</label><input id="email" name="email" type="email" required>' +
  '<label for="resume">Resume/CV</label><input id="resume" name="resume" type="file">' +
  '<button type="submit">Submit application</button></form></main>';

/** What these specs use of the extension's own API: in its service worker, and on its side of a page. */
interface Chrome {
  tabs: { query(filter: { url: string }): Promise<{ id: number }[]> };
  scripting: {
    executeScript<Result>(injection: {
      target: { tabId: number };
      args: [string];
      func: (selector: string) => Result;
    }): Promise<{ result: Result }[]>;
  };
  dom: { openOrClosedShadowRoot(host: Element): ShadowRoot | null };
}

/** Something in the card: its words, what it holds if it's a field, and its middle on the screen. */
interface Seen {
  text: string;
  value: string | null;
  x: number;
  y: number;
}

/**
 * What matches a selector inside the card, read where the card's own script runs: there a closed root opens
 * (`chrome.dom`). Null where the page has no card.
 */
function inCard(worker: Worker, selector: string): Promise<Seen[] | null> {
  return worker.evaluate(
    async ({ selector, pages }) => {
      const { chrome } = globalThis as unknown as { chrome: Chrome };
      const [tab] = await chrome.tabs.query({ url: pages });
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId: tab!.id },
        args: [selector],
        func: (selector: string) => {
          const { chrome } = globalThis as unknown as { chrome: Chrome };
          const host = document.querySelector('outbox-autofill');
          const root = host && chrome.dom.openOrClosedShadowRoot(host);
          if (!root) return null;
          return [...root.querySelectorAll(selector)].map((element) => {
            const box = element.getBoundingClientRect();
            return {
              text: element.textContent ?? '',
              value: element instanceof HTMLInputElement ? element.value : null,
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
            };
          });
        },
      });
      return frame!.result;
    },
    { selector, pages: `https://${HOST}/*` },
  );
}

/** The same, once it's there and at rest: the card glides in, and a press aimed at where it was would miss. */
async function settled(worker: Worker, selector: string): Promise<Seen[]> {
  let seen: Seen[] = [];
  let before = '';
  await expect
    .poll(
      async () => {
        seen = (await inCard(worker, selector)) ?? [];
        const now = JSON.stringify(seen);
        const still = seen.length > 0 && now === before;
        before = now;
        return still;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return seen;
}

/**
 * What a page's script can try on the card: presses of its own making, on the card's element, on whatever it finds
 * at the spot, and on what a root left open would show it there.
 */
async function fakePress(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const host = document.querySelector<HTMLElement>('outbox-autofill')!;
    const found = [host, document.elementFromPoint(x, y), host.shadowRoot?.elementFromPoint(x, y)];
    for (const target of new Set(found)) {
      if (!(target instanceof HTMLElement)) continue;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y }),
        );
      target.click();
    }
  }, at);
  // Long enough for a press that got through to show.
  await page.waitForTimeout(500);
}

test('keeps the card out of the page’s reach, and in the owner’s hand', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, HOST, FORM, THANKS);
  const page = await context.newPage();
  // A page can swap `attachShadow` for its own, which opens every root made on its side and keeps hold of it. The
  // card's is made on the extension's side, which has its own `attachShadow`.
  await page.addInitScript(() => {
    const kept: ShadowRoot[] = [];
    Object.assign(window, { kept });
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const root = attach.call(this, { ...init, mode: 'open' });
      kept.push(root);
      return root;
    };
  });
  await page.goto(APPLY);
  const [fill] = await settled(worker, 'button.primary');
  expect(fill!.text).toBe('Fill');

  // The page finds the card's element, and nothing in it.
  expect(
    await page.evaluate(() => {
      const host = document.querySelector('outbox-autofill')!;
      return {
        root: host.shadowRoot,
        kept: (window as unknown as { kept: ShadowRoot[] }).kept.length,
        markup: host.innerHTML,
        read: document.body.innerText.includes('alex@example.com'),
      };
    }),
  ).toEqual({ root: null, kept: 0, markup: '', read: false });

  // A press the page makes up goes nowhere; the owner's fills the form.
  await fakePress(page, fill!);
  expect((await inCard(worker, 'button.primary'))?.[0]?.text).toBe('Fill');
  await expect(page.locator('#first')).toHaveValue('');
  await page.mouse.click(fill!.x, fill!.y);
  await expect(page.locator('#first')).toHaveValue('Alex');

  // The settings' frame is in the card too: the page has no hold on it, to point it somewhere else.
  const [more] = await settled(worker, '.menu-wrap > .icon-button');
  await page.mouse.click(more!.x, more!.y);
  const settings = (await settled(worker, '[role="menuitem"]')).find((item) => item.text === 'Settings');
  await page.mouse.click(settings!.x, settings!.y);
  await expect.poll(() => page.frames().some((frame) => frame.url().includes('/options.html'))).toBe(true);
  expect(
    await page.evaluate(() => ({ frames: window.length, found: document.querySelector('iframe') })),
  ).toEqual({ frames: 0, found: null });
});

test('keeps the profile’s window out of the page’s reach, and its Save in the owner’s hand', async ({
  context,
  worker,
  outbox,
}) => {
  await seed(worker, outbox.url);
  await serve(context, HOST, FORM, THANKS);
  const page = await context.newPage();
  await page.goto(APPLY);
  const [profile] = await settled(worker, 'button.choices.link');
  await page.mouse.click(profile!.x, profile!.y);
  const [first] = await settled(worker, '.sheet input');
  expect(first!.value).toBe('Alex');

  // The window is over the page, and the page sees neither its words nor its fields: only its own three.
  expect(
    await page.evaluate(() => ({
      root: document.querySelector('outbox-autofill')!.shadowRoot,
      fields: document.querySelectorAll('input, select, textarea').length,
      read: document.body.innerText.includes('Your autofill information'),
    })),
  ).toEqual({ root: null, fields: 3, read: false });

  // An edit by hand, then Save: pressed by the page, nothing is saved; pressed by the owner, the edit is.
  await page.mouse.click(first!.x, first!.y);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Alexander');
  const [save] = await settled(worker, '.sheet-foot .primary');
  await fakePress(page, save!);
  expect(outbox.profiles).toHaveLength(0);
  await page.mouse.click(save!.x, save!.y);
  await expect.poll(() => outbox.profiles.length).toBe(1);
  expect(outbox.profiles[0]).toMatchObject({ name: { first: 'Alexander', last: 'Chen' } });
});

test('draws no card where the page defined its element first', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  await serve(context, HOST, FORM, THANKS);
  const page = await context.newPage();
  // An element's definition is handed the element's shadow root, closed or not: a page that defines one by the
  // card's name before the card comes would hold the card's.
  await page.addInitScript(() => {
    const held: ElementInternals[] = [];
    Object.assign(window, { held });
    customElements.define(
      'outbox-autofill',
      class extends HTMLElement {
        constructor() {
          super();
          held.push(this.attachInternals());
        }
      },
    );
  });
  await page.goto(APPLY);

  // What the page got hold of, once the card's script has made its element: the words in each root, style aside.
  const held = () =>
    page.evaluate(() =>
      (window as unknown as { held: ElementInternals[] }).held.map((internals) =>
        [...(internals.shadowRoot?.children ?? [])]
          .filter((child) => child.localName !== 'style')
          .map((child) => child.textContent)
          .join(''),
      ),
    );
  await expect.poll(held, { timeout: 15_000 }).toHaveLength(1);
  expect(await held()).toEqual(['']);
  await expect(page.locator('outbox-autofill')).toHaveCount(0);
});

test('hands a page that defines its element afterwards nothing', async ({ context, worker, outbox }) => {
  await seed(worker, outbox.url);
  await serve(context, HOST, FORM, THANKS);
  const page = await context.newPage();
  await page.goto(APPLY);
  await settled(worker, 'button.primary');

  // The browser upgrades the card's element to the page's definition, and keeps the root it already had from it.
  const reached = await page.evaluate(() => {
    const reached: boolean[] = [];
    customElements.define(
      'outbox-autofill',
      class extends HTMLElement {
        constructor() {
          super();
          reached.push(this.attachInternals().shadowRoot !== null);
        }
      },
    );
    return reached;
  });
  expect(reached).toEqual([false]);
  expect(await inCard(worker, 'button.primary')).toHaveLength(1);
});
