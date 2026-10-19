import { useSyncExternalStore } from 'react';

/**
 * The pet's flight into the toolbar as Outbox opens (Arrival.tsx). While it flies, the toolbar's own pet (Brand)
 * stays hidden; when it lands, that one takes its place with a squash.
 */
interface Flight {
  flying: boolean;
  /** How many times one has landed: the toolbar's pet takes it as a poke. */
  landings: number;
}

let flight: Flight = { flying: false, landings: 0 };
const listeners = new Set<() => void>();

export function setFlying(flying: boolean): void {
  if (flying === flight.flying) return;
  flight = { flying, landings: flight.landings + (flying ? 0 : 1) };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useArrival(): Flight {
  return useSyncExternalStore(subscribe, () => flight);
}
