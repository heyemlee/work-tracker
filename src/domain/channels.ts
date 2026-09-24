import type { Channel } from './types';

/**
 * Channels every user has. They live in code rather than the database; their `name` is an i18n key, and
 * applications refer to them by these stable ids.
 */
export const BUILTIN_CHANNELS: readonly Channel[] = [
  { id: 'ch_company_site', name: 'company_site', builtin: true },
  { id: 'ch_linkedin', name: 'linkedin', builtin: true },
  { id: 'ch_referral', name: 'referral', builtin: true },
  { id: 'ch_recruiter', name: 'recruiter', builtin: true },
  { id: 'ch_other', name: 'other', builtin: true },
];

export const isBuiltinChannel = (id: string) => BUILTIN_CHANNELS.some((channel) => channel.id === id);
