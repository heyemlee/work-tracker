// Renders the app icons from one SVG definition. Run with `node scripts/icons.mjs` after changing the mark;
// the PNGs are committed. Needs @resvg/resvg-js (installed on demand: npm i --no-save @resvg/resvg-js).
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

const glyph = (scale) => `
  <g transform="translate(32 32) scale(${scale}) translate(-32 -31)" fill="none" stroke="#fff" stroke-width="4.5"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 36v5.5a4.5 4.5 0 0 0 4.5 4.5h19a4.5 4.5 0 0 0 4.5-4.5V36" />
    <path d="M32 37V17M24.5 24.5 32 17l7.5 7.5" />
  </g>`;

const background = `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3a3a3c" /><stop offset="1" stop-color="#0b0b0c" /></linearGradient></defs>`;

// "any" icons keep the rounded tile; maskable and Apple icons are full-bleed because the OS applies its own mask.
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${background}
  <rect width="64" height="64" rx="15" fill="url(#bg)" />${glyph(1)}</svg>`;
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${background}
  <rect width="64" height="64" fill="url(#bg)" />${glyph(scale)}</svg>`;

const render = (svg, size, file) => {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(`../public/${file}`, import.meta.url), png);
  console.log(`public/${file}`);
};

render(rounded, 192, 'icons/icon-192.png');
render(rounded, 512, 'icons/icon-512.png');
render(fullBleed(0.78), 512, 'icons/maskable-512.png');
render(fullBleed(0.9), 180, 'apple-touch-icon.png');
