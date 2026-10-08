import type { Posting, ScannedField } from '../model';

/**
 * The browser shows the page in another language. Chrome's page translation marks the document for as long as it
 * does, from before it rewords the first text: a reading that holds a translated word was taken with the mark on.
 */
export const isTranslated = (doc: Document): boolean =>
  /(^|\s)translated-(ltr|rtl)(\s|$)/.test(doc.documentElement.className);

/**
 * Has the browser's translation leave the application form as the page wrote it, by the mark a page uses for that
 * (`translate="no"`), put on the form in the turn it is drawn in: what a page draws while it is shown translated is
 * reworded a moment later, sooner than the form is read. The rest of the page is translated as the owner asked. A
 * form translated already stays so, and is read as `ownWords` below allows. Returns a function that stops it.
 */
export function leaveUntranslated(doc: Document, form: (doc: Document) => Element | null): () => void {
  const mark = () => {
    const found = form(doc);
    if (found && found.getAttribute('translate') !== 'no') found.setAttribute('translate', 'no');
  };
  mark();
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.addedNodes.length > 0)) mark();
  });
  observer.observe(doc, { childList: true, subtree: true });
  return () => observer.disconnect();
}

const holds = new WeakMap<Document, { count: number; before: string | null }>();

/**
 * Holds the browser's translation off whatever the page draws, for as long as the extension works the page: a list
 * a fill opens is often drawn at the end of the page, outside the form, and a translated page has it reworded within
 * a few hundredths of a second, sooner than it is read. The same mark, on the page's body for that while. Returns a
 * function that lets go; when the last one has, the body is as the page had it.
 */
export function holdTranslation(doc: Document): () => void {
  const body = doc.body as HTMLElement | null;
  if (!body) return () => {};
  let hold = holds.get(doc);
  if (!hold || hold.count === 0) {
    hold = { count: 0, before: body.getAttribute('translate') };
    holds.set(doc, hold);
    body.setAttribute('translate', 'no');
  }
  hold.count++;
  const held = hold;
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    if (--held.count > 0) return;
    if (held.before === null) body.removeAttribute('translate');
    else body.setAttribute('translate', held.before);
  };
}

type Words = Pick<ScannedField, 'label' | 'description' | 'options' | 'section'>;

/** What was read of a page: its fields, its posting, and the step of the form it shows. */
interface Reading {
  fields: ScannedField[];
  posting: Posting | null;
  step: string | null;
}

/**
 * A page's own words for its fields and its posting, kept for as long as the browser shows the page translated.
 * The translation puts "种族" where the page wrote "Race", and the rules read the page's words: a form translated
 * after it was read is planned, filled and remembered in the words it was read in. One that is translated before
 * it is first read has only the translation to go by, which is what `leaveUntranslated` is there to prevent.
 *
 * `keep` puts those words back into a reading, in place; `choices` gives a field's choices in them, in the order
 * its controls stand in.
 */
export function ownWords(doc: Document) {
  const fields = new Map<string, { own: Words; shown: string | null }>();
  let posting: Posting | null = null;
  let place = '';
  return {
    keep(reading: Reading): void {
      const translated = isTranslated(doc);
      // Another step of the form, or another page in the same document, may draw its questions in the controls of
      // the last one: nothing kept of those holds for these.
      const here = `${doc.location?.pathname ?? ''}#${reading.step ?? ''}`;
      if (here !== place) fields.clear();
      place = here;
      for (const field of reading.fields) {
        const { label, description, options, section } = field;
        const known = fields.get(field.id);
        // The same question still: as many choices, and the wording it was first seen translated into. A control
        // that comes to read otherwise again holds another question, which is taken as it reads.
        const same =
          translated &&
          known !== undefined &&
          known.own.options.length === options.length &&
          (label === known.own.label || (known.shown ??= label) === label);
        if (same) Object.assign(field, known.own);
        else fields.set(field.id, { own: { label, description, options, section }, shown: null });
      }
      // The posting is the same one for as long as its address is. What the page hadn't said of it yet when it
      // was read in its own words (Gem names the company a moment after the form) is taken as it reads now.
      const now = reading.posting;
      if (translated && posting && now?.url === posting.url)
        reading.posting = {
          ...now,
          title: posting.title ?? now.title,
          company: posting.company ?? now.company,
          location: posting.location ?? now.location,
          description: posting.description || now.description,
        };
      posting = reading.posting;
    },
    choices: (fieldId: string): readonly string[] | undefined => fields.get(fieldId)?.own.options,
  };
}
