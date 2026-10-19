// Generate the web and Chrome icons, and src/assets/outbox.svg they're drawn from, from the pet at rest: npm run icons.
// The pet is the one the site and the extension animate (src/ui/pet/engine.ts), so the icon is its frame, not a
// drawing of it.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PET_ICON, PET_MIDDLE_Y, PetSim } from '../src/ui/pet/engine.ts';

// Eyes open and ahead, a little bigger than the live pet's so they still read at 16 pixels.
const pet = new PetSim({ breathe: false, eyeBoost: 1.2 }).frame();

const { tile, radius } = PET_ICON;
const icon = ({
  rx,
  scale,
}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tile} ${tile}" width="100%" height="100%">
  <rect width="${tile}" height="${tile}" rx="${rx}" fill="#fff" />
  <g transform="translate(${tile / 2} ${tile / 2 - PET_MIDDLE_Y * scale}) scale(${scale})">
    <path fill="#000000" d="${pet.body}" />
    <path fill="#ffffff" d="${pet.eyes[0]}" />
    <path fill="#ffffff" d="${pet.eyes[1]}" />
  </g>
</svg>
`;
const source = icon({ rx: radius, scale: PET_ICON.scale });
const fullBleed = icon({ rx: 0, scale: PET_ICON.scale });
// Inside the middle 80% circle, all of it, for circular Android launchers.
const maskable = icon({ rx: 0, scale: 0.3 });

const save = (file, contents) => {
  const path = fileURLToPath(new URL(`../${file}`, import.meta.url));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(file);
};
const render = (svg, size, file) =>
  save(file, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());

save('src/assets/outbox.svg', source);
save('public/favicon.svg', source);
save('extension/public/icon.svg', source);
render(source, 192, 'public/icons/icon-192.png');
render(source, 512, 'public/icons/icon-512.png');
render(maskable, 512, 'public/icons/maskable-512.png');
render(fullBleed, 180, 'public/apple-touch-icon.png');
for (const size of [16, 32, 48, 96, 128]) {
  render(source, size, `extension/public/icon/${size}.png`);
}
