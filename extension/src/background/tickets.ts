/**
 * The extension's own pages that the card shows in a frame inside its window, the settings and a resume's preview,
 * are reachable by address from any site. So framed, such a page draws only on a ticket: one the card asked for,
 * for its own tab and for the one thing it's about to show, good for one showing.
 */
export type Showing = { page: 'settings' } | { page: 'preview'; resumeId: string };

const tickets = new Map<string, { tabId: number; showing: Showing }>();

export function giveTicket(tabId: number, showing: Showing): { ticket: string } {
  const ticket = crypto.randomUUID();
  tickets.set(ticket, { tabId, showing });
  return { ticket };
}

/** What the framed page may show: what its ticket was given out for, in the tab it's in. A ticket works once. */
export function takeTicket(tabId: number | undefined, ticket: string): Showing | null {
  const given = tickets.get(ticket);
  tickets.delete(ticket);
  return given && given.tabId === tabId ? given.showing : null;
}

/** A closed tab's tickets are no use to anyone. */
export function dropTickets(tabId: number): void {
  for (const [ticket, given] of tickets) if (given.tabId === tabId) tickets.delete(ticket);
}
