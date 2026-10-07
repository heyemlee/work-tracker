import { describe, expect, it } from 'vitest';
import { makeProfile } from '../../test/profiles';
import { translator } from '../i18n';
import { describeIssue, tidy } from './profileForm';

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
