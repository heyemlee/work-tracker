/**
 * Reads a posting for what decides whether applying is worth it: requirements that rule out an F-1 applicant
 * (red), stretches (yellow), and good signs (green). Every signal quotes the sentence it came from.
 */

export type Level = 'green' | 'yellow' | 'red';

export interface Signal {
  level: Level;
  code:
    | 'citizenship'
    | 'clearance'
    | 'usPerson'
    | 'noSponsorship'
    | 'sponsors'
    | 'seniorTitle'
    | 'years'
    | 'newGrad'
    | 'sameCompany'
    | 'h1b'
    | 'noH1b';
  /** The sentence that triggered it, or a count. */
  evidence: string;
}

interface Pattern {
  level: Level;
  code: Signal['code'];
  test: RegExp;
}

const PATTERNS: Pattern[] = [
  {
    level: 'red',
    code: 'citizenship',
    test: /\b(u\.?s\.?|united states) citizen(ship)?\b[^.]{0,40}\b(required|only|is a requirement)|\bmust be (a )?(u\.?s\.?|united states) citizen|\bonly (u\.?s\.?|united states) citizens\b|\bcitizenship is required\b/i,
  },
  {
    level: 'red',
    code: 'clearance',
    test: /\b(active|current|existing) (ts\/sci|top secret|secret|security) (security )?clearance|\b(security )?clearance (is )?required|\bmust (be able to )?(obtain|hold|have|maintain) (a|an)? ?(active |current )?(u\.?s\.? )?(government )?(security )?clearance|\bts\/sci\b/i,
  },
  {
    level: 'red',
    code: 'usPerson',
    test: /\bu\.?s\.? persons?\b[^.]{0,80}\b(required|only|must|itar|ear)\b|\bmust (qualify as|be) a u\.?s\.? person\b/i,
  },
  {
    level: 'red',
    code: 'noSponsorship',
    test: /\b(unable|not able|cannot|can ?not|will not|won'?t|do(es)? not|no longer|not in a position) (to )?(provide |offer |support )?(visa |immigration |employment |work )?(visa )?sponsor(ship)?\b|\bsponsorship (is |will )?not (be )?(available|provided|offered|supported)\b|\bno (visa |immigration )?sponsorship\b|\bwithout (the need for |requiring )?(current or future |future )?(visa |employer |immigration )?sponsorship\b|\bnot (eligible|available) for (visa )?sponsorship\b|\bmust not require (visa )?sponsorship\b/i,
  },
  {
    level: 'green',
    code: 'sponsors',
    test: /\b(visa|h-?1b|immigration) sponsorship (is )?(available|provided|offered|supported)\b|\bwe (do |will |are able to |can )?sponsor (visas|h-?1b|work visas)\b|\bopen to sponsor(ing)?\b|\bsponsorship available\b/i,
  },
  {
    level: 'green',
    code: 'newGrad',
    test: /\bnew grad(uate)?s?\b|\brecent graduates?\b|\bentry[- ]level\b|\bearly[- ]career\b|\buniversity grad(uate)?\b|\b0 ?(-|to) ?[12] years\b|\bclass of 202[5-7]\b/i,
  },
];

const SENIOR_TITLE =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|architect|distinguished|vp)\b/i;

/** The sentence around a match, trimmed for the card. */
function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf('.', index) + 1, index - 140);
  const endDot = text.indexOf('.', index + length);
  const end = Math.min(endDot < 0 ? text.length : endDot + 1, index + length + 140);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** The fewest years the posting asks for, e.g. "5+ years of experience" → 5. Null when it names none. */
export function minimumYears(text: string): number | null {
  let lowest: number | null = null;
  for (const match of text.matchAll(
    /\b(\d{1,2})\s*(\+|or more|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?\b[^.]{0,60}?\bexperience/gi,
  )) {
    const years = Number(match[1]);
    if (years > 0 && years < 30 && (lowest === null || years < lowest)) lowest = years;
  }
  return lowest;
}

export function scanPosting(description: string, title: string | null, applicantYears: number): Signal[] {
  const signals: Signal[] = [];
  const noSponsorship = PATTERNS.find((pattern) => pattern.code === 'noSponsorship');
  for (const pattern of PATTERNS) {
    const match = pattern.test.exec(description);
    if (!match) continue;
    // "We do not sponsor … except for" and the like still read as no sponsorship; a posting saying both keeps red.
    if (pattern.code === 'sponsors' && noSponsorship?.test.test(description)) continue;
    signals.push({
      level: pattern.level,
      code: pattern.code,
      evidence: sentenceAround(description, match.index, match[0].length),
    });
  }
  if (title && SENIOR_TITLE.test(title))
    signals.push({ level: 'yellow', code: 'seniorTitle', evidence: title });
  const years = minimumYears(description);
  // A couple of years' stretch is normal; beyond that the posting is likely out of reach.
  if (years !== null && years > applicantYears + 2)
    signals.push({ level: 'yellow', code: 'years', evidence: `${years}+` });
  return signals;
}
