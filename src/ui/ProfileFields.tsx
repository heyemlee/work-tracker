import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  EDUCATION_LEVELS,
  EEO_GENDERS,
  EEO_ORIENTATIONS,
  EEO_RACES,
  EEO_VETERAN,
  EEO_YES_NO,
  JOB_TYPES,
  type Education,
  type Experience,
  type Profile,
} from '../domain/profile';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/messages';
import { Switch } from './primitives';
import type { ProfileSection } from './profileSections';

const OPT: Profile['workAuthorization']['opt'][] = ['none', 'opt', 'stem'];
const ANSWER_SWITCHES = [
  'relocate',
  'onsite',
  'over18',
  'nonCompete',
  'governmentOfficial',
  'relativeOfGovernmentOfficial',
  'securityClearance',
  'contactCurrentEmployer',
  'emailOptIn',
  'smsOptIn',
] as const;

type Part = 'name' | 'address' | 'links' | 'workAuthorization' | 'eeo' | 'answers' | 'writing';
export type Update = (change: (profile: Profile) => Profile) => void;

/** The fields of one section of the profile. */
export function SectionBody({
  section,
  draft,
  update,
}: {
  section: ProfileSection;
  draft: Profile;
  update: Update;
}) {
  const { t } = useI18n();
  const patch = <P extends Part>(part: P, fields: Partial<Profile[P]>) =>
    update((profile) => ({ ...profile, [part]: { ...profile[part], ...fields } }));
  const { name, address, links, workAuthorization: auth, eeo, answers, writing } = draft;
  const eeoLabel = (value: string) => t(`profile.eeo.${value}` as MessageKey);

  switch (section) {
    case 'basics':
      return (
        <Grid>
          <Text
            label={t('profile.f.first')}
            value={name.first}
            onChange={(first) => patch('name', { first })}
          />
          <Text label={t('profile.f.last')} value={name.last} onChange={(last) => patch('name', { last })} />
          <Text
            label={t('profile.f.preferred')}
            value={name.preferred}
            onChange={(preferred) => patch('name', { preferred })}
          />
          <Text
            label={t('profile.f.pronouns')}
            value={name.pronouns}
            onChange={(pronouns) => patch('name', { pronouns })}
          />
          <Text
            label={t('profile.f.pronunciation')}
            value={name.pronunciation}
            onChange={(pronunciation) => patch('name', { pronunciation })}
          />
          <Text
            label={t('profile.f.phone')}
            type="tel"
            value={draft.phone}
            onChange={(phone) => update((profile) => ({ ...profile, phone }))}
          />
        </Grid>
      );

    case 'address':
      return (
        <Grid>
          <Text
            wide
            label={t('profile.f.line1')}
            value={address.line1}
            onChange={(line1) => patch('address', { line1 })}
          />
          <Text
            label={t('profile.f.city')}
            value={address.city}
            onChange={(city) => patch('address', { city })}
          />
          <Text
            label={t('profile.f.state')}
            value={address.state}
            onChange={(state) => patch('address', { state })}
          />
          <Text
            label={t('profile.f.zip')}
            value={address.zip}
            onChange={(zip) => patch('address', { zip })}
          />
          <Text
            label={t('profile.f.country')}
            value={address.country}
            onChange={(country) => patch('address', { country })}
          />
        </Grid>
      );

    case 'links':
      return (
        <Grid>
          {(['linkedin', 'github', 'website', 'twitter'] as const).map((key) => (
            <Text
              key={key}
              type="url"
              label={t(`profile.f.${key}`)}
              value={links[key]}
              onChange={(value) => patch('links', { [key]: value })}
            />
          ))}
        </Grid>
      );

    case 'auth':
      return (
        <>
          <Note>{t('profile.authNote')}</Note>
          <Grid>
            <List
              label={t('profile.f.authorizedCountries')}
              value={auth.authorizedCountries}
              onChange={(authorizedCountries) => patch('workAuthorization', { authorizedCountries })}
            />
            <List
              label={t('profile.f.citizenship')}
              value={auth.citizenship}
              onChange={(citizenship) => patch('workAuthorization', { citizenship })}
            />
            <Text
              label={t('profile.f.status')}
              placeholder="F-1 STEM OPT"
              value={auth.status}
              onChange={(status) => patch('workAuthorization', { status })}
            />
            <Choice
              label={t('profile.f.opt')}
              value={auth.opt}
              options={OPT.map((value) => ({ value, label: t(`profile.opt.${value}`) }))}
              onChange={(opt) => patch('workAuthorization', { opt })}
            />
          </Grid>
          <Toggle
            label={t('profile.f.sponsorshipNow')}
            checked={auth.sponsorshipNow}
            onChange={(sponsorshipNow) => patch('workAuthorization', { sponsorshipNow })}
          />
          <Toggle
            label={t('profile.f.sponsorshipFuture')}
            checked={auth.sponsorshipFuture}
            onChange={(sponsorshipFuture) => patch('workAuthorization', { sponsorshipFuture })}
          />
        </>
      );

    case 'education':
      return (
        <>
          {draft.education.map((school, index) => {
            const set = (fields: Partial<Education>) =>
              update((profile) => ({
                ...profile,
                education: profile.education.map((item, at) =>
                  at === index ? { ...item, ...fields } : item,
                ),
              }));
            return (
              <Entry
                key={index}
                onRemove={() =>
                  update((profile) => ({
                    ...profile,
                    education: profile.education.filter((_, at) => at !== index),
                  }))
                }
              >
                <Grid>
                  <Text
                    wide
                    label={t('profile.f.school')}
                    value={school.school}
                    onChange={(value) => set({ school: value })}
                  />
                  <Choice
                    label={t('profile.f.level')}
                    value={school.level}
                    options={EDUCATION_LEVELS.map((value) => ({ value, label: t(`profile.level.${value}`) }))}
                    onChange={(level) => set({ level })}
                  />
                  <Text
                    label={t('profile.f.degree')}
                    value={school.degree}
                    onChange={(degree) => set({ degree })}
                  />
                  <Text
                    label={t('profile.f.field')}
                    value={school.field}
                    onChange={(field) => set({ field })}
                  />
                  <Text label={t('profile.f.gpa')} value={school.gpa} onChange={(gpa) => set({ gpa })} />
                  <Month
                    label={t('profile.f.start')}
                    value={school.start}
                    onChange={(start) => set({ start })}
                  />
                  <Month label={t('profile.f.end')} value={school.end} onChange={(end) => set({ end })} />
                  <Text
                    label={t('profile.f.location')}
                    value={school.location}
                    onChange={(location) => set({ location })}
                  />
                </Grid>
              </Entry>
            );
          })}
          <Add
            onClick={() =>
              update((profile) => ({
                ...profile,
                education: [
                  ...profile.education,
                  {
                    school: '',
                    degree: '',
                    level: 'bachelor',
                    field: '',
                    start: null,
                    end: null,
                    gpa: '',
                    location: '',
                  },
                ],
              }))
            }
          >
            {t('profile.addEducation')}
          </Add>
        </>
      );

    case 'experience':
      return (
        <>
          {draft.experience.map((job, index) => {
            const set = (fields: Partial<Experience>) =>
              update((profile) => ({
                ...profile,
                experience: profile.experience.map((item, at) =>
                  at === index ? { ...item, ...fields } : item,
                ),
              }));
            return (
              <Entry
                key={index}
                onRemove={() =>
                  update((profile) => ({
                    ...profile,
                    experience: profile.experience.filter((_, at) => at !== index),
                  }))
                }
              >
                <Grid>
                  <Text
                    label={t('profile.f.company')}
                    value={job.company}
                    onChange={(company) => set({ company })}
                  />
                  <Text
                    label={t('profile.f.jobTitle')}
                    value={job.title}
                    onChange={(title) => set({ title })}
                  />
                  <Text
                    label={t('profile.f.location')}
                    value={job.location}
                    onChange={(location) => set({ location })}
                  />
                  <Choice
                    label={t('profile.f.type')}
                    value={job.type}
                    options={JOB_TYPES.map((value) => ({ value, label: t(`profile.type.${value}`) }))}
                    onChange={(type) => set({ type })}
                  />
                  <Month
                    label={t('profile.f.start')}
                    value={job.start || null}
                    onChange={(start) => set({ start: start ?? '' })}
                  />
                  <Month label={t('profile.f.endCurrent')} value={job.end} onChange={(end) => set({ end })} />
                  <Area
                    wide
                    label={t('profile.f.description')}
                    value={job.description}
                    onChange={(description) => set({ description })}
                  />
                </Grid>
              </Entry>
            );
          })}
          <Add
            onClick={() =>
              update((profile) => ({
                ...profile,
                experience: [
                  {
                    company: '',
                    title: '',
                    location: '',
                    start: '',
                    end: null,
                    type: 'full-time',
                    description: '',
                  },
                  ...profile.experience,
                ],
              }))
            }
          >
            {t('profile.addExperience')}
          </Add>
        </>
      );

    case 'skills':
      return (
        <Grid>
          <List
            wide
            label={t('profile.f.skills')}
            value={draft.skills}
            onChange={(skills) => update((profile) => ({ ...profile, skills }))}
          />
          <List
            wide
            label={t('profile.f.languages')}
            value={draft.languages}
            onChange={(languages) => update((profile) => ({ ...profile, languages }))}
          />
        </Grid>
      );

    case 'eeo':
      return (
        <>
          <Note>{t('profile.eeoNote')}</Note>
          <Grid>
            <Choice
              label={t('profile.f.gender')}
              value={eeo.gender}
              options={EEO_GENDERS.map((value) => ({ value, label: eeoLabel(value) }))}
              onChange={(gender) => patch('eeo', { gender })}
            />
            <Choice
              label={t('profile.f.hispanic')}
              value={eeo.hispanic}
              options={EEO_YES_NO.map((value) => ({ value, label: eeoLabel(value) }))}
              onChange={(hispanic) => patch('eeo', { hispanic })}
            />
            <Choice
              label={t('profile.f.race')}
              value={eeo.race}
              options={EEO_RACES.map((value) => ({ value, label: eeoLabel(value) }))}
              onChange={(race) => patch('eeo', { race })}
            />
            <Choice
              label={t('profile.f.veteran')}
              value={eeo.veteran}
              options={EEO_VETERAN.map((value) => ({ value, label: eeoLabel(value) }))}
              onChange={(veteran) => patch('eeo', { veteran })}
            />
            <Choice
              label={t('profile.f.disability')}
              value={eeo.disability}
              options={EEO_YES_NO.map((value) => ({ value, label: eeoLabel(value) }))}
              onChange={(disability) => patch('eeo', { disability })}
            />
            <Choice
              label={t('profile.f.orientation')}
              value={eeo.orientation}
              options={EEO_ORIENTATIONS.map((value) => ({ value, label: eeoLabel(value) }))}
              onChange={(orientation) => patch('eeo', { orientation })}
            />
            <Choice
              label={t('profile.f.transgender')}
              value={eeo.transgender}
              options={EEO_YES_NO.map((value) => ({ value, label: eeoLabel(value) }))}
              onChange={(transgender) => patch('eeo', { transgender })}
            />
          </Grid>
        </>
      );

    case 'answers':
      return (
        <>
          <Grid>
            <Text
              label={t('profile.f.salary')}
              value={answers.salary}
              onChange={(salary) => patch('answers', { salary })}
            />
            <Text
              label={t('profile.f.earliestStart')}
              placeholder="Two weeks after an offer"
              value={answers.earliestStart}
              onChange={(earliestStart) => patch('answers', { earliestStart })}
            />
            <Count
              label={t('profile.f.startInWeeks')}
              value={answers.startInWeeks}
              onChange={(weeks) => patch('answers', { startInWeeks: weeks ?? 0 })}
            />
            <Count
              label={t('profile.f.years')}
              placeholder={t('profile.f.yearsAuto')}
              value={answers.yearsOfExperience}
              onChange={(yearsOfExperience) => patch('answers', { yearsOfExperience })}
            />
            <List
              wide
              label={t('profile.f.howHeard')}
              value={answers.howHeard}
              onChange={(howHeard) => patch('answers', { howHeard })}
            />
            <List
              wide
              label={t('profile.f.interviewedAt')}
              value={answers.interviewedAt}
              onChange={(interviewedAt) => patch('answers', { interviewedAt })}
            />
            <Text
              wide
              label={t('profile.f.timeline')}
              value={answers.timeline}
              onChange={(timeline) => patch('answers', { timeline })}
            />
          </Grid>
          {ANSWER_SWITCHES.map((key) => (
            <Toggle
              key={key}
              label={t(`profile.f.${key}`)}
              checked={answers[key]}
              onChange={(value) => patch('answers', { [key]: value })}
            />
          ))}
        </>
      );

    case 'writing':
      return (
        <>
          <Note>{t('profile.writingNote')}</Note>
          <Area
            label={t('profile.f.summary')}
            value={writing.summary}
            onChange={(summary) => patch('writing', { summary })}
          />
          <Label>{t('profile.f.stories')}</Label>
          {writing.stories.map((story, index) => {
            const set = (fields: Partial<typeof story>) =>
              patch('writing', {
                stories: writing.stories.map((item, at) => (at === index ? { ...item, ...fields } : item)),
              });
            return (
              <Entry
                key={index}
                onRemove={() =>
                  patch('writing', { stories: writing.stories.filter((_, at) => at !== index) })
                }
              >
                <Text
                  label={t('profile.f.storyTitle')}
                  value={story.title}
                  onChange={(title) => set({ title })}
                />
                <Area
                  label={t('profile.f.storyText')}
                  value={story.text}
                  onChange={(text) => set({ text })}
                />
              </Entry>
            );
          })}
          <Add onClick={() => patch('writing', { stories: [...writing.stories, { title: '', text: '' }] })}>
            {t('profile.addStory')}
          </Add>
          <Label>{t('profile.f.snippets')}</Label>
          {writing.snippets.map((snippet, index) => (
            <Entry
              key={index}
              onRemove={() =>
                patch('writing', { snippets: writing.snippets.filter((_, at) => at !== index) })
              }
            >
              <Area
                label={t('profile.f.snippets')}
                hideLabel
                value={snippet}
                onChange={(value) =>
                  patch('writing', {
                    snippets: writing.snippets.map((item, at) => (at === index ? value : item)),
                  })
                }
              />
            </Entry>
          ))}
          <Add onClick={() => patch('writing', { snippets: [...writing.snippets, ''] })}>
            {t('profile.addSnippet')}
          </Add>
        </>
      );
  }
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-fg-3">{children}</p>;
}

function Label({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-[12px] font-medium text-fg-2">{children}</p>;
}

const INPUT =
  'w-full rounded-[10px] bg-fill px-2.5 text-[14px] outline-none placeholder:text-fg-3 focus:bg-fill-2';

function Field({
  label,
  wide,
  hideLabel,
  children,
}: {
  label: string;
  wide?: boolean;
  hideLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={clsx('block min-w-0', wide && 'sm:col-span-2')}>
      <span className={clsx('mb-1 block text-[12px] text-fg-2', hideLabel && 'sr-only')}>{label}</span>
      {children}
    </label>
  );
}

export function Text({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'tel' | 'url';
  wide?: boolean;
}) {
  return (
    <Field label={label} wide={wide}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(INPUT, 'h-9')}
      />
    </Field>
  );
}

function Area({
  label,
  value,
  onChange,
  wide,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <Field label={label} wide={wide} hideLabel={hideLabel}>
      <textarea
        value={value}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(INPUT, 'resize-y py-2 leading-snug')}
      />
    </Field>
  );
}

/** Comma-separated words, kept as typed until the field loses focus. */
function List({
  label,
  value,
  onChange,
  wide,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const joined = value.join(', ');
  return (
    <Field label={label} wide={wide}>
      <input
        key={joined}
        defaultValue={joined}
        placeholder={t('profile.listHint')}
        onBlur={(event) => {
          const next = event.target.value
            .split(/[,，、]/)
            .map((item) => item.trim())
            .filter(Boolean);
          if (next.join(', ') !== joined) onChange(next);
        }}
        className={clsx(INPUT, 'h-9')}
      />
    </Field>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={clsx(INPUT, 'h-9')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** YYYY-MM, or null when empty. */
function Month({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="month"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className={clsx(INPUT, 'h-9')}
      />
    </Field>
  );
}

/** A whole number, or null when empty. */
function Count({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={0}
        max={60}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
        className={clsx(INPUT, 'h-9')}
      />
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-[12px] bg-fill px-3 py-1.5">
      <span className="text-[14px]">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
    </div>
  );
}

function Entry({ onRemove, children }: { onRemove: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2 rounded-[16px] bg-fill p-3 pt-2">
      <div className="flex justify-end">
        <button
          type="button"
          aria-label={t('profile.remove')}
          title={t('profile.remove')}
          onClick={onRemove}
          className="grid size-7 place-items-center rounded-full text-fg-3 transition-colors hover:bg-fill-2 hover:text-danger"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function Add({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-fill hover:text-fg"
    >
      <Plus className="size-4" aria-hidden="true" />
      {children}
    </button>
  );
}
