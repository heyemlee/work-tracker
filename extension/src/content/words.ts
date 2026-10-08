import type { Posting, ScannedField } from '../model';

/**
 * The browser shows the page in another language. Chrome's page translation marks the document for as long as it
 * does, from before it rewords the first text: a reading that holds a translated word was taken with the mark on.
 */
export const isTranslated = (doc: Document): boolean =>
  /(^|\s)translated-(ltr|rtl)(\s|$)/.test(doc.documentElement.className);

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
 * it is first read has only the translation to go by.
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
