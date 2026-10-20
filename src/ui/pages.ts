import { ChartColumn, Compass, FileScan, FileText, IdCard, Send, type LucideIcon } from 'lucide-react';
import { useProfile } from '../data/store';
import { emptyProfile, missingItems } from '../domain/profile';
import type { MessageKey } from '../i18n/messages';
import type { Page } from '../state/router';

/** Main pages; compact navigation groups secondary destinations under More. */
export const PAGES: readonly { page: Page; icon: LucideIcon; label: MessageKey }[] = [
  { page: 'applications', icon: Send, label: 'nav.applications' },
  { page: 'resumes', icon: FileText, label: 'nav.resumes' },
  { page: 'profile', icon: IdCard, label: 'nav.profile' },
  { page: 'discovery', icon: Compass, label: 'nav.discovery' },
  { page: 'resumeTools', icon: FileScan, label: 'nav.resumeTools' },
  { page: 'insights', icon: ChartColumn, label: 'nav.insights' },
];

/** How many of the blanks most forms ask about the saved profile still has; 0 while it loads. */
export function useProfileBlanks(): number {
  const profile = useProfile();
  return profile.isPending ? 0 : missingItems(profile.data?.profile ?? emptyProfile()).length;
}
