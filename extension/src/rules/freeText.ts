import type { ScannedField } from '../model';
import { norm } from '../text';

export type FreeTextKind = 'whyCompany' | 'project' | 'experience' | 'coverLetter' | 'additional' | 'other';

/** Long answers a person writes: essays, motivations, project stories. */
export function classifyFreeText(field: ScannedField): FreeTextKind | null {
  const label = norm(field.label);
  // Greenhouse asks even essay questions in single-line inputs (255 characters), so a text field counts when it's
  // roomy enough and the question reads like prose.
  const long =
    field.kind === 'textarea' ||
    (field.kind === 'text' && (field.maxLength === null || field.maxLength >= 200));
  if (!long) return null;
  if (/cover letter|motivation letter/.test(label)) return 'coverLetter';
  if (
    /additional (information|comments|details)|anything else|other information|is there anything|^comments?$|^notes?$/.test(
      label,
    )
  ) {
    return 'additional';
  }
  if (
    /\bwhy\b|what (excites|interests|draws|attracts|motivates) you|excited (about|to)|interested in (this|joining|working)|motivat|what do you hope|what makes you want|resonates/.test(
      label,
    )
  ) {
    return 'whyCompany';
  }
  if (/project|built|build|proud|accomplishment|achievement|impact|contribution|favorite|shipped/.test(label))
    return 'project';
  if (/^(tell us|describe|walk us through|explain|share (an|a|about|with us))\b/.test(label))
    return 'experience';
  if (
    /describe|tell us|walk us through|share|explain|how (have|do|would) you|what (is|was|are|has)|experience with/.test(
      label,
    )
  ) {
    return field.kind === 'textarea' ? 'experience' : null;
  }
  return field.kind === 'textarea' ? 'other' : null;
}
