import type { Ats, Entry, FieldKind, Hint, Posting } from '../../model';

/** How to reach a field's controls when filling it. */
export type Handle =
  | { type: 'input'; element: HTMLInputElement | HTMLTextAreaElement }
  | { type: 'select'; element: HTMLSelectElement }
  /** react-select, Workday's dropdown button: opened, then an option clicked. */
  | { type: 'combobox'; element: HTMLElement }
  | { type: 'typeahead'; element: HTMLInputElement }
  | { type: 'radio'; inputs: HTMLInputElement[] }
  | { type: 'checkbox'; element: HTMLInputElement }
  | { type: 'multi'; inputs: HTMLInputElement[] }
  /** Choices drawn as buttons, like Ashby's Yes/No. */
  | { type: 'buttons'; buttons: HTMLElement[] }
  | { type: 'file'; element: HTMLInputElement }
  /** A date typed into separate month, day and year boxes (Workday). */
  | {
      type: 'dateParts';
      month: HTMLInputElement | null;
      day: HTMLInputElement | null;
      year: HTMLInputElement;
    }
  /** A search box whose suggestions become chips (Workday's "How did you hear about us?", fields of study). */
  | { type: 'prompt'; element: HTMLInputElement };

/** A field an adapter finds itself, where generic extraction can't see it. */
export interface CustomField {
  label: string;
  description?: string;
  kind: FieldKind;
  options: string[];
  required: boolean;
  hint?: Hint | null;
  entry?: Entry | null;
  handle: Handle;
  /** The element to scroll to when the owner clicks the field in the checklist. */
  anchor: Element;
  filled?: boolean;
}

export interface Adapter {
  ats: Ats;
  /** The element holding the application form, or null when the page shows only the posting. */
  form(doc: Document): Element | null;
  posting(doc: Document, url: string): Posting | null;
  /** What a control means when the page names it outright. */
  hint?(control: Element): Hint | null;
  /** The repeatable entry a control belongs to, like Workday's "Work Experience 2". */
  entry?(control: Element): Entry | null;
  /** Overrides the kind generic extraction would give a control. */
  kind?(control: Element): FieldKind | null;
  /** Controls generic extraction must leave alone. */
  skip?(control: Element): boolean;
  /** Fields drawn with custom widgets. Controls they cover are skipped by generic extraction. */
  custom?(form: Element): CustomField[];
  submitButton(doc: Document): HTMLElement | null;
  /** The page shows that an application went through. */
  confirmed(doc: Document, url: string): boolean;
  /** Workday's step name ("My Information"). */
  step?(doc: Document): string | null;
  /**
   * Gets the form ready before it's read: Workday shows no work-experience or education entries until "Add" is
   * pressed once per entry. Resolves true when it changed the page.
   */
  prepare?(form: Element, counts: { experience: number; education: number }): Promise<boolean>;
}
