/**
 * Outbox's pet: a jelly mochi drawn as SVG paths, with no library. The site, the extension's card and the toolbar
 * button's picture all draw from these frames.
 *
 * Two ideas come from bloub (github.com/jeremy-prt/bloub, MIT): an outline kept as radii at fixed angles, so two
 * shapes morph by interpolating radii; and a blink that hides a change of eye shape. The jelly itself (a squash
 * anchored at the seat, a sway, a ripple, hops) is springs, which bloub deliberately doesn't have.
 *
 * Units: 1 is about half the pet's width; frames are drawn at 60 to the unit, the body's middle at the origin.
 */

export type PetMood =
  /** Blinks and glances now and then. */
  | 'idle'
  /** Three dots taking turns to hop: loading, or the extension at work. */
  | 'think'
  /** Eyes going along lines: a page being read. */
  | 'read'
  /** Eyes on the form to its left, nodding: a form being filled. */
  | 'work'
  /** Eyes ∩ ∩ and a hop. */
  | 'happy'
  /** Eyes > < and a shake; then a look down. */
  | 'oops'
  /** Eyes to the left, for the tab at the window's right edge. */
  | 'peek';

export type PetLook = 'left' | 'right' | 'up' | 'down' | 'downLeft' | 'downRight';

export interface PetOptions {
  seed?: number;
  /** Only blinks: no hops, shakes, ripples or bouncing dots (the system's "reduce motion"). */
  reduced?: boolean;
  /** Bigger eyes, for a pet a few pixels tall. */
  eyeBoost?: number;
  /** A slow breath at rest; small pets go without, so they can rest between blinks. */
  breathe?: boolean;
  mood?: PetMood;
}

export interface PetEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  opacity: number;
}

export interface PetFrame {
  body: string;
  /** Under reduced motion the loading dots pulse instead of hopping, the middle one being the body. */
  bodyOpacity: number;
  eyes: [string, string];
  eyeOpacity: number;
  /** A soft highlight up on the left, as a jelly catches the light: centre, radii, rotation in degrees. */
  gloss: { x: number; y: number; rx: number; ry: number; angle: number };
  /** On the ground under the pet, smaller in the air. */
  shadow: PetEllipse;
  /** The loading dots either side of the body. */
  dots: [PetEllipse, PetEllipse];
  badge: { cx: number; cy: number; r: number };
}

const TAU = Math.PI * 2;
const SCALE = 60;
const N = 56;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = (t: number) => clamp(t, 0, 1) ** 2;
const round = (v: number) => Math.round(v * 100) / 100;

function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spring {
  x: number;
  v: number;
  /** What it was last pulled towards. */
  to: number;
}

const spring = (x = 0): Spring => ({ x, v: 0, to: x });

function pull(s: Spring, to: number, k: number, c: number, dt: number) {
  s.to = to;
  s.v += (-k * (s.x - to) - c * s.v) * dt;
  s.x += s.v * dt;
}

const still = (s: Spring) => Math.abs(s.x - s.to) < 2e-3 && Math.abs(s.v) < 2e-2;

const SEAT = 0.84;
const DOME = 0.97;
const DOT = 0.3;

/** How far below the origin the middle of the body at rest is (it is lower than wide: the seat is flatter). */
export const PET_MIDDLE_Y = round(((SEAT - DOME) / 2) * SCALE);

/**
 * The outline's spokes. At rest it is a mochi: a round dome over a wider, flatter seat (superellipses whose
 * half-axes and exponent change from top to bottom). `free` is how far a ripple may move it: not along the seat, so
 * the pet stays sitting.
 */
const SPOKES = Array.from({ length: N }, (_, i) => {
  const angle = (i / N) * TAU;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle); // positive is down
  const down = smooth(-0.45, 0.45, sin);
  const a = lerp(0.98, 1.07, down);
  const b = lerp(DOME, SEAT, down);
  const n = lerp(2.2, 3.3, down);
  const mochi = Math.pow(Math.abs(cos / a) ** n + Math.abs(sin / b) ** n, -1 / n);
  return { angle, cos, sin, mochi, free: 1 - 0.85 * smooth(0.55, 0.95, sin) };
});

/** An eye as a pill (width × height), or as a stroke along a quadratic curve (`a` to `b`, bent by `c`). */
interface PillEye {
  w: number;
  h: number;
}
interface CurveEye {
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  bx: number;
  by: number;
  /** stroke width */
  sw: number;
}
type Face =
  { kind: 'pill'; left: PillEye; right: PillEye } | { kind: 'curve'; left: CurveEye; right: CurveEye };
type FaceName = 'open' | 'focus' | 'happy' | 'shut';

const SHUT_PILL = 0.04;
const SHUT_LINE: CurveEye = { ax: -0.09, ay: 0, cx: 0, cy: 0, bx: 0.09, by: 0, sw: 0.04 };
const EYE_X = 0.28;
const EYE_Y = -0.11;

function face(name: FaceName): Face {
  switch (name) {
    case 'open':
      return { kind: 'pill', left: { w: 0.18, h: 0.32 }, right: { w: 0.18, h: 0.32 } };
    case 'focus':
      return { kind: 'pill', left: { w: 0.17, h: 0.22 }, right: { w: 0.17, h: 0.22 } };
    case 'happy': {
      const eye = { ax: -0.1, ay: 0.05, cx: 0, cy: -0.13, bx: 0.1, by: 0.05, sw: 0.075 };
      return { kind: 'curve', left: eye, right: { ...eye } };
    }
    case 'shut':
      return {
        kind: 'curve',
        left: { ax: -0.07, ay: -0.075, cx: 0.11, cy: 0, bx: -0.07, by: 0.075, sw: 0.07 },
        right: { ax: 0.07, ay: -0.075, cx: -0.11, cy: 0, bx: 0.07, by: 0.075, sw: 0.07 },
      };
  }
}

function mixPill(a: PillEye, b: PillEye, t: number): PillEye {
  return { w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

function mixCurve(a: CurveEye, b: CurveEye, t: number): CurveEye {
  return {
    ax: lerp(a.ax, b.ax, t),
    ay: lerp(a.ay, b.ay, t),
    cx: lerp(a.cx, b.cx, t),
    cy: lerp(a.cy, b.cy, t),
    bx: lerp(a.bx, b.bx, t),
    by: lerp(a.by, b.by, t),
    sw: lerp(a.sw, b.sw, t),
  };
}

/** From `a` to `b`, two faces of one kind. */
function mixFace(a: Face, b: Face, t: number): Face {
  if (a.kind === 'pill' && b.kind === 'pill')
    return { kind: 'pill', left: mixPill(a.left, b.left, t), right: mixPill(a.right, b.right, t) };
  if (a.kind === 'curve' && b.kind === 'curve')
    return { kind: 'curve', left: mixCurve(a.left, b.left, t), right: mixCurve(a.right, b.right, t) };
  return b;
}

/** The same face with its eyes closed: a line the other kind can open from. */
function shut(f: Face): Face {
  return f.kind === 'pill'
    ? { kind: 'pill', left: { w: f.left.w, h: SHUT_PILL }, right: { w: f.right.w, h: SHUT_PILL } }
    : { kind: 'curve', left: SHUT_LINE, right: SHUT_LINE };
}

interface MoodSpec {
  face: FaceName;
  /** Blinks, and glances about unless `gaze` says where to look. */
  life?: boolean;
  gaze?: 'left' | 'up' | 'down' | 'scan' | 'form';
  dots?: boolean;
  /** A small squash every half second: busy. */
  bob?: boolean;
  /** The face it settles on after a second. */
  after?: FaceName;
}

const MOODS: Record<PetMood, MoodSpec> = {
  idle: { face: 'open', life: true },
  think: { face: 'open', dots: true },
  read: { face: 'focus', gaze: 'scan', life: true },
  work: { face: 'focus', gaze: 'form', bob: true, life: true },
  happy: { face: 'happy', gaze: 'up' },
  oops: { face: 'shut', gaze: 'down', after: 'focus' },
  peek: { face: 'open', gaze: 'left', life: true },
};
const AFTER = 1.1;

const LOOKS: Record<PetLook, [number, number]> = {
  left: [-0.8, 0.02],
  right: [0.8, 0.02],
  up: [0, -0.7],
  down: [0, 0.75],
  downLeft: [-0.6, 0.6],
  downRight: [0.6, 0.6],
};

function pillPoints(cx: number, cy: number, w: number, h: number, out: [number, number][]) {
  const segments = 9;
  const vertical = h >= w;
  const r = (vertical ? w : h) / 2;
  const half = Math.abs(h - w) / 2;
  for (let k = 0; k <= segments; k++) {
    const a = (vertical ? Math.PI : -Math.PI / 2) + (k / segments) * Math.PI;
    out.push(
      vertical
        ? [cx + r * Math.cos(a), cy - half + r * Math.sin(a)]
        : [cx + half + r * Math.cos(a), cy + r * Math.sin(a)],
    );
  }
  for (let k = 0; k <= segments; k++) {
    const a = (vertical ? 0 : Math.PI / 2) + (k / segments) * Math.PI;
    out.push(
      vertical
        ? [cx + r * Math.cos(a), cy + half + r * Math.sin(a)]
        : [cx - half + r * Math.cos(a), cy + r * Math.sin(a)],
    );
  }
}

/** The outline of a round-capped stroke along the curve. */
function curvePoints(ox: number, oy: number, e: CurveEye, out: [number, number][]) {
  const steps = 12;
  const half = e.sw / 2;
  const along: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    let tx = 2 * u * (e.cx - e.ax) + 2 * t * (e.bx - e.cx);
    let ty = 2 * u * (e.cy - e.ay) + 2 * t * (e.by - e.cy);
    const length = Math.hypot(tx, ty);
    if (length < 1e-6) [tx, ty] = [1, 0];
    else [tx, ty] = [tx / length, ty / length];
    along.push({
      x: ox + u * u * e.ax + 2 * u * t * e.cx + t * t * e.bx,
      y: oy + u * u * e.ay + 2 * u * t * e.cy + t * t * e.by,
      nx: -ty,
      ny: tx,
    });
  }
  const cap = (p: { x: number; y: number }, from: number) => {
    for (let s = 1; s < 8; s++) {
      const a = from - (s / 8) * Math.PI;
      out.push([p.x + Math.cos(a) * half, p.y + Math.sin(a) * half]);
    }
  };
  for (const p of along) out.push([p.x + p.nx * half, p.y + p.ny * half]);
  const end = along[steps]!;
  cap(end, Math.atan2(end.ny, end.nx));
  for (const p of [...along].reverse()) out.push([p.x - p.nx * half, p.y - p.ny * half]);
  const start = along[0]!;
  cap(start, Math.atan2(-start.ny, -start.nx));
}

/** A closed curve through the points (Catmull-Rom as cubic Béziers). */
function smoothPath(points: [number, number][]): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n]!;
  let d = `M${round(at(0)[0])} ${round(at(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d +=
      `C${round(p1[0] + (p2[0] - p0[0]) / 6)} ${round(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${round(p2[0] - (p3[0] - p1[0]) / 6)} ${round(p2[1] - (p3[1] - p1[1]) / 6)} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${d}Z`;
}

function polygonPath(points: [number, number][]): string {
  return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join('')}Z`;
}

export class PetSim {
  /** Seconds simulated so far. */
  t = 0;
  mood: PetMood = 'idle';
  private moodT = 0;
  private readonly rand: () => number;
  private reduced: boolean;
  private readonly eyeBoost: number;
  private readonly breathe: boolean;

  private readonly form = spring();
  private readonly side = spring();
  private readonly eyeSize = spring(1);
  private readonly gazeX = spring();
  private readonly gazeY = spring();
  private readonly squash = spring();
  private readonly lean = spring();
  private readonly shake = spring();
  private readonly ripple = spring();
  private readonly badgeSize = spring();
  private badgeOn = false;

  private hopY = 0;
  private hopV = 0;
  private hopWait = 0;
  private hopPower = 0;
  private airborne = false;
  private bobIn = 0;
  private blinkT = -1;
  private blinkAt: number;
  private glanceAt = 0.6;
  private glance: [number, number] = [0, 0];
  private lookDir: [number, number] = [0, 0];
  private lookUntil = -1;
  private settled = false;
  private face: Face = face('open');
  private tween: { from: Face; to: Face; t: number; swap: boolean } | null = null;

  // The body's current squash, lean and place, for the drawing of what rides on it.
  private sx = 1;
  private sy = 1;
  private base = SEAT;
  private offX = 0;
  private offY = 0;

  constructor(options: PetOptions = {}) {
    this.rand = random(options.seed ?? 7);
    this.reduced = options.reduced ?? false;
    this.eyeBoost = options.eyeBoost ?? 1;
    this.breathe = options.breathe ?? true;
    this.blinkAt = 0.9 + this.rand() * 1.5;
    if (options.mood && options.mood !== 'idle') this.setMood(options.mood, true);
  }

  // ------------------------------------------------------------------ commands

  /** `instant`: in place at once, as when the pet first shows up already loading. */
  setMood(mood: PetMood, instant = false): void {
    if (mood === this.mood) return;
    const was = this.mood;
    this.mood = mood;
    this.moodT = 0;
    this.settled = false;
    const spec = MOODS[mood];
    this.setFace(face(spec.face), instant);
    if (instant) {
      const dots = spec.dots ? 1 : 0;
      for (const s of [this.form, this.side]) Object.assign(s, { x: dots, v: 0, to: dots });
      Object.assign(this.eyeSize, { x: 1 - dots, v: 0, to: 1 - dots });
      return;
    }
    if (this.reduced) return;
    if (was === 'think') {
      this.squash.v += 3.2;
      this.ripple.v += 1.4;
    }
    if (mood === 'think') this.squash.v -= 2.2;
    if (mood === 'happy') this.hop();
    if (mood === 'oops') {
      this.shake.v = 2.7;
      this.squash.v += 2;
    }
  }

  /** A press: it squashes, wobbles and blinks. */
  poke(): void {
    this.blinkT = 0;
    if (this.reduced) return;
    this.squash.v += 4.2;
    this.ripple.v += 2.4;
    this.lean.v += (this.rand() - 0.5) * 2.4;
  }

  hop(power = 1): void {
    if (this.reduced || this.airborne || this.hopWait > 0) return;
    this.hopWait = 0.07;
    this.hopPower = 3 * power;
    this.squash.v += 3;
  }

  /** Looks that way, for `seconds` or until told otherwise; `null` gives the eyes back to the mood. */
  look(direction: PetLook | null, seconds?: number): void {
    if (!direction) {
      this.lookUntil = -1;
      return;
    }
    this.lookDir = LOOKS[direction];
    this.lookUntil = this.t + (seconds ?? Infinity);
  }

  setBadge(on: boolean): void {
    this.badgeOn = on;
  }

  setReduced(on: boolean): void {
    this.reduced = on;
  }

  // ------------------------------------------------------------------ time

  step(seconds: number): void {
    let left = clamp(seconds, 0, 0.05);
    while (left > 1e-6) {
      const dt = Math.min(1 / 240, left);
      this.tick(dt);
      left -= dt;
    }
  }

  /**
   * Moves the clock on without simulating: for time spent resting (`restUntil`), when nothing moved. Whatever was due
   * in that time comes due on the next step.
   */
  skip(seconds: number): void {
    this.t += seconds;
    this.moodT += seconds;
  }

  /**
   * When the pet is still and will stay so for a while: the time of the next thing that moves it (a blink, a
   * glance), Infinity if nothing will until it's told something. `null` while it moves. Lets a small pet that's only
   * blinking now and then cost nothing in between.
   */
  restUntil(): number | null {
    const spec = MOODS[this.mood];
    if (spec.dots || spec.bob || spec.gaze === 'scan' || spec.gaze === 'form') return null;
    if (this.breathe && !this.reduced) return null;
    if (this.airborne || this.hopWait > 0 || this.tween || this.blinkT >= 0) return null;
    const springs = [
      this.form,
      this.side,
      this.eyeSize,
      this.gazeX,
      this.gazeY,
      this.squash,
      this.lean,
      this.shake,
      this.ripple,
      this.badgeSize,
    ];
    if (!springs.every(still)) return null;
    let next = Infinity;
    if (spec.life) next = Math.min(next, this.blinkAt);
    if (this.lookUntil > this.t) next = Math.min(next, this.lookUntil);
    else if (spec.life && !spec.gaze && !this.reduced) next = Math.min(next, this.glanceAt);
    if (spec.after && !this.settled) next = Math.min(next, this.t + (AFTER - this.moodT));
    return next;
  }

  private tick(dt: number) {
    this.t += dt;
    this.moodT += dt;
    const spec = MOODS[this.mood];
    const calm = this.reduced;

    pull(this.form, spec.dots ? 1 : 0, 170, calm ? 26 : 13, dt);
    pull(this.side, spec.dots ? 1 : 0, 190, calm ? 28 : 15, dt);
    pull(this.eyeSize, spec.dots ? 0 : 1, 260, calm ? 32 : 14, dt);

    const [gx, gy] = this.gazeTarget(spec);
    pull(this.gazeX, gx, 280, 30, dt);
    pull(this.gazeY, gy, 280, 30, dt);

    pull(this.squash, 0, 300, 9, dt);
    pull(this.shake, 0, 520, 9, dt);
    pull(this.lean, calm ? 0 : this.gazeX.x * 0.05 - this.shake.v * 0.035, 160, 7, dt);
    pull(this.ripple, 0, 560, 5, dt);
    pull(this.badgeSize, this.badgeOn ? 1 : 0, 320, 13, dt);

    if (this.hopWait > 0) {
      this.hopWait -= dt;
      if (this.hopWait <= 0) {
        this.airborne = true;
        this.hopV = this.hopPower;
        this.squash.v -= 7;
      }
    }
    if (this.airborne) {
      this.hopV -= 14 * dt;
      this.hopY += this.hopV * dt;
      if (this.hopY <= 0) {
        this.hopY = 0;
        this.airborne = false;
        this.squash.v += 3.5 + 0.6 * this.hopPower;
        this.ripple.v += 1.6;
      }
    }

    if (spec.bob && !calm) {
      this.bobIn -= dt;
      if (this.bobIn <= 0) {
        this.bobIn = 0.48;
        this.squash.v += 1.5;
      }
    }

    if (spec.after && !this.settled && this.moodT > AFTER) {
      this.settled = true;
      this.setFace(face(spec.after));
    }

    if (this.tween) {
      this.tween.t += dt;
      if (this.tween.t >= 0.26) {
        this.face = this.tween.to;
        this.tween = null;
      }
    }

    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT > 0.2) this.blinkT = -1;
    } else if (this.t >= this.blinkAt) {
      if (spec.life) this.blinkT = 0;
      // Now and then a second blink right after the first.
      this.blinkAt = this.t + (this.rand() < 0.18 ? 0.34 : 2.2 + this.rand() * 3.4);
    }
  }

  private gazeTarget(spec: MoodSpec): [number, number] {
    if (this.lookUntil > this.t) return this.lookDir;
    if (spec.dots) return [0, 0];
    switch (spec.gaze) {
      case 'left':
        return [-0.85, 0.05];
      case 'up':
        return [0, -0.08];
      case 'down':
        return [0, 0.16];
      case 'scan': {
        // Along a line, quickly back, the next line down.
        const period = 1.15;
        const u = (this.moodT % period) / period;
        const line = Math.floor(this.moodT / period) % 3;
        const x =
          u < 0.78
            ? lerp(-0.5, 0.5, easeOut(u / 0.78) * 0.4 + (u / 0.78) * 0.6)
            : lerp(0.5, -0.5, easeOut((u - 0.78) / 0.22));
        return [x, -0.14 + line * 0.13];
      }
      case 'form': {
        // Down the form on its left, a field at a time.
        const field = Math.floor(this.moodT / 0.48) % 5;
        return [-0.55, 0.06 + field * 0.09];
      }
    }
    if (this.reduced) return [0, 0];
    if (this.t >= this.glanceAt) {
      this.glance = this.rand() < 0.3 ? [0, 0] : [(this.rand() - 0.5) * 0.76, (this.rand() - 0.6) * 0.42];
      this.glanceAt = this.t + 0.9 + this.rand() * 2.4;
    }
    return this.glance;
  }

  private setFace(next: Face, instant = false) {
    if (instant) {
      this.face = next;
      this.tween = null;
      return;
    }
    const from = this.faceNow();
    this.tween = { from, to: next, t: 0, swap: from.kind !== next.kind };
  }

  /** The face as it stands: a change of kind (pills to curves) goes through closed eyes, a blink hiding it. */
  private faceNow(): Face {
    const tween = this.tween;
    if (!tween) return this.face;
    if (!tween.swap) return mixFace(tween.from, tween.to, easeOut(tween.t / 0.24));
    if (tween.t < 0.09) return mixFace(tween.from, shut(tween.from), easeIn(tween.t / 0.09));
    return mixFace(shut(tween.to), tween.to, easeOut((tween.t - 0.09) / 0.16));
  }

  private blink(): number {
    const b = this.blinkT;
    if (b < 0) return 0;
    return b < 0.07 ? easeIn(b / 0.07) : 1 - easeOut((b - 0.07) / 0.12);
  }

  /** The loading dots, 0 left to 2 right: height off the seat, squash, and under reduced motion a pulse. */
  private wave(i: number): { y: number; s: number; opacity: number } {
    if (this.reduced)
      return { y: 0, s: 0, opacity: 0.45 + 0.55 * Math.max(0, Math.sin(TAU * this.moodT - i * 0.9)) };
    const ramp = smooth(0.2, 0.55, this.moodT);
    const period = 0.92;
    const u = ((((this.moodT - i * 0.13) % period) + period) % period) / period;
    let y = 0;
    let s = 0;
    if (u < 0.42) {
      const k = Math.sin((Math.PI * u) / 0.42);
      y = k * 0.42;
      s = -0.16 * k;
    } else if (u < 0.6) {
      const k = (u - 0.42) / 0.18;
      s = 0.28 * Math.sin(Math.PI * k) * (1 - k * 0.3);
    }
    return { y: y * ramp, s: s * ramp, opacity: 1 };
  }

  /** A point riding the body: leaned, squashed at the seat, moved with it; in drawing units. */
  private place(x: number, y: number): [number, number] {
    const xx = (x + this.lean.x * (this.base - y)) * this.sx;
    const yy = this.base + (y - this.base) * this.sy;
    return [(xx + this.offX) * SCALE, (yy + this.offY) * SCALE];
  }

  frame(): PetFrame {
    const form = this.form.x;
    const formIn = clamp(form, 0, 1);
    const breath = this.breathe && !this.reduced ? 0.012 * Math.sin((TAU * this.t) / 2.7) : 0;

    const middle = this.wave(1);
    const squash = clamp(this.squash.x, -0.35, 0.45) + middle.s * formIn;
    this.sx = (1 + squash) / (1 + breath);
    this.sy = (1 + breath) / (1 + squash);
    // Past the mochi the spring pops the body bigger, which is the jelly; past the dot it would shrink the middle
    // dot below its neighbours, so it stops there.
    const toDot = Math.min(form, 1);
    this.base = lerp(SEAT, DOT, toDot);
    this.offX = this.shake.x;
    this.offY = -this.hopY - middle.y * formIn;

    const outline = SPOKES.map((spoke) => {
      const r =
        Math.max(0.02, lerp(spoke.mochi, DOT, toDot)) *
        (1 + this.ripple.x * Math.cos(3 * spoke.angle + 0.6) * spoke.free);
      return this.place(r * spoke.cos, r * spoke.sin);
    });

    // The eyes ride the body, and shrink into its middle as it turns into a dot. The one nearer the edge it looks
    // towards is narrower, as on a ball.
    const blink = this.blink();
    const current = this.faceNow();
    const gx = this.gazeX.x;
    const gy = this.gazeY.x;
    const size = Math.max(0, this.eyeSize.x) * this.eyeBoost;
    const converge = 1 - 0.55 * formIn;
    const eye = (side: -1 | 1): string => {
      const near = 1 - 0.22 * Math.max(0, side * gx);
      const x = (side * EYE_X * (1 - 0.18 * Math.max(0, side * gx)) + gx * 0.17) * converge;
      const y = (EYE_Y + gy * 0.12) * converge;
      const points: [number, number][] = [];
      if (current.kind === 'pill') {
        const shape = side < 0 ? current.left : current.right;
        const w = shape.w * near * size;
        const h = lerp(shape.h, SHUT_PILL, blink) * (1 - 0.1 * Math.abs(gy)) * size;
        pillPoints(x, y, Math.max(w, 0.001), Math.max(h, 0.001), points);
      } else {
        const e = side < 0 ? current.left : current.right;
        curvePoints(
          x,
          y,
          {
            ax: e.ax * size * near,
            ay: e.ay * size,
            cx: e.cx * size * near,
            cy: e.cy * size,
            bx: e.bx * size * near,
            by: e.by * size,
            sw: Math.max(e.sw * size, 0.001),
          },
          points,
        );
      }
      return polygonPath(points.map(([px, py]) => this.place(px, py)));
    };

    const [glossX, glossY] = this.place(-0.4, -0.5);
    const lifted = Math.min(1, this.hopY / 0.35);
    const shadowWidth =
      0.7 * (1 - 0.35 * lifted) * lerp(1, 0.45, formIn) * (1 + clamp(squash, -0.3, 0.4) * 0.5);
    const dot = (i: 0 | 2): PetEllipse => {
      const spread = Math.max(0, this.side.x);
      const shown = Math.min(spread, 1);
      const w = this.wave(i);
      const r = DOT * shown;
      const sxd = 1 + w.s * shown;
      const syd = 1 / sxd;
      return {
        cx: round((i === 0 ? -1 : 1) * 0.8 * spread * SCALE),
        cy: round((DOT - r * syd - w.y * shown) * SCALE),
        rx: round(r * sxd * SCALE),
        ry: round(r * syd * SCALE),
        opacity: round(clamp(spread * 2, 0, 1) * w.opacity),
      };
    };
    const [badgeX, badgeY] = this.place(0.7, -0.7);

    return {
      body: smoothPath(outline),
      bodyOpacity: round(this.reduced ? lerp(1, middle.opacity, formIn) : 1),
      eyes: [eye(-1), eye(1)],
      eyeOpacity: round(clamp(size * 4, 0, 1)),
      gloss: {
        x: round(glossX),
        y: round(glossY),
        rx: round(0.24 * SCALE * this.sx * (1 - formIn)),
        ry: round(0.12 * SCALE * this.sy * (1 - formIn)),
        angle: -32,
      },
      shadow: {
        cx: round(this.offX * SCALE),
        cy: round((SEAT + 0.07) * SCALE),
        rx: round(shadowWidth * SCALE),
        ry: round(0.075 * SCALE),
        opacity: round(0.1 * (1 - 0.45 * lifted) * (1 - formIn)),
      },
      dots: [dot(0), dot(2)],
      badge: {
        cx: round(badgeX),
        cy: round(badgeY),
        r: round(0.15 * Math.max(0, this.badgeSize.x) * (1 - formIn) * SCALE),
      },
    };
  }
}

/**
 * The boxes a pet is drawn in, as SVG view boxes in frame units: `icon` hugs the body (a mark, a tab, a button);
 * `stage` leaves room above for hops and below for the shadow; `dots` is the loading dots' strip, for a line of text.
 */
export const PET_BOXES = {
  icon: { x: -67, y: -70, width: 134, height: 134 },
  stage: { x: -76, y: -88, width: 152, height: 152 },
  dots: { x: -72, y: -48, width: 144, height: 72 },
} as const;

export type PetFit = keyof typeof PET_BOXES;

/**
 * The app's and the extension's icon: the pet on a white tile 64 across with corners of 15, its body's middle on the
 * tile's, frame units at 0.39 (the body about 50 wide). scripts/icons.mjs draws the files; the toolbar button's
 * moving picture (extension/src/background/icon.ts) is drawn the same way.
 */
export const PET_ICON = { tile: 64, radius: 15, scale: 0.39 } as const;
