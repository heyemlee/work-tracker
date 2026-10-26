import type { Entry, Hint, PlannedField, ScannedField, Source } from './model';
import { latestEducation, nationalPhone } from './profile/profile';
import type { Education, Experience } from './profile/schema';
import { answerAuth, classifyAuth, postingCountry } from './rules/authorization';
import { findRule, RULES } from './rules/common';
import { answerConsent, isConsent } from './rules/consent';
import type { RuleContext } from './rules/context';
import { classifyEeo, eeoWant } from './rules/eeo';
import { classifyFreeText } from './rules/freeText';
import { recall, unnamed, type MemoryEntry } from './rules/memory';
import { choose, date, empty, fits, isTextKind, text, yesNo, type Resolution } from './rules/resolve';
import { norm, words } from './text';

/** What rules answer from the newest job or school. */
const NEWEST = new Set(['current.company', 'current.title', 'education.school', 'education.degree', 'education.field', 'education.gpa', 'education.graduation']); // prettier-ignore

/**
 * Decides what goes into each field. Layers, first match wins:
 *
 * 1. Repeatable entries and adapter hints — the page named the field.
 * 2. Work authorization — rules only, always marked for confirmation.
 * 3. Voluntary self-identification (EEO) — from the profile.
 * 4. Answers the owner typed last time for the same question.
 * 5. Acknowledgements — filled, marked for confirmation.
 * 6. The field dictionary.
 * 7. Free-text questions — drafted by AI when required, skipped when optional.
 *
 * Whatever is left is `missing`; the service worker may hand those to AI.
 */
export function planForm(
  fields: readonly ScannedField[],
  ctx: RuleContext,
  memory: readonly MemoryEntry[],
): PlannedField[] {
  // Work experience or education the page filled in (Workday's "Autofill with Resume") is left to the page: its
  // entries needn't follow the profile's order, so filling their gaps from the profile could mix two jobs.
  const started = new Set(fields.flatMap((field) => (field.entry && field.filled ? [field.entry.kind] : [])));
  const newest = new Set<string>();
  return fields.map((field) => {
    if (field.entry && started.has(field.entry.kind)) return leftToPage(field, field.entry);
    const planned = planField(field, ctx, memory);
    // Where the form doesn't number its jobs and schools, the newest one's answers go to the first field asking:
    // a second "Company name" or "School" is another one's, which nothing tells. (A question asked twice, or one
    // widget read twice in two kinds, is the same question.)
    if (field.entry || !planned.answer || !NEWEST.has(planned.key ?? '')) return planned;
    if (field.label.includes('?') || words(field.label).length > 3) return planned;
    const asked = `${planned.key}|${norm(field.label)}|${field.kind}`;
    if (!newest.has(asked)) {
      newest.add(asked);
      return planned;
    }
    const status = field.required ? ('missing' as const) : ('skipped' as const);
    return { ...planned, status, answer: null, source: null, note: 'one of several alike' };
  });
}

function leftToPage(field: ScannedField, entry: Entry): PlannedField {
  return {
    fieldId: field.id,
    status: field.filled ? 'filled' : field.required ? 'missing' : 'skipped',
    answer: null,
    source: null,
    key: field.hint ? `${field.hint}#${entry.index}` : null,
    note: field.filled ? 'already filled' : null,
    critical: false,
  };
}

export function planField(
  field: ScannedField,
  ctx: RuleContext,
  memory: readonly MemoryEntry[],
): PlannedField {
  const found = resolve(field, ctx, memory);
  const { source } = found;
  // An answer the field can't take was meant for another question: the field is left for the owner.
  const resolution =
    found.resolution.answer && !fits(field, found.resolution.answer)
      ? empty(found.resolution.key, field, 'doesn’t fit the field', found.resolution.critical)
      : found.resolution;
  // A field the page already filled (a parsed resume, a Workday profile, the owner's typing) is kept. Where a rule
  // has an answer, the content script makes that call as it fills: uploading the resume can fill more fields.
  if (!resolution.answer && field.filled) {
    return {
      fieldId: field.id,
      status: 'filled',
      answer: null,
      source: null,
      key: resolution.key,
      note: 'already filled',
      critical: resolution.critical,
    };
  }
  return {
    fieldId: field.id,
    status: resolution.status,
    answer: resolution.answer,
    source: resolution.answer ? source : null,
    key: resolution.key,
    note: resolution.note,
    critical: resolution.critical,
  };
}

/**
 * What the owner typed for this question last time, as an answer to fill; null when nothing was kept. AI's answer
 * the owner sent as it was is AI's still: a draft, marked as AI's, to be checked.
 */
function recalled(
  memory: readonly MemoryEntry[],
  field: ScannedField,
): { resolution: Resolution; source: Source } | null {
  const remembered = recall(memory, field);
  if (!remembered) return null;
  if (remembered.byAi)
    return {
      resolution: {
        status: 'draft',
        answer: remembered.answer,
        key: 'ai',
        note: 'AI’s answer last time',
        critical: false,
      },
      source: 'ai',
    };
  return {
    resolution: {
      status: 'filled',
      answer: remembered.answer,
      key: 'memory',
      note: 'your answer last time',
      critical: false,
    },
    source: 'memory',
  };
}

function resolve(
  field: ScannedField,
  ctx: RuleContext,
  memory: readonly MemoryEntry[],
): { resolution: Resolution; source: Source } {
  const rule = (resolution: Resolution) => ({ resolution, source: 'rule' as const });

  if (field.entry && field.hint) {
    const entry = resolveEntry(field, ctx);
    if (entry) return rule(entry);
  }
  if (field.hint) {
    const hinted = resolveHint(field.hint, field, ctx);
    if (hinted) {
      // The profile has nothing for one of the form's own fields (a preferred name, a city): what the owner typed
      // there last time fills it, as it would a question no rule knows. Not one of several alike (a school's end
      // year), which its label doesn't tell apart, and never the voluntary survey.
      const remembered =
        !hinted.answer && !field.entry && !field.hint.startsWith('eeo.') ? recalled(memory, field) : null;
      return remembered ?? rule(hinted);
    }
  }

  const auth = classifyAuth(field.label, field.description);
  if (auth) return rule(resolveAuth(auth, field, ctx));

  const eeo = classifyEeo(field.label);
  if (eeo && field.kind !== 'textarea') return rule(choose(`eeo.${eeo}`, field, eeoWant(eeo, ctx.profile)));

  // A rule that answers from the profile or the account fills its field before what was typed there last time: the
  // account's email, not another account's; the profile's answer as it stands now. What the owner typed comes first
  // where a rule only proposes an answer for them to confirm, or has none.
  const consent = isConsent(field);
  const found = consent ? undefined : findRule(field);
  const ruled = found?.answer(field, ctx);
  if (ruled?.status === 'filled' && ruled.answer) return rule(ruled);

  const remembered = recalled(memory, field);
  if (remembered) return remembered;

  if (consent) return rule(answerConsent(field, ctx.profile));

  if (ruled) return rule(ruled);

  const freeText = classifyFreeText(field);
  if (freeText) {
    if (freeText === 'additional' || (freeText === 'coverLetter' && !field.required)) {
      return rule(empty(`text.${freeText}`, field, freeText === 'coverLetter' ? 'cover letter' : null));
    }
    return rule(
      field.required
        ? { status: 'draft', answer: null, key: `text.${freeText}`, note: null, critical: false }
        : {
            status: 'skipped',
            answer: null,
            key: `text.${freeText}`,
            note: 'optional: left for you',
            critical: false,
          },
    );
  }

  return rule({
    status: field.required ? 'missing' : 'skipped',
    answer: null,
    key: 'unknown',
    note: null,
    critical: false,
  });
}

function resolveAuth(
  kind: NonNullable<ReturnType<typeof classifyAuth>>,
  field: ScannedField,
  ctx: RuleContext,
): Resolution {
  const country = postingCountry(ctx.posting?.location ?? null) ?? 'United States';
  const result = answerAuth(kind, field.label, field.kind, ctx.profile, field.options, country);
  const options = { status: 'confirm' as const, critical: true, note: result.note };
  const key = `auth.${kind}`;
  if (result.text !== null) return text(key, field, result.text, [], options);
  if (!result.question) return { status: 'missing', answer: null, key, note: result.note, critical: true };
  const { answer } = result.question;
  if (field.kind === 'checkbox' || isTextKind(field.kind)) {
    return answer
      ? yesNo(key, field, answer === 'yes', options)
      : { status: 'missing', answer: null, key, note: result.note, critical: true };
  }
  // "Select all that apply" export-control lists take a single "None of the above".
  const single = field.kind === 'multi' ? { ...field, kind: 'radio' as const } : field;
  const resolution = choose(key, single, { kind: 'auth', question: result.question }, options);
  return resolution.answer ? resolution : { ...resolution, status: 'missing', critical: true };
}

const HINT_RULE_KEYS: Partial<Record<Hint, string>> = {
  'name.first': 'name.first',
  'name.last': 'name.last',
  'name.full': 'name.full',
  'name.preferred': 'name.preferred',
  email: 'email',
  phone: 'phone',
  'phone.country': 'phone.country',
  'phone.type': 'phone.type',
  location: 'location',
  'address.line1': 'address.line1',
  'address.city': 'address.city',
  'address.state': 'address.state',
  'address.zip': 'address.zip',
  'address.country': 'address.country',
  'links.linkedin': 'links.linkedin',
  'links.github': 'links.github',
  'links.website': 'links.website',
  'links.twitter': 'links.twitter',
  website: 'links.website',
  'current.company': 'current.company',
  'current.title': 'current.title',
  resume: 'resume',
  coverLetter: 'coverLetter',
  pronouns: 'pronouns',
  howHeard: 'howHeard',
  'education.school': 'education.school',
  'education.degree': 'education.degree',
  'education.field': 'education.field',
  'education.gpa': 'education.gpa',
  signatureDate: 'signatureDate',
};

function resolveHint(hint: Hint, field: ScannedField, ctx: RuleContext): Resolution | null {
  if (hint.startsWith('eeo.')) {
    const eeo = hint.slice(4) as 'gender' | 'hispanic' | 'race' | 'veteran' | 'disability';
    return choose(hint, field, eeoWant(eeo, ctx.profile));
  }
  if (hint === 'phone.national') return text('phone', field, nationalPhone(ctx.profile.phone));
  // Ashby's name field keeps its hint when a form relabels it "Preferred First & Last Name".
  const relabeled = hint === 'name.full' && /\bpreferred\b/.test(norm(field.label));
  const key = relabeled ? 'name.preferred' : HINT_RULE_KEYS[hint];
  const rule = key ? RULES.find((candidate) => candidate.key === key) : undefined;
  return rule ? rule.answer(field, ctx) : null;
}

/** Newest first, the order Workday's "Add" buttons fill in. */
const jobsNewestFirst = (jobs: readonly Experience[]) =>
  [...jobs].sort((a, b) => b.start.localeCompare(a.start));

function resolveEntry(field: ScannedField, ctx: RuleContext): Resolution | null {
  const { entry, hint } = field;
  if (!entry || !hint) return null;
  const key = `${hint}#${entry.index}`;
  if (entry.kind === 'experience') {
    const job = jobsNewestFirst(ctx.profile.experience)[entry.index];
    if (!job) return empty(key, field);
    switch (hint) {
      case 'experience.title':
        return text(key, field, job.title);
      case 'experience.company':
        return text(key, field, job.company);
      case 'experience.location':
        return text(key, field, job.location);
      case 'experience.current':
        return yesNo(key, field, job.end === null);
      case 'experience.start':
        return datePart(key, field, job.start);
      case 'experience.end':
        return job.end ? datePart(key, field, job.end) : empty(key, { ...field, required: false });
      case 'experience.description':
        return text(key, field, job.description);
      default:
        return null;
    }
  }
  if (entry.kind === 'education') {
    const schools = [...ctx.profile.education].sort((a: Education, b: Education) =>
      (b.end ?? '9999').localeCompare(a.end ?? '9999'),
    );
    const school = schools[entry.index] ?? (entry.index === 0 ? latestEducation(ctx.profile) : null);
    if (!school) return empty(key, field);
    switch (hint) {
      case 'education.school':
        return text(key, field, school.school, ['Other']);
      case 'education.degree':
        return text(key, field, school.degree, degreeWords(school.level));
      case 'education.field':
        return text(key, field, school.field);
      case 'education.gpa':
        return text(key, field, school.gpa);
      case 'education.start':
        return school.start ? datePart(key, field, school.start) : empty(key, field);
      case 'education.end':
        return school.end ? datePart(key, field, school.end) : empty(key, field);
      default:
        return null;
    }
  }
  return null;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']; // prettier-ignore

/**
 * A month ("2023-09") as the field asks for it: a date where the field takes one (Workday's month and year), else the
 * month's name where it's split out (Greenhouse), else the year.
 */
function datePart(key: string, field: ScannedField, month: string): Resolution {
  const label = norm(field.label);
  if (field.kind !== 'date' && /\bmonth\b/.test(label) && !/\byear\b/.test(label)) {
    const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '';
    return text(key, field, name, [name.slice(0, 3), month.slice(5, 7)]);
  }
  return date(key, field, `${month}-01`, month.slice(0, 4));
}

function degreeWords(level: Education['level']): string[] {
  const words: Record<Education['level'], string[]> = {
    'high-school': ['High School'],
    associate: ["Associate's Degree", 'Associate'],
    bachelor: ["Bachelor's Degree", "Bachelor's", 'Bachelor', 'BS'],
    master: ["Master's Degree", "Master's", 'Master', 'MS'],
    doctorate: ['Doctorate', 'PhD'],
    other: ['Other'],
  };
  return words[level];
}

/** Counts for the card's summary line. */
export function summarize(plan: readonly PlannedField[]): Record<PlannedField['status'], number> {
  const counts = { filled: 0, confirm: 0, draft: 0, missing: 0, skipped: 0 };
  for (const field of plan) counts[field.status]++;
  return counts;
}

/**
 * Fields worth sending to the AI fallback: required, unplaced, not critical, not free text, and saying what they ask
 * (no answer is guessed for a bare "End date year").
 */
export function aiCandidates(fields: readonly ScannedField[], plan: readonly PlannedField[]): ScannedField[] {
  const byId = new Map(plan.map((entry) => [entry.fieldId, entry]));
  return fields.filter((field) => {
    const entry = byId.get(field.id);
    // Unknown questions, and dictionary matches whose options held no answer ("San Fransisco" for a Bay Area city).
    const open = entry?.key === 'unknown' || entry?.note === 'no matching option';
    return entry?.status === 'missing' && open && !entry.critical && field.kind !== 'file' && !unnamed(field);
  });
}

/** Free-text questions waiting for a draft. */
export function draftCandidates(
  fields: readonly ScannedField[],
  plan: readonly PlannedField[],
): ScannedField[] {
  const byId = new Map(plan.map((entry) => [entry.fieldId, entry]));
  return fields.filter((field) => byId.get(field.id)?.status === 'draft' && !byId.get(field.id)?.answer);
}
