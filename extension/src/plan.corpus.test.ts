import { describe, expect, it } from 'vitest';
import type { FieldKind, PlannedField, ScannedField } from './model';
import { planForm, summarize } from './plan';
import type { RuleContext } from './rules/context';
import { makeProfile } from './test/profiles';
import questions from '../test/data/questions.json';

interface Question {
  source: string;
  label: string;
  description: string;
  kind: FieldKind;
  options: string[];
  required: boolean;
}

// 646 questions from public Greenhouse, Ashby and Lever application forms (collected 2026-09-27).
const corpus = questions as Question[];

const ctx: RuleContext = {
  profile: makeProfile(),
  email: 'alex@example.com',
  resumeId: 'resume-1',
  posting: {
    ats: 'greenhouse',
    company: 'Acme Hiring',
    title: 'Software Engineer',
    url: 'https://example.com/jobs/1',
    location: 'San Francisco, CA',
    description: '',
  },
  today: '2026-09-27',
  appliedBefore: false,
};

const fields: ScannedField[] = corpus.map((question, index) => ({
  id: String(index),
  label: question.label,
  description: question.description,
  kind: question.kind,
  options: question.options,
  required: question.required,
  hint: null,
  section: '',
  entry: null,
  filled: false,
  maxLength: null,
}));
// Each question as a form of its own: they come from many forms, and in one form a second "Current company" is
// another job's.
const plan = fields.map((field) => planForm([field], ctx, [])[0]!);

function shown(entry: PlannedField): string {
  const answer = entry.answer;
  if (!answer) return '';
  switch (answer.type) {
    case 'text':
      return answer.text;
    case 'choice':
      return answer.option ?? `(${answer.want.kind})`;
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

describe('the question corpus', () => {
  it('answers every question the same way as last reviewed', () => {
    // Review changes to this snapshot line by line: each is an answer that will go into a real application.
    const lines = plan.map(
      (entry, index) =>
        `${entry.status.padEnd(7)} ${(entry.key ?? '').padEnd(24)} ${fields[index]?.label.slice(0, 110)} => ${shown(entry).slice(0, 80)}`,
    );
    expect(lines).toMatchSnapshot();
  });

  it('leaves no critical question to memory or AI, and marks every one for confirmation', () => {
    for (const entry of plan.filter((item) => item.critical)) {
      expect(entry.source === null || entry.source === 'rule').toBe(true);
      expect(['confirm', 'missing']).toContain(entry.status);
    }
  });

  it('answers most questions without AI', () => {
    const counts = summarize(plan);
    const answered = counts.filled + counts.confirm;
    expect(answered / corpus.length).toBeGreaterThan(0.6);
  });
});
