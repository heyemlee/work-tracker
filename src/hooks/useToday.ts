import { useEffect, useState } from 'react';
import { toIsoDate } from '../domain/dates';
import type { IsoDate } from '../domain/types';

/** Today's local date, refreshed each minute so the list regroups after midnight. */
export function useToday(): IsoDate {
  const [today, setToday] = useState(() => toIsoDate(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setToday(toIsoDate(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}
