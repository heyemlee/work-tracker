import { cleanLink, companyFromSlug, parsePosting } from '@domain/postings';
import type { Ats, Posting } from '../../model';
import { htmlText, isHidden, textOf } from '../dom';

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const string = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
function jobData(doc: Document): Record<string, unknown> | null {
  const visit = (value: unknown): Record<string, unknown> | null => {
    if (Array.isArray(value)) return value.map(visit).find(Boolean) ?? null;
    const item = record(value);
    if (!item) return null;
    if ([item['@type']].flat().includes('JobPosting')) return item;
    return visit(item['@graph']);
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = visit(JSON.parse(script.textContent ?? ''));
      if (found) return found;
    } catch {
      /* Malformed markup is not executable code. */
    }
  }
  return null;
}
/** Structured job metadata plus explicit page selectors; unrelated page headings are not used as a job title. */
export function postingFrom(
  doc: Document,
  url: string,
  ats: Ats,
  selectors: { title: string; company?: string; location: string; description: string },
): Posting {
  const data = jobData(doc),
    organization = record(data?.hiringOrganization);
  const places = [data?.jobLocation].flat().flatMap((place) => {
    const address = record(record(place)?.address);
    return address
      ? [
          [address.addressLocality, address.addressRegion, address.addressCountry]
            .map(string)
            .filter(Boolean)
            .join(', '),
        ]
      : [];
  });
  const slug = parsePosting(url)?.companySlug;
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  let link = url;
  try {
    const target = canonical ? new URL(canonical, url) : null;
    if (target?.origin === new URL(url).origin) link = target.href;
  } catch {
    /* A malformed canonical must not stop the scan. */
  }
  return {
    ats,
    title: string(data?.title) || textOf(doc.querySelector(selectors.title)) || null,
    company:
      string(organization?.name) ||
      (selectors.company ? textOf(doc.querySelector(selectors.company)) : '') ||
      (slug ? companyFromSlug(slug, []) : null),
    location: places.filter(Boolean).join('; ') || textOf(doc.querySelector(selectors.location)) || null,
    description: (
      htmlText(string(data?.description)) || textOf(doc.querySelector(selectors.description))
    ).slice(0, 8000),
    url: cleanLink(link) ?? url,
  };
}
export function submittedText(doc: Document, selector: string) {
  const root = doc.querySelector(selector);
  return (
    !!root &&
    !isHidden(root) &&
    /thank you for (applying|your application)|application (?:has been |was )?(?:successfully )?(?:submitted|received)|we(?:'ve| have) received your application/i.test(
      textOf(root).slice(0, 4000),
    )
  );
}
/** Inputs and widgets inside open component roots, confined to the requested component. */
export function shadowElements<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  const result: T[] = [...root.querySelectorAll<T>(selector)];
  if (root instanceof Element && root.shadowRoot)
    result.push(...shadowElements<T>(root.shadowRoot, selector));
  for (const element of root.querySelectorAll('*'))
    if (element.shadowRoot) result.push(...shadowElements<T>(element.shadowRoot, selector));
  return result;
}
export function shadowWidget(element: Element): HTMLElement | null {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 12; depth++) {
    if (current.matches('spl-autocomplete, spl-select, spl-multiselect-autocomplete'))
      return current as HTMLElement;
    const root: Node = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return null;
}
export function componentHidden(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (isHidden(current)) return true;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}
export const optionText = (element: Element) =>
  element.getAttribute('label') ||
  textOf(element) ||
  shadowElements(element, '[role="option"], span').map(textOf).filter(Boolean).join(' ');
export function shadowOptions(widget: HTMLElement): HTMLElement[] {
  const hosts = shadowElements(widget, 'spl-select-option, spl-autocomplete-option');
  const options = hosts.length ? hosts : shadowElements(widget, '[role="option"]');
  return options.filter((option) => !isHidden(option) && !!optionText(option));
}
