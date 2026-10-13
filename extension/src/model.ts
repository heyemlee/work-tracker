/** The applicant-tracking system a page belongs to. `generic` is any other site. */
export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'gem' | 'linkedin' | 'generic';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  /** A native `<select>`. */
  | 'select'
  /** A custom dropdown: react-select, Workday's listbox, Ashby's select. Options may load only when opened. */
  | 'combobox'
  /** Type to search, then pick a suggestion: locations, schools. */
  | 'typeahead'
  /** One of several labeled choices: radio inputs or yes/no buttons. */
  | 'radio'
  /** A single box: a consent, "I currently work here". */
  | 'checkbox'
  /** Several boxes, or a multi-select. */
  | 'multi'
  | 'file';

/** What an adapter knows a field means because the page names it outright (Greenhouse's `#first_name`). */
export type Hint =
  | 'name.first'
  | 'name.last'
  | 'name.full'
  | 'name.preferred'
  | 'email'
  | 'phone'
  | 'phone.country'
  | 'phone.type'
  | 'location'
  | 'address.line1'
  | 'address.city'
  | 'address.state'
  | 'address.zip'
  | 'address.country'
  | 'links.linkedin'
  | 'links.github'
  | 'links.website'
  | 'links.twitter'
  | 'current.company'
  | 'current.title'
  | 'resume'
  | 'coverLetter'
  | 'pronouns'
  | 'eeo.gender'
  | 'eeo.hispanic'
  | 'eeo.race'
  | 'eeo.veteran'
  | 'eeo.disability'
  | 'howHeard'
  | 'experience.title'
  | 'experience.company'
  | 'experience.location'
  | 'experience.current'
  | 'experience.start'
  | 'experience.end'
  | 'experience.description'
  | 'education.school'
  | 'education.degree'
  | 'education.field'
  | 'education.gpa'
  | 'education.start'
  | 'education.end'
  | 'website'
  /** The date a form is signed on: today's. */
  | 'signatureDate';

/** A repeatable entry a field belongs to, like Workday's "Work Experience 2". */
export interface Entry {
  kind: 'experience' | 'education' | 'website';
  index: number;
}

export interface ScannedField {
  /** Unique within the tab: `${frameId}:${localId}`. */
  id: string;
  label: string;
  /** Help text under the question, often where the real question hides. */
  description: string;
  kind: FieldKind;
  /** Choice labels the page shows. Empty when a dropdown loads them only when opened. */
  options: string[];
  required: boolean;
  hint: Hint | null;
  /** The heading of the section the field sits in, e.g. "Voluntary Self-Identification". */
  section: string;
  entry: Entry | null;
  /** The field already holds something: the page prefilled it, or the owner typed it. */
  filled: boolean;
  /** What it holds is an answer AI wrote in an earlier fill, standing as AI left it: kept, and not asked for again. */
  drafted?: boolean;
  maxLength: number | null;
}

export interface Posting {
  ats: Ats;
  company: string | null;
  title: string | null;
  /** The posting's page, cleaned of tracking parameters. */
  url: string;
  location: string | null;
  /** Plain text, trimmed to a length a prompt can carry. */
  description: string;
}

export interface FrameScan {
  frameId: number;
  ats: Ats;
  /** The frame holds an application form, not just a posting. */
  isApplication: boolean;
  /**
   * The frame is on an application under way, though it may show nothing to fill: a step of Workday's still on its
   * way, or its review of the whole before it's sent.
   */
  applying: boolean;
  /** The frame shows the button that sends the application: on Workday, the last step's. */
  sends: boolean;
  /**
   * On a site the extension doesn't know: the page gives itself out as a job, by its address or its own markup. A
   * hiring system's own pages tell a posting by its title, and say true here.
   */
  jobLike: boolean;
  /** No application form was found in the frame, and it has a form the owner can say is one. */
  otherForm: boolean;
  posting: Posting | null;
  fields: ScannedField[];
  /** Workday's current step ("My Information"); null elsewhere. */
  step: string | null;
}

/** What a field holds as the page stands: whether anything, and what it shows there. */
export interface Held {
  filled: boolean;
  value?: string;
}

/** A frame's fields as its content script last saw them, and when by the page's clock. */
export interface FrameHeld {
  at: number;
  /** By field id. A field the script can't tell about is left out. */
  fields: Record<string, Held>;
}

/** An answer to a choice, resolved against the options once they're known (some load only when opened). */
export type Want =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'decline' }
  /** The first option matching one of these texts, in order. */
  | { kind: 'like'; texts: string[] }
  /** "I acknowledge", "Yes", "Confirmed", "I agree". */
  | { kind: 'affirm' }
  /** Ranges like "3-5 years". */
  | { kind: 'range'; value: number }
  | { kind: 'eeo'; field: EeoField; value: string }
  | { kind: 'auth'; question: AuthQuestion };

export type EeoField =
  'gender' | 'hispanic' | 'race' | 'veteran' | 'disability' | 'orientation' | 'transgender';

/** A work-authorization question, reduced to what decides its answer. See rules/authorization.ts. */
export interface AuthQuestion {
  /** The answer to the question as asked, before options: yes, no, or a text for text fields. */
  answer: 'yes' | 'no' | null;
  facts: AuthFacts;
}

export interface AuthFacts {
  authorized: boolean;
  /** Authorized for any employer without restriction (citizen, permanent resident, open work permit). */
  unrestricted: boolean;
  citizenOrResident: boolean;
  sponsorshipNow: boolean;
  sponsorshipFuture: boolean;
  /** On F-1 OPT or STEM OPT. */
  opt: boolean;
  /** On the STEM extension of OPT. */
  stemOpt: boolean;
}

export type Answer =
  | { type: 'text'; text: string }
  | {
      type: 'choice';
      want: Want;
      /** Resolved when the options were known while planning. */ option: string | null;
    }
  | { type: 'choices'; texts: string[] }
  | { type: 'check'; checked: boolean }
  | { type: 'file'; resumeId: string }
  | { type: 'date'; iso: string };

/**
 * - `filled`: set from the profile or a rule.
 * - `confirm`: set, but worth a look: work authorization, consents.
 * - `draft`: written or picked by AI; stays marked until the owner edits or confirms it.
 * - `missing`: nothing to put there; the owner fills it.
 * - `skipped`: left empty on purpose (optional free text, a cover letter).
 */
export type FieldStatus = 'filled' | 'confirm' | 'draft' | 'missing' | 'skipped';

export type Source = 'rule' | 'memory' | 'ai';

export interface PlannedField {
  fieldId: string;
  status: FieldStatus;
  answer: Answer | null;
  source: Source | null;
  /** Which rule or profile entry answered, for the checklist and for tests. */
  key: string | null;
  /** Shown next to the field in the checklist. */
  note: string | null;
  critical: boolean;
}
