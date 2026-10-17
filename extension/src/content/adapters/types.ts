import type { Ats, Entry, FieldKind, Hint, Posting } from '../../model';

/** How to reach a field's controls when filling it. */
export type Handle =
  | { type: 'input'; element: HTMLInputElement | HTMLTextAreaElement; dateFormat?: 'month-name-year' }
  | { type: 'select'; element: HTMLSelectElement }
  /** react-select, Workday's dropdown button: opened, then an option clicked. */
  | { type: 'combobox'; element: HTMLElement; shown?: () => string | null }
  | { type: 'typeahead'; element: HTMLInputElement }
  | { type: 'radio'; inputs: HTMLInputElement[]; labels?: string[] }
  | { type: 'checkbox'; element: HTMLInputElement }
  | { type: 'multi'; inputs: HTMLInputElement[] }
  /** Choices drawn as buttons, like Ashby's Yes/No. */
  | { type: 'buttons'; buttons: HTMLElement[] }
  | {
      type: 'file';
      element: HTMLInputElement;
      /**
       * The name of the file the page shows it holds, null when it shows none. Given where the page and not the
       * input says what the upload holds, as on Gem; without it the input is read (`attachedFile`).
       */
      shown?: () => string | null;
    }
  /** A date typed into separate month, day and year boxes (Workday). */
  | {
      type: 'dateParts';
      month: HTMLInputElement | null;
      day: HTMLInputElement | null;
      year: HTMLInputElement;
    }
  /** A search box whose suggestions become chips (Workday's "How did you hear about us?", fields of study). */
  | { type: 'prompt'; element: HTMLInputElement; multiple?: boolean; shown?: () => string[] };

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
  /** The button that sends the application, or the buttons where the page has more than one way to send it. */
  submitButton(doc: Document): HTMLElement | HTMLElement[] | null;
  /** The page shows that an application went through. */
  confirmed(doc: Document, url: string): boolean;
  /** Emails held in an application whose controls live inside component roots. */
  emails?(doc: Document): string[];
  /** Waits after a field is filled until the page has taken the answer in, before the next field is touched. */
  settle?(): Promise<void>;
  /**
   * Waits, once the resume is attached, for what the page does with it, before the next field is touched: Lever
   * and Ashby read the file and fill fields of their own, which are then kept. Without it the fill goes on after
   * a moment.
   */
  resumeRead?(doc: Document): Promise<void>;
  /** Workday's step name ("My Information"). */
  step?(doc: Document): string | null;
  /**
   * The page is an application under way, whatever it shows of it just now: a step of Workday's whose fields are
   * still on their way, its review of the whole before it's sent. Without this, a page is an application's only
   * where a form with fields is found on it.
   */
  applying?(doc: Document, url: string): boolean;
  /**
   * Resolves true if the posting came to be told more fully after the form was drawn: Gem writes the company's own
   * name into the page a moment later. The card then reads the page again.
   */
  postingLate?(doc: Document): Promise<boolean>;
  /**
   * Gets the form ready before it's read: Workday shows no work-experience or education entries until "Add" is
   * pressed once per entry. Resolves true when it changed the page.
   */
  prepare?(form: Element, counts: { experience: number; education: number }): Promise<boolean>;
  /**
   * Takes out of a copy of the form, made for a fill report, the answers the page keeps in markup of its own, where
   * emptying the inputs doesn't reach: on Gem a dropdown is a bare button that reads its pick.
   */
  blank?(form: Element): void;
  /**
   * Off the hiring systems' own hosts, where any page may be about anything: whether this one gives itself out as
   * a job, by its address or its own markup.
   */
  jobLike?(doc: Document, url: string): boolean;
  /** A form on the page that wasn't taken for an application, and that the owner can say is one (`asApplication`). */
  otherForm?(doc: Document): boolean;
  /** The owner says the page is an application: its form is read as one for as long as the page keeps its address. */
  asApplication?(doc: Document): void;
}
