// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { material } from '../src/ai/prompts';
import { draftAnswer } from '../src/background/ai';
import { parseProfile } from '../src/profile/schema';
import { apiKeyItem, DEFAULT_SETTINGS, settingsItem, usageItem, type Model } from '../src/storage';
import { makeProfile } from '../src/test/profiles';
import { questions } from './eval-questions';

/**
 * The free-text eval. Each model drafts the same 20 questions through the extension's own `draftAnswer`, and the
 * report sets the drafts side by side with what a careful reader would catch: phrases the prompt rules out and
 * numbers the applicant's material never states. Reading the drafts is the real test; the flags only point.
 *
 *   ANTHROPIC_API_KEY=sk-ant-… npm run eval -w extension
 *   EVAL_PROFILE=path/to/profile.json   drafts for that profile instead of the test applicant
 *
 * A run costs about $1 and writes `evals/drafts-<date>.md`. It needs RUN_EVAL, so it never runs with the tests.
 */

const MODELS: Model[] = ['claude-opus-5-5', 'claude-sonnet-5-5'];

// What DRAFT_SYSTEM tells the model not to write.
const BANNED =
  /passionate|thrilled|excited to|leverage|delve|cutting[- ]edge|dynamic|synergy|spearheaded|i am confident that|—|not only\b.*\bbut also/i;

function applicant() {
  const path = process.env.EVAL_PROFILE?.replace(/^~(?=\/)/, homedir());
  if (!path) return { profile: makeProfile(), source: 'the test applicant' };
  const parsed = parseProfile(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error(`EVAL_PROFILE: ${parsed.errors.join('; ')}`);
  return { profile: parsed.profile, source: path };
}

/** Numbers in a draft that the applicant's material never states: likely invented. */
function unsupportedNumbers(draft: string, material: string): string[] {
  const known = new Set(material.match(/\d+(?:[.,]\d+)*/g) ?? []);
  return [...new Set(draft.match(/\d+(?:[.,]\d+)*/g) ?? [])].filter((number) => !known.has(number));
}

function flagsOf(draft: string, material: string): string[] {
  const banned = BANNED.exec(draft)?.[0];
  const numbers = unsupportedNumbers(draft, material);
  return [
    ...(banned ? [`uses “${banned}”`] : []),
    ...(numbers.length ? [`numbers not in the material: ${numbers.join(', ')}`] : []),
  ];
}

interface Row {
  draft: string | null;
  cost: number;
  flags: string[];
}

describe.skipIf(!process.env.RUN_EVAL)('free-text drafts', () => {
  it('drafts each question with each model and writes the report', { timeout: 40 * 60_000 }, async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Set ANTHROPIC_API_KEY to run the eval.');
    await apiKeyItem.setValue(key);
    const { profile, source } = applicant();
    const today = new Date().toLocaleDateString('en-CA');
    const context = material(profile, today);
    const results = new Map<Model, Row[]>();

    for (const model of MODELS) {
      await settingsItem.setValue({ ...DEFAULT_SETTINGS, model });
      const rows: Row[] = [];
      for (const [index, question] of questions.entries()) {
        await usageItem.setValue([]);
        const draft = await draftAnswer(
          {
            id: `q${index + 1}`,
            label: question.label,
            description: question.help,
            kind: 'textarea',
            options: [],
            required: true,
            maxLength: null,
          },
          profile,
          {
            ats: 'generic',
            company: question.company,
            title: question.title,
            url: '',
            location: null,
            description: question.description,
          },
          today,
          [],
        );
        const cost = (await usageItem.getValue())[0]?.cost ?? 0;
        rows.push({ draft, cost, flags: draft ? flagsOf(draft, context) : [] });
      }
      results.set(model, rows);
    }

    const lines = [
      `# Free-text drafts, ${today}`,
      '',
      `${questions.length} questions, drafted for ${source} with the extension’s own prompt. Flags point at things to check; they are not verdicts. “No draft” means the model found nothing honest to say, which is the right call when the material has no answer.`,
      '',
      '| Model | Drafts | Flagged | Cost |',
      '|---|---|---|---|',
      ...MODELS.map((model) => {
        const rows = results.get(model) ?? [];
        const drafted = rows.filter((row) => row.draft).length;
        const flagged = rows.filter((row) => row.flags.length).length;
        const cost = rows.reduce((sum, row) => sum + row.cost, 0);
        return `| ${model} | ${drafted}/${rows.length} | ${flagged} | $${cost.toFixed(2)} |`;
      }),
      '',
    ];
    for (const [index, question] of questions.entries()) {
      lines.push(`## ${index + 1}. ${question.company}: ${question.label}`, '');
      if (question.help) lines.push(`*${question.help}*`, '');
      for (const model of MODELS) {
        const row = results.get(model)?.[index];
        if (!row) continue;
        const words = row.draft ? row.draft.split(/\s+/).length : 0;
        lines.push(`### ${model} · ${words} words · $${row.cost.toFixed(3)}`, '');
        if (row.flags.length) lines.push(`⚠ ${row.flags.join('; ')}`, '');
        lines.push(row.draft ? `> ${row.draft.replace(/\n/g, '\n> ')}` : '*No draft.*', '');
      }
    }
    mkdirSync('evals', { recursive: true });
    const file = `evals/drafts-${today}.md`;
    writeFileSync(file, lines.join('\n'));
    console.log(`Wrote ${file}`);
    expect(results.size).toBe(MODELS.length);
  });
});
