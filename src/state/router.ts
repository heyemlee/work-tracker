import { useMemo, useSyncExternalStore } from 'react';

/** Outbox's pages. Each has its own address, so reloading, the back button and links all land on it. */
export type Page =
  'applications' | 'discovery' | 'resumes' | 'resumeTools' | 'profile' | 'insights' | 'welcome';

export const PAGE_PATHS: Record<Page, string> = {
  applications: '/',
  discovery: '/discover',
  resumeTools: '/resume-tools',
  resumes: '/resumes',
  profile: '/profile',
  insights: '/insights',
  welcome: '/welcome',
};

export function pageOf(pathname: string): Page {
  const path = pathname.replace(/\/+$/, '') || '/';
  const found = (Object.keys(PAGE_PATHS) as Page[]).find((page) => PAGE_PATHS[page] === path);
  return found ?? 'applications';
}

const listeners = new Set<() => void>();
const here = () => window.location.pathname + window.location.search;
let shown = here();
let guard: (() => boolean) | null = null;

function notify() {
  shown = here();
  for (const listener of listeners) listener();
}

/**
 * Asked before leaving the current page, say with unsaved edits; returning false stays put. One at a time: the page
 * that sets it clears it when it goes.
 */
export function setLeaveGuard(next: (() => boolean) | null): void {
  guard = next;
}

const leavingPage = (to: string) =>
  pageOf(new URL(to, window.location.href).pathname) !==
  pageOf(new URL(shown, window.location.href).pathname);

/** Goes to an address within Outbox. Returns false when the page's guard kept the owner where they were. */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}): boolean {
  if (to === here()) return true;
  const leaving = leavingPage(to);
  if (leaving && guard && !guard()) return false;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  if (leaving) window.scrollTo(0, 0);
  notify();
  return true;
}

window.addEventListener('popstate', () => {
  // The back button can't be cancelled; a guard that says no puts the address back instead.
  if (guard && leavingPage(here()) && !guard()) {
    window.history.pushState(null, '', shown);
    return;
  }
  notify();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface Location {
  page: Page;
  params: URLSearchParams;
}

export function useLocation(): Location {
  const address = useSyncExternalStore(subscribe, () => shown);
  return useMemo(() => {
    const url = new URL(address, window.location.origin);
    return { page: pageOf(url.pathname), params: url.searchParams };
  }, [address]);
}
