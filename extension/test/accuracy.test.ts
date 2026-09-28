import { describe, expect, it } from 'vitest';
import { FIXTURES, planFixture } from './accuracy';
import expected from './fixtures/expected.json';

/**
 * Fill accuracy on saved application pages. Every expected answer was reviewed by hand for the test applicant (F-1
 * STEM OPT, Bay Area); a rule change that alters one fails here. Coverage is the share of required fields filled
 * without the owner, per applicant-tracking system.
 */
describe('fill accuracy on saved pages', () => {
  const report: Record<string, { expected: number; correct: number; required: number; answered: number }> =
    {};

  for (const fixture of FIXTURES) {
    it(fixture.path, () => {
      const rows = planFixture(fixture);
      const wanted = (expected as unknown as Record<string, [string, string][]>)[fixture.path] ?? [];
      const seen = new Map<string, number>();
      const byLabel = new Map<string, typeof rows>();
      for (const row of rows) byLabel.set(row.label, [...(byLabel.get(row.label) ?? []), row]);
      const stats = (report[fixture.ats] ??= { expected: 0, correct: 0, required: 0, answered: 0 });
      const wrong: string[] = [];
      for (const [label, value] of wanted) {
        const occurrence = seen.get(label) ?? 0;
        seen.set(label, occurrence + 1);
        // The same filter the expectations were written with: placeholders like "(eeo)" can't be checked.
        const candidates = (byLabel.get(label) ?? []).filter(
          (row) => row.value && !/^\(.*\)$/.test(row.value),
        );
        const actual = candidates[occurrence]?.value;
        stats.expected++;
        if (actual === value) stats.correct++;
        else wrong.push(`${label}: expected ${value}, got ${actual ?? 'nothing'}`);
      }
      for (const row of rows.filter((item) => item.field.required)) {
        stats.required++;
        if (row.entry.status === 'filled' || row.entry.status === 'confirm') stats.answered++;
      }
      expect(wrong).toEqual([]);
    });
  }

  it('reports accuracy and coverage per system', () => {
    const lines = Object.entries(report).map(
      ([ats, stats]) =>
        `${ats.padEnd(10)} accuracy ${stats.correct}/${stats.expected}  coverage ${stats.answered}/${stats.required} required fields (${Math.round((stats.answered / stats.required) * 100)}%)`,
    );
    console.log(`Fill accuracy\n${lines.join('\n')}`);
    for (const stats of Object.values(report)) {
      expect(stats.correct).toBe(stats.expected);
      // Required fields left to the owner are free-text essays and questions only they can answer.
      expect(stats.answered / stats.required).toBeGreaterThanOrEqual(0.6);
    }
  });
});
