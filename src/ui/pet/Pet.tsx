import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  PET_BOXES,
  PetSim,
  type PetEllipse,
  type PetFit,
  type PetFrame,
  type PetLook,
  type PetMood,
} from './engine';

export interface PetProps {
  mood?: PetMood;
  /** Width in pixels; the height follows the box. */
  size: number;
  fit?: PetFit;
  /** Where it looks, while something there matters; `null` gives the eyes back to the mood. */
  look?: PetLook | null;
  badge?: boolean;
  /** Counters: each new value is one press, one hop. */
  poke?: number;
  hop?: number;
  /** A shadow on the ground under it, for a pet standing on its own. */
  shadow?: boolean;
  /** Comes into its mood as it shows up (a hop into `happy`), rather than already in it. */
  arrive?: boolean;
  /** Read out by screen readers; without one the pet is decoration. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  seed?: number;
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const ellipse = (e: PetEllipse) => ({ cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, opacity: e.opacity });

const INK: CSSProperties = { fill: 'var(--pet-ink, currentColor)' };
const EYE: CSSProperties = { fill: 'var(--pet-eye, #fff)' };

/**
 * Outbox's pet, alive. Colors come from the page: `--pet-ink` (the body, else the text color), `--pet-eye`,
 * `--pet-gloss` (the highlight's strength, 0 to 1, none unless set), `--pet-badge`, `--pet-shadow`.
 *
 * Frames are drawn straight onto the SVG, not through React; when the pet is only waiting for its next blink it
 * stops drawing until then, so a mark in a toolbar costs nothing between blinks.
 */
export function Pet({
  mood = 'idle',
  size,
  fit = 'icon',
  look = null,
  badge = false,
  poke = 0,
  hop = 0,
  shadow = false,
  arrive = false,
  label,
  className,
  style,
  seed,
}: PetProps) {
  const id = useId();
  const [sim] = useState(
    () =>
      new PetSim({
        // Each pet its own blinks and glances, two on a page never in step.
        seed:
          seed ?? [...id].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261),
        mood: arrive ? 'idle' : mood,
        reduced: reducedMotion(),
        eyeBoost: size <= 24 ? 1.35 : 1,
        breathe: size >= 64,
      }),
  );
  const [first] = useState(() => sim.frame());
  const gloss = `pet-gloss-${id.replace(/[^\w-]/g, '')}`;
  const wake = useRef<() => void>(() => undefined);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const dotLeft = useRef<SVGEllipseElement>(null);
  const dotRight = useRef<SVGEllipseElement>(null);
  const body = useRef<SVGPathElement>(null);
  const glossRef = useRef<SVGEllipseElement>(null);
  const eyeLeft = useRef<SVGPathElement>(null);
  const eyeRight = useRef<SVGPathElement>(null);
  const badgeRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const set = (node: Element | null, values: Record<string, string | number>) => {
      if (node) for (const [name, value] of Object.entries(values)) node.setAttribute(name, String(value));
    };
    const paint = (f: PetFrame) => {
      set(body.current, { d: f.body, opacity: f.bodyOpacity });
      set(eyeLeft.current, { d: f.eyes[0], opacity: f.eyeOpacity });
      set(eyeRight.current, { d: f.eyes[1], opacity: f.eyeOpacity });
      set(dotLeft.current, ellipse(f.dots[0]));
      set(dotRight.current, ellipse(f.dots[1]));
      set(shadowRef.current, ellipse(f.shadow));
      set(glossRef.current, {
        rx: f.gloss.rx,
        ry: f.gloss.ry,
        transform: `translate(${f.gloss.x} ${f.gloss.y}) rotate(${f.gloss.angle})`,
      });
      set(badgeRef.current, f.badge);
    };

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = performance.now();
    // While resting: since when, by the page's clock.
    let restingSince: number | null = null;

    const run = (now: number) => {
      sim.step((now - last) / 1000);
      last = now;
      paint(sim.frame());
      const until = sim.restUntil();
      if (until === null) {
        raf = requestAnimationFrame(run);
        return;
      }
      restingSince = performance.now();
      if (until !== Infinity) timer = setTimeout(() => wake.current(), Math.max(0, (until - sim.t) * 1000));
    };
    wake.current = () => {
      if (restingSince === null) return;
      clearTimeout(timer);
      sim.skip((performance.now() - restingSince) / 1000);
      restingSince = null;
      last = performance.now();
      raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);

    // The setting can change while the page is open.
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const follow = () => {
      sim.setReduced(query?.matches === true);
      wake.current();
    };
    query?.addEventListener?.('change', follow);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      query?.removeEventListener?.('change', follow);
      wake.current = () => undefined;
    };
  }, [sim]);

  useEffect(() => {
    sim.setMood(mood);
    wake.current();
  }, [sim, mood]);

  useEffect(() => {
    sim.look(look);
    wake.current();
  }, [sim, look]);

  useEffect(() => {
    sim.setBadge(badge);
    wake.current();
  }, [sim, badge]);

  // A counter's first value is where it starts, not a press.
  const pokes = useRef(poke);
  useEffect(() => {
    if (poke === pokes.current) return;
    pokes.current = poke;
    sim.poke();
    wake.current();
  }, [sim, poke]);
  const hops = useRef(hop);
  useEffect(() => {
    if (hop === hops.current) return;
    hops.current = hop;
    sim.hop();
    wake.current();
  }, [sim, hop]);

  const box = PET_BOXES[fit];
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      width={size}
      height={Math.round((size * box.height) / box.width)}
      className={className}
      style={{ display: 'block', flexShrink: 0, overflow: 'visible', ...style }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {shadow && (
        <ellipse ref={shadowRef} {...ellipse(first.shadow)} style={{ fill: 'var(--pet-shadow, #000)' }} />
      )}
      <ellipse ref={dotLeft} {...ellipse(first.dots[0])} style={INK} />
      <ellipse ref={dotRight} {...ellipse(first.dots[1])} style={INK} />
      <path ref={body} d={first.body} opacity={first.bodyOpacity} style={INK} />
      {fit !== 'dots' && (
        <>
          <defs>
            <radialGradient id={gloss}>
              <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse
            ref={glossRef}
            rx={first.gloss.rx}
            ry={first.gloss.ry}
            transform={`translate(${first.gloss.x} ${first.gloss.y}) rotate(${first.gloss.angle})`}
            fill={`url(#${gloss})`}
            style={{ opacity: 'var(--pet-gloss, 0)' }}
          />
          <path ref={eyeLeft} d={first.eyes[0]} opacity={first.eyeOpacity} style={EYE} />
          <path ref={eyeRight} d={first.eyes[1]} opacity={first.eyeOpacity} style={EYE} />
          <circle ref={badgeRef} {...first.badge} style={{ fill: 'var(--pet-badge, #3478f6)' }} />
        </>
      )}
    </svg>
  );
}

/** The pet as three hopping dots, sized for a line of text: what loading looks like everywhere. */
export function PetDots({ size = 22, className }: { size?: number; className?: string }) {
  return <Pet mood="think" fit="dots" size={size} className={className} />;
}
