import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/fixtures';
import { extractFields } from '../extract';
import { ashby } from './ashby';
import { lever } from './lever';

const summarize = (fields: ReturnType<typeof extractFields>['fields']) =>
  fields.map(
    (field) =>
      `${field.kind} ${field.hint ?? '-'} ${field.required ? '*' : ' '} ${field.label} ${field.options.length ? `[${field.options.join(' | ')}]` : ''}`,
  );

describe('ashby', () => {
  const url = 'https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application';
  const doc = loadFixture('ashby/notion.html', url);

  it('reads the posting', () => {
    expect(ashby.posting(doc, url)).toMatchObject({
      company: 'Notion',
      title: 'Software Engineer, Developer Platform',
      url: 'https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a',
    });
  });

  it('finds system fields, yes/no buttons, groups and EEO', () => {
    const { fields } = extractFields(ashby, doc, 0);
    expect(summarize(fields)).toMatchSnapshot();
    expect(fields.find((field) => field.hint === 'resume')?.kind).toBe('file');
    expect(fields.filter((field) => field.kind === 'file')).toHaveLength(1);
    expect(fields.find((field) => field.hint === 'location')?.kind).toBe('typeahead');
    expect(fields.find((field) => /sponsor/.test(field.label))).toMatchObject({
      kind: 'radio',
      options: ['Yes', 'No'],
      required: true,
    });
    expect(fields.find((field) => /hear about/.test(field.label))).toMatchObject({
      kind: 'multi',
      options: ['LinkedIn', 'Glassdoor', 'Notion Website'],
    });
  });
});

describe('lever', () => {
  const url = 'https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply';
  const doc = loadFixture('lever/palantir.html', url);

  it('reads the posting', () => {
    expect(lever.posting(doc, url)).toMatchObject({
      company: 'Palantir Technologies',
      url: 'https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2',
    });
  });

  it('finds the fields', () => {
    const { fields } = extractFields(lever, doc, 0);
    expect(summarize(fields)).toMatchSnapshot();
    expect(fields.find((field) => field.hint === 'name.full')).toMatchObject({
      label: 'Full name',
      required: true,
    });
    expect(fields.find((field) => /sponsorship/.test(field.label))).toMatchObject({
      kind: 'radio',
      options: ['Yes', 'No'],
    });
  });
});
