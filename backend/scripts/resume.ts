import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractResume } from '../src/resume/extract.js';
import { manifestSchema, predictionSchema, scoreSuite, type Prediction } from '../src/resume/evaluation.js';
import { methodSchema, modelConfig, parseResume } from '../src/resume/model.js';
import { quoteRequest, withBudget } from '../src/resume/budget.js';
import { PROMPT_VERSION, resumeSchema } from '../src/resume/schema.js';

const [command, input, output, ...flags] = process.argv.slice(2);
async function loadCases(path: string) {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
  const base = dirname(resolve(path));
  const cases = [];
  for (const item of manifest.cases) {
    const buffer = await readFile(resolve(base, item.file));
    const gold = resumeSchema.parse(JSON.parse(await readFile(resolve(base, item.gold), 'utf8')));
    const inputHash = createHash('sha256').update(buffer).digest('hex');
    if (item.sha256 && item.sha256 !== inputHash) throw new Error(`Source checksum mismatch: ${item.id}`);
    cases.push({ ...item, buffer, gold, inputHash });
  }
  return { manifest, cases };
}
async function main() {
  if (command === 'extract' && input && !output) {
    const result = await extractResume(await readFile(resolve(input)), input);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if ((command === 'plan' || command === 'quote') && input && !output) {
    const { manifest, cases } = await loadCases(input);
    const rows = [];
    for (const item of cases) {
      try {
        const extracted = await extractResume(item.buffer, item.file);
        rows.push({
          id: item.id,
          provenance: item.provenance,
          format: extracted.format,
          characters: extracted.text.length,
          warnings: extracted.warnings,
          referenceReview: item.referenceReview,
          ...(command === 'quote'
            ? {
                reservations: ['function-calling', 'structured-output'].map((method) =>
                  quoteRequest(
                    extracted.text,
                    methodSchema.parse(method),
                    process.env.RESUME_MODEL?.trim() || 'claude-sonnet-5-5',
                    process.env.RESUME_PROVIDER === 'openai' ? 'openai' : 'anthropic',
                  ),
                ),
              }
            : {}),
        });
      } catch (error) {
        rows.push({ id: item.id, error: error instanceof Error ? error.message : 'Extraction failed' });
      }
    }
    process.stdout.write(
      JSON.stringify(
        {
          description: manifest.description,
          paidRequests: 0,
          modelRequests: 0,
          uniqueSubjects: new Set(cases.map((item) => item.subjectId ?? item.id)).size,
          note:
            command === 'quote'
              ? 'Offline conservative reservations for both methods, not actual cost or token estimates. Failed calls keep their reservation. $5 shared-ledger cap applies to live evaluation.'
              : 'Extraction only. Character counts are not token counts or a price quote.',
          rows,
        },
        null,
        2,
      ) + '\n',
    );
  } else if (command === 'run' && input && output) {
    const methodFlag = flags.find((flag) => flag.startsWith('--method='));
    const method = methodSchema.parse(methodFlag?.split('=')[1] ?? 'function-calling');
    const budgetFlag = flags.find((flag) => flag.startsWith('--budget-usd='));
    if (flags.some((flag) => flag !== '--live' && flag !== methodFlag && flag !== budgetFlag))
      throw new Error('Unknown option.');
    const budgetUsd = Number(budgetFlag?.split('=')[1]);
    if (!budgetFlag || !Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 5)
      throw new Error('Live evaluation requires --budget-usd=<limit>, at most 5.');
    const config = modelConfig();
    if (!flags.includes('--live') || !config)
      throw new Error(
        'Live calls require --live, ENABLE_RESUME_AI=true, RESUME_MODEL and the selected provider API key. Use plan for an offline check.',
      );
    const { cases } = await loadCases(input);
    // Reserve a fresh file before any paid request; never overwrite an earlier run.
    await writeFile(resolve(output), '', { flag: 'wx', mode: 0o600 });
    // Built CLI is dist/scripts/resume.js. Anchor the ledger to this package even if invoked from another cwd.
    const ledger = fileURLToPath(new URL('../../evals/private/budget-ledger.json', import.meta.url));
    await mkdir(dirname(ledger), { recursive: true, mode: 0o700 });
    await withBudget(ledger, budgetUsd, async (budget) => {
      for (const item of cases) {
        let row: Prediction;
        let failed = false;
        const metadata = {
          id: item.id,
          inputHash: item.inputHash,
          model: config.model,
          provider: config.provider ?? 'anthropic',
          ...(config.provider === 'openai' ? { baseUrl: config.baseUrl ?? 'https://api.openai.com/v1' } : {}),
          method,
          promptVersion: PROMPT_VERSION,
          timestamp: new Date().toISOString(),
        };
        try {
          const extracted = await extractResume(item.buffer, item.file);
          const quote = quoteRequest(extracted.text, method, config.model, config.provider);
          const reservationId = await budget.reserve(item.id, quote);
          const result = await parseResume(extracted.text, method, config);
          await budget.recordUsage(reservationId, result.usage);
          row = { ...metadata, ok: true, ...result, reservationId, reservedUsd: quote.reservedUsd };
        } catch (error) {
          failed = true;
          process.exitCode = 1;
          row = { ...metadata, ok: false, error: error instanceof Error ? error.message : 'Failed' };
        }
        await writeFile(resolve(output), JSON.stringify(row) + '\n', { flag: 'a' });
        process.stderr.write(`${item.id}: ${row.ok ? 'ok' : 'failed'}\n`);
        if (failed) break; // Inspect the first failure before spending on further cases; no automatic retries.
      }
      process.stderr.write(JSON.stringify(budget.summary()) + '\n');
    });
  } else if (command === 'score' && input && output && !flags.length) {
    const { cases } = await loadCases(input);
    const predictions = (await readFile(resolve(output), 'utf8'))
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => predictionSchema.parse(JSON.parse(line)));
    process.stdout.write(JSON.stringify(scoreSuite(cases, predictions), null, 2) + '\n');
  } else {
    throw new Error(
      'Usage: npm run resume -- extract <file> | plan <manifest.json> | quote <manifest.json> | run <manifest.json> <new-run.jsonl> --live --budget-usd=5 [--method=function-calling|structured-output] | score <manifest.json> <run.jsonl>',
    );
  }
}
main().catch((error: unknown) => {
  // Avoid printing parser exceptions that could embed resume contents.
  process.stderr.write(
    error instanceof Error && error.name !== 'ZodError'
      ? error.message + '\n'
      : 'Invalid manifest, gold labels or prediction schema.\n',
  );
  process.exitCode = 1;
});
