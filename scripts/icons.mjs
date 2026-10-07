// Generate the web and Chrome icons from the same SVG used by both interfaces: npm run icons.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(new URL('../src/assets/outbox.svg', import.meta.url), 'utf8');
const fullBleed = source.replace('rx="15"', 'rx="0"');
// Keep the entire mark inside the central 80% circle, including on circular Android launchers.
const maskable = fullBleed.replace(
  '<g fill=',
  '<g transform="translate(32 32) scale(0.88) translate(-32 -32)" fill=',
);

const save = (file, contents) => {
  const path = fileURLToPath(new URL(`../${file}`, import.meta.url));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(file);
};
const render = (svg, size, file) =>
  save(file, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());

save('public/favicon.svg', source);
save('extension/public/icon.svg', source);
render(source, 192, 'public/icons/icon-192.png');
render(source, 512, 'public/icons/icon-512.png');
render(maskable, 512, 'public/icons/maskable-512.png');
render(fullBleed, 180, 'public/apple-touch-icon.png');
for (const size of [16, 32, 48, 96, 128]) {
  render(source, size, `extension/public/icon/${size}.png`);
}
