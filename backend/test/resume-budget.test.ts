import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { quoteRequest, withBudget } from '../src/resume/budget.js';

describe('shared evaluation budget', () => {
  it('quotes offline and refuses unknown prices', () => {
    const q = quoteRequest('resume', 'function-calling', 'claude-sonnet-5-5');
    expect(q.reservedInputTokens).toBeGreaterThan(q.payloadBytes);
    expect(q.maxOutputTokens).toBe(8192);
    expect(() => quoteRequest('resume', 'structured-output', 'unknown')).toThrow('verified');
  });
  it('retains failed reservations across methods and rejects overspend', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-budget-')),
      path = join(dir, 'ledger.json');
    try {
      const q = quoteRequest('resume', 'function-calling', 'claude-sonnet-5-5');
      await expect(
        withBudget(path, q.reservedUsd + 0.001, async (b) => {
          await b.reserve('a', q);
          throw new Error('network died');
        }),
      ).rejects.toThrow('network died');
      await withBudget(path, 5, async (b) => {
        expect(b.summary().reservedUsd).toBe(q.reservedUsd);
        expect(b.summary().unresolvedCalls).toBe(1);
        await expect(
          b.reserve('b', quoteRequest('resume', 'structured-output', 'claude-sonnet-5-5')),
        ).rejects.toThrow('Insufficient');
      });
      expect(JSON.parse(await readFile(path, 'utf8')).entries).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('locks concurrency and keeps conservative reserves after recording actual usage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-budget-')),
      path = join(dir, 'ledger.json');
    try {
      await withBudget(path, 5, async (b) => {
        await expect(withBudget(path, 5, async () => {})).rejects.toThrow('locked');
        const q = quoteRequest('resume', 'function-calling', 'claude-sonnet-5-5'),
          id = await b.reserve('one', q);
        await b.recordUsage(id, { input_tokens: 1000, output_tokens: 100 });
        expect(b.summary()).toMatchObject({
          reservedUsd: q.reservedUsd,
          actualKnownUsd: 0.003,
          unresolvedCalls: 0,
          limitUsd: 5,
        });
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('rejects authorization above $5 and refuses to reset corruption', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-budget-')),
      path = join(dir, 'ledger.json');
    try {
      await expect(withBudget(path, 5.01, async () => {})).rejects.toThrow('at most');
      await writeFile(path, 'broken');
      await expect(withBudget(path, 5, async () => {})).rejects.toThrow('refusing to reset');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('halts future runs if provider usage ever exceeds a reservation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-budget-')),
      path = join(dir, 'ledger.json');
    try {
      const quote = quoteRequest('resume', 'function-calling', 'claude-sonnet-5-5');
      await withBudget(path, 5, async (budget) => {
        const id = await budget.reserve('one', quote);
        await expect(budget.recordUsage(id, { input_tokens: 200_000, output_tokens: 8192 })).rejects.toThrow(
          'exceeded',
        );
      });
      await withBudget(path, 5, async (budget) => {
        await expect(budget.reserve('two', quote)).rejects.toThrow('halted');
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
