import { describe, expect, it } from 'vitest';
import { makeProfile } from '../test/profiles';
import { answerAuth, classifyAuth, postingCountry, pickAuthOption, type AuthKind } from './authorization';

const YES_NO = ['Yes', 'No'];

/** Answers a question the way the planner does, for an applicant on F-1 STEM OPT with Chinese citizenship. */
function answer(label: string, options: string[], profile = makeProfile()): string | null {
  const kind = classifyAuth(label);
  if (!kind) throw new Error(`not a work-authorization question: ${label}`);
  const result = answerAuth(kind, label, options.length ? 'radio' : 'text', profile, options);
  if (options.length === 0) return result.text;
  return result.question ? pickAuthOption(options, result.question) : null;
}

// Every question below was collected from a public Greenhouse, Lever or Ashby application form (2026-09).
describe('work authorization, F-1 STEM OPT in the US', () => {
  const cases: [label: string, options: string[], expected: string | null][] = [
    ['Are you legally authorized to work in the United States?', YES_NO, 'Yes'],
    [
      'Are you legally authorized to work in the country where the job is located?',
      [
        'Yes, I am currently legally authorized to work in the country where the job is located.',
        'No, I am not currently legally authorized to work in the country where the job is located.',
      ],
      'Yes, I am currently legally authorized to work in the country where the job is located.',
    ],
    [
      'Will you now or in the future require company sponsorship to retain or extend your work authorization in the country where the job is located?',
      [
        'Yes, I will require immigration sponsorship now to legally work in the country where the job is located.',
        'Yes, I will require immigration sponsorship in the future to legally work in the country where the job is located.',
        'No, I do not and will not require immigration sponsorship to legally work in the country where the job is located.',
      ],
      'Yes, I will require immigration sponsorship in the future to legally work in the country where the job is located.',
    ],
    [
      "Will you now or will you in the future require employment visa sponsorship to work in the country in which the job you're applying for is located?",
      YES_NO,
      'Yes',
    ],
    ['Do you require visa sponsorship?', YES_NO, 'Yes'],
    [
      'Do you now, or will you in the future, require immigration sponsorship for work authorization to work in this location?',
      YES_NO,
      'Yes',
    ],
    ['Are you currently eligible to work legally in the United States of America?', ['No', 'Yes'], 'Yes'],
    [
      'Do you now or in the future require immigration support or visa sponsorship to continue working in the United States?',
      ['No', 'Yes'],
      'Yes',
    ],
    [
      'Are you legally authorised to work full-time in the country where this job is based?',
      [
        'Yes, no restriction.',
        'Yes, but I will need sponsorship in the future.',
        'No, I need sponsorship now.',
      ],
      'Yes, but I will need sponsorship in the future.',
    ],
    [
      'Will you now require immigration sponsorship by our company to attain or maintain your employment eligibility (e.g., H-1B, E-3, TN, O-1, STEM OPT, or any immigration work authorization requiring a written sponsorship)?',
      YES_NO,
      'Yes',
    ],
    [
      'Will you in the future require immigration sponsorship by our company to attain or maintain your employment eligibility (e.g., H-1B, E-3, TN, O-1, STEM OPT)?',
      YES_NO,
      'Yes',
    ],
    [
      'Are you currently authorized to work for any employer in the country outlined for this role?',
      [
        'I am authorized to work for any employer in the specific country outlined for this role (e.g., an EU citizen, permanent resident, etc.)',
        'My current work authorization requires a renewal or sponsorship now or in the future',
        'My status to work in the country in this job location is unknown',
      ],
      'My current work authorization requires a renewal or sponsorship now or in the future',
    ],
    [
      'Will you now or in the future require sponsorship for work authorization?',
      [
        'No, I can work for any employer in the offer location without sponsorship',
        'Yes, I require sponsorship for work authorization in the offer location',
      ],
      'Yes, I require sponsorship for work authorization in the offer location',
    ],
    [
      'Will you now or in the future require sponsorship for a visa to remain in your current location?',
      [
        'No',
        'Yes, Netherlands Highly Skilled Migrant Visa',
        'Yes, Ireland Highly Skilled Worker Visa',
        'Yes, EU Blue Card',
        'Yes, USMCA Professional (TN) Visa (USA)',
        'Yes, F-1 Visa OPT (USA)',
        'Yes, but not one of the visas listed here',
      ],
      'Yes, F-1 Visa OPT (USA)',
    ],
    [
      'Are you authorised to work in the country in which this role is located? (Fin sponsors immigration for some roles so we encourage you to still apply if you require sponsorship.)',
      [
        'I am authorised to work in the country which this role is located (citizen, permanent resident etc)',
        'My current work authorisation requires sponsorship or renewal now or in the future.',
        'My authorisation to work in this country is unknown',
      ],
      'My current work authorisation requires sponsorship or renewal now or in the future.',
    ],
    [
      'Work Authorization',
      [
        'I am authorized to work for any employer in the country in which this position is based.',
        "I require/will require Lyft's sponsorship to obtain work authorization in the country in which this position is based (e.g. H-1B, TN, etc.)",
        'My status to work in the country in which this position is based is unknown',
      ],
      "I require/will require Lyft's sponsorship to obtain work authorization in the country in which this position is based (e.g. H-1B, TN, etc.)",
    ],
    [
      'What is the source of your right to work where this role is listed?',
      [
        'Citizen or permanent resident where this role is listed',
        'Citizen of a country with an unlimited right to work where this role is listed',
        'Valid visa with permission to work with any employer where this role is listed',
        'I do not currently have an unlimited right to work where this role is listed and would need sponsorship',
      ],
      'I do not currently have an unlimited right to work where this role is listed and would need sponsorship',
    ],
    [
      'Will you now or will you in the future require employment visa sponsorship?',
      [
        'Yes, I will require Harvey to sponsor my employment',
        'No, I do not require sponsorship to work in the country where this role is located',
      ],
      'Yes, I will require Harvey to sponsor my employment',
    ],
    [
      "Will you require Elastic's sponsorship to continue or extend your work authorization status?",
      YES_NO,
      'Yes',
    ],
    ['Will you require our assistance with work authorization now or in the future?', YES_NO, 'Yes'],
    [
      'Will you now or in the future require Samsara to commence ("sponsor") an immigration case in order to employ you?',
      YES_NO,
      'Yes',
    ],
    [
      'Are you currently legally authorized to work in the country in which this job is based (e.g. you are a citizen, you have a visa, etc.)?',
      YES_NO,
      'Yes',
    ],
    [
      'Do you require a work permit, visa or additional right to work support for the country where you are applying to work?',
      YES_NO,
      'Yes',
    ],
    ['Do you have the legal right to work in the country where you are applying to work?', YES_NO, 'Yes'],
    ['Are you authorized to work lawfully in the United States for Duolingo?', YES_NO, 'Yes'],
    [
      'If so, are you eligible or currently in a period of Optional Practical Training (OPT)?',
      ['Yes', 'No', 'NA'],
      'Yes',
    ],
    [
      'After the OPT, are you eligible for a 24-month OPT extension or are currently in a 24-month OPT extension based upon a degree from a qualifying U.S. institution in Science, Technology, Engineering, or Mathematics?',
      ['Yes', 'No', 'NA'],
      'Yes',
    ],
    // Questions about other countries answer for that country.
    ['Do you now or in the future require sponsorship for employment visa status in Poland?', YES_NO, 'Yes'],
    ['Are you legally authorized to work in China?', YES_NO, 'Yes'],
    ['Will you now or in the future require visa sponsorship to work in the United Kingdom?', YES_NO, 'Yes'],
    ['Are you an EU citizen (a citizen of European Union Member State)?', YES_NO, 'No'],
    [
      'Which of the following best describes your right to work in China?',
      [
        'I am a Chinese citizen',
        'I am on a dependent visa',
        'I am a HK, Macau or Taiwan Residence Permit holder',
        'I need visa sponsorship',
        'None of the above',
      ],
      'I am a Chinese citizen',
    ],
    [
      'Which of the following best describes your right to work in Singapore?',
      [
        'I am a SG citizen or permanent resident',
        'I am on a dependent visa',
        'I need visa sponsorship',
        'None of the above',
      ],
      'I need visa sponsorship',
    ],
    // Export control and clearance.
    [
      'US Export Control laws 2026: Are you a citizen, national or permanent resident of Iran, Cuba, North Korea or Syria?',
      YES_NO,
      'No',
    ],
    [
      'Please confirm whether any of the below applies to you. Select all that apply. Note: This information will only be used to ensure compliance with U.S. sanctions and export controls.',
      [
        'Citizen or permanent resident of Cuba, Iran, North Korea, or Syria',
        'Ordinarily a resident of Russia or Belarus and not willing to relocate for a Databricks role',
        'None of the above',
      ],
      'None of the above',
    ],
    ['Do you currently hold an active UK security clearance?', YES_NO, 'No'],
    ['Are you eligible to obtain the security clearance specified in the job description?', YES_NO, 'No'],
    // Text fields.
    ['In what countries do you have the unrestricted right to work?', [], 'China'],
    [
      "If you're not authorized to work at the stated location, what sponsorship would you require for the role?",
      [],
      'F-1 STEM OPT; H-1B sponsorship needed in the future',
    ],
  ];

  it.each(cases)('%s', (label, options, expected) => {
    expect(answer(label, options)).toBe(expected);
  });
});

describe('work authorization edge cases', () => {
  it('answers a now-only sponsorship question from the facts: STEM OPT needs none today', () => {
    expect(answer('Do you currently require sponsorship to work in the US?', YES_NO)).toBe('No');
  });

  it('leaves questions it cannot settle blank', () => {
    const noCitizenship = makeProfile({
      workAuthorization: { ...makeProfile().workAuthorization, citizenship: [] },
    });
    expect(
      answer('In what countries do you have the unrestricted right to work?', [], noCitizenship),
    ).toBeNull();
    expect(
      answer(
        'US Export Control laws 2026: Are you a citizen, national or permanent resident of Iran, Cuba, North Korea or Syria?',
        YES_NO,
        noCitizenship,
      ),
    ).toBeNull();
    // OPT is authorization with restrictions: no "any employer", no "without restrictions".
    expect(
      answer('Are you currently authorized to work for any employer in the United States?', YES_NO),
    ).toBe('No');
    expect(answer('Are you authorized to work in the United States without restrictions?', YES_NO)).toBe(
      'No',
    );
    expect(
      answer(
        'Are you legally authorized to work in the country where the job is located without any restrictions?',
        YES_NO,
      ),
    ).toBe('No');
    // Authorized, needing no sponsorship, not a citizen (a green card, say): theirs to answer.
    const resident = makeProfile({
      workAuthorization: {
        authorizedCountries: ['United States'],
        sponsorshipNow: false,
        sponsorshipFuture: false,
        citizenship: ['China'],
      },
    });
    expect(
      answer('Are you authorized to work in the United States without restrictions?', YES_NO, resident),
    ).toBeNull();
  });

  it('answers for a US citizen', () => {
    const citizen = makeProfile({
      workAuthorization: {
        authorizedCountries: ['United States'],
        sponsorshipNow: false,
        sponsorshipFuture: false,
        citizenship: ['United States'],
      },
    });
    expect(
      answer(
        'Will you now or in the future require sponsorship for work authorization?',
        [
          'No, I can work for any employer in the offer location without sponsorship',
          'Yes, I require sponsorship for work authorization in the offer location',
        ],
        citizen,
      ),
    ).toBe('No, I can work for any employer in the offer location without sponsorship');
    expect(
      answer(
        'Are you legally authorised to work full-time in the country where this job is based?',
        [
          'Yes, no restriction.',
          'Yes, but I will need sponsorship in the future.',
          'No, I need sponsorship now.',
        ],
        citizen,
      ),
    ).toBe('Yes, no restriction.');
  });

  it.each<[string, AuthKind | null]>([
    ['Do you opt-in to receive WhatsApp messages from Stripe Recruiting?', null],
    ['Would you like to receive communications via SMS? You can opt out at any time.', null],
    ['Veteran status (including National Guard)', null],
    ['What is your current visa status?', 'status'],
    ['Are you a U.S. citizen?', 'citizen'],
  ])('classifies %s', (label, kind) => {
    expect(classifyAuth(label)).toBe(kind);
  });
});

describe('postingCountry', () => {
  it.each([
    ['Belgrade', 'Serbia'],
    ['London', 'United Kingdom'],
    ['Dublin', 'Ireland'],
    ['Dublin, CA', 'United States'],
    ['Munich, DE', 'Germany'],
    ['Bangalore, IN', 'India'],
    ['Vancouver, WA', 'United States'],
    ['Vancouver, BC', 'Canada'],
    ['San Francisco; London', 'United States'],
    ['New York, NY (HQ)', 'United States'],
    ['Austin, TX', 'United States'],
    ['Remote - US', 'United States'],
    ['Tokyo, Japan', 'Japan'],
  ])('%s is in %s', (location, country) => {
    expect(postingCountry(location)).toBe(country);
  });

  it('says nothing for a region', () => {
    expect(postingCountry('EMEA')).toBeNull();
  });
});
