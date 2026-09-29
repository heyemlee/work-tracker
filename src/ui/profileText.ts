import { ExtensionError, type ExtensionState } from '../data/extension';
import type { MessageKey } from '../i18n/messages';

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Why the extension can't read a resume right now, or why it couldn't. */
export function extensionText(t: Translate, reason: ExtensionState | ExtensionError): string {
  if (reason instanceof ExtensionError) {
    return reason.code === 'failed'
      ? t('profile.ext.failed', { detail: reason.detail || reason.code })
      : t(`profile.ext.${reason.code}`);
  }
  if (reason === 'no-key' || reason === 'ai-off') return t(`profile.ext.${reason}`);
  return t('profile.ext.missing');
}

const ENTRY_FIELDS: Record<string, MessageKey> = { title: 'profile.f.jobTitle', text: 'profile.f.storyText' };

/** "Legal first name is required", "Work experience 2 · Start isn’t valid". */
export function describeIssue(issue: { path: PropertyKey[]; code: string }, t: Translate) {
  const [section, second, third] = issue.path.map(String);
  const label = (key: string) => ENTRY_FIELDS[key] ?? (`profile.f.${key}` as MessageKey);
  let field: string;
  if ((section === 'education' || section === 'experience') && third)
    field = `${t(`profile.s.${section}`)} ${Number(second) + 1} · ${t(label(third))}`;
  else if (section === 'writing' && second === 'stories' && issue.path[3] !== undefined)
    field = `${t('profile.f.stories')} ${Number(third) + 1} · ${t(label(String(issue.path[3])))}`;
  else if (second && section !== 'education' && section !== 'experience') field = t(label(second));
  else field = issue.path.join('.');
  return t(issue.code === 'too_small' ? 'profile.required' : 'profile.badValue', { field });
}
