import { describe, expect, it } from 'vitest';
import { makeProfile } from '../test/profiles';
import { eeoWant, pickEeoOption } from './eeo';

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

describe('sexual orientation', () => {
  // Twilio's Greenhouse form, from the owner's snapshot.
  const twilio = ['Bisexual', 'Heterosexual', 'Homosexual', "I don't wish to answer"];

  it('picks the profile’s answer under either of its names', () => {
    expect(pickEeoOption(twilio, 'orientation', 'heterosexual')).toBe('Heterosexual');
    expect(
      pickEeoOption(
        ['Asexual', 'Gay or Lesbian', 'Straight', 'Prefer not to say'],
        'orientation',
        'heterosexual',
      ),
    ).toBe('Straight');
    expect(pickEeoOption(twilio, 'orientation', 'gay')).toBe('Homosexual');
    expect(pickEeoOption(twilio, 'orientation', 'bisexual')).toBe('Bisexual');
  });

  it('declines until the profile says otherwise', () => {
    expect(eeoWant('orientation', makeProfile())).toMatchObject({ value: 'decline' });
    expect(pickEeoOption(twilio, 'orientation', 'decline')).toBe("I don't wish to answer");
    const profile = makeProfile({ eeo: { orientation: 'heterosexual' } });
    expect(eeoWant('orientation', profile)).toMatchObject({ value: 'heterosexual' });
  });
});

describe('a list that asks race and Hispanic origin at once', () => {
  // Workday's "Ethnicity", as one list.
  const ethnicity = [
    'Hispanic or Latino (United States of America)',
    'White (Not Hispanic or Latino) (United States of America)',
    'Asian (Not Hispanic or Latino) (United States of America)',
    'I do not wish to answer. (United States of America)',
  ];

  it('is answered Hispanic or Latino for an applicant who is', () => {
    const profile = makeProfile();
    const want = eeoWant('race', { ...profile, eeo: { ...profile.eeo, hispanic: 'yes', race: 'white' } });
    expect(want.kind === 'eeo' && pickEeoOption(ethnicity, 'race', want.value, want.hispanic)).toBe(
      'Hispanic or Latino (United States of America)',
    );
  });

  it('is answered by race for an applicant who isn’t, and where the list has no Hispanic choice', () => {
    expect(pickEeoOption(ethnicity, 'race', 'white')).toBe(
      'White (Not Hispanic or Latino) (United States of America)',
    );
    expect(pickEeoOption(['White', 'Asian'], 'race', 'white', true)).toBe('White');
  });
});
