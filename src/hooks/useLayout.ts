import { useMediaQuery } from './useMediaQuery';

/**
 * Phones get a top bar and sheets. Wider screens get the sidebar, and the widest also keep the selected job
 * open beside the list instead of sliding it over.
 */
export type Layout = 'phone' | 'medium' | 'wide';

export function useLayout(): Layout {
  const phone = useMediaQuery('(max-width: 767px)');
  const wide = useMediaQuery('(min-width: 1280px)');
  return phone ? 'phone' : wide ? 'wide' : 'medium';
}
