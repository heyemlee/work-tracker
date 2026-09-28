/**
 * A resume as a model returned it, brought to the shape `resumeFactsSchema` reads. Structured output keeps Claude
 * and OpenAI to the schema, but a proxy may drop it, and then models write the same facts their own way: the
 * location as "San Jose, CA", links as a list, "institution" for the school, "Jun 2025 – Present" for the dates,
 * bullets as an array. What can't be placed is left for the schema to default.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Nulls dropped, numbers and booleans as text. */
function tidy(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(tidy);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, tidy(item)]),
  );
}

/** The first of these keys the object has, as text. */
function pick(object: Json, ...keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** A list of words, from a list, a "Python, Go; SQL" line, or groups like { languages: [...], tools: [...] }. */
function words(value: unknown): string[] {
  if (typeof value === 'string')
    return value
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(words);
  if (isObject(value)) return Object.values(value).flatMap(words);
  return [];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (month: number) => String(month).padStart(2, '0');

/** "Jun 2025", "06/2025", "2025-6", "2025" → YYYY-MM; "Present" → empty. A lone year is January or December. */
export function toMonth(value: string, end: boolean): string {
  const text = value.trim().toLowerCase();
  if (!text || /present|current|now|today|至今|现在/.test(text)) return '';
  let match = /^(\d{4})[-/.](\d{1,2})\b/.exec(text);
  if (match) return `${match[1]}-${pad(Number(match[2]))}`;
  match = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
  if (match) return `${match[2]}-${pad(Number(match[1]))}`;
  match = /([a-z]{3})[a-z]*\.?,?\s*(\d{4})/.exec(text);
  if (match && MONTHS.includes(match[1]!)) return `${match[2]}-${pad(MONTHS.indexOf(match[1]!) + 1)}`;
  match = /^(\d{4})$/.exec(text);
  if (match) return `${match[1]}-${end ? '12' : '01'}`;
  return value.trim();
}

/** Start and end from separate fields, or from one "Jun 2025 – Present" line. */
function dates(object: Json): { start: string; end: string } {
  let start = pick(object, 'start', 'start_date', 'startDate', 'from', 'begin');
  let end = pick(
    object,
    'end',
    'end_date',
    'endDate',
    'to',
    'graduation',
    'graduation_date',
    'graduationDate',
  );
  const span = pick(object, 'dates', 'date', 'period', 'duration', 'years');
  if (!start && !end && span) [start = '', end = ''] = span.split(/\s+(?:–|—|-|to)\s+|\s*[–—]\s*/);
  const current = object.current === 'true' || object.current_role === 'true';
  return { start: toMonth(start, false), end: current ? '' : toMonth(end, true) };
}

/** "San Jose, CA" or "San Jose, California, United States". */
function location(value: unknown): Json {
  if (isObject(value)) return value;
  if (typeof value !== 'string') return {};
  const [city = '', state = '', country = ''] = value.split(',').map((part) => part.trim());
  return { city, state, country };
}

/** Links as an object, or as a list of URLs sorted by where they point. */
function links(value: unknown, top: Json): Json {
  const found: Json = isObject(value)
    ? {
        linkedin: pick(value, 'linkedin', 'LinkedIn', 'linkedin_url'),
        github: pick(value, 'github', 'GitHub', 'github_url'),
        website: pick(value, 'website', 'portfolio', 'personal_website', 'site', 'url'),
      }
    : {};
  for (const url of words(isObject(value) ? [] : value)) {
    if (/linkedin\.com/i.test(url)) found.linkedin ||= url;
    else if (/github\.com/i.test(url)) found.github ||= url;
    else found.website ||= url;
  }
  return {
    linkedin: found.linkedin || pick(top, 'linkedin', 'linkedin_url'),
    github: found.github || pick(top, 'github', 'github_url'),
    website: found.website || pick(top, 'website', 'portfolio'),
  };
}

/** Bullets as written: a list becomes "- " lines. */
function bullets(object: Json): string {
  for (const key of ['description', 'responsibilities', 'highlights', 'bullets', 'achievements', 'details']) {
    const value = object[key];
    if (Array.isArray(value))
      return words(value.map((line) => (typeof line === 'string' ? line.replace(/^[-•*]\s*/, '') : line)))
        .map((line) => `- ${line}`)
        .join('\n');
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);

/** The level a degree's name implies, when the model didn't give one. */
function levelOf(degree: string): string {
  const text = degree.toLowerCase().replace(/\./g, '');
  if (/phd|doctor/.test(text)) return 'doctorate';
  if (/master|\bms\b|\bma\b|\bmeng\b|\bmba\b|\bmsc\b/.test(text)) return 'master';
  if (/bachelor|\bbs\b|\bba\b|\bbe\b|\bbeng\b|\bbsc\b/.test(text)) return 'bachelor';
  if (/associate/.test(text)) return 'associate';
  return 'other';
}

export function resumeShape(raw: unknown): unknown {
  const top = tidy(raw);
  if (!isObject(top)) return top;
  const name = isObject(top.name)
    ? top.name
    : (() => {
        const parts = pick(top, 'name', 'full_name', 'fullName').split(/\s+/).filter(Boolean);
        return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
      })();
  return {
    ...top,
    name,
    phone: pick(top, 'phone', 'phone_number', 'phoneNumber'),
    location: location(top.location ?? top.address),
    links: links(top.links ?? top.urls ?? top.profiles, top),
    education: list(top.education).map((school) => ({
      ...school,
      school: pick(school, 'school', 'institution', 'university', 'college', 'name'),
      degree: pick(school, 'degree', 'degree_type', 'degreeType'),
      level: pick(school, 'level') || levelOf(pick(school, 'degree', 'degree_type', 'degreeType')),
      field: pick(school, 'field', 'major', 'field_of_study', 'fieldOfStudy', 'area'),
      gpa: pick(school, 'gpa', 'GPA'),
      location: pick(school, 'location', 'city'),
      ...dates(school),
    })),
    experience: list(top.experience ?? top.work_experience ?? top.workExperience ?? top.jobs).map((job) => ({
      ...job,
      company: pick(job, 'company', 'employer', 'organization', 'company_name'),
      title: pick(job, 'title', 'position', 'role', 'job_title'),
      type:
        pick(job, 'type', 'employment_type') ||
        (/\bintern(ship)?\b/i.test(pick(job, 'title', 'position', 'role', 'job_title'))
          ? 'internship'
          : 'full-time'),
      location: pick(job, 'location', 'city'),
      description: bullets(job),
      ...dates(job),
    })),
    skills: words(top.skills ?? top.technical_skills),
    languages: words(top.languages),
    summary: pick(top, 'summary', 'objective', 'profile', 'about'),
  };
}
