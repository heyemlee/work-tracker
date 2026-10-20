import { ChartColumn, Compass, FileText, IdCard, Send, type LucideIcon } from 'lucide-react';
import { useProfile } from '../data/store';
import { emptyProfile, missingItems } from '../domain/profile';
import type { MessageKey } from '../i18n/messages';
import type { Page } from '../state/router';

/**
 * Main pages; compact navigation groups secondary destinations under More. Resume tools has no entry: it is part of
 * Resumes, opened from that page and from Profile.
 */
export const PAGES: readonly { page: Page; icon: LucideIcon; label: MessageKey }[] = [
  { page: 'applications', icon: Send, label: 'nav.applications' },
  { page: 'resumes', icon: FileText, label: 'nav.resumes' },
  { page: 'profile', icon: IdCard, label: 'nav.profile' },
  { page: 'discovery', icon: Compass, label: 'nav.discovery' },
  { page: 'insights', icon: ChartColumn, label: 'nav.insights' },
];

/** Pages without an entry of their own, each shown as part of another's. */
const PART_OF: Partial<Record<Page, Page>> = { resumeTools: 'resumes' };

/** `aria-current` for a navigation entry: `page` on its own page, `true` on a page that is part of it. */
export function navCurrent(entry: Page, page: Page): 'page' | 'true' | undefined {
  if (entry === page) return 'page';
  return PART_OF[page] === entry ? 'true' : undefined;
}

/** How many of the blanks most forms ask about the saved profile still has; 0 while it loads. */
export function useProfileBlanks(): number {
  const profile = useProfile();
  return profile.isPending ? 0 : missingItems(profile.data?.profile ?? emptyProfile()).length;
}
