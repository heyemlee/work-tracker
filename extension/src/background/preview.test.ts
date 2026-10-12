import { beforeEach, describe, expect, it, vi } from 'vitest';

const readResume =
  vi.fn<(id: string) => Promise<{ label: string; name: string; type: string; base64: string } | null>>();
vi.mock('../resumes', () => ({ readResume, clearResumeCopies: vi.fn() }));

const { enterPreview, openPreview, previewOf } = await import('./preview');
const { enterSettings, openSettings } = await import('./settings');
const { dropTickets } = await import('./tickets');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('showing a resume in the card’s window', () => {
  it('names the resume the card asked to look at, to the framed page in that tab, once', () => {
    const { ticket } = openPreview(7, 'res-1');
    expect(enterPreview(7, ticket)).toBe('res-1');
    // The same ticket again is a page that read it off the frame's address.
    expect(enterPreview(7, ticket)).toBeNull();
  });

  it('refuses a ticket that wasn’t given out, was given to another tab, or whose tab has closed', () => {
    expect(enterPreview(7, '')).toBeNull();
    expect(enterPreview(8, openPreview(7, 'res-1').ticket)).toBeNull();
    expect(enterPreview(undefined, openPreview(7, 'res-1').ticket)).toBeNull();
    const { ticket } = openPreview(9, 'res-1');
    dropTickets(9);
    expect(enterPreview(9, ticket)).toBeNull();
  });

  it('keeps the settings’ tickets and a resume’s apart', () => {
    expect(enterPreview(7, openSettings(7).ticket)).toBeNull();
    expect(enterSettings(7, openPreview(7, 'res-1').ticket)).toBe(false);
  });

  it('hands over the version’s name, the file’s and the PDF', async () => {
    readResume.mockResolvedValue({
      label: 'SDE-v3',
      name: 'Alex_Chen_Resume.pdf',
      type: 'application/pdf',
      base64: 'JVBERi0x',
    });
    expect(await previewOf('res-1')).toEqual({
      label: 'SDE-v3',
      file: { name: 'Alex_Chen_Resume.pdf', base64: 'JVBERi0x' },
    });
    expect(readResume).toHaveBeenCalledWith('res-1');
  });

  it('says so where there’s no PDF to read', async () => {
    readResume.mockResolvedValue(null);
    expect(await previewOf('res-1')).toBe('unread');
    readResume.mockRejectedValue(new Error('The browser’s store is closed'));
    expect(await previewOf('res-1')).toBe('unread');
  });
});
