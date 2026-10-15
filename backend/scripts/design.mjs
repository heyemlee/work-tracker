import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const source = new URL('../../src/', import.meta.url);
const output = new URL('../web/.generated/', import.meta.url);
const css = await readFile(new URL('index.css', source), 'utf8');
const tokensStart = css.indexOf(':root {');
const tokensEnd = css.indexOf('@layer base');
if (tokensStart < 0 || tokensEnd < tokensStart) throw new Error('Cannot find Outbox design tokens.');

function rule(selector) {
  const start = css.indexOf(selector.endsWith(',') ? selector : `${selector} {`);
  if (start < 0) throw new Error(`Missing shared style: ${selector}`);
  let depth = 0;
  for (let at = css.indexOf('{', start); at < css.length; at++) {
    if (css[at] === '{') depth++;
    if (css[at] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, at + 1);
    }
  }
  throw new Error(`Unclosed shared style: ${selector}`);
}

const selectors = [
  '.ambient',
  "[data-theme='white'] .ambient,",
  '.glass',
  '.glass::before',
  '.glass::after',
  '.glass-strong',
  '.card',
  '.select',
  '@media (prefers-reduced-transparency: reduce)',
];
// The ambient visibility rule is a selector list; preserve it whole.
const shared = selectors.map(rule);
await mkdir(output, { recursive: true });
await writeFile(
  new URL('design.css', output),
  `/* Generated from src/index.css. Edit the source design system. */\n${css.slice(tokensStart, tokensEnd)}\n${shared.join('\n\n')}\n`,
);
await writeFile(new URL('outbox.svg', output), await readFile(new URL('assets/outbox.svg', source)));
const refraction = await readFile(new URL('ui/glass/refraction.ts', source), 'utf8');
await writeFile(
  new URL('refraction.js', output),
  ts.transpileModule(refraction, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText,
);
console.log('Reused Outbox colors, glass styles, refraction and brand mark.');
