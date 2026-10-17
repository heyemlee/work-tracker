import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { applyAnswer, readAnswer } from '../apply';
import { extractFields } from '../extract';
import { heldBy } from '../held';
import { shadowElements } from './shared';
import { smartrecruiters as adapter } from './smartrecruiters';

function page(name: string) {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../../../test/fixtures/new-ats', `${name}.html`),
    'utf8',
  );
  function hydrate(root: ParentNode) {
    for (const t of root.querySelectorAll<HTMLTemplateElement>('template[data-shadow]')) {
      const s = t.parentElement!.attachShadow({ mode: 'open' });
      s.append(t.content.cloneNode(true));
      t.remove();
      hydrate(s);
    }
  }
  hydrate(doc);
  return doc;
}
const apply = (handle: Parameters<typeof applyAnswer>[0], answer: Parameters<typeof applyAnswer>[1]) =>
  applyAnswer(handle, answer, async () => null);

it('maps role and credential fields to their own entry, excluding calendar internals and header location', async () => {
  const doc = page('smartrecruiters-entries');
  const { fields, handles } = extractFields(adapter, doc, 0);
  expect(fields).toHaveLength(13);
  expect(fields.filter((f) => f.entry?.kind === 'experience')).toHaveLength(7);
  expect(fields.filter((f) => f.entry?.kind === 'experience').every((f) => f.entry?.index === 1)).toBe(true);
  expect(fields.filter((f) => f.entry?.kind === 'education').every((f) => f.entry?.index === 0)).toBe(true);
  expect(fields.some((f) => f.hint === 'location')).toBe(false);
  expect(fields.find((f) => f.label === 'School location')?.hint).toBeNull();
  expect(fields.find((f) => f.hint === 'education.field')?.label).toBe('Major');
  const date = fields.find((f) => f.hint === 'experience.start')!;
  const handle = handles.get(date.id)!;
  const blur = vi.fn();
  if (handle.type === 'input') handle.element.addEventListener('blur', blur);
  expect(await apply(handle, { type: 'date', iso: '2024-05-01' })).toMatchObject({
    ok: true,
    value: 'May 2024',
  });
  expect(blur).toHaveBeenCalled();
  expect(heldBy(handle)).toMatchObject({ filled: true, value: 'May 2024' });
  expect(adapter.submitButton(doc)).toBeNull(); // Neither an entry Save nor Next submits the application.
});

it('opens only the first empty editor and never saves or advances a populated section', async () => {
  const doc = page('smartrecruiters-entries');
  const root = adapter.form(doc)!;
  const experience = root.querySelector('oc-experience')!;
  const editor = experience.querySelector('oc-experience-entry')!.cloneNode(true);
  experience.querySelectorAll('oc-experience-entry').forEach((e) => e.remove());
  const add = experience.querySelector<HTMLElement>('[data-test="add-experience"]')!;
  const click = vi.fn(() => {
    const e = editor.cloneNode(true) as Element;
    e.append(doc.createElement('oc-experience-edit-form'));
    experience.append(e);
  });
  add.onclick = click;
  const save = vi.fn();
  root.addEventListener('submit', save);
  expect(await adapter.prepare!(root, { experience: 3, education: 2 })).toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
  expect(await adapter.prepare!(root, { experience: 3, education: 2 })).toBe(false);
  expect(click).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});

it('extracts labelled standard screening controls and handles opaque radio values', async () => {
  const doc = page('smartrecruiters-screening');
  const { fields, handles } = extractFields(adapter, doc, 0);
  expect(fields).toHaveLength(6);
  expect(fields.some((f) => /Hidden/.test(f.label))).toBe(false);
  expect(fields.find((f) => f.kind === 'radio')).toMatchObject({
    label: 'Will you require visa sponsorship?',
    required: true,
    options: ['Yes', 'No'],
  });
  expect(fields.find((f) => f.label.startsWith('Which working'))?.required).toBe(true);
  const radio = handles.get(fields.find((f) => f.kind === 'radio')!.id)!;
  expect(await apply(radio, { type: 'choice', want: { kind: 'no' }, option: 'No' })).toMatchObject({
    ok: true,
    value: 'No',
  });
  expect(readAnswer(radio)).toMatchObject({ option: 'No' });
  expect(adapter.step!(doc)).toBe('Screening questions');
  expect(adapter.submitButton(doc)).toBe(doc.querySelector('[data-test="footer-submit"]'));
});

it('selects multiple exact choices, tracks tag removal and never falls back to an unrelated option', async () => {
  const doc = page('smartrecruiters-screening');
  const host = doc.querySelector('spl-multiselect-autocomplete')!;
  const input = shadowElements<HTMLInputElement>(host, 'input')[0]!;
  const menu = host.shadowRoot!.querySelector('[role="listbox"]')!;
  const tags = host.shadowRoot!.querySelector('[data-test="local-selected-tags"]')!;
  input.oninput = () => {
    menu.innerHTML = ['Engineering', 'Research', 'Engineering Management']
      .map(
        (label) =>
          `<spl-autocomplete-option role="option" label="${label}">${label}</spl-autocomplete-option>`,
      )
      .join('');
    for (const option of menu.children)
      (option as HTMLElement).onclick = () => {
        const tag = doc.createElement('spl-tag');
        tag.setAttribute('label', option.getAttribute('label')!);
        tags.append(tag);
        input.value = '';
        menu.innerHTML = '';
      };
  };
  const { fields, handles } = extractFields(adapter, doc, 0);
  const field = fields.find((f) => f.kind === 'multi')!;
  const handle = handles.get(field.id)!;
  expect(await apply(handle, { type: 'choices', texts: ['Engineering', 'Research'] })).toMatchObject({
    ok: true,
    value: 'Engineering, Research',
  });
  expect(heldBy(handle)).toMatchObject({ filled: true, value: 'Engineering, Research' });
  expect(await apply(handle, { type: 'choices', texts: ['Engineering'] })).toMatchObject({ ok: true });
  expect(tags.children).toHaveLength(2); // Existing choices are never toggled off or duplicated.
  tags.innerHTML = '';
  expect(heldBy(handle)).toEqual({ filled: false });
  expect(await apply(handle, { type: 'choices', texts: ['Management'] })).toMatchObject({ ok: false });
  expect(tags.children).toHaveLength(0);
}, 10_000); // Includes the real asynchronous suggestion timeout on the no-match path.
