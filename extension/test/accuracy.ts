import type { Answer, PlannedField, ScannedField } from '../src/model';
import { adapterFor } from '../src/content/adapters';
import { extractFields } from '../src/content/extract';
import { planForm } from '../src/plan';
import { pickOption } from '../src/rules/options';
import { loadFixture } from '../src/test/fixtures';
import { makeProfile } from '../src/test/profiles';
import greenhouseOptions from './fixtures/greenhouse/options.json';

/** The saved application pages, with the address each was saved from. */
export const FIXTURES: { ats: string; path: string; url: string }[] = [
  {
    ats: 'greenhouse',
    path: 'greenhouse/discord.html',
    url: 'https://job-boards.greenhouse.io/discord/jobs/8811574002',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/anthropic.html',
    url: 'https://job-boards.greenhouse.io/anthropic/jobs/5390799008',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/figma.html',
    url: 'https://job-boards.greenhouse.io/figma/jobs/6201407004',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/stripe-embed.html',
    url: 'https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8044460',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/zscaler.html',
    url: 'https://job-boards.greenhouse.io/zscaler/jobs/5239093007',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/intercom.html',
    url: 'https://job-boards.greenhouse.io/intercom/jobs/7824137',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/scaleai.html',
    url: 'https://job-boards.greenhouse.io/scaleai/jobs/4413992005',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/samsara-embed.html',
    url: 'https://job-boards.greenhouse.io/embed/job_app?for=samsara&token=8113356',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/brex-embed.html',
    url: 'https://job-boards.greenhouse.io/embed/job_app?for=brex&token=8606845002',
  },
  {
    ats: 'greenhouse',
    path: 'greenhouse/rubrik-embed.html',
    url: 'https://job-boards.greenhouse.io/embed/job_app?for=rubrik&token=7942501',
  },
  {
    ats: 'lever',
    path: 'lever/palantir.html',
    url: 'https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply',
  },
  {
    ats: 'lever',
    path: 'lever/spotify-80c3a1cd-3f98-49e5-88d1-b45fca349d7f.html',
    url: 'https://jobs.lever.co/spotify/80c3a1cd-3f98-49e5-88d1-b45fca349d7f/apply',
  },
  {
    ats: 'lever',
    path: 'lever/spotify-faffd837-edbc-42f8-b4bf-14e1658c18e6.html',
    url: 'https://jobs.lever.co/spotify/faffd837-edbc-42f8-b4bf-14e1658c18e6/apply',
  },
  {
    ats: 'lever',
    path: 'lever/shieldai.html',
    url: 'https://jobs.lever.co/shieldai/cf148e69-2ca0-4bfd-a4cc-af214bfcce8a/apply',
  },
  {
    ats: 'lever',
    path: 'lever/wealthfront.html',
    url: 'https://jobs.lever.co/wealthfront/93383267-2d57-45d0-bb6a-7d9c5d8b6f3c/apply',
  },
  {
    ats: 'lever',
    path: 'lever/zoox.html',
    url: 'https://jobs.lever.co/zoox/5f10dfaf-5920-4506-8a09-b39b29e6f48b/apply',
  },
  {
    ats: 'ashby',
    path: 'ashby/notion.html',
    url: 'https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application',
  },
  {
    ats: 'ashby',
    path: 'ashby/openai.html',
    url: 'https://jobs.ashbyhq.com/openai/3c67f712-697d-48d8-b05c-01be896e61da/application',
  },
  {
    ats: 'ashby',
    path: 'ashby/replit.html',
    url: 'https://jobs.ashbyhq.com/replit/447a6e11-b06b-4cc5-9203-cd55883f2af4/application',
  },
  {
    ats: 'ashby',
    path: 'ashby/sierra.html',
    url: 'https://jobs.ashbyhq.com/sierra/b7d1dbcd-ca72-472f-b15e-5b4b0f886be0/application',
  },
  {
    ats: 'ashby',
    path: 'ashby/ramp.html',
    url: 'https://jobs.ashbyhq.com/ramp/fc971889-db1d-4a20-a25e-f282f9296936/application',
  },
  {
    ats: 'ashby',
    path: 'ashby/perplexity.html',
    url: 'https://jobs.ashbyhq.com/perplexity/9246cf02-26fd-4ae8-90c5-639c6e85e9e2/application',
  },
];

/** What a planned answer puts in the field, as text: the option a dropdown resolves to when it opens. */
export function shown(answer: Answer | null, options: string[]): string {
  if (!answer) return '';
  switch (answer.type) {
    case 'text':
      return answer.text;
    case 'choice':
      return (
        answer.option ??
        (options.length ? (pickOption(options, answer.want) ?? '(no match)') : `(${answer.want.kind})`)
      );
    case 'choices':
      return answer.texts.join(' | ');
    case 'check':
      return answer.checked ? 'checked' : 'unchecked';
    case 'file':
      return 'resume';
    case 'date':
      return answer.iso;
  }
}

export interface Row {
  label: string;
  field: ScannedField;
  entry: PlannedField;
  value: string;
}

/** Plans a saved page as the extension would, with dropdown options loaded as if opened. */
export function planFixture(fixture: (typeof FIXTURES)[number]): Row[] {
  const doc = loadFixture(fixture.path, fixture.url);
  const adapter = adapterFor(fixture.url);
  const posting = adapter.posting(doc, fixture.url);
  const { fields, handles } = extractFields(adapter, doc, 0);
  const name = fixture.path
    .replace(/^greenhouse\//, '')
    .replace(/\.html$/, '') as keyof typeof greenhouseOptions;
  const known: Record<string, string[]> = fixture.ats === 'greenhouse' ? (greenhouseOptions[name] ?? {}) : {};
  for (const field of fields) {
    const handle = handles.get(field.id);
    const id = handle && 'element' in handle ? handle.element.id : '';
    if (field.options.length === 0 && known[id]) field.options = known[id];
  }
  const plan = planForm(
    fields,
    {
      profile: makeProfile(),
      email: 'alex@example.com',
      resumeId: 'resume-1',
      posting,
      today: '2026-09-27',
      appliedBefore: false,
    },
    [],
  );
  return plan.map((entry, index) => {
    const field = fields[index]!;
    return { label: field.label, field, entry, value: shown(entry.answer, field.options) };
  });
}
