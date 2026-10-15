import { describe, expect, it, vi } from 'vitest';
import { fetchListings, parseListings, providerUrl } from '../src/providers.js';

describe('public board connectors', () => {
  it('normalizes Greenhouse without inventing publication dates', () => {
    expect(
      parseListings('greenhouse', {
        jobs: [
          {
            id: 7,
            title: 'Engineer',
            absolute_url: 'https://example.com/jobs/7',
            location: { name: 'Remote' },
            content: '&lt;p&gt;TypeScript &amp; SQL&lt;/p&gt;',
            updated_at: '2026-10-01T00:00:00Z',
          },
        ],
      })[0],
    ).toMatchObject({ externalId: '7', description: 'TypeScript & SQL', remote: true, publishedAt: null });
  });
  it('includes Lever lists and excludes unlisted Ashby posts', () => {
    expect(
      parseListings('lever', [
        {
          id: 'one',
          text: 'Engineer',
          hostedUrl: 'https://jobs.lever.co/acme/one',
          workplaceType: 'remote',
          lists: [{ text: 'Requirements', content: '<li>SQL</li>' }],
        },
      ])[0],
    ).toMatchObject({ description: 'Requirements: SQL', remote: true });
    expect(
      parseListings('ashby', {
        jobs: [{ id: 'a', title: 'Engineer', jobUrl: 'https://jobs.ashbyhq.com/acme/a', isListed: false }],
      }),
    ).toEqual([]);
    expect(
      parseListings('ashby', {
        jobs: [{ id: 'a', title: 'Engineer', jobUrl: 'https://jobs.ashbyhq.com/acme/a', isRemote: null }],
      })[0]?.remote,
    ).toBe(false);
  });
  it('rejects malformed complete boards and non-HTTPS posting URLs', () => {
    expect(() => parseListings('greenhouse', { error: 'unavailable' })).toThrow();
    expect(() =>
      parseListings('ashby', { jobs: [{ id: 'a', title: 'Engineer', jobUrl: 'javascript:alert(1)' }] }),
    ).toThrow();
    expect(() => providerUrl('lever', '../localhost')).toThrow();
  });
  it('fetches all Lever pages before returning', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      text: 'Engineer',
      hostedUrl: `https://jobs.lever.co/acme/${i}`,
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json([{ ...page[0], id: '100' }]));
    expect(await fetchListings('lever', 'acme', fetcher)).toHaveLength(101);
    expect(fetcher.mock.calls[1]![0]).toContain('skip=100');
  });
  it('throws on a failed later page so partial results cannot deactivate jobs', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      text: 'Engineer',
      hostedUrl: `https://jobs.lever.co/acme/${i}`,
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(fetchListings('lever', 'acme', fetcher)).rejects.toThrow('HTTP 404');
  });
});
