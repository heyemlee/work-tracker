import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

const DURATION_MS = 5000;
/** Toasts with an action (Undo) stay longer, so there is time to change your mind. */
const ACTION_DURATION_MS = 8000;
const MAX_VISIBLE = 3;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showToast(toast: Omit<Toast, 'id'>): number {
  const id = nextId++;
  toasts = [...toasts.slice(1 - MAX_VISIBLE), { ...toast, id }];
  emit();
  setTimeout(() => dismissToast(id), toast.action ? ACTION_DURATION_MS : DURATION_MS);
  return id;
}

export function dismissToast(id: number): void {
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts);
}
