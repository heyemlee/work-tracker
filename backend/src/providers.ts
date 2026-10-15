import { z } from 'zod';
import { providerSchema } from './validation.js';

export type Provider = z.output<typeof providerSchema>;
export interface Listing {
  externalId: string;
  title: string;
  location: string;
  department: string;
  description: string;
  url: string;
  remote: boolean;
  publishedAt: Date | null;
}
const string = z.string().default('');
const safeUrl = z.url().refine((url) => new URL(url).protocol === 'https:');
const id = z.union([z.string().min(1), z.number().int()]).transform(String);
const gh = z.object({
  jobs: z.array(
    z.object({
      id,
      title: z.string().min(1),
      absolute_url: safeUrl,
      location: z.object({ name: string }),
      content: string,
      departments: z.array(z.object({ name: string })).default([]),
      // updated_at is not a publication date; do not mislabel it.
    }),
  ),
});
const lever = z.array(
  z.object({
    id,
    text: z.string().min(1),
    hostedUrl: safeUrl,
    categories: z.object({ location: string, department: string }).default({ location: '', department: '' }),
    descriptionPlain: string,
    additionalPlain: string,
    lists: z.array(z.object({ text: string, content: string })).default([]),
    workplaceType: string,
  }),
);
const ashby = z.object({
  jobs: z.array(
    z.object({
      id,
      title: z.string().min(1),
      jobUrl: safeUrl,
      location: string,
      department: string,
      descriptionPlain: string,
      isRemote: z
        .boolean()
        .nullish()
        .transform((value) => value ?? false),
      isListed: z.boolean().default(true),
      publishedAt: z.iso.datetime({ offset: true }).nullish(),
    }),
  ),
});

export function textFromHtml(text: string) {
  // Greenhouse encodes its HTML; decode before removing tags.
  const decoded = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  return decoded
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60000);
}

export function providerUrl(provider: Provider, slug: string, skip = 0) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) throw new Error('Invalid board slug');
  if (provider === 'greenhouse')
    return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  if (provider === 'ashby') return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  return `https://api.lever.co/v0/postings/${slug}?mode=json&limit=100&skip=${skip}`;
}

export function parseListings(provider: Provider, data: unknown): Listing[] {
  if (provider === 'greenhouse')
    return gh.parse(data).jobs.map((job) => ({
      externalId: job.id,
      title: job.title,
      location: job.location.name,
      department: job.departments.map((d) => d.name).join(', '),
      description: textFromHtml(job.content),
      url: job.absolute_url,
      remote: /\bremote\b/i.test(job.location.name),
      publishedAt: null,
    }));
  if (provider === 'lever')
    return lever.parse(data).map((job) => ({
      externalId: job.id,
      title: job.text,
      location: job.categories.location,
      department: job.categories.department,
      description: textFromHtml(
        [job.descriptionPlain, ...job.lists.map((l) => `${l.text}: ${l.content}`), job.additionalPlain].join(
          '\n',
        ),
      ),
      url: job.hostedUrl,
      remote: job.workplaceType === 'remote',
      publishedAt: null,
    }));
  return ashby
    .parse(data)
    .jobs.filter((job) => job.isListed)
    .map((job) => ({
      externalId: job.id,
      title: job.title,
      location: job.location,
      department: job.department,
      description: job.descriptionPlain.slice(0, 60000),
      url: job.jobUrl,
      remote: job.isRemote,
      publishedAt: job.publishedAt ? new Date(job.publishedAt) : null,
    }));
}

export async function fetchListings(
  provider: Provider,
  slug: string,
  fetcher: typeof fetch = fetch,
): Promise<Listing[]> {
  const all: Listing[] = [];
  for (let skip = 0; skip < 50000; skip += 100) {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetcher(providerUrl(provider, slug, skip), {
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/json' },
      });
      if (response.status !== 429 && response.status < 500) break;
      if (attempt < 2) {
        const seconds = Number(response.headers.get('retry-after'));
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 5000) : 250 * 2 ** attempt,
          ),
        );
      }
    }
    if (!response?.ok) throw new Error(`Board API returned HTTP ${response?.status ?? 'unknown'}`);
    const jobs = parseListings(provider, await response.json());
    all.push(...jobs);
    if (provider !== 'lever' || jobs.length < 100) return all;
  }
  throw new Error('Pagination exceeded limit; leave existing jobs unchanged.');
}
