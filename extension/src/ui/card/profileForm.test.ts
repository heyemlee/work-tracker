import { describe, expect, it } from 'vitest';
import { makeProfile } from '../../test/profiles';
import { translator } from '../i18n';
import { findOption } from '../../text';
import { describeIssue, picks, PRONOUNS, STATES, tidy } from './profileForm';

const t = translator('en');

describe('tidy', () => {
  it('drops entries added and left blank, and keeps one with anything in it', () => {
    const profile = makeProfile();
    const draft = {
      ...profile,
      education: [
        ...profile.education,
        // "Add school", then nothing: the level is the form's default, not something the owner entered.
        {
          school: '',
          degree: '',
          level: 'bachelor' as const,
          field: '',
          start: null,
          end: null,
          gpa: '',
          location: '',
        },
        {
          school: '',
          degree: 'BS',
          level: 'bachelor' as const,
          field: '',
          start: null,
          end: null,
          gpa: '',
          location: '',
        },
      ],
      experience: [
        {
          company: '',
          title: '',
          location: '',
          start: '',
          end: null,
          type: 'full-time' as const,
          description: '',
        },
        ...profile.experience,
      ],
      writing: {
        ...profile.writing,
        stories: [...profile.writing.stories, { title: ' ', text: '' }],
        snippets: [...profile.writing.snippets, '  '],
      },
    };
    const tidied = tidy(draft);
    expect(tidied.education).toHaveLength(profile.education.length + 1);
    expect(tidied.education.at(-1)?.degree).toBe('BS');
    expect(tidied.experience).toEqual(profile.experience);
    expect(tidied.writing).toEqual(profile.writing);
  });
});

describe('describeIssue', () => {
  it.each([
    [['name', 'first'], 'too_small', 'personal', 'Legal first name is required'],
    [['education', 1, 'school'], 'too_small', 'education', 'Education 2 · School is required'],
    [['experience', 0, 'start'], 'invalid_format', 'experience', 'Work experience 1 · Start isn’t valid'],
    [['answers', 'startInWeeks'], 'too_big', 'answers', 'Weeks until you can start isn’t valid'],
    [['writing', 'stories', 0, 'title'], 'too_small', 'writing', 'Stories (STAR) 1 · Title is required'],
  ] as const)('says where %j stands, and in which section', (path, code, section, text) => {
    expect(describeIssue({ path: [...path], code }, t)).toEqual({ section, text });
  });
});

describe('picks', () => {
  it('offers none, the usual values, and a value typed on Outbox that isn’t among them', () => {
    expect(picks(PRONOUNS, '', 'Prefer not to say').map((option) => option.value)).toEqual([
      '',
      'He/him',
      'She/her',
      'They/them',
    ]);
    expect(picks(PRONOUNS, 'Ze/zir', 'Prefer not to say').at(-1)).toEqual({
      value: 'Ze/zir',
      label: 'Ze/zir',
    });
    expect(picks(STATES, 'CA', '—')).toHaveLength(52);
    expect(picks(STATES, 'CA', '—')).toContainEqual({ value: 'CA', label: 'California (CA)' });
  });

  it('keeps pronouns in the form that finds a form’s longer option', () => {
    const offered = ['He/him/his', 'She/her/hers', 'They/them/theirs', 'I prefer not to say'];
    expect(PRONOUNS.map((pronouns) => findOption(offered, [pronouns]))).toEqual(offered.slice(0, 3));
  });
});
