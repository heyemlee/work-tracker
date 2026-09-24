import { describe, expect, it } from 'vitest';
import { accountName } from './accounts';

describe('accountName', () => {
  it('names an account by its email', () => {
    expect(accountName({ label: 'A', email: 'me.primary@example.com' })).toBe('me.primary@example.com');
  });

  it('falls back to the label until an email is entered', () => {
    expect(accountName({ label: 'A', email: '  ' })).toBe('A');
  });
});
