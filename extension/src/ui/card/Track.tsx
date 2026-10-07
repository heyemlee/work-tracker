import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A list's highlight: where it is, whether it shows, and whether it got there by sliding. */
interface Lens {
  box: Box;
  on: boolean;
  sliding: boolean;
}

/**
 * A list whose highlight sits on the current item, slides to the next one and takes its size: the account applying,
 * the field last jumped to. Items are direct children carrying `data-key`.
 */
export function Track({
  current,
  className,
  children,
  ...rest
}: {
  current: string | null;
  className: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const track = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState<Lens | null>(null);

  const measure = useCallback(() => {
    const item = [...(track.current?.children ?? [])].find(
      (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.key === current,
    );
    setLens((before) => {
      // Nothing to be on: it fades where it was.
      if (!item) return before?.on ? { ...before, on: false, sliding: false } : before;
      const box = {
        x: item.offsetLeft,
        y: item.offsetTop,
        width: item.offsetWidth,
        height: item.offsetHeight,
      };
      const moved =
        before?.box.x !== box.x ||
        before.box.y !== box.y ||
        before.box.width !== box.width ||
        before.box.height !== box.height;
      if (before?.on && !moved) return before;
      // It lands on its first item at once, and slides from then on.
      return { box, on: true, sliding: before?.on ?? false };
    });
  }, [current]);

  // Any render may have moved the items: a draft arrived, a line wrapped.
  useLayoutEffect(measure);
  useEffect(() => {
    if (!track.current) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(track.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div ref={track} className={`track ${className}`} {...rest}>
      <span
        className={`lens${lens?.on ? ' on' : ''}${lens?.sliding ? ' sliding' : ''}`}
        style={
          lens
            ? {
                transform: `translate(${lens.box.x}px, ${lens.box.y}px)`,
                width: lens.box.width,
                height: lens.box.height,
              }
            : undefined
        }
        aria-hidden="true"
      />
      {children}
    </div>
  );
}
