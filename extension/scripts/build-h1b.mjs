// Builds public/h1b.json from the USCIS H-1B Employer Data Hub: approvals per employer over three fiscal years.
//
//   node scripts/build-h1b.mjs            downloads FY2021–FY2023 from uscis.gov
//   node scripts/build-h1b.mjs <dir>      reads h1b_datahubexport-<year>.csv files from <dir> instead
//
// FY2024 onward is only available through the hub's interactive query, so the static files end at FY2023. The
// counts are a signal that an employer sponsors, not a promise.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const YEARS = [2021, 2022, 2023];
const SOURCE = (year) =>
  `https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-${year}.csv`;

const LEGAL_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|gmbh)\b/g;
const ENTITY =
  /\b(inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|lp|llp|plc|pbc|holdings?|group|technologies|technology|usa|us|america)\b/g;

/** Same key as src/match/h1b.ts `employerKey` (a test keeps them in step). */
export function employerKey(name) {
  const normalized = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.replace(ENTITY, ' ').replace(/\s+/g, ' ').trim();
}

/** Minimal CSV: quoted fields with doubled quotes, no embedded newlines (none in these files). */
export function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

export function aggregate(csvTexts) {
  /** key → { approvals, names: Map<name, approvals> } */
  const employers = new Map();
  for (const text of csvTexts) {
    const [header, ...lines] = text.split(/\r?\n/).filter(Boolean);
    const columns = parseCsvLine(header).map((column) => column.trim().toLowerCase());
    const at = (name) => columns.indexOf(name);
    const [employer, initial, continuing] = [
      at('employer'),
      at('initial approval'),
      at('continuing approval'),
    ];
    for (const line of lines) {
      const cells = parseCsvLine(line);
      const name = (cells[employer] ?? '').trim();
      const key = employerKey(name);
      if (!key) continue;
      const approvals = Number(cells[initial] ?? 0) + Number(cells[continuing] ?? 0);
      if (!Number.isFinite(approvals) || approvals <= 0) continue;
      const entry = employers.get(key) ?? { approvals: 0, names: new Map() };
      entry.approvals += approvals;
      entry.names.set(name, (entry.names.get(name) ?? 0) + approvals);
      employers.set(key, entry);
    }
  }
  const out = {};
  for (const [key, entry] of [...employers].sort(([a], [b]) => a.localeCompare(b))) {
    const name = [...entry.names].sort((a, b) => b[1] - a[1])[0][0];
    out[key] = [entry.approvals, name];
  }
  return out;
}

async function main() {
  const dir = process.argv[2];
  const texts = [];
  for (const year of YEARS) {
    if (dir) texts.push(await readFile(join(dir, `h1b_datahubexport-${year}.csv`), 'utf8'));
    else {
      const response = await fetch(SOURCE(year));
      if (!response.ok) throw new Error(`FY${year}: ${response.status}`);
      texts.push(await response.text());
    }
  }
  const employers = aggregate(texts);
  const target = fileURLToPath(new URL('../public/h1b.json', import.meta.url));
  await writeFile(target, JSON.stringify({ years: YEARS, employers }));
  console.log(`${Object.keys(employers).length} employers → public/h1b.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
