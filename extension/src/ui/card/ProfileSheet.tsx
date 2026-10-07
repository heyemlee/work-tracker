import { ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toBackground, type CardState, type ProfileDraft } from '../../messages';
import {
  EDUCATION_LEVELS,
  EEO_GENDERS,
  EEO_ORIENTATIONS,
  EEO_RACES,
  EEO_VETERAN,
  EEO_YES_NO,
  JOB_TYPES,
  profileSchema,
  type Education,
  type Experience,
  type Profile,
} from '../../profile/schema';
import type { MessageKey, Translate } from '../i18n';
import {
  ANSWER_SWITCHES,
  describeIssue,
  picks,
  PRONOUNS,
  SECTIONS,
  STATES,
  tidy,
  type Section,
} from './profileForm';
import { Track } from './Track';

const OPT: Profile['workAuthorization']['opt'][] = ['none', 'opt', 'stem'];

type Part = 'name' | 'address' | 'links' | 'workAuthorization' | 'eeo' | 'answers' | 'writing';
type Update = (change: (profile: Profile) => Profile) => void;

/**
 * The profile, edited where it's used: a window over the page, opened from the card. It's the same profile Outbox's
 * profile page edits, saved to Outbox, so either place shows what the other changed.
 */
export function ProfileSheet({
  t,
  dark,
  onClose,
  onSaved,
}: {
  t: Translate;
  dark: boolean;
  onClose: () => void;
  onSaved: (state: CardState) => void;
}) {
  const [loaded, setLoaded] = useState<ProfileDraft | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [section, setSection] = useState<Section>('personal');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // What stands in the way of a save, said beside the button.
  const [problem, setProblem] = useState<string | null>(null);
  // Asked to close with edits unsaved: asked once more before they're dropped.
  const [leaving, setLeaving] = useState(false);
  const fields = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let gone = false;
    toBackground('profile:load', {})
      .then((reply) => {
        if (gone || !reply) return;
        setLoaded(reply);
        setDraft(reply.profile);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, []);

  // Each section starts at its top.
  useEffect(() => {
    fields.current?.scrollTo({ top: 0 });
  }, [section]);

  const dirty = loaded !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(loaded.profile);
  const update: Update = (change) => {
    setDraft((profile) => (profile ? change(profile) : profile));
    setProblem(null);
    setSaved(false);
    setLeaving(false);
  };

  const close = () => {
    if (dirty && !leaving) setLeaving(true);
    else onClose();
  };

  const save = async () => {
    if (!draft || !loaded) return;
    setLeaving(false);
    const parsed = profileSchema.safeParse(tidy(draft));
    if (!parsed.success) {
      const [first] = parsed.error.issues;
      const where = describeIssue({ path: first?.path.map(String) ?? [], code: first?.code ?? '' }, t);
      setSection(where.section);
      setProblem(where.text);
      return;
    }
    setSaving(true);
    setProblem(null);
    const reply = await toBackground('profile:save', { profile: parsed.data }).catch(() => undefined);
    setSaving(false);
    if (!reply) setProblem(t('profile.unreachable'));
    else if (!reply.ok) {
      const [first] = reply.issues;
      if (first) {
        const where = describeIssue(first, t);
        setSection(where.section);
        setProblem(where.text);
      } else setProblem(t(reply.error === 'signedOut' ? 'profile.signedOut' : 'profile.unreachable'));
    } else {
      setLoaded({ ...loaded, profile: reply.profile, blank: false });
      setDraft(reply.profile);
      setSaved(true);
      if (reply.state) onSaved(reply.state);
    }
  };

  const offline = loaded && loaded.outbox !== 'connected';
  const status = leaving ? t('profile.unsaved') : (problem ?? (saved && !dirty ? t('profile.saved') : ''));

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={`sheet glass${dark ? ' dark' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('profile.title')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        <header className="sheet-head">
          <h1>{t('profile.title')}</h1>
          <button className="icon-button" onClick={close} aria-label={t('close')} title={t('close')}>
            <X size={14} />
          </button>
        </header>

        <div className="sheet-main">
          <Track className="sheet-nav" current={section} role="tablist" aria-orientation="vertical">
            {SECTIONS.map((name) => (
              <button
                key={name}
                data-key={name}
                role="tab"
                aria-selected={name === section}
                className="sheet-tab"
                onClick={() => setSection(name)}
              >
                {t(`profile.s.${name}`)}
              </button>
            ))}
          </Track>
          <div className="sheet-fields" ref={fields} role="tabpanel" aria-label={t(`profile.s.${section}`)}>
            {offline && (
              <div className="notice">
                <span>{t(loaded.outbox === 'signedOut' ? 'profile.signedOut' : 'profile.unreachable')}</span>
              </div>
            )}
            {draft ? (
              <Fields section={section} draft={draft} update={update} t={t} />
            ) : (
              <div className="sheet-wait">
                <span className="spinner" />
                {t('profile.loading')}
              </div>
            )}
          </div>
        </div>

        <footer className="sheet-foot">
          <span className={`sheet-status${problem || leaving ? ' bad' : ''}`} role="status">
            {status}
          </span>
          {leaving && (
            <button className="secondary" onClick={onClose}>
              {t('profile.discard')}
            </button>
          )}
          <button className="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t('profile.saving') : t('profile.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The fields of one section. */
function Fields({
  section,
  draft,
  update,
  t,
}: {
  section: Section;
  draft: Profile;
  update: Update;
  t: Translate;
}) {
  const patch = <P extends Part>(part: P, fields: Partial<Profile[P]>) =>
    update((profile) => ({ ...profile, [part]: { ...profile[part], ...fields } }));
  const { name, address, links, workAuthorization: auth, eeo, answers, writing } = draft;
  const f = (key: string) => t(`profile.f.${key}` as MessageKey);
  const options = <T extends string>(values: readonly T[], group: string) =>
    values.map((value) => ({ value, label: t(`profile.${group}.${value}` as MessageKey) }));
  const hint = t('profile.listHint');
  const remove = t('profile.remove');

  switch (section) {
    case 'personal':
      return (
        <>
          <Grid>
            <Text label={f('first')} value={name.first} onChange={(first) => patch('name', { first })} />
            <Text label={f('last')} value={name.last} onChange={(last) => patch('name', { last })} />
            <Text
              label={f('preferred')}
              value={name.preferred}
              onChange={(preferred) => patch('name', { preferred })}
            />
            <Text
              label={f('phone')}
              type="tel"
              value={draft.phone}
              onChange={(phone) => update((profile) => ({ ...profile, phone }))}
            />
            <Choice
              label={f('pronouns')}
              value={name.pronouns}
              options={picks(PRONOUNS, name.pronouns, t('profile.pronouns.none'))}
              onChange={(pronouns) => patch('name', { pronouns })}
            />
            <Text
              label={f('pronunciation')}
              value={name.pronunciation}
              onChange={(pronunciation) => patch('name', { pronunciation })}
            />
          </Grid>
          <Heading>{t('profile.h.address')}</Heading>
          <Grid>
            <Text
              wide
              label={f('line1')}
              value={address.line1}
              onChange={(line1) => patch('address', { line1 })}
            />
            <Text label={f('city')} value={address.city} onChange={(city) => patch('address', { city })} />
            <Choice
              label={f('state')}
              value={address.state}
              options={picks(STATES, address.state, '—')}
              onChange={(state) => patch('address', { state })}
            />
            <Text label={f('zip')} value={address.zip} onChange={(zip) => patch('address', { zip })} />
            <Text
              label={f('country')}
              value={address.country}
              onChange={(country) => patch('address', { country })}
            />
          </Grid>
          <Heading>{t('profile.h.links')}</Heading>
          <Grid>
            {(['linkedin', 'github', 'website', 'twitter'] as const).map((key) => (
              <Text
                key={key}
                type="url"
                label={f(key)}
                value={links[key]}
                onChange={(value) => patch('links', { [key]: value })}
              />
            ))}
          </Grid>
        </>
      );

    case 'auth':
      return (
        <>
          <Note>{t('profile.authNote')}</Note>
          <Grid>
            <List
              label={f('authorizedCountries')}
              hint={hint}
              value={auth.authorizedCountries}
              onChange={(authorizedCountries) => patch('workAuthorization', { authorizedCountries })}
            />
            <List
              label={f('citizenship')}
              hint={hint}
              value={auth.citizenship}
              onChange={(citizenship) => patch('workAuthorization', { citizenship })}
            />
            <Text
              label={f('status')}
              placeholder="F-1 STEM OPT"
              value={auth.status}
              onChange={(status) => patch('workAuthorization', { status })}
            />
            <Choice
              label={f('opt')}
              value={auth.opt}
              options={options(OPT, 'opt')}
              onChange={(opt) => patch('workAuthorization', { opt })}
            />
          </Grid>
          <Toggles>
            <Toggle
              label={f('sponsorshipNow')}
              checked={auth.sponsorshipNow}
              onChange={(sponsorshipNow) => patch('workAuthorization', { sponsorshipNow })}
            />
            <Toggle
              label={f('sponsorshipFuture')}
              checked={auth.sponsorshipFuture}
              onChange={(sponsorshipFuture) => patch('workAuthorization', { sponsorshipFuture })}
            />
          </Toggles>
        </>
      );

    case 'education':
      return (
        <>
          {draft.education.map((school, index) => {
            const set = (change: Partial<Education>) =>
              update((profile) => ({
                ...profile,
                education: profile.education.map((item, at) =>
                  at === index ? { ...item, ...change } : item,
                ),
              }));
            return (
              <Entry
                key={index}
                title={`${t('profile.s.education')} ${index + 1}`}
                remove={remove}
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
                    label={f('school')}
                    value={school.school}
                    onChange={(value) => set({ school: value })}
                  />
                  <Choice
                    label={f('level')}
                    value={school.level}
                    options={options(EDUCATION_LEVELS, 'level')}
                    onChange={(level) => set({ level })}
                  />
                  <Text label={f('degree')} value={school.degree} onChange={(degree) => set({ degree })} />
                  <Text label={f('field')} value={school.field} onChange={(field) => set({ field })} />
                  <Text label={f('gpa')} value={school.gpa} onChange={(gpa) => set({ gpa })} />
                  <Month label={f('start')} value={school.start} onChange={(start) => set({ start })} />
                  <Month label={f('end')} value={school.end} onChange={(end) => set({ end })} />
                  <Text
                    wide
                    label={f('location')}
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
          {/* A new job goes first: the latest one leads, as on a resume. */}
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
          {draft.experience.map((job, index) => {
            const set = (change: Partial<Experience>) =>
              update((profile) => ({
                ...profile,
                experience: profile.experience.map((item, at) =>
                  at === index ? { ...item, ...change } : item,
                ),
              }));
            return (
              <Entry
                key={index}
                title={`${t('profile.s.experience')} ${index + 1}`}
                remove={remove}
                onRemove={() =>
                  update((profile) => ({
                    ...profile,
                    experience: profile.experience.filter((_, at) => at !== index),
                  }))
                }
              >
                <Grid>
                  <Text label={f('company')} value={job.company} onChange={(company) => set({ company })} />
                  <Text label={f('jobTitle')} value={job.title} onChange={(title) => set({ title })} />
                  <Text
                    label={f('location')}
                    value={job.location}
                    onChange={(location) => set({ location })}
                  />
                  <Choice
                    label={f('type')}
                    value={job.type}
                    options={options(JOB_TYPES, 'type')}
                    onChange={(type) => set({ type })}
                  />
                  <Month
                    label={f('start')}
                    value={job.start || null}
                    onChange={(start) => set({ start: start ?? '' })}
                  />
                  <Month label={f('endCurrent')} value={job.end} onChange={(end) => set({ end })} />
                  <Area
                    wide
                    label={f('description')}
                    value={job.description}
                    onChange={(description) => set({ description })}
                  />
                </Grid>
              </Entry>
            );
          })}
        </>
      );

    case 'skills':
      return (
        <Grid>
          <List
            wide
            label={f('skills')}
            hint={hint}
            value={draft.skills}
            onChange={(skills) => update((profile) => ({ ...profile, skills }))}
          />
          <List
            wide
            label={f('languages')}
            hint={hint}
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
              label={f('gender')}
              value={eeo.gender}
              options={options(EEO_GENDERS, 'eeo')}
              onChange={(gender) => patch('eeo', { gender })}
            />
            <Choice
              label={f('hispanic')}
              value={eeo.hispanic}
              options={options(EEO_YES_NO, 'eeo')}
              onChange={(hispanic) => patch('eeo', { hispanic })}
            />
            <Choice
              label={f('race')}
              value={eeo.race}
              options={options(EEO_RACES, 'eeo')}
              onChange={(race) => patch('eeo', { race })}
            />
            <Choice
              label={f('veteran')}
              value={eeo.veteran}
              options={options(EEO_VETERAN, 'eeo')}
              onChange={(veteran) => patch('eeo', { veteran })}
            />
            <Choice
              label={f('disability')}
              value={eeo.disability}
              options={options(EEO_YES_NO, 'eeo')}
              onChange={(disability) => patch('eeo', { disability })}
            />
            <Choice
              label={f('orientation')}
              value={eeo.orientation}
              options={options(EEO_ORIENTATIONS, 'eeo')}
              onChange={(orientation) => patch('eeo', { orientation })}
            />
          </Grid>
        </>
      );

    case 'answers':
      return (
        <>
          <Grid>
            <Text
              label={f('salary')}
              value={answers.salary}
              onChange={(salary) => patch('answers', { salary })}
            />
            <Text
              label={f('earliestStart')}
              placeholder="Two weeks after an offer"
              value={answers.earliestStart}
              onChange={(earliestStart) => patch('answers', { earliestStart })}
            />
            <Count
              label={f('startInWeeks')}
              max={52}
              value={answers.startInWeeks}
              onChange={(weeks) => patch('answers', { startInWeeks: weeks ?? 0 })}
            />
            <Count
              label={f('yearsOfExperience')}
              max={60}
              placeholder={f('yearsAuto')}
              value={answers.yearsOfExperience}
              onChange={(yearsOfExperience) => patch('answers', { yearsOfExperience })}
            />
            <List
              wide
              label={f('howHeard')}
              hint={hint}
              value={answers.howHeard}
              onChange={(howHeard) => patch('answers', { howHeard })}
            />
            <List
              wide
              label={f('interviewedAt')}
              hint={hint}
              value={answers.interviewedAt}
              onChange={(interviewedAt) => patch('answers', { interviewedAt })}
            />
            <Text
              wide
              label={f('timeline')}
              value={answers.timeline}
              onChange={(timeline) => patch('answers', { timeline })}
            />
          </Grid>
          <Heading>{t('profile.h.consents')}</Heading>
          <Toggles>
            {ANSWER_SWITCHES.map((key) => (
              <Toggle
                key={key}
                label={f(key)}
                checked={answers[key]}
                onChange={(value) => patch('answers', { [key]: value })}
              />
            ))}
          </Toggles>
        </>
      );

    case 'writing':
      return (
        <>
          <Note>{t('profile.writingNote')}</Note>
          <Grid>
            <Area
              wide
              label={f('summary')}
              value={writing.summary}
              onChange={(summary) => patch('writing', { summary })}
            />
          </Grid>
          <Heading>{f('stories')}</Heading>
          {writing.stories.map((story, index) => {
            const set = (change: Partial<typeof story>) =>
              patch('writing', {
                stories: writing.stories.map((item, at) => (at === index ? { ...item, ...change } : item)),
              });
            return (
              <Entry
                key={index}
                title={`${f('stories')} ${index + 1}`}
                remove={remove}
                onRemove={() =>
                  patch('writing', { stories: writing.stories.filter((_, at) => at !== index) })
                }
              >
                <Grid>
                  <Text
                    wide
                    label={f('storyTitle')}
                    value={story.title}
                    onChange={(title) => set({ title })}
                  />
                  <Area wide label={f('storyText')} value={story.text} onChange={(text) => set({ text })} />
                </Grid>
              </Entry>
            );
          })}
          <Add onClick={() => patch('writing', { stories: [...writing.stories, { title: '', text: '' }] })}>
            {t('profile.addStory')}
          </Add>
          <Heading>{f('snippets')}</Heading>
          {writing.snippets.map((snippet, index) => (
            <Entry
              key={index}
              title={`${f('snippets')} ${index + 1}`}
              remove={remove}
              onRemove={() =>
                patch('writing', { snippets: writing.snippets.filter((_, at) => at !== index) })
              }
            >
              <Grid>
                <Area
                  wide
                  label={f('snippets')}
                  bare
                  value={snippet}
                  onChange={(value) =>
                    patch('writing', {
                      snippets: writing.snippets.map((item, at) => (at === index ? value : item)),
                    })
                  }
                />
              </Grid>
            </Entry>
          ))}
          <Add onClick={() => patch('writing', { snippets: [...writing.snippets, ''] })}>
            {t('profile.addSnippet')}
          </Add>
        </>
      );
  }
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid">{children}</div>;
const Heading = ({ children }: { children: ReactNode }) => <h2 className="sheet-heading">{children}</h2>;
const Note = ({ children }: { children: ReactNode }) => <p className="sheet-note">{children}</p>;
const Toggles = ({ children }: { children: ReactNode }) => <div className="toggles">{children}</div>;

function Field({
  label,
  wide,
  bare,
  children,
}: {
  label: string;
  wide?: boolean;
  /** The label is said, not shown: the entry's own title already names the field. */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span className={bare ? 'unseen' : undefined}>{label}</span>
      {children}
    </label>
  );
}

function Text({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'tel' | 'url';
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <Field label={label} wide={wide}>
      <input
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function Area({
  label,
  value,
  onChange,
  wide,
  bare,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
  bare?: boolean;
}) {
  return (
    <Field label={label} wide={wide} bare={bare}>
      <textarea
        className="input area"
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

const words = (text: string) =>
  text
    .split(/[,，、]/)
    .map((word) => word.trim())
    .filter(Boolean);

/** Comma-separated words. What's typed stays as typed; the words it makes go to the profile as it changes. */
function List({
  label,
  value,
  onChange,
  hint,
  wide,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint: string;
  wide?: boolean;
}) {
  const joined = value.join(', ');
  const [text, setText] = useState(joined);
  // The profile's words changed from outside this field (a save came back, an entry above was removed).
  const [seen, setSeen] = useState(joined);
  if (joined !== seen) {
    setSeen(joined);
    if (words(text).join(', ') !== joined) setText(joined);
  }
  return (
    <Field label={label} wide={wide}>
      <input
        className="input"
        value={text}
        placeholder={hint}
        onChange={(event) => {
          setText(event.target.value);
          const next = words(event.target.value);
          if (next.join(', ') !== joined) onChange(next);
        }}
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
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <span className="select">
        <select className="input" value={value} onChange={(event) => onChange(event.target.value as T)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} />
      </span>
    </Field>
  );
}

/** A month, or none: YYYY-MM as the profile keeps it. */
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
        className="input"
        type="month"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      />
    </Field>
  );
}

/** A number, or none where the profile takes none. */
function Count({
  label,
  value,
  onChange,
  max,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  max: number;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input
        className="input"
        type="number"
        min={0}
        max={max}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      />
    </Field>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}

/** One of several alike (a school, a job, a story), with a way to take it out. */
function Entry({
  title,
  remove,
  onRemove,
  children,
}: {
  title: string;
  remove: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="entry">
      <div className="entry-head">
        <span>{title}</span>
        <button type="button" className="ghost" onClick={onRemove}>
          {remove}
        </button>
      </div>
      {children}
    </div>
  );
}

function Add({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="add" onClick={onClick}>
      <Plus size={14} />
      {children}
    </button>
  );
}
