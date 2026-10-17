import { z } from 'zod';
import { resumeSchema, type ResumeFacts } from './schema.js';

export const manifestSchema = z
  .strictObject({
    description: z.string().min(1),
    cases: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          file: z.string().min(1),
          gold: z.string().min(1),
          provenance: z.enum(['synthetic', 'consented', 'public-licensed']),
          source: z.string().min(1),
          permission: z.string().min(1),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          subjectId: z.string().min(1).optional(),
          referenceReview: z
            .enum(['synthetic-fixture', 'agent-draft', 'agent-reviewed', 'owner-reviewed', 'unreviewed'])
            .default('unreviewed'),
        }),
      )
      .min(1),
  })
  .superRefine((manifest, context) => {
    if (new Set(manifest.cases.map((item) => item.id)).size !== manifest.cases.length)
      context.addIssue({ code: 'custom', message: 'Case IDs must be unique.' });
  });
export const predictionSchema = z.discriminatedUnion('ok', [
  z
    .object({ id: z.string(), ok: z.literal(true), facts: resumeSchema, inputHash: z.string().optional() })
    .passthrough(),
  z
    .object({ id: z.string(), ok: z.literal(false), error: z.string(), inputHash: z.string().optional() })
    .passthrough(),
]);
export type Prediction = z.output<typeof predictionSchema>;

/** A later source review can withdraw a public sample without erasing historical runs. */
export function assertPublicSourceEligibility(
  cases: { id: string; provenance: string; inputHash: string }[],
  excludedSources: { sha256: string; reason: string }[],
) {
  for (const item of cases) {
    const excluded = excludedSources.find((source) => source.sha256 === item.inputHash);
    if (item.provenance === 'public-licensed' && excluded)
      throw new Error(`Public sample ${item.id} is excluded from live evaluation: ${excluded.reason}`);
  }
}
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Empty defaults don't earn accuracy points. Skills/languages are sets; employment/education remain ordered. */
function fields(facts: ResumeFacts): Map<string, string> {
  const result = new Map<string, string>();
  function visit(value: unknown, path: string) {
    if (typeof value === 'string') {
      const normalized = normalize(value);
      if (normalized) result.set(path, normalized);
    } else if (Array.isArray(value)) {
      if (path === 'skills' || path === 'languages') {
        for (const item of new Set(value.map((entry: string) => normalize(entry)).filter(Boolean)))
          result.set(`${path}[${item}]`, item);
      } else value.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
    }
  }
  visit(facts, '');
  return result;
}
export function compareFacts(gold: ResumeFacts, predicted: ResumeFacts | null) {
  const expected = fields(gold),
    actual = predicted ? fields(predicted) : new Map<string, string>();
  let matched = 0;
  const differences: {
    field: string;
    kind: 'missing' | 'extra' | 'different';
    expected: string;
    actual: string;
  }[] = [];
  for (const field of new Set([...expected.keys(), ...actual.keys()])) {
    const want = expected.get(field) ?? '',
      got = actual.get(field) ?? '';
    if (want === got) matched++;
    else
      differences.push({
        field,
        kind: !want ? 'extra' : !got ? 'missing' : 'different',
        expected: want,
        actual: got,
      });
  }
  return { matched, expected: expected.size, predicted: actual.size, differences };
}
export function scoreSuite(
  cases: {
    id: string;
    gold: ResumeFacts;
    inputHash: string;
    provenance: string;
    subjectId?: string;
    referenceReview?: string;
  }[],
  predictions: Prediction[],
) {
  const ids = new Set(cases.map((item) => item.id));
  if (new Set(predictions.map((item) => item.id)).size !== predictions.length)
    throw new Error('Duplicate prediction IDs.');
  if (predictions.some((item) => !ids.has(item.id)))
    throw new Error('Prediction contains an unknown case ID.');
  const rows = cases.map((item) => {
    const prediction = predictions.find((entry) => entry.id === item.id);
    if (prediction?.inputHash && prediction.inputHash !== item.inputHash)
      throw new Error(`Input file changed: ${item.id}`);
    const score = compareFacts(item.gold, prediction?.ok ? prediction.facts : null);
    return {
      id: item.id,
      provenance: item.provenance,
      referenceReview: item.referenceReview ?? 'unreviewed',
      ok: prediction?.ok ?? false,
      error: prediction?.ok ? null : (prediction?.error ?? 'Missing prediction'),
      ...score,
    };
  });
  const totals = rows.reduce(
    (acc, row) => ({
      matched: acc.matched + row.matched,
      expected: acc.expected + row.expected,
      predicted: acc.predicted + row.predicted,
    }),
    { matched: 0, expected: 0, predicted: 0 },
  );
  return {
    cases: rows.length,
    failedCases: rows.filter((row) => !row.ok).length,
    uniqueSubjects: new Set(cases.map((item) => item.subjectId ?? item.id)).size,
    provisional: cases.some(
      (item) => item.referenceReview !== 'owner-reviewed' && item.provenance !== 'synthetic',
    ),
    note: 'Exact normalized field agreement against references; draft labels and tiny samples are not validated extraction accuracy.',
    provenance: Object.fromEntries(
      [...new Set(rows.map((r) => r.provenance))].map((kind) => [
        kind,
        rows.filter((r) => r.provenance === kind).length,
      ]),
    ),
    ...totals,
    precision: totals.predicted ? totals.matched / totals.predicted : null,
    recall: totals.expected ? totals.matched / totals.expected : null,
    rows,
  };
}
