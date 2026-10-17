import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

// Only pinned, license-reviewed public originals. No model requests or auto-generated reference labels.
const catalogSchema = z.object({
  checked: z.string(),
  sources: z.array(
    z.object({
      id: z.string().regex(/^[a-z]+$/),
      repository: z.string().regex(/^[\w-]+\/[\w-]+$/),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      file: z.string().regex(/^[\w.-]+\.pdf$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      licenseFile: z.string().regex(/^[\w.-]+$/),
      licenseSha256: z.string().regex(/^[a-f0-9]{64}$/),
      license: z.enum(['MIT', 'CC-BY-SA-4.0']),
    }),
  ),
});
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function fetchPinned(url: string, expected: string, path: string) {
  try {
    const existing = await readFile(path);
    if (hash(existing) !== expected) throw new Error('Existing local file differs from pinned checksum.');
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Public source download returned ${response.status}.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing source body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 5 * 1024 * 1024) throw new Error('Source exceeds 5MB.');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const data = Buffer.concat(chunks);
  if (hash(data) !== expected) throw new Error('Source checksum mismatch; no file saved.');
  await writeFile(path, data, { flag: 'wx', mode: 0o600 });
}
async function main() {
  const catalog = catalogSchema.parse(
    JSON.parse(await readFile(resolve('evals/public-sources.json'), 'utf8')),
  );
  for (const source of catalog.sources) {
    const dir = resolve('evals/private/public-v2', source.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const base = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/`;
    await fetchPinned(base + source.licenseFile, source.licenseSha256, resolve(dir, source.licenseFile));
    await fetchPinned(base + source.file, source.sha256, resolve(dir, source.file));
    await writeFile(
      resolve(dir, 'provenance.json'),
      JSON.stringify(
        { ...source, licenseReviewDate: catalog.checked, downloadedAt: new Date().toISOString() },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    process.stdout.write(`${source.id}: original and ${source.license} evidence checksums verified\n`);
  }
  process.stdout.write(
    `${catalog.sources.length} original PDFs staged privately in public-v2. Draft/review references separately. No paid calls.\n`,
  );
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof Error && error.name !== 'ZodError'
      ? error.message + '\n'
      : 'Invalid public source catalog.\n',
  );
  process.exitCode = 1;
});
