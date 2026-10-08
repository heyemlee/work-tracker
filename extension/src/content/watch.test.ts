import { afterEach, describe, expect, it, vi } from 'vitest';
import { rebuildDocument } from '../test/rebuild';
import { watchForForm } from './watch';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hasInput = () => document.querySelector('input') !== null;

describe('watching a frame for its form', () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    document.body.innerHTML = '';
  });

  it('reports a form that is already there, at once', () => {
    document.body.innerHTML = '<input>';
    const found = vi.fn();
    stop = watchForForm(document, () => 'page', hasInput, found, 10);
    expect(found).toHaveBeenCalledTimes(1);
  });

  it('reports a form the page draws after loading, as Workday does', async () => {
    const found = vi.fn();
    stop = watchForForm(document, () => 'page', hasInput, found, 10);
    expect(found).not.toHaveBeenCalled();
    document.body.append(document.createElement('input'));
    await vi.waitFor(() => expect(found).toHaveBeenCalledTimes(1));
  });

  it('reports a hidden form once it is shown', async () => {
    document.body.innerHTML = '<div hidden><input></div>';
    const shown = () => document.querySelector('div:not([hidden]) input') !== null;
    const found = vi.fn();
    stop = watchForForm(document, () => 'page', shown, found, 10);
    expect(found).not.toHaveBeenCalled();
    document.querySelector('div')?.removeAttribute('hidden');
    await vi.waitFor(() => expect(found).toHaveBeenCalledTimes(1));
  });

  it('reports each place once, so a card closed there stays closed until the page moves on', async () => {
    let place = 'My Information';
    document.body.innerHTML = '<input>';
    const found = vi.fn();
    stop = watchForForm(document, () => place, hasInput, found, 10);
    document.body.append(document.createElement('input'));
    await pause(50);
    expect(found).toHaveBeenCalledTimes(1);
    place = 'My Experience';
    document.body.append(document.createElement('input'));
    await vi.waitFor(() => expect(found).toHaveBeenCalledTimes(2));
  });

  it('goes on watching a page that throws its document away and builds another', async () => {
    const found = vi.fn();
    stop = watchForForm(document, () => 'page', hasInput, found, 10);
    rebuildDocument();
    await pause(50);
    expect(found).not.toHaveBeenCalled();
    document.body.append(document.createElement('input'));
    await vi.waitFor(() => expect(found).toHaveBeenCalledTimes(1));
  });

  it('stops watching', async () => {
    const found = vi.fn();
    stop = watchForForm(document, () => 'page', hasInput, found, 10);
    stop();
    document.body.append(document.createElement('input'));
    await pause(50);
    expect(found).not.toHaveBeenCalled();
  });
});
