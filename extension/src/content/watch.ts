/**
 * Calls `found` once the frame shows an application form: at once if it's there, otherwise when the page draws it —
 * Workday renders its fields well after the page loads, and career sites open their form in place. Once per place
 * (`where`: the address, and Workday's step), so a card the owner closed stays closed until the page moves on.
 * Returns a function that stops watching.
 */
export function watchForForm(
  doc: Document,
  where: () => string,
  hasForm: () => boolean,
  found: () => void,
  delay = 400,
): () => void {
  let announced: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    timer = undefined;
    const place = where();
    if (place === announced || !hasForm()) return;
    announced = place;
    found();
  };
  // Fields added, or a hidden form shown. Checked a moment after the page changes, not on every change.
  const observer = new MutationObserver(() => {
    timer ??= setTimeout(check, delay);
  });
  // The document, not its root element: a page may throw that away and build another (ui/card/shadow.tsx).
  observer.observe(doc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'],
  });
  check();
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
