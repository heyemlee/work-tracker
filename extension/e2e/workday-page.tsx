// A stand-in for two steps of a Workday application, Voluntary Disclosures and Self Identify, as one page. Workday's
// pages can't be run without signing in, but its page code is public: the fields here are drawn and wired after it
// (candidate-experience-apply-flow 2026.40.17, read 2026-10-09), names in brackets being its own. What a fill meets
// is kept as it is there:
//
// - a group of boxes sits in a fieldset of its own inside the one that carries the question, in a list drawn row by
//   row; where a group takes one answer, the other boxes are disabled while one is ticked;
// - a date is three number boxes under readouts. Each change builds on what the field held when it was last drawn,
//   the part that's whole hands the highlight on, and the highlighted part takes the focus;
// - the form gets a date only as the field is left, and takes the disability form's only if it's today's.
//
// At `?step=experience`, My Experience's Resume/CV instead (read 2026-10-14, same version): its input empties as soon
// as it hands a file on, and each file is drawn beside the box with its name, size, state and a button to delete it.
//
// Bundled for the page by workday.spec.ts.
/* eslint-disable react-refresh/only-export-components -- a page of its own: nothing imports it, or refreshes it */
import {
  Component,
  createRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';

type PartName = 'mm' | 'dd' | 'yyyy';
type Parts = Record<PartName, string>;
const ORDER: PartName[] = ['mm', 'dd', 'yyyy'];
const EMPTY: Parts = { mm: '', dd: '', yyyy: '' };

/** A number held within bounds, null where there's none. [wc] */
const within = (value: number, low: number, high: number) =>
  Number.isNaN(value) ? null : value === 0 ? 0 : value < low ? low : value > high ? high : value;

/** What was typed, as a date's parts: two digits of a year are this century's or the last's. [hc] */
function settled(parts: Parts | null): Parts {
  if (!parts) return EMPTY;
  const typed = parseInt(parts.yyyy, 10);
  const now = new Date().getFullYear();
  const year =
    typed >= 0 && typed < 100
      ? typed + (now - (now % 100) - (typed <= (now % 100) + 10 ? 0 : 100))
      : within(typed, 1900, 9999);
  const month = within(parseInt(parts.mm, 10), 1, 12);
  const days = month && year ? new Date(year, month, 0).getDate() : 31;
  const day = within(parseInt(parts.dd, 10), 1, days);
  const text = (value: number | null) => (value || value === 0 ? String(value) : '');
  return { mm: text(month), dd: text(day), yyyy: text(year) };
}

interface PartProps {
  id: string;
  automationId: string;
  label: string;
  low: number;
  high: number;
  placeholder: string;
  value: number | null;
  selected: boolean;
  onChange: (value: number | null, typed: string, direct: boolean) => void;
}

/** One part of a date: a number box, hardly visible, under a readout of what it holds. [oe] */
class Part extends Component<PartProps, { current: number | null }> {
  input = createRef<HTMLInputElement>();
  size = String(this.props.high).length;
  override state = { current: this.props.value };

  typed = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.currentTarget.value;
    const cut = text.length > this.size ? text.substring(0, this.size) : text;
    let value: number | null = parseInt(cut, 10);
    if (Number.isNaN(value)) value = null;
    else if (value > 0 && value < this.props.low) value = this.props.low;
    else if (value > this.props.high) value = this.props.high;
    this.setState({ current: value });
    this.props.onChange(value, this.input.current?.value ?? '', true);
  };

  /** The highlighted part is the one typed into. */
  takeFocus() {
    if (this.props.selected && this.input.current !== document.activeElement) this.input.current?.focus();
  }

  override componentDidMount() {
    this.takeFocus();
  }

  override componentDidUpdate(before: PartProps) {
    this.takeFocus();
    const { value } = this.props;
    const apart = typeof this.state.current === 'number' && typeof value === 'number';
    if (before.value !== value || (apart && this.state.current !== value))
      this.setState({ current: value || value === 0 ? value : null });
  }

  override render() {
    const { id, automationId, label, low, high, placeholder } = this.props;
    const shown =
      this.state.current === null ? placeholder : String(this.state.current).padStart(this.size, '0');
    const value = Number.isNaN(parseInt(shown, 10)) ? '' : String(parseInt(shown, 10));
    return (
      <div id={id} tabIndex={-1} className="part">
        <div aria-hidden="true" id={`${id}-display`} data-automation-id={`${automationId}-display`}>
          {shown}
        </div>
        <input
          role="spinbutton"
          aria-label={label}
          aria-valuemax={high}
          aria-valuemin={low}
          aria-valuenow={value ? Number(value) : undefined}
          aria-valuetext={value || placeholder}
          id={`${id}-input`}
          value={value}
          onChange={this.typed}
          ref={this.input}
          data-automation-id={`${automationId}-input`}
        />
      </div>
    );
  }
}

/** A date's three parts. What's typed stays the field's own until the field is left. [gp] */
function DateInput({ id, value, onBlur }: { id: string; value: Parts; onBlur: (parts: Parts) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ entered: Parts; at: number | null }>({
    entered: settled(value),
    at: null,
  });
  // The form's own value, taken up when it changes: over what the field held when it was last drawn, as there.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ ...state, entered: settled(value) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const select = (index: number | null) => {
    if (index === state.at) return;
    setState((now) => ({ ...now, at: index === null ? null : index > 2 ? 0 : index < 0 ? 2 : index }));
  };
  const numberOf = (part: PartName) => {
    const number = parseInt(state.entered[part], 10);
    return Number.isNaN(number) ? null : number;
  };
  // Built on `state` as this drawing has it, not on the latest: two changes with no drawing between them would
  // lose the first.
  const change = (value: number | null, part: PartName, whole: (value: number) => boolean) => {
    const entered = { ...state.entered, [part]: value !== null ? String(value) : '' };
    const on = state.at !== null && part !== 'yyyy' && value !== null && whole(value);
    setState((now) => ({ ...now, entered }));
    if (on && state.at !== null) select(state.at + 1);
  };
  const leave = () => {
    const entered = settled(state.entered);
    setState({ ...state, entered, at: null });
    onBlur(entered);
  };

  const part = (name: PartName, automationId: string, label: string, high: number, placeholder: string) => (
    <Part
      id={`${id}-${automationId}`}
      automationId={automationId}
      label={label}
      low={1}
      high={high}
      placeholder={placeholder}
      value={numberOf(name)}
      selected={state.at === ORDER.indexOf(name)}
      onChange={(number, typed, direct) =>
        change(number, name, (whole) =>
          name === 'yyyy'
            ? false
            : (whole !== 0 || typed.length === 2) && (10 * whole > high || typed.length === 2) && direct,
        )
      }
    />
  );
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={`hiddenDateValueId-${id}`}
      data-automation-id="dateInputWrapper"
      ref={box}
      onFocus={(event) => {
        if (state.at === null && event.target instanceof HTMLInputElement) select(0);
      }}
      onBlur={(event) => {
        const next = event.nativeEvent.relatedTarget ?? document.activeElement;
        if (!(next instanceof Node && box.current?.contains(next))) leave();
      }}
    >
      <div tabIndex={-1} className="parts">
        {part('mm', 'dateSectionMonth', 'Month', 12, 'MM')}
        <div>/</div>
        {part('dd', 'dateSectionDay', 'Day', 31, 'DD')}
        <div>/</div>
        {part('yyyy', 'dateSectionYear', 'Year', 9999, 'YYYY')}
      </div>
      <div aria-label="Calendar" data-automation-id="dateIcon" role="button" tabIndex={0} />
    </div>
  );
}

type Value = string | { id: string } | { id: string }[] | undefined;
interface Form {
  value: Record<string, Value>;
  setValue: (change: { id: string; value: Value }) => Promise<void>;
  setErrors: (errors: Record<string, string[]>) => void;
}

/** A field's question over its control, in the wrapper that names it. [K9] */
function Field({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div data-automation-id={`formField-${id}`} data-fkit-id={`form--${id}`}>
      {children}
    </div>
  );
}

const Question = ({ id, children }: { id: string; children: string }) => (
  <legend>
    <label id={id}>
      <span>
        {children}
        <abbr aria-hidden="true">*</abbr>
      </span>
    </label>
  </legend>
);

/** A date of the form's: it reaches the form as the field is left, whole and, where asked, today's. [uee] */
function DateField({ id, label, form }: { id: string; label: string; form: Form }) {
  const held = form.value[id];
  const [committed, setCommitted] = useState(typeof held === 'string' ? held : '');
  const value = useMemo(() => {
    const [yyyy = '', mm = '', dd = ''] = committed.split('-');
    return { mm, dd, yyyy };
  }, [committed]);
  const leave = (parts: Parts) => {
    const padded = { mm: parts.mm && parts.mm.padStart(2, '0'), dd: parts.dd && parts.dd.padStart(2, '0') };
    const text = [parts.yyyy, padded.mm, padded.dd].filter(Boolean).join('-');
    if (text === committed) return;
    setCommitted(text);
    const all = [parts.yyyy, padded.mm, padded.dd];
    const broken = (all.some(Boolean) && !all.every(Boolean)) || all.some((one) => one && Number(one) === 0);
    if (broken) {
      void form.setValue({ id, value: undefined }).then(() => form.setErrors({ [id]: ['Invalid date'] }));
      return;
    }
    void form.setValue({ id, value: text }).then(() => {
      const [year = 0, month = 0, day = 0] = text.split('-').map(Number);
      const now = new Date();
      const today = year === now.getFullYear() && month === now.getMonth() + 1 && day === now.getDate();
      form.setErrors({ [id]: text && !today ? ['Enter today’s date.'] : [] });
    });
  };
  return (
    <Field id={id}>
      <fieldset>
        <Question id={`label-${id}`}>{label}</Question>
        <div>
          <div>
            <div aria-hidden="true" id={`helpText-form--${id}`}>
              current value is MM/DD/YYYY
            </div>
            <DateInput id={`form--${id}`} value={value} onBlur={leave} />
          </div>
        </div>
      </fieldset>
    </Field>
  );
}

interface Option {
  id: string;
  label: string;
}

/**
 * A question answered by ticking boxes: all that apply, or one. Each press changes the value as this drawing has
 * it; while a group that takes one answer has one, its other boxes can't be pressed. [lie, sie]
 */
function Boxes({
  id,
  label,
  options,
  several = false,
  form,
}: {
  id: string;
  label: string;
  options: Option[];
  several?: boolean;
  form: Form;
}) {
  const held = form.value[id];
  const picks = Array.isArray(held) ? held : typeof held === 'object' && held.id ? [held] : [];
  const picked = (option: Option) => picks.some((pick) => pick.id === option.id);
  const press = (option: Option, ticked: boolean) =>
    void form.setValue({
      id,
      value: several
        ? ticked
          ? picks.concat({ id: option.id })
          : picks.filter((pick) => pick.id !== option.id)
        : { id: ticked ? option.id : '' },
    });
  return (
    <Field id={id}>
      <fieldset>
        <Question id={`label-${id}`}>{label}</Question>
        <div>
          <div>
            <span data-automation-id={`111955656-rows_${options.length}`}>
              <fieldset data-automation-id={`${id}-CheckboxGroup`} id={`form--${id}`} aria-required="true">
                <div>
                  <div
                    aria-label="grid"
                    aria-readonly="true"
                    className="ReactVirtualized__Grid ReactVirtualized__List"
                    role="grid"
                    tabIndex={0}
                  >
                    <div className="ReactVirtualized__Grid__innerScrollContainer" role="row">
                      {options.map((option) => (
                        <div role="row" key={option.id}>
                          <div role="cell">
                            <div>
                              <div>
                                <input
                                  id={`${option.id}-${id}`}
                                  type="checkbox"
                                  aria-checked={picked(option)}
                                  aria-required="true"
                                  checked={picked(option)}
                                  disabled={!several && picks.length > 0 && !picked(option)}
                                  onChange={(event) => press(option, event.target.checked)}
                                />
                              </div>
                              <label htmlFor={`${option.id}-${id}`}>{option.label}</label>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </fieldset>
            </span>
          </div>
        </div>
      </fieldset>
    </Field>
  );
}

/** A line of text: the form gets it as the field is left. */
function Line({ id, label, form }: { id: string; label: string; form: Form }) {
  const [text, setText] = useState('');
  return (
    <Field id={id}>
      <label htmlFor={`form--${id}`}>
        <span>
          {label}
          <abbr aria-hidden="true">*</abbr>
        </span>
      </label>
      <div>
        <input
          type="text"
          id={`form--${id}`}
          name={id}
          aria-required="true"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => void form.setValue({ id, value: event.target.value })}
        />
      </div>
    </Field>
  );
}

const US = '(United States of America)';
const RACES: Option[] = [
  { id: 'a1', label: `American Indian or Alaska Native (Not Hispanic or Latino) ${US}` },
  { id: 'a2', label: `Asian (Not Hispanic or Latino) ${US}` },
  { id: 'a3', label: `Black or African American (Not Hispanic or Latino) ${US}` },
  { id: 'a4', label: `Hispanic or Latino ${US}` },
  { id: 'a5', label: `Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino) ${US}` },
  { id: 'a6', label: `Two or More Races (Not Hispanic or Latino) ${US}` },
  { id: 'a7', label: `White (Not Hispanic or Latino) ${US}` },
  { id: 'a8', label: `Wish Not To Answer ${US}` },
];
const DISABILITY: Option[] = [
  { id: 'd1', label: 'Yes, I have a disability, or have had one in the past' },
  { id: 'd2', label: 'No, I do not have a disability and have not had one in the past' },
  { id: 'd3', label: 'I do not want to answer' },
];

/** A file the resume's field holds: sent to Workday's server as it's taken, and done once the server has it. */
interface Held {
  key: number;
  name: string;
  size: number;
  done: boolean;
}

/** A file's size, as Workday words it under the file's name. [SZ] */
const sizeOf = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);

/**
 * What a screen reader is told as a file comes in: shown for 5 s, then hidden, and kept in the page all the while.
 * [JJ, QJ]
 */
function Said({ message }: { message: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.display = 'block';
    element.hidden = false;
    const timer = setTimeout(() => {
      element.style.display = 'none';
      element.hidden = true;
    }, 5000);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <div ref={box}>
      <div
        aria-atomic="true"
        aria-live="polite"
        aria-relevant="all"
        role="alert"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
      >
        {message}
      </div>
    </div>
  );
}

/**
 * My Experience's Resume/CV: a box to drop files on, there for as long as more may be taken (five), and each file
 * drawn beside it once taken, with its name, its size, a line for a screen reader, its state and a button to delete
 * it by name. The input is emptied as soon as it has handed its files on. [_Se, jZ, GJ, ISe, wSe, bSe]
 */
function Attachments({ form }: { form: Form }) {
  const [files, setFiles] = useState<Held[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const next = useRef(0);
  const add = (list: FileList) => {
    const added = [...list]
      .slice(0, 5 - files.length)
      .map((file) => ({ key: next.current++, name: file.name, size: file.size, done: false }));
    setFiles((now) => [...now, ...added]);
    for (const file of added)
      setTimeout(
        () => setFiles((now) => now.map((one) => (one.key === file.key ? { ...one, done: true } : one))),
        50,
      );
  };
  useEffect(() => {
    void form.setValue({
      id: 'resumeAttachments',
      value: files.filter((file) => file.done).map((file) => ({ id: file.name })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);
  return (
    <div role="group" aria-labelledby="Resume/CV-section" data-fkit-id="resumeAttachments">
      <h3 id="Resume/CV-section">Resume/CV</h3>
      <div data-automation-id="formField-" data-fkit-id="resumeAttachments--attachments">
        <div>
          <div data-automation-id="attachments-file-upload">
            {files.length < 5 && (
              <div>
                <div
                  data-automation-id="file-upload-drop-zone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    add(event.dataTransfer.files);
                  }}
                  onClick={() => input.current?.click()}
                >
                  <div>Drop files here</div>
                  <div>
                    <div>or</div>
                    <button
                      type="button"
                      data-automation-id="select-files"
                      id="resumeAttachments--attachments"
                      onClick={(event) => {
                        input.current?.click();
                        event.stopPropagation();
                      }}
                    >
                      Select files
                    </button>
                  </div>
                </div>
                <input
                  data-automation-id="file-upload-input-ref"
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  ref={input}
                  onChange={(event) => {
                    if (!event.target.files) return;
                    add(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>
            )}
            <div />
          </div>
          {files.map((file) => (
            <div key={file.key}>
              <div>
                <div aria-hidden="true" className="file-type" />
                <div>
                  <Said message={`${file.name}${file.done ? ' successfully uploaded' : ' loading'}`} />
                  <div data-automation-id="file-upload-item-name">{file.name}</div>
                  <div>{sizeOf(file.size)}</div>
                  {file.done ? (
                    <div data-automation-id="file-upload-successful">Successfully Uploaded!</div>
                  ) : (
                    <div data-automation-id="file-loading-dots" />
                  )}
                </div>
              </div>
              {file.done && (
                <div>
                  <button
                    type="button"
                    data-automation-id="delete-file"
                    aria-label={`Delete ${file.name}`}
                    title="Delete"
                    onClick={() => setFiles((now) => now.filter((one) => one.key !== file.key))}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The step before: My Experience, with the resume's field. What the form holds is shown outside the form. */
function ExperiencePage() {
  const [value, setValues] = useState<Form['value']>({});
  const form: Form = {
    value,
    setValue: (change) => {
      setValues((now) => ({ ...now, [change.id]: change.value }));
      return Promise.resolve();
    },
    setErrors: () => {},
  };
  return (
    <>
      <div data-automation-id="applyFlowPage">
        <h2 data-automation-id="jobTitleHeading">Software Engineer</h2>
        <ol data-automation-id="progressBar">
          <li data-automation-id="progressBarCompletedStep">
            <label>step 1 of 7</label>
            <label>My Information</label>
          </li>
          <li data-automation-id="progressBarActiveStep">
            <label>current step 2 of 7</label>
            <label>My Experience</label>
          </li>
          <li data-automation-id="progressBarInactiveStep">
            <label>step 3 of 7</label>
            <label>Application Questions</label>
          </li>
        </ol>
        <h3 tabIndex={-1}>My Experience</h3>
        <div data-automation-id="applyFlowMyExpPage">
          <Attachments form={form} />
        </div>
        <div data-automation-id="pageFooter">
          <button data-automation-id="pageFooterBackButton">Back</button>
          <button data-automation-id="pageFooterNextButton">Save and Continue</button>
        </div>
      </div>
      <pre id="sent">{JSON.stringify(value)}</pre>
    </>
  );
}

function Page() {
  const [value, setValues] = useState<Form['value']>({});
  const [errors, setAllErrors] = useState<Record<string, string[]>>({});
  const form: Form = {
    value,
    setValue: (change) => {
      setValues((now) => ({ ...now, [change.id]: change.value }));
      return Promise.resolve();
    },
    setErrors: (more) => setAllErrors((now) => ({ ...now, ...more })),
  };
  return (
    <div data-automation-id="applyFlowPage">
      <h2 data-automation-id="jobTitleHeading">Software Engineer</h2>
      <ol data-automation-id="progressBar">
        <li data-automation-id="progressBarActiveStep">
          <label>current step 6 of 7</label>
          <label>Self Identify</label>
        </li>
        <li data-automation-id="progressBarInactiveStep">
          <label>step 7 of 7</label>
          <label>Review</label>
        </li>
      </ol>
      <h3 tabIndex={-1}>Self Identify</h3>
      <div data-automation-id="applyFlowSelfIdentifyPage">
        <div role="group" aria-labelledby="form-section">
          <Boxes
            id="ethnicityMulti"
            label="Please indicate your race / ethnic group (choose all that apply)."
            options={RACES}
            several
            form={form}
          />
          <h3>Voluntary Self-Identification of Disability</h3>
          <Line id="name" label="Name" form={form} />
          <DateField id="dateSignedOn" label="Date" form={form} />
          <Boxes
            id="disabilityStatus"
            label="Please check one of the boxes below:"
            options={DISABILITY}
            form={form}
          />
        </div>
      </div>
      {/* What the form holds, as it would be sent, and what it objects to: for the spec to read. */}
      <pre id="sent">{JSON.stringify(value)}</pre>
      <pre id="errors">{Object.values(errors).flat().join(' ')}</pre>
      <div data-automation-id="pageFooter">
        <button data-automation-id="pageFooterBackButton">Back</button>
        <button data-automation-id="pageFooterNextButton">Save and Continue</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  new URLSearchParams(location.search).get('step') === 'experience' ? <ExperiencePage /> : <Page />,
);
