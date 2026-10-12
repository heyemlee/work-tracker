import type { ResumePreview } from '../messages';
import { readResume } from '../resumes';
import { giveTicket, takeTicket } from './tickets';

/**
 * A resume's preview is the extension's own page in a frame inside the card's window, as the settings are. Drawing
 * a PDF takes pdf.js and its worker, which run there by the extension's own rules whatever the page under the card
 * allows itself, and the PDF never passes through that page. Framed, the preview draws only on the ticket the card
 * asked for (tickets.ts), and the ticket names the resume: the page is handed that one.
 */
export function openPreview(tabId: number, resumeId: string): { ticket: string } {
  return giveTicket(tabId, { page: 'preview', resumeId });
}

/** The resume the framed page may show: the one its ticket was given out for, in the tab it's in. */
export function enterPreview(tabId: number | undefined, ticket: string): string | null {
  const showing = takeTicket(tabId, ticket);
  return showing?.page === 'preview' ? showing.resumeId : null;
}

/**
 * What the preview shows of a resume, or `unread` where there's no PDF: Outbox holds none for it, or can't be
 * reached for one this browser keeps no copy of.
 */
export async function previewOf(resumeId: string): Promise<ResumePreview | 'unread'> {
  const read = await readResume(resumeId).catch(() => null);
  return read ? { label: read.label, file: { name: read.name, base64: read.base64 } } : 'unread';
}
