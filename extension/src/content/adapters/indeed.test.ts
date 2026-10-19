import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterFor } from './index';
import { indeed } from './indeed';

/** A page saved from Indeed, its JSON-LD kept (the shared loader drops every script). */
function page(name: string): Document {
  const doc = document.implementation.createHTMLDocument('');
  doc.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../../../test/fixtures/indeed', `${name}.html`),
    'utf8',
  )
    .replace(/^[\s\S]*?<html[^>]*>/i, '')
    .replace(/<\/html>[\s\S]*$/i, '');
  return doc;
}

const VIEWJOB = 'https://www.indeed.com/viewjob?jk=5a2e49e6872d0c2b';
const SEARCH = 'https://www.indeed.com/jobs?q=software+engineer&l=San+Jose%2C+CA&vjk=d501d1fd236f6dc3';

describe('indeed', () => {
  it('is the adapter for Indeed’s hosts, Indeed Apply’s among them, and no look-alike’s', () => {
    expect(adapterFor(VIEWJOB).ats).toBe('indeed');
    expect(adapterFor('https://ca.indeed.com/jobs?q=engineer').ats).toBe('indeed');
    expect(
      adapterFor('https://smartapply.indeed.com/beta/indeedapply/form/questions-module/questions/1').ats,
    ).toBe('indeed');
    expect(adapterFor('https://notindeed.com/viewjob?jk=5a2e49e6872d0c2b').ats).toBe('generic');
  });

  it('reads a job’s own page: the header, and the description without the style sheet inside it', () => {
    const posting = indeed.posting(page('viewjob'), VIEWJOB)!;
    expect(posting).toMatchObject({
      ats: 'indeed',
      title: 'Senior Director, Facilities & Engineering',
      company: 'US AMR-Jones Lang LaSalle Americas, Inc.',
      location: 'South San Francisco, CA 94080',
      url: VIEWJOB,
    });
    expect(posting.description).toMatch(/^JLL empowers you to shape a brighter way/);
    expect(posting.description).toContain('This position does not provide visa sponsorship.');
    expect(posting.description).not.toMatch(/@layer|padding-top/);
  });

  it('reads the job open beside a list, by its key: a company with no page of its own on Indeed too', () => {
    const doc = page('search');
    const posting = {
      title: 'Staff Software Engineer (SF)',
      company: 'Ode with Anthropic',
      location: 'San Jose, CA',
    };
    const own = 'https://www.indeed.com/viewjob?jk=d501d1fd236f6dc3';
    expect(indeed.posting(doc, SEARCH)).toMatchObject({ ...posting, url: own });
    // Just loaded, the address names no job: the list says which one is open. Its look-alike row
    // (abcdef0123456789), shown to no one, isn't it.
    expect(indeed.posting(doc, 'https://www.indeed.com/jobs?q=software+engineer')).toMatchObject({
      ...posting,
      url: own,
    });
  });

  it('keeps title and link one job’s while the address has moved on and the header not yet', () => {
    const doc = page('viewjob');
    // The list beside it picked another job a moment ago: the header still shows this one, and links its company
    // from it.
    expect(indeed.posting(doc, 'https://www.indeed.com/jobs?q=engineer&vjk=0123456789abcdef')).toMatchObject({
      title: 'Senior Director, Facilities & Engineering',
      url: VIEWJOB,
    });
  });

  it('goes by the page’s JobPosting markup where the header isn’t drawn as expected', () => {
    const doc = page('viewjob');
    doc.querySelector('[data-testid="desktop-job-header"]')!.remove();
    doc.querySelector('.react-native-html-content')!.remove();
    expect(indeed.posting(doc, VIEWJOB)).toMatchObject({
      title: 'Senior Director, Facilities & Engineering',
      company: 'US AMR-Jones Lang LaSalle Americas, Inc.',
      location: 'South San Francisco, CA',
      url: VIEWJOB,
      description:
        'JLL empowers you to shape a brighter way. This position does not provide visa sponsorship.',
    });
  });

  it('reads no posting where none is on show: Indeed Apply’s steps, a list with none open', () => {
    const doc = document.implementation.createHTMLDocument('Indeed Apply');
    doc.body.innerHTML =
      '<main><h1>Answer these questions from the employer</h1><form><label for="q">Years of experience</label>' +
      '<input id="q"></form></main>';
    expect(
      indeed.posting(doc, 'https://smartapply.indeed.com/beta/indeedapply/form/questions-module/questions/1'),
    ).toBeNull();
  });

  it('tells Indeed Apply’s steps, which go on with the tab’s posting, from Indeed’s own pages', () => {
    const doc = page('viewjob');
    expect(
      indeed.boardApplying!(
        doc,
        'https://smartapply.indeed.com/beta/indeedapply/form/questions-module/questions/1',
      ),
    ).toBe(true);
    expect(indeed.boardApplying!(doc, VIEWJOB)).toBe(false);
    expect(indeed.boardApplying!(doc, SEARCH)).toBe(false);
  });

  it('fills nothing, sends nothing and tells no confirmation: Indeed’s terms forbid automating Indeed Apply', () => {
    const doc = page('viewjob');
    expect(indeed.form(doc)).toBeNull();
    expect(indeed.submitButton(doc)).toBeNull();
    expect(indeed.confirmed(doc, VIEWJOB)).toBe(false);
  });
});
