import { ChartColumn, FileText, IdCard, Send, type LucideIcon } from 'lucide-react';
import { useProfile } from '../data/store';
import { emptyProfile, missingItems } from '../domain/profile';
import type { MessageKey } from '../i18n/messages';
import type { Page } from '../state/router';

/** The four pages, in the toolbar on wide screens and the tab bar on phones. */
export const PAGES: readonly { page: Page; icon: LucideIcon; label: MessageKey }[] = [
  { page: 'applications', icon: Send, label: 'nav.applications' },
  { page: 'resumes', icon: FileText, label: 'nav.resumes' },
  { page: 'profile', icon: IdCard, label: 'nav.profile' },
  { page: 'insights', icon: ChartColumn, label: 'nav.insights' },
];

/** How many of the blanks most forms ask about the saved profile still has; 0 while it loads. */
export function useProfileBlanks(): number {
  const profile = useProfile();
  return profile.isPending ? 0 : missingItems(profile.data?.profile ?? emptyProfile()).length;
}
