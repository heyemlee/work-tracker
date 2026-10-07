import { describe, expect, it } from 'vitest';
import { dropTickets, enterSettings, openSettings } from './settings';

describe('showing the settings in the card’s window', () => {
  it('lets the framed page draw in the tab the card asked from, once', () => {
    const { ticket } = openSettings(7);
    expect(enterSettings(7, ticket)).toBe(true);
    // The same ticket again is a page that read it off the frame's address.
    expect(enterSettings(7, ticket)).toBe(false);
  });

  it('refuses a ticket that wasn’t given out, or was given to another tab', () => {
    expect(enterSettings(7, '')).toBe(false);
    expect(enterSettings(7, crypto.randomUUID())).toBe(false);
    const { ticket } = openSettings(7);
    expect(enterSettings(8, ticket)).toBe(false);
    expect(enterSettings(undefined, openSettings(7).ticket)).toBe(false);
    // A refusal spends the ticket too.
    expect(enterSettings(7, ticket)).toBe(false);
  });

  it('forgets a closed tab’s tickets', () => {
    const { ticket } = openSettings(9);
    dropTickets(9);
    expect(enterSettings(9, ticket)).toBe(false);
  });
});
