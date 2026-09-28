import type { ScannedField } from '../model';
import { norm } from '../text';
import { fullName } from '../profile/profile';
import type { Profile } from '../profile/schema';
import { choose, text, yesNo, type Resolution } from './resolve';

const CONSENT =
  /acknowledg|\bi certify\b|certif(y|ication) that|privacy (notice|policy|statement|consent)|\bconsent\b|arbitration|\bi understand\b|\bi agree\b|terms (and|&) conditions|\battest\b|confirm (that )?(i have read|receipt|you have read)|data (transfer|processing|protection)|point of data transfer|ai note ?tak(er|ing)|\bai policy\b|may use ai|recorded|recording|true (and|&) (complete|correct|accurate)|to the best of my knowledge|indicate your agreement|by typing your (full )?name/;

/**
 * Acknowledgements, certifications and privacy consents. They're filled so the form can be submitted, and always
 * marked for the owner to read — agreeing is the owner's call, not the extension's.
 */
export function isConsent(field: ScannedField): boolean {
  if (field.kind === 'file' || field.kind === 'textarea') return false;
  // "Do you acknowledge this role is in the office three days a week?" is about where they'll work, not consent.
  if (/in ?office|hybrid|on ?site|in ?person|relocat|days (per|a) week/.test(norm(field.label))) return false;
  // "… has my consent to contact me about future job opportunities" is a mailing-list opt-in.
  if (/future (job )?(opportunities|openings|roles|positions)|contact me about/.test(norm(field.label)))
    return false;
  // Options count only when there are a few ("I acknowledge"), not a thousand-school list.
  const options = field.options.length <= 5 ? field.options.join(' ') : '';
  // A lone checkbox often carries its agreement in the text under it: "Confidential Information — I agree (a)…".
  const terms = field.kind === 'checkbox' ? field.description : '';
  return CONSENT.test(norm(`${field.label} ${options} ${terms}`));
}

export function answerConsent(field: ScannedField, profile: Profile): Resolution {
  const options = { status: 'confirm' as const, note: 'acknowledgement' };
  if (field.kind === 'checkbox') return yesNo('consent', field, true, options);
  // A typed certification is a signature: the full name.
  if (field.kind === 'text')
    return text('consent', field, fullName(profile), [], { ...options, note: 'signature' });
  return choose('consent', field, { kind: 'affirm' }, options);
}
