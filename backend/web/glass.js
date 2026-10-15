import { displacementMap, supportsRefraction } from './refraction.js';

const reduced = matchMedia('(prefers-reduced-transparency: reduce)');
const ns = 'http://www.w3.org/2000/svg';
const panes = [...document.querySelectorAll('.glass')];
function node(tag, attrs) {
  const result = document.createElementNS(ns, tag);
  for (const [name, value] of Object.entries(attrs)) result.setAttribute(name, String(value));
  return result;
}
function render(pane, index) {
  pane.style.backdropFilter = '';
  pane.style.webkitBackdropFilter = '';
  pane.querySelector('.glass-filter')?.remove();
  if (!supportsRefraction || reduced.matches) return;
  const box = pane.getBoundingClientRect();
  const width = Math.round(box.width),
    height = Math.round(box.height);
  if (!width || !height) return;
  const radius = parseFloat(getComputedStyle(pane).borderTopLeftRadius),
    bevel = 14;
  const map = displacementMap(width, height, radius, bevel);
  if (!map) return;
  const id = `jobs-glass-${index}`;
  const svg = node('svg', { class: 'glass-filter', 'aria-hidden': 'true', focusable: 'false' });
  const filter = node('filter', {
    id,
    x: 0,
    y: 0,
    width,
    height,
    filterUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  });
  filter.append(
    node('feImage', { href: map, x: 0, y: 0, width, height, preserveAspectRatio: 'none', result: 'map' }),
    node('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'map',
      scale: bevel * 0.9 * 2,
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    }),
  );
  svg.append(filter);
  pane.append(svg);
  pane.style.backdropFilter = `blur(var(--glass-blur)) url(#${id}) saturate(1.8)`;
  pane.style.webkitBackdropFilter = pane.style.backdropFilter;
}
let frame;
function refresh() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => panes.forEach(render));
}
const observer = new ResizeObserver(refresh);
panes.forEach((pane) => observer.observe(pane));
reduced.addEventListener('change', refresh);
