import clsx from 'clsx';
import { motion } from 'motion/react';
import { useRef, type KeyboardEvent } from 'react';

export interface Segment<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Unique per mounted control, so the selection thumb animates within its own track. */
  layoutId: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** An Apple-style segmented control: a recessed track with a sliding thumb. Arrow keys move the selection. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  layoutId,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + segments.length) % segments.length;
    const segment = segments[next];
    if (!segment) return;
    onChange(segment.value);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx('inline-flex rounded-full bg-fill p-[3px]', className)}
    >
      {segments.map((segment, index) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(segment.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={clsx(
              'relative flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-8 px-3.5 text-[13px]',
              active ? 'text-fg' : 'text-fg-2 hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                aria-hidden="true"
                className="absolute inset-0 rounded-full"
                style={{ background: 'var(--thumb)', boxShadow: 'var(--thumb-shadow)' }}
                transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
              />
            )}
            <span className="relative">{segment.label}</span>
            {segment.count !== undefined && (
              <span className="relative text-fg-3 tabular-nums">{segment.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
