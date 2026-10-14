import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBackground, type CardState } from '../../messages';
import type { Posting } from '../../model';
import { Card } from './Card';

vi.mock('../../messages', async (original) => ({
  ...(await original<typeof import('../../messages')>()),
  toBackground: vi.fn(),
}));

const { happyDOM } = window as unknown as { happyDOM: { setURL(url: string): void } };
const first = location.href;
const SEARCH = 'https://www.linkedin.com/jobs/search/?currentJobId=';
const posting = (id: string, title: string): Posting => ({
  ats: 'linkedin',
  company: 'Acme',
  title,
  url: `https://www.linkedin.com/jobs/view/${id}/`,
  location: null,
  description: '',
});

let root: Root | undefined;
/** The card's state on a LinkedIn posting, as the service worker sends it. */
const base: CardState = {
  phase: 'idle',
  ats: 'linkedin',
  posting: null,
  hasForm: false,
  applying: false,
  sends: false,
  jobPage: true,
  otherForm: false,
  step: null,
  outbox: 'connected',
  profile: { name: 'Alex Chen', blanks: 0 },
  accounts: [],
  accountId: null,
  resumes: [],
  resumeId: null,
  match: null,
  duplicateHint: false,
  checklist: [],
  logged: null,
  saved: null,
  tracked: null,
  ai: 'off',
  error: null,
} as unknown as CardState;

beforeEach(() => {
  happyDOM.setURL(`${SEARCH}1`);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.mocked(toBackground).mockReset();
  happyDOM.setURL(first);
});

describe('the card as LinkedIn moves to another posting in place', () => {
  it('stays where the next posting is drawn only after the address has moved', async () => {
    // What the card reads: the posting it came up for, then nothing (the next one isn't drawn yet), then that one.
    const reads: CardState[] = [
      { ...base, ats: 'linkedin', jobPage: true, posting: posting('1', 'Data Engineer') },
      { ...base, ats: 'linkedin', jobPage: true, posting: null },
      { ...base, ats: 'linkedin', jobPage: true, posting: posting('2', 'Software Engineer') },
    ];
    vi.mocked(toBackground).mockImplementation((async (type: string) =>
      type === 'card:state' ? (reads.shift() ?? reads.at(-1)) : undefined) as never);
    const host = document.body.appendChild(document.createElement('div'));
    await act(async () => {
      root = createRoot(host);
      root.render(<Card startOpen />);
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Data Engineer'));
    happyDOM.setURL(`${SEARCH}2`);
    await vi.waitFor(() => expect(host.textContent).toContain('Software Engineer'), { timeout: 4000 });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('goes where the second look finds nothing either, as on a board’s list of jobs', async () => {
    const reads: CardState[] = [
      { ...base, posting: posting('1', 'Data Engineer') },
      { ...base, posting: null },
      { ...base, posting: null },
    ];
    vi.mocked(toBackground).mockImplementation((async (type: string) =>
      type === 'card:state' ? (reads.shift() ?? { ...base, posting: null }) : undefined) as never);
    const host = document.body.appendChild(document.createElement('div'));
    await act(async () => {
      root = createRoot(host);
      root.render(<Card startOpen />);
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Data Engineer'));
    happyDOM.setURL(`${SEARCH}2`);
    await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).toBeNull(), { timeout: 4000 });
  });
});
