/** Collapses whitespace and drops required-field markers: "First Name *" → "First Name". */
export function clean(text: string): string {
  return text
    .replace(/[\u00a0\s]+/g, ' ')
    .replace(/\s*[*✱]\s*$/u, '')
    .replace(/\s*\((required|optional)\)\s*$/i, '')
    .trim();
}

/**
 * Yes and no as a page in Chinese offers them (Workday in zh-CN), and the owner's country as a list of countries
 * in Chinese names it (Eightfold's): whole options only.
 */
const LOCAL_WORDS: Record<string, string> = {
  是: 'yes',
  是的: 'yes',
  否: 'no',
  不是: 'no',
  美国: 'united states',
  美利坚合众国: 'united states of america',
};

/**
 * Lowercase words only, for matching: "Are you legally authorized to work in the U.S.?" → "are you legally
 * authorized to work in the u s". Diacritics and curly quotes fold to plain letters.
 */
export function norm(text: string): string {
  const local = LOCAL_WORDS[text.trim()];
  if (local) return local;
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'s\b/g, 's')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  return norm(text).split(' ').filter(Boolean);
}

/** Share of the shorter text's words found in the longer one, 0–1. */
export function overlap(a: string, b: string): number {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (left.size === 0 || right.size === 0) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const word of small) if (large.has(word)) shared++;
  return shared / small.size;
}

/** The option matching the first candidate that matches any: exactly, else as whole words inside the option. */
export function findOption(options: readonly string[], candidates: readonly string[]): string | null {
  const normalized = options.map((option) => norm(option));
  // Candidates are in order of preference: an earlier one found inside an option ("LinkedIn" in "Career Platform
  // (LinkedIn, Glassdoor)") beats a later exact match ("Other").
  for (const candidate of candidates) {
    const wanted = norm(candidate);
    if (!wanted) continue;
    const exact = normalized.indexOf(wanted);
    if (exact >= 0) return options[exact] ?? null;
    const pattern = new RegExp(`(^| )${escapeRegExp(wanted)}( |$)`);
    // Not where the option says it isn't: "I am not a US resident" is no answer for the United States.
    const denied = new RegExp(`(^| )(not|non|outside)( (a|an|the|in|of|from))* ${escapeRegExp(wanted)}( |$)`);
    const index = normalized.findIndex((option) => pattern.test(option) && !denied.test(option));
    if (index >= 0) return options[index] ?? null;
  }
  return null;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalized text starts with the word, e.g. leads("Yes, I am authorized", "yes"). */
export function leads(text: string, word: string): boolean {
  const normalized = norm(text);
  return normalized === word || normalized.startsWith(`${word} `);
}
