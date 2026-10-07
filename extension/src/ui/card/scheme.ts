/**
 * Whether a page is dark, from the backgrounds of its body and root, front to back. A layer that is mostly
 * see-through shows the one under it; colors in a notation other than `rgb()` are passed over the same way.
 */
export function isDark(backgrounds: string[]): boolean | null {
  for (const color of backgrounds) {
    const channels = /^rgba?\(([^)]+)\)$/
      .exec(color.trim())?.[1]
      ?.split(/[\s,/]+/)
      .map(Number);
    if (!channels || channels.length < 3 || channels.some(Number.isNaN)) continue;
    const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
    if (alpha < 0.5) continue;
    // Perceived brightness, 0 to 255.
    return 0.299 * red + 0.587 * green + 0.114 * blue < 128;
  }
  return null;
}

/**
 * Whether the page behind the card is dark. Glass takes on what lies beneath it, and a dark pane over a white
 * page turns the gray of neither: the card follows the page it sits on, not the system's setting. A page that
 * paints no background shows the browser's own, dark only where the page allows it and the system asks.
 */
export function pageIsDark(doc: Document = document): boolean {
  const view = doc.defaultView;
  if (!view) return false;
  const style = (element: Element) => view.getComputedStyle(element);
  const painted = isDark(
    [doc.body, doc.documentElement].flatMap((element) => (element ? [style(element).backgroundColor] : [])),
  );
  if (painted !== null) return painted;
  return (
    /\bdark\b/.test(style(doc.documentElement).colorScheme) &&
    view.matchMedia('(prefers-color-scheme: dark)').matches
  );
}
