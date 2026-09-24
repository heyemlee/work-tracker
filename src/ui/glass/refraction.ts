/**
 * Liquid-glass refraction for the web.
 *
 * Chromium can run an SVG filter as a `backdrop-filter`, so a displacement map can bend what sits behind a
 * pane — the way light bends through the rounded edge of a glass slab. Safari and Firefox don't support this,
 * so they keep the blur-and-highlight look from CSS.
 */

interface UserAgentData {
  brands?: { brand: string }[];
}

export const supportsRefraction: boolean = (() => {
  if (typeof navigator === 'undefined') return false;
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  return Boolean(data?.brands?.some(({ brand }) => /Chromium|Google Chrome|Microsoft Edge/i.test(brand)));
})();

/** Signed distance from a point to a rounded rectangle's edge: negative inside, positive outside. */
function roundedRectDistance(x: number, y: number, width: number, height: number, radius: number): number {
  const qx = Math.abs(x - width / 2) - (width / 2 - radius);
  const qy = Math.abs(y - height / 2) - (height / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

const MAX_CACHED = 24;
const cache = new Map<string, string>();

/**
 * Encodes a displacement field as an image: red = x offset, green = y offset, 128 = none. Inside the bevel
 * (a band `bevel` px wide along the edge) pixels sample from further inward, strongest at the edge, which
 * magnifies and bends the backdrop like a convex lens. Sampling inward also keeps every sample inside the pane.
 */
export function displacementMap(width: number, height: number, radius: number, bevel: number): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const r = Math.min(radius, w / 2, h / 2);
  const key = `${w}x${h}:${r}:${bevel}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(w, h);
  const { data } = image;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      const depth = -roundedRectDistance(px, py, w, h, r);
      let dx = 0;
      let dy = 0;
      if (depth < bevel) {
        const t = 1 - Math.max(0, depth) / bevel;
        const strength = t * t;
        // The gradient of the distance field points outward; its negation is the inward normal.
        const gx = roundedRectDistance(px + 1, py, w, h, r) - roundedRectDistance(px - 1, py, w, h, r);
        const gy = roundedRectDistance(px, py + 1, w, h, r) - roundedRectDistance(px, py - 1, w, h, r);
        const length = Math.hypot(gx, gy) || 1;
        dx = (-gx / length) * strength;
        dy = (-gy / length) * strength;
      }
      data[i] = 128 + Math.round(dx * 127);
      data[i + 1] = 128 + Math.round(dy * 127);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value ?? '');
  cache.set(key, url);
  return url;
}
