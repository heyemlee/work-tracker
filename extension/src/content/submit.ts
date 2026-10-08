import type { Adapter } from './adapters/types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The emails a form's fields hold, read from the page as it stands: the account applying is the one whose email the
 * form is sent with, whoever put it there.
 */
export function emailsIn(root: ParentNode): string[] {
  const held = [...root.querySelectorAll('input')]
    .filter((input) => input.type === 'email' || input.type === 'text')
    .map((input) => input.value.trim())
    .filter((value) => EMAIL.test(value));
  return [...new Set(held)];
}

/**
 * Watches for the owner submitting the form, then for the page saying it went through. The extension never
 * submits; it only notices, whoever filled the form in. An attempt is the application's own form being sent, by its
 * Submit button or as a form, and is told with the emails the form holds as it's sent. A confirmation page loaded
 * fresh (after a redirect) is reported too, and the service worker decides whether it belongs to a form the owner
 * sent.
 */
export function watchSubmission(
  adapter: Adapter,
  doc: Document,
  onAttempt: (emails: string[]) => void,
  onConfirmed: () => void,
): () => void {
  let confirmed = false;
  let watching: ReturnType<typeof setInterval> | null = null;

  const says = () => adapter.confirmed(doc, doc.location?.href ?? '');

  const confirm = () => {
    if (confirmed) return;
    confirmed = true;
    onConfirmed();
  };

  const startWatching = () => {
    if (watching) clearInterval(watching);
    const started = Date.now();
    watching = setInterval(() => {
      if (says()) confirm();
      if (confirmed || Date.now() - started > 120_000) {
        if (watching) clearInterval(watching);
        watching = null;
      }
    }, 600);
  };

  const attempt = () => {
    // A board that moves between postings without loading a page sends its next application from this same
    // document: by then the last one's confirmation has left the page, and this one is told of in its turn.
    if (confirmed && !says()) confirmed = false;
    onAttempt(emailsIn(adapter.form(doc) ?? doc));
    startWatching();
  };

  // Another form sent from the page, a search box or a sign-up, isn't the application. The page is watched for what
  // it says next all the same, as it is after any form.
  const onSubmit = (event: Event) => {
    const form = adapter.form(doc);
    const { target } = event;
    if (form && target instanceof Node && (form.contains(target) || target.contains(form))) attempt();
    else startWatching();
  };
  const onClick = (event: MouseEvent) => {
    const { target } = event;
    if (!(target instanceof Node)) return;
    const buttons = [adapter.submitButton(doc)].flat();
    if (buttons.some((button) => button?.contains(target))) attempt();
  };

  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('click', onClick, true);

  // Arriving on a confirmation page.
  if (says()) queueMicrotask(confirm);

  return () => {
    doc.removeEventListener('submit', onSubmit, true);
    doc.removeEventListener('click', onClick, true);
    if (watching) clearInterval(watching);
  };
}
