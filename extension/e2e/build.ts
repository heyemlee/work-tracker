import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * As a run starts: the build the specs drive (`wxt.e2e.config.ts`), made afresh from the source as it is, in a
 * folder of its own. The build Chrome loads is only read, by the spec that checks what a page can reach of it.
 */
export default function buildForSpecs(): void {
  try {
    execFileSync('npx', ['wxt', 'build', '--config', 'wxt.e2e.config.ts'], {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      stdio: 'pipe',
    });
  } catch (error) {
    // What the build said, which a run that went well keeps to itself.
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`The build for the specs failed.\n${stdout ?? ''}${stderr ?? ''}`, { cause: error });
  }
}
