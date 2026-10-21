import { describe, expect, it } from 'vitest';
import config from '../wxt.config';
import { outboxMatches } from './hosts';

describe('the manifest', () => {
  // The owner's call (2026-10-14): filling is the card's Fill button alone. A key that filled from anywhere could start
  // a second fill while one ran or AI was writing.
  it('has no keyboard shortcut', () => {
    expect(config.manifest).not.toHaveProperty('commands');
  });

  // A published build answers no page on this machine: Outbox while developing is a development build's alone.
  it('takes no local page for Outbox outside a development build', () => {
    expect(outboxMatches(false)).toEqual(['https://tracker.haoyang.us/*']);
    expect(outboxMatches(true)).toContain('http://localhost:5180/*');
  });
});
