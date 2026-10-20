import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keeps the built service running on this Mac for the deployed app: started at login, started again if it stops.
const LABEL = 'com.outbox.tools';
const agents = join(homedir(), 'Library/LaunchAgents');
const plist = join(agents, `${LABEL}.plist`);
const log = join(homedir(), 'Library/Logs/outbox-tools.log');
const service = `gui/${process.getuid?.()}/${LABEL}`;
const launchctl = (...args: string[]) => execFileSync('launchctl', args, { stdio: 'inherit' });
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function install() {
  // The `node` on PATH, a link Homebrew moves on upgrade, rather than this process's versioned path, which goes away.
  const node =
    (process.env.PATH ?? '')
      .split(':')
      .filter((dir) => dir && !dir.includes('node_modules'))
      .map((dir) => join(dir, 'node'))
      .find((file) => existsSync(file)) ?? process.execPath;
  const program = [node, '--env-file-if-exists=.env', 'dist/src/main.js'];
  await mkdir(agents, { recursive: true });
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${program.map((value) => `<string>${xml(value)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(fileURLToPath(new URL('../..', import.meta.url)))}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`,
  );
  remove(false);
  launchctl('bootstrap', `gui/${process.getuid?.()}`, plist);
  console.log(`Started ${LABEL}; it starts again at login. Log: ${log}`);
}

const loaded = () => {
  try {
    execFileSync('launchctl', ['print', service], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

function remove(report = true) {
  try {
    execFileSync('launchctl', ['bootout', service], { stdio: 'ignore' });
  } catch {
    // Not loaded.
  }
  // The agent can outlive bootout for a moment, and loading it again before it's gone fails with an I/O error.
  for (let wait = 0; wait < 50 && loaded(); wait++) execFileSync('sleep', ['0.1']);
  if (report) console.log(`Stopped ${LABEL}.`);
}

switch (process.argv[2]) {
  case 'install':
    await install();
    break;
  case 'restart':
    launchctl('kickstart', '-k', service);
    break;
  case 'remove':
    remove();
    await rm(plist, { force: true });
    break;
  default:
    console.error('Usage: npm run autostart -- install | restart | remove');
    process.exitCode = 1;
}
