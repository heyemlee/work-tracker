import { isDone, type CardState } from './messages';

/**
 * What Outbox's pet (src/ui/pet) makes of a tab's state, in the card's header and on the toolbar button: the same
 * words for both.
 */

/** The extension at work on the tab: reading the page, filling it, AI writing answers. */
export const working = (state: Pick<CardState, 'phase'>): boolean =>
  state.phase === 'reading' || state.phase === 'filling' || state.phase === 'drafting';

/** After a fill: the fields still empty that count, the required ones (all of them on a form that marks none). */
export function fieldsLeft(state: Pick<CardState, 'checklist'>): number {
  const required = state.checklist.filter((item) => item.required);
  return (required.length > 0 ? required : state.checklist).filter((item) => !isDone(item)).length;
}

/** A fill is over and fields it counts are still empty: the owner's to fill. */
export const waitingOnOwner = (state: Pick<CardState, 'phase' | 'checklist'>): boolean =>
  !working(state) && state.checklist.length > 0 && fieldsLeft(state) > 0;

/** Something went wrong that the card says (a log Outbox didn't take, AI failing); a queued log is on its way. */
export const failed = (state: Pick<CardState, 'error'>): boolean =>
  state.error !== null && state.error !== 'queued';
