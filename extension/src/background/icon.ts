import { browser } from 'wxt/browser';
import { PET_ICON, PET_MIDDLE_Y, PetSim, type PetFrame } from '../../../src/ui/pet/engine';
import type { CardState } from '../messages';
import { failed, waitingOnOwner, working } from '../pet';

/**
 * The toolbar button's picture on each tab: Outbox's pet, as the icon files draw it (scripts/icons.mjs).
 *
 * - Still, the manifest's own icon, while nothing happens on the tab.
 * - Three dots taking turns to hop while the extension works on it: reading the page, filling it, AI writing.
 * - A hop with happy eyes for two seconds when the work ends with nothing left to fill, or an application is logged.
 * - A blue dot while something waits on the owner: fields the fill left empty, an error the card shows.
 *
 * Drawn in the service worker on an OffscreenCanvas a dozen times a second, only while it moves, and only on its
 * tab. At rest nothing runs: a service worker kept awake for a blink would keep Chrome busy for nothing.
 */

const FPS = 12;
const HAPPY_MS = 2000;
const SIZES = [16, 32] as const;
const DEFAULT_ICON = { 16: 'icon/16.png', 32: 'icon/32.png' };

/** What the button shows, from what it showed before on that tab and the tab's state now. */
export interface ButtonLook {
  /** Moving: the dots while at work, the hop when done; `null` when still. */
  moving: 'think' | 'happy' | null;
  badge: boolean;
}

interface Before {
  working: boolean;
  logged: boolean;
}

export function buttonLook(before: Before | undefined, state: CardState): ButtonLook {
  if (working(state)) return { moving: 'think', badge: false };
  const badge = waitingOnOwner(state) || failed(state);
  const logged = state.logged !== null && !state.logged.undone;
  const done = before?.working === true && state.checklist.length > 0 && !badge;
  const loggedNow = logged && before !== undefined && !before.logged;
  return { moving: done || loggedNow ? 'happy' : null, badge };
}

interface Button extends Before {
  sim: PetSim | null;
  moving: ButtonLook['moving'];
  /** Where the hop leaves it, when it's over. */
  badgeAfter: boolean;
  ticker?: ReturnType<typeof setInterval>;
  ending?: ReturnType<typeof setTimeout>;
}

const buttons = new Map<number, Button>();

/** Shows a tab's state on the toolbar button. Never fails: the button is a picture, not the card's job. */
export function showOnButton(tabId: number, state: CardState): void {
  if (!canDraw()) return;
  const button = buttons.get(tabId) ?? {
    working: false,
    logged: false,
    sim: null,
    moving: null,
    badgeAfter: false,
  };
  buttons.set(tabId, button);
  const look = buttonLook(button, state);
  button.working = working(state);
  button.logged = state.logged !== null && !state.logged.undone;

  if (look.moving === 'think') return move(tabId, button, 'think');
  if (look.moving === 'happy') {
    button.badgeAfter = look.badge;
    move(tabId, button, 'happy');
    clearTimeout(button.ending);
    button.ending = setTimeout(() => still(tabId, button, button.badgeAfter), HAPPY_MS);
    return;
  }
  // A hop under way finishes; what it leaves follows the latest state.
  if (button.moving === 'happy') {
    button.badgeAfter = look.badge;
    return;
  }
  still(tabId, button, look.badge);
}

/**
 * The tab loaded another page: what the button showed was the last page's, and it goes back to the plain icon.
 * Whether an application was logged on the tab is kept, so the confirmation page a sending loads still hops.
 */
export function resetButton(tabId: number): void {
  const button = buttons.get(tabId);
  if (!button) return;
  button.working = false;
  still(tabId, button, false);
}

/** The tab is gone: so is its picture. */
export function forgetButton(tabId: number): void {
  const button = buttons.get(tabId);
  if (!button) return;
  clearInterval(button.ticker);
  clearTimeout(button.ending);
  buttons.delete(tabId);
}

function move(tabId: number, button: Button, mood: 'think' | 'happy') {
  if (button.moving === mood && button.ticker) return;
  button.moving = mood;
  // The same pet from the dots to the hop: it turns from one into the other.
  button.sim ??= new PetSim({ breathe: false, eyeBoost: 1.35, seed: tabId });
  button.sim.setMood(mood);
  clearInterval(button.ticker);
  const draw = () => {
    const sim = button.sim;
    if (!sim) return;
    // The engine takes at most 50 ms a step.
    for (let left = 1 / FPS; left > 0; left -= 0.04) sim.step(Math.min(0.04, left));
    paint(tabId, sim.frame(), false);
  };
  draw();
  button.ticker = setInterval(draw, 1000 / FPS);
}

function still(tabId: number, button: Button, badge: boolean) {
  clearInterval(button.ticker);
  clearTimeout(button.ending);
  button.ticker = undefined;
  button.moving = null;
  button.sim = null;
  if (badge) paint(tabId, new PetSim({ breathe: false, eyeBoost: 1.35 }).frame(), true);
  else setIcon({ tabId, path: DEFAULT_ICON });
}

/**
 * Whether there's a canvas to draw on: a service worker has one; a test's stand-in for the browser may have none,
 * or one that draws nothing. Without one the manifest's icon stays.
 */
function canDraw(): boolean {
  try {
    return (
      typeof OffscreenCanvas !== 'undefined' &&
      typeof Path2D !== 'undefined' &&
      new OffscreenCanvas(1, 1).getContext('2d') !== null
    );
  } catch {
    return false;
  }
}

function setIcon(details: Parameters<typeof browser.action.setIcon>[0]) {
  try {
    void browser.action.setIcon(details).catch(() => undefined);
  } catch {
    // Thrown, not rejected (a tab gone in between): the button keeps what it had.
  }
}

function paint(tabId: number, frame: PetFrame, badge: boolean) {
  try {
    setIcon({
      tabId,
      imageData: Object.fromEntries(SIZES.map((size) => [size, picture(frame, size, badge)])),
    });
  } catch {
    // A canvas that won't draw leaves the icon as it was.
  }
}

function picture(frame: PetFrame, size: number, badge: boolean): ImageData {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  const unit = size / PET_ICON.tile;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, PET_ICON.radius * unit);
  ctx.fill();

  ctx.save();
  ctx.translate((PET_ICON.tile / 2) * unit, (PET_ICON.tile / 2 - PET_MIDDLE_Y * PET_ICON.scale) * unit);
  ctx.scale(PET_ICON.scale * unit, PET_ICON.scale * unit);
  ctx.fillStyle = '#000000';
  for (const dot of frame.dots) {
    if (dot.opacity <= 0 || dot.rx <= 0) continue;
    ctx.globalAlpha = dot.opacity;
    ctx.beginPath();
    ctx.ellipse(dot.cx, dot.cy, dot.rx, Math.max(dot.ry, 0.01), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = frame.bodyOpacity;
  ctx.fill(new Path2D(frame.body));
  ctx.globalAlpha = frame.eyeOpacity;
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(frame.eyes[0]));
  ctx.fill(new Path2D(frame.eyes[1]));
  ctx.restore();

  if (badge) {
    // Big enough to see at 16 pixels, in the tile's corner, ringed in white to stand off the body.
    const r = size * 0.12;
    const [x, y] = [size - r - size * 0.04, r + size * 0.04];
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r + size * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3478f6';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, size, size);
}
