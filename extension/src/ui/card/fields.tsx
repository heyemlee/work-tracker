import { Check, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The fields a window of the card is made of: the profile's, and the settings'. Each is a label over its control, in
 * the card's own look.
 */

export const Grid = ({ children }: { children: ReactNode }) => <div className="grid">{children}</div>;
export const Heading = ({ children }: { children: ReactNode }) => (
  <h2 className="sheet-heading">{children}</h2>
);
export const Note = ({ children }: { children: ReactNode }) => <p className="sheet-note">{children}</p>;
export const Toggles = ({ children }: { children: ReactNode }) => <div className="toggles">{children}</div>;

export function Field({
  label,
  wide,
  bare,
  note,
  children,
}: {
  label: string;
  wide?: boolean;
  /** The label is said, not shown: the entry's own title already names the field. */
  bare?: boolean;
  /** Something said of the field at the end of its label's line: that what's in it was saved. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      {note === undefined ? (
        <span className={bare ? 'unseen' : undefined}>{label}</span>
      ) : (
        <span className="field-head">
          {label}
          {note}
        </span>
      )}
      {children}
    </label>
  );
}

export function Text({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'tel' | 'url';
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <Field label={label} wide={wide}>
      <input
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function Area({
  label,
  value,
  onChange,
  wide,
  bare,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
  bare?: boolean;
}) {
  return (
    <Field label={label} wide={wide} bare={bare}>
      <textarea
        className="input area"
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

const words = (text: string) =>
  text
    .split(/[,，、]/)
    .map((word) => word.trim())
    .filter(Boolean);

/** Comma-separated words. What's typed stays as typed; the words it makes go to the profile as it changes. */
export function List({
  label,
  value,
  onChange,
  hint,
  wide,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint: string;
  wide?: boolean;
}) {
  const joined = value.join(', ');
  const [text, setText] = useState(joined);
  // The profile's words changed from outside this field (a save came back, an entry above was removed).
  const [seen, setSeen] = useState(joined);
  if (joined !== seen) {
    setSeen(joined);
    if (words(text).join(', ') !== joined) setText(joined);
  }
  return (
    <Field label={label} wide={wide}>
      <input
        className="input"
        value={text}
        placeholder={hint}
        onChange={(event) => {
          setText(event.target.value);
          const next = words(event.target.value);
          if (next.join(', ') !== joined) onChange(next);
        }}
      />
    </Field>
  );
}

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  note,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  note?: ReactNode;
}) {
  return (
    <Field label={label} note={note}>
      <span className="select">
        <select className="input" value={value} onChange={(event) => onChange(event.target.value as T)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </span>
    </Field>
  );
}

/** A month, or none: YYYY-MM as the profile keeps it. */
export function Month({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <Field label={label}>
      <input
        className="input"
        type="month"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      />
    </Field>
  );
}

/**
 * When a job ended, or that it hasn't. "Present" is a choice of its own, not a date left empty: chosen, it stands
 * where the date would. Asked for a date instead, the month field shows until Present is chosen again.
 */
export function End({
  label,
  present,
  value,
  onChange,
}: {
  label: string;
  present: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  // A date is wanted and none is picked yet (or one is being retyped): the profile still says "current".
  const [dating, setDating] = useState(false);
  const current = value === null && !dating;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dating) input.current?.focus();
  }, [dating]);
  return (
    <div className="field">
      <span className="field-head">
        {label}
        <button
          type="button"
          role="checkbox"
          aria-checked={current}
          className="check"
          onClick={() => {
            setDating(current);
            if (!current) onChange(null);
          }}
        >
          <span className={`mark${current ? ' on' : ''}`}>
            {current && <Check size={9} strokeWidth={3.5} />}
          </span>
          {present}
        </button>
      </span>
      {current ? (
        <button type="button" className="input still" aria-label={label} onClick={() => setDating(true)}>
          {present}
        </button>
      ) : (
        <input
          ref={input}
          className="input"
          type="month"
          aria-label={label}
          value={value ?? ''}
          // Typed a part at a time, a month is empty until it's whole: it mustn't flip to "Present" meanwhile.
          onFocus={() => setDating(true)}
          onChange={(event) => onChange(event.target.value || null)}
        />
      )}
    </div>
  );
}

/**
 * Several of a list, folded behind what's chosen like a closed dropdown. Pressed, the list drops open under it, a
 * mark on each line that's in; it stays open while lines are pressed, and closes when focus leaves it.
 */
export function Several({
  label,
  value,
  options,
  none,
  onChange,
  wide,
}: {
  label: string;
  value: string[];
  options: readonly string[];
  /** What the closed field says with nothing chosen. */
  none: string;
  onChange: (value: string[]) => void;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // What the profile held that the list doesn't offer (typed on Outbox) stays on it, taken out or not.
  const [extra, setExtra] = useState<string[]>([]);
  const unlisted = value.filter((item) => !options.includes(item) && !extra.includes(item));
  if (unlisted.length) setExtra([...extra, ...unlisted]);
  const all = [...options, ...extra];
  const toggle = (item: string) => {
    const chosen = value.includes(item) ? value.filter((other) => other !== item) : [...value, item];
    // In the list's order, whatever order they were pressed in.
    onChange(all.filter((other) => chosen.includes(other)));
  };
  return (
    <div
      className={`field${wide ? ' wide' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        // Escape closes the list; the window it's in stays.
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        className="input pick"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <span className={value.length ? undefined : 'none'}>{value.length ? value.join(', ') : none}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="options" role="listbox" aria-multiselectable="true" aria-label={label}>
          {all.map((item) => {
            const on = value.includes(item);
            return (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={on}
                className="option"
                onClick={() => toggle(item)}
              >
                <span className={`mark${on ? ' on' : ''}`}>{on && <Check size={9} strokeWidth={3.5} />}</span>
                {item}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A number, or none where the profile takes none. */
export function Count({
  label,
  value,
  onChange,
  max,
  placeholder,
  note,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  max: number;
  placeholder?: string;
  note?: ReactNode;
}) {
  return (
    <Field label={label} note={note}>
      <input
        className="input"
        type="number"
        min={0}
        max={max}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      />
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}

/** One of several alike (a school, a job, a story), with a way to take it out. */
export function Entry({
  title,
  remove,
  onRemove,
  children,
}: {
  title: string;
  remove: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="entry">
      <div className="entry-head">
        <span>{title}</span>
        <button type="button" className="ghost" onClick={onRemove}>
          {remove}
        </button>
      </div>
      {children}
    </div>
  );
}

export function Add({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="add" onClick={onClick}>
      <Plus size={14} />
      {children}
    </button>
  );
}
