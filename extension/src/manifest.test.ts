import { describe, expect, it } from 'vitest';
import config from '../wxt.config';

describe('the manifest', () => {
  // The owner's call (2026-10-14): filling is the card's Fill button alone. A key that filled from anywhere could start
  // a second fill while one ran or AI was writing.
  it('has no keyboard shortcut', () => {
    expect(config.manifest).not.toHaveProperty('commands');
  });
});
