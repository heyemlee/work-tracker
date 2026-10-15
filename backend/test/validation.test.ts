import { expect, it } from 'vitest';
import { boardFromUrl, jobQuerySchema } from '../src/validation.js';

it('reads a board from a supported URL without accepting arbitrary outbound destinations', () => {
  expect(boardFromUrl('https://job-boards.greenhouse.io/figma/jobs/123')).toEqual({
    provider: 'greenhouse',
    slug: 'figma',
  });
  expect(boardFromUrl('https://jobs.ashbyhq.com/notion')).toEqual({ provider: 'ashby', slug: 'notion' });
  for (const url of [
    'http://jobs.lever.co/acme',
    'https://localhost/acme',
    'https://jobs.lever.co.evil.example/acme',
    'https://user:pass@jobs.lever.co/acme',
    'https://jobs.lever.co/%2fprivate',
  ])
    expect(() => boardFromUrl(url)).toThrow();
});
it('bounds search, validates selections and handles pagination consistently', () => {
  expect(jobQuerySchema.parse({ q: ' engineer ', remote: 'true' })).toMatchObject({
    q: 'engineer',
    page: 1,
    active: 'true',
  });
  expect(jobQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  expect(jobQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  expect(jobQuerySchema.safeParse({ boardId: 'broken' }).success).toBe(false);
});
