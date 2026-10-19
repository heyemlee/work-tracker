import { describe, expect, it } from 'vitest';
import { PetSim, type PetFrame, type PetMood } from './engine';

/** The x and y extents of a path's points (every other number is an x). */
function extents(path: string) {
  const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const xs = numbers.filter((_, i) => i % 2 === 0);
  const ys = numbers.filter((_, i) => i % 2 === 1);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

const run = (sim: PetSim, seconds: number, each?: (frame: PetFrame) => void) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    sim.step(1 / 60);
    each?.(sim.frame());
  }
};

const MOODS: PetMood[] = ['idle', 'think', 'read', 'work', 'happy', 'oops', 'peek'];

describe('the pet', () => {
  it('draws every mood, in and out, with nothing missing', () => {
    for (const reduced of [false, true]) {
      const sim = new PetSim({ seed: 3, reduced });
      for (const mood of [...MOODS, 'think', 'idle'] as PetMood[]) {
        sim.setMood(mood);
        sim.poke();
        sim.look('downLeft', 0.4);
        sim.setBadge(mood === 'read');
        run(sim, 1.2, (frame) => expect(JSON.stringify(frame)).not.toMatch(/NaN|Infinity|null/));
      }
    }
  });

  it('is the same pet for the same seed', () => {
    const a = new PetSim({ seed: 9 });
    const b = new PetSim({ seed: 9 });
    run(a, 4);
    run(b, 4);
    expect(a.frame()).toEqual(b.frame());
  });

  it('sits on its seat at rest', () => {
    const { left, right, top, bottom } = extents(new PetSim({ breathe: false }).frame().body);
    // Wider than tall, the seat lower than the dome is high: a mochi, not a ball.
    expect(right - left).toBeGreaterThan(bottom - top + 12);
    expect(top).toBeCloseTo(-58.2, 0);
    expect(bottom).toBeCloseTo(50.4, 0);
  });

  it('loads as three dots of one size', () => {
    const sim = new PetSim({ mood: 'think' });
    // Every dot is on the ground and round at 0.85 s into a hop's 0.92 s.
    run(sim, 0.92 + 0.85);
    const frame = sim.frame();
    const middle = extents(frame.body);
    expect((middle.right - middle.left) / 2).toBeCloseTo(18, 0);
    for (const dot of frame.dots) {
      expect(dot.rx).toBeCloseTo(18, 0);
      expect(dot.ry).toBeCloseTo(18, 0);
      expect(dot.opacity).toBe(1);
    }
  });

  it('turns back from dots into itself, eyes and all', () => {
    const width = (path: string) => extents(path).right - extents(path).left;
    const rest = width(new PetSim({ breathe: false }).frame().body);
    const sim = new PetSim({ mood: 'think', breathe: false });
    run(sim, 1);
    expect(sim.frame().eyeOpacity).toBe(0);
    sim.setMood('idle');
    run(sim, 1.5);
    const frame = sim.frame();
    expect(frame.eyeOpacity).toBe(1);
    expect(frame.dots.every((dot) => dot.opacity === 0)).toBe(true);
    expect(width(frame.body)).toBeCloseTo(rest, 0);
  });

  it('hops when happy, but not under reduced motion', () => {
    for (const reduced of [false, true]) {
      const sim = new PetSim({ reduced, breathe: false });
      let highest = Infinity;
      sim.setMood('happy');
      run(sim, 1, (frame) => (highest = Math.min(highest, extents(frame.body).bottom)));
      if (reduced) expect(highest).toBeCloseTo(50.4, 0);
      else expect(highest).toBeLessThan(40);
    }
  });

  it('rests between blinks when it has no breath, and says until when', () => {
    const sim = new PetSim({ breathe: false, seed: 4 });
    let until = sim.restUntil();
    for (let i = 0; i < 600 && until === null; i++) {
      sim.step(1 / 60);
      until = sim.restUntil();
    }
    expect(until).not.toBeNull();
    expect(until!).toBeGreaterThan(sim.t);
    expect(until!).toBeLessThan(sim.t + 6);
    const resting = sim.frame();
    // Nothing moves until then...
    sim.skip(until! - sim.t - 0.01);
    expect(sim.frame()).toEqual(resting);
    // ...and then something does.
    sim.step(0.02);
    sim.step(1 / 60);
    expect(sim.restUntil()).toBeNull();
  });

  it('never rests while it breathes or loads', () => {
    const breathing = new PetSim();
    run(breathing, 3);
    expect(breathing.restUntil()).toBeNull();
    const loading = new PetSim({ mood: 'think', breathe: false });
    run(loading, 3);
    expect(loading.restUntil()).toBeNull();
  });

  it('looks where it is told for as long as it is told', () => {
    const sim = new PetSim({ breathe: false, reduced: true });
    const ahead = sim.frame().eyes[0];
    sim.look('left', 0.5);
    run(sim, 0.4);
    expect(extents(sim.frame().eyes[0]).left).toBeLessThan(extents(ahead).left - 3);
    run(sim, 0.8);
    expect(sim.frame().eyes[0]).toEqual(ahead);
  });

  it('shows a badge when asked, and takes it away', () => {
    const sim = new PetSim({ breathe: false });
    sim.setBadge(true);
    run(sim, 0.6);
    expect(sim.frame().badge.r).toBeCloseTo(9, 0);
    sim.setBadge(false);
    run(sim, 0.6);
    expect(sim.frame().badge.r).toBeCloseTo(0, 1);
  });
});
