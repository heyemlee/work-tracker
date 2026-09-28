import type { Adapter } from './adapters/types';

/**
 * Watches for the owner submitting the form, then for the page saying it went through. The extension never
 * submits; it only notices. A confirmation page loaded fresh (after a redirect) is reported too, and the service
 * worker decides whether it belongs to a form it filled.
 */
export function watchSubmission(
  adapter: Adapter,
  doc: Document,
  onAttempt: () => void,
  onConfirmed: () => void,
): () => void {
  let confirmed = false;
  let watching: ReturnType<typeof setInterval> | null = null;

  const confirm = () => {
    if (confirmed) return;
    confirmed = true;
    onConfirmed();
  };

  const startWatching = () => {
    if (watching) clearInterval(watching);
    const started = Date.now();
    watching = setInterval(() => {
      if (adapter.confirmed(doc, doc.location?.href ?? '')) {
        confirm();
      }
      if (confirmed || Date.now() - started > 120_000) {
        if (watching) clearInterval(watching);
        watching = null;
      }
    }, 600);
  };

  const attempt = () => {
    onAttempt();
    startWatching();
  };

  const onSubmit = () => attempt();
  const onClick = (event: MouseEvent) => {
    const button = adapter.submitButton(doc);
    if (button && event.target instanceof Node && button.contains(event.target)) attempt();
  };

  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('click', onClick, true);

  // Arriving on a confirmation page.
  if (adapter.confirmed(doc, doc.location?.href ?? '')) queueMicrotask(confirm);

  return () => {
    doc.removeEventListener('submit', onSubmit, true);
    doc.removeEventListener('click', onClick, true);
    if (watching) clearInterval(watching);
  };
}
