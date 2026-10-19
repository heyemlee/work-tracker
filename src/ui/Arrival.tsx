import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { setFlying } from './pet/arrival';
import { PET_BOXES, PET_MIDDLE_Y } from './pet/engine';
import { Pet } from './pet/Pet';

/** How long Outbox may take to open before the pet comes to wait with the owner: a quick start shows nothing. */
const PATIENCE_MS = 300;
/** The dots running back into the pet, once everything is there. */
const MERGE_MS = 380;
const FLIGHT_MS = 640;
const SIZE = 96;
const BOX = PET_BOXES.stage;
// The middle of the body, from the drawing's top left corner: what the flight moves and scales about.
const MIDDLE_X = (-BOX.x / BOX.width) * SIZE;
const MIDDLE_Y = ((PET_MIDDLE_Y - BOX.y) / BOX.height) * SIZE;

type Flight = { x: number; y: number; scale: number } | 'fade';

/**
 * While Outbox opens: the pet as three hopping dots in the middle of the page. When everything is there, the dots
 * run back into the pet, which hops into its place in the toolbar (Brand) as the page shows through; the toolbar's
 * own pet takes over as it lands. A start quicker than `PATIENCE_MS` shows none of it.
 */
export function Arrival({ ready }: { ready: boolean }) {
  const [shown, setShown] = useState(false);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (ready) return undefined;
    const timer = setTimeout(() => setShown(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (!ready || !shown) return undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        const mark = document.querySelector('[data-brand-pet] svg')?.getBoundingClientRect();
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (!mark || mark.width === 0 || reduced) setFlight('fade');
        else {
          // The toolbar's pet is drawn in the `icon` box: where its body's middle is on the page.
          const icon = PET_BOXES.icon;
          const unit = mark.width / icon.width;
          setFlying(true);
          setFlight({
            x: mark.left + -icon.x * unit - window.innerWidth / 2,
            y: mark.top + (PET_MIDDLE_Y - icon.y) * unit - window.innerHeight / 2,
            scale: unit / (SIZE / BOX.width),
          });
        }
        timers.push(
          setTimeout(() => {
            setGone(true);
            setFlying(false);
          }, FLIGHT_MS),
        );
      }, MERGE_MS),
    );
    return () => {
      timers.forEach(clearTimeout);
      setFlying(false);
    };
  }, [ready, shown]);

  if (!shown || gone) return null;
  const flying = flight !== null && flight !== 'fade';
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40">
      {/* The page shows through as the pet takes off, not before: the dots run together on the blank page. */}
      <div
        className={clsx(
          'absolute inset-0 bg-canvas transition-opacity duration-300',
          flight === null ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        className="absolute"
        style={{
          left: `calc(50% - ${MIDDLE_X}px)`,
          top: `calc(50% - ${MIDDLE_Y}px)`,
          transformOrigin: `${MIDDLE_X}px ${MIDDLE_Y}px`,
          transform: flying ? `translate(${flight.x}px, ${flight.y}px) scale(${flight.scale})` : undefined,
          // A spring's overshoot: it lands a little past its place and settles back.
          transition: `transform ${FLIGHT_MS}ms cubic-bezier(0.34, 1.3, 0.5, 1), opacity 200ms ease-out`,
          opacity: flight === 'fade' ? 0 : 1,
        }}
      >
        <Pet size={SIZE} fit="stage" mood={ready ? 'idle' : 'think'} hop={flying ? 1 : 0} />
      </div>
    </div>
  );
}
