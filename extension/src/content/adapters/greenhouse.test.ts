import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/fixtures';
import { extractFields } from '../extract';
import { greenhouse } from './greenhouse';

describe('greenhouse', () => {
  const url = 'https://job-boards.greenhouse.io/discord/jobs/8811574002';
  const doc = loadFixture('greenhouse/discord.html', url);

  it('reads the posting', () => {
    const posting = greenhouse.posting(doc, url);
    expect(posting).toMatchObject({
      company: 'Discord',
      title: 'Senior Full-Stack Software Engineer, Developer Success',
      url,
    });
    expect(posting?.location).toContain('San Francisco');
    expect(posting?.description.length).toBeGreaterThan(500);
  });

  it('finds every field with its label, kind and meaning', () => {
    const { fields } = extractFields(greenhouse, doc, 0);
    const summary = fields.map(
      (field) => `${field.kind} ${field.hint ?? '-'} ${field.required ? '*' : ' '} ${field.label}`,
    );
    process.stderr.write(summary.join('\n') + '\n');
    expect(fields.find((field) => field.hint === 'name.first')).toMatchObject({
      label: 'First Name',
      kind: 'text',
      required: true,
    });
    expect(fields.find((field) => field.hint === 'resume')).toMatchObject({ kind: 'file' });
    expect(fields.find((field) => field.hint === 'eeo.gender')).toMatchObject({ kind: 'combobox' });
  });
});
