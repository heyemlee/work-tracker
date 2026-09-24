import type { Account } from './types';

/** What the app calls an account: its email address, which says which inbox it is. The label is a fallback. */
export function accountName(account: Pick<Account, 'email' | 'label'>): string {
  return account.email.trim() || account.label;
}
