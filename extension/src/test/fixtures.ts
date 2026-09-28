import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A saved application page, parsed into its own document at the page's own address. */
export function loadFixture(path: string, url: string): Document {
  const html = readFileSync(resolve(__dirname, '../../test/fixtures', path), 'utf8');
  const doc = document.implementation.createHTMLDocument('');
  // Scripts and stylesheets would only try to load; the markup is what's under test. The inline scripts kept are
  // the posting data Greenhouse and Ashby embed, which the adapters read as text; they're marked inert.
  const markup = html
    .replace(/^[\s\S]*?<html[^>]*>/i, '')
    .replace(/<\/html>[\s\S]*$/i, '')
    .replace(
      /<script\b[^>]*>(\s*window\.__(?:remixContext|appData)\b[\s\S]*?)<\/script>/gi,
      '<script type="text/plain">$1</script>',
    )
    .replace(/<script(?! type="text\/plain")[\s\S]*?<\/script>/gi, '')
    .replace(/<link[^>]*>/gi, '');
  doc.documentElement.innerHTML = markup;
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) doc.title = title.replace(/&amp;/g, '&');
  Object.defineProperty(doc, 'URL', { value: url });
  return doc;
}
