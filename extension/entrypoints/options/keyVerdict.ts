import type { checkKey } from '../../src/background/ai';
import type { Strings } from './strings';

/** What a check of the key came to, or that one is under way. */
export interface Verdict {
  tone: 'wait' | 'good' | 'warn' | 'bad';
  text: string;
}

/**
 * What a check of the key says. Only the provider turning the key away (401, 403) says the key is bad: an address
 * that isn't there (404), a provider down, no network, tell nothing of the key; and a request answered with nothing
 * usable (cut off, declined) was a key the provider took.
 */
export function keyVerdict(
  found: Awaited<ReturnType<typeof checkKey>>,
  effortMatters: boolean,
  s: Strings,
): Verdict {
  const detail = found.error ?? '';
  // Both providers' errors begin with the status.
  if (!found.ok) {
    if (/^401\b/.test(detail)) return { tone: 'bad', text: s('keyRefused', { detail }) };
    if (/^403\b/.test(detail)) return { tone: 'bad', text: s('keyBad', { detail }) };
    return { tone: 'warn', text: s('keyUnchecked', { detail }) };
  }
  if (found.empty) return { tone: 'warn', text: s('keyOkEmpty', { detail: found.empty }) };
  if (found.effortRefused && effortMatters) return { tone: 'warn', text: s('keyOkNoEffort') };
  return { tone: 'good', text: s('keyOk') };
}
