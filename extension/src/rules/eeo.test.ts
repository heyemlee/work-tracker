import { describe, expect, it } from 'vitest';
import { pickEeoOption } from './eeo';

describe('veteran status', () => {
  // Workday's wording, in the order the dropdown lists it.
  const workday = [
    'I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE',
    'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN',
    'I AM NOT A VETERAN',
    'I DO NOT WISH TO SELF-IDENTIFY',
  ];
  const greenhouse = [
    'I am not a protected veteran',
    'I identify as one or more of the classifications of a protected veteran',
    "I don't wish to answer",
  ];

  it('picks "not a veteran" over "a veteran, just not a protected veteran"', () => {
    expect(pickEeoOption(workday, 'veteran', 'not')).toBe('I AM NOT A VETERAN');
  });

  it('picks "not a protected veteran" when that is the only no', () => {
    expect(pickEeoOption(greenhouse, 'veteran', 'not')).toBe('I am not a protected veteran');
  });

  it('picks the protected-veteran option', () => {
    expect(pickEeoOption(workday, 'veteran', 'protected')).toBe(workday[0]);
    expect(pickEeoOption(greenhouse, 'veteran', 'protected')).toBe(greenhouse[1]);
  });

  it('declines', () => {
    expect(pickEeoOption(workday, 'veteran', 'decline')).toBe('I DO NOT WISH TO SELF-IDENTIFY');
  });
});
