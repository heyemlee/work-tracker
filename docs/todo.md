# To do

Work that is deferred or not done yet. Decisions and their reasons live in [design.md](design.md).

## Redesign (decided and built 2026-09-28)

After a look at Jobright, Simplify, Teal and Huntr: labelled pages, a first-run guide, and numbers that say what
works. Still the single column and the floating glass toolbar; still the owner's own app. One release.

### Navigation and pages

- [x] Pages with their own addresses: Applications `/`, Resumes `/resumes`, Profile `/profile`, Insights
      `/insights`, the guide `/welcome`. Leaving the profile with unsaved edits asks first.
- [x] Toolbar: Applications · Resumes · Profile · Insights, labelled, the profile's blanks counted on its tab;
      search; the extension's status as a dot (connected, needs a key, not installed) that explains itself; New;
      an account menu with Settings, language, CSV export, the setup guide and sign-out.
- [x] The status filter moves above the list, with a count on each segment.
- [x] Phones: a glass tab bar at the bottom and a round New button beside it.
- [x] Profile page, from the panel: a completeness score weighted by what forms ask, each blank a link to its
      section.
- [x] Resumes page, from the panel: each version's uses and OA rate, and which one new applications default to.
- [x] Settings stays a dialog and gains the daily goal.

### First run

- [x] A guide at `/welcome`, six steps, each skippable: emails, resumes, the extension and its key, reading a
      resume into the profile, work authorization with preferences and EEO, done (with the daily goal). It opens
      by itself for an owner with no accounts and no jobs, and from the account menu.
- [x] Setup checklist on the home page: the guide's steps, ending with the first application logged by the
      extension. Hiding it once hides it for 7 days, twice for good.

### Numbers

- [x] Stats row: today against the daily goal (30 by default, none if left empty), the last 7 days, active OAs,
      and the OA rate over 30 days.
- [x] Insights page, for 7 days, 30 days or everything: the funnel, applications per day against the goal, and the
      OA rate by resume version, account and channel.
- [x] No reply: an application still at Applied after 30 days, shown faded and counted apart. Worked out, not
      stored.

### Extension

- [x] Bridge: Outbox can open the extension's settings, and learns its version and whether it has logged an
      application.
- [x] Card on a posting without a form: Save for later (a saved job) and Mark as applied; LinkedIn keeps Mark as
      applied first. A saved posting says so when it's opened again. Undo.

### Quality and docs

- [x] Unit tests for the new domain code, the bridge and saving from the card; the extension's e2e specs pass.
- [x] design.md, autofill.md and the README describe the new pages and the guide.
- [x] Shown locally, then deployed on 2026-09-28 (version 23065acd). No migration: nothing stored changed.

## Autofill extension (decided and built 2026-09-27)

One release with everything below, no MVP. Design: [autofill.md](autofill.md).

### Foundation

- [x] `extension/` as an npm workspace: WXT, React 19, Tailwind v4, strict TypeScript; `src/domain` shared through an
      alias.
- [x] Root scripts and CI run the extension's typecheck, lint, format check, tests, build and end-to-end tests.
- [x] Storage: `chrome.storage.local` for the profile, settings, remembered answers and usage; IndexedDB for resume
      PDFs.
- [x] Typed messages between the frames' content scripts, the card, the options page and the service worker.

### Profile and resumes

- [x] Profile schema (zod, versioned).
- [x] Draft `~/Desktop/job-search/autofill-profile.json` from the resume and `profile.md`.
- [x] Edit the profile on Outbox, stored in D1 and synced by the extension (decided 2026-09-27, replacing the JSON
      import on the options page).
- [x] Its own panel from the toolbar's profile button (in place of the language toggle, which Settings already has):
      a section list on wide screens, collapsible sections on phones, dots where something is still empty.
- [x] Fill from a resume PDF: read by the extension with the owner's key, previewed, contact details only where
      empty; never work authorization, EEO or preferences.
- [x] Options page: import and validate the profile, list what's missing.
- [x] Resumes on Outbox, in their own panel from the toolbar (decided 2026-09-28, replacing the options page's PDFs
      and Settings' resume versions): upload, rename, open, replace, delete, fill the profile from one. PDFs in D1
      as base64; the extension downloads the one it attaches and keeps a copy.

### Reading the page

- [x] Detect the applicant-tracking system from the host and the DOM, embedded iframes included, and whether the
      page is an application form.
- [x] Read the posting: company, title, link, location, description — from the page's own data where the form
      doesn't show them (Greenhouse embeds, Ashby).
- [x] Extract fields: label, kind, options, required, section, repeatable group.

### Filling

- [x] Setters React sees: text, textarea, select, radio, checkbox, custom dropdowns, typeaheads, dates, file upload.
- [x] Field dictionary: contact, links, education, experience, preferences, common questions.
- [x] Critical questions by rule only: authorization, sponsorship (now / future / either, negated wordings),
      citizenship, visa status, export control. Ambiguous → blank and red. The job's country comes from the
      posting's location, cities abroad included.
- [x] Voluntary (EEO) answers matched across wordings: gender, Hispanic/Latino, race, veteran, disability.
- [x] Answer memory: capture typed answers at submit, reuse them by normalized question, edit them on the options
      page.
- [x] Greenhouse adapter: job boards, legacy boards, embeds.
- [x] Lever adapter.
- [x] Ashby adapter.
- [x] Workday adapter: sign-up email, My Information, My Experience (repeatable work and education), Application
      Questions, Voluntary Disclosures, Self Identify. Built from Workday's `data-automation-id` conventions; real
      pages still to check (see below).
- [x] Generic adapter: dictionary only, card opened from the toolbar.

### Card

- [x] Shadow-DOM card in the top frame: Outbox's Liquid Glass, English and Chinese.
- [x] Match status; account picker with already-applied accounts disabled and the duplicate hint on Ashby and
      Workday; resume picker; Fill button and shortcut.
- [x] Checklist (filled, confirm, AI draft, missing); click to jump to a field.
- [x] "This page didn't fill right": save the form's structure without values.
- [x] LinkedIn and other job pages: Log to Outbox only.
- [x] Simplified (2026-09-28): the match check is a dot, with two reasons when yellow or red; account and resume
      share one row and are named, not offered, when there's one; after Fill only what needs the owner is listed
      (Check, AI, Fill), the rest counted; after submitting only "Logged to Outbox" with Undo; at most one notice,
      with what to do; Log to Outbox, "This page didn't fill right" and Settings in a ⋯ menu. The options page is
      Status, AI and a closed More.

### Match check

- [x] Description scan: citizenship, clearance, export control, no sponsorship → red.
- [x] Seniority and years → yellow; new-grad signals → green.
- [x] Three or more postings at the company in 30 days → yellow.
- [x] H-1B history: a compact table built from the USCIS H-1B Employer Data Hub (FY2021–2023), matched by
      normalized company name.

### AI

- [x] Claude client in the service worker: `@anthropic-ai/sdk`, the owner's key, Opus 5 by default, Sonnet 5
      selectable, refusal fallback.
- [x] Field fallback: one structured-output request per form, confidence threshold, never critical questions.
- [x] Free-text drafts grounded in the resume, stories, approved snippets and the description; style rules; the
      owner's edited finals as examples; optional questions skipped.
- [x] Usage and cost per day on the options page.
- [x] An OpenAI-compatible provider (address, key, model), the default: `https://api.kabi.pro`, GPT-5.6 Terra.
- [x] Free-text eval: 20 questions, Opus 5 vs Sonnet 5, through the extension's own `draftAnswer`
      (`npm run eval -w extension`). Runs cost money, so the owner starts each.

### Logging to Outbox

- [x] Detect a submission on Greenhouse, Lever, Ashby and Workday.
- [x] Quick add with the link, account, channel (Company site) and resume version; Undo; offline queue.
- [x] Sign-in: session cookie first; bearer token from an open Outbox tab as the fallback (Better Auth `bearer`
      plugin on the Worker).

### Quality and docs

- [x] Fixtures: 22 public application pages (10 Greenhouse, 6 Lever, 6 Ashby), saved as served, plus a corpus of 646
      questions.
- [x] Fill-accuracy report per system, gated in CI: every hand-checked answer right; 87% / 79% / 77% of required
      fields filled on Greenhouse / Lever / Ashby with rules only.
- [x] Unit tests for every module above.
- [x] Playwright: the built extension in Chromium against the fixtures (request interception) and a mock Outbox.
- [x] README section; installing the extension in [deploy.md](deploy.md). A card screenshot waits for a real
      application: on saved pages the dropdowns can't open.

### Waiting on the owner

- [ ] On Outbox, open the profile panel (toolbar): fill from the resume PDF or import
      `~/Desktop/job-search/autofill-profile.json` once, then check phone, address and ZIP, citizenship, salary
      expectation, earliest start date, relocation, languages, EEO answers, and years of experience (computed as 2
      from full-time and contract work).
- [ ] Load the extension: `npm run ext:build`, then `chrome://extensions` → Developer mode → Load unpacked →
      `extension/.output/chrome-mv3`.
- [ ] Paste the API key for `https://api.kabi.pro` under AI on the options page and press Save, which tries it
      (or pick Anthropic and use a Console key with a monthly spend limit).
- [ ] Run the free-text eval once (about $1) and choose Opus 5 or Sonnet 5 from its report.
- [ ] On each Workday page, pick "This page didn't fill right" in the card's ⋯ menu once: Workday's forms are behind sign-in, so these
      snapshots are its only fixtures.
- [x] Before using the extension with production: `npm run db:migrate:remote` (migration 0003, the profile table),
      then deploy the Worker with job links, the profile API and the `bearer` plugin.
- [x] Migration 0004 (resume PDFs) applied remotely and the Worker deployed, 2026-09-28.
- [ ] Rebuild the extension (`npm run ext:build`), reload it on `chrome://extensions`, and upload each resume PDF
      in Outbox's Resumes page: this version clears PDFs added on the options page. Until then the installed
      extension keeps attaching its own copies.
- [ ] Optional: Simplify's free version until the extension is installed; afterwards turn it off on Greenhouse,
      Lever and Ashby.
- [ ] Optional: three to five STAR stories with `my-interview-prep`, to ground free-text answers.

## On hold (decided 2026-09-24)

- [ ] **Workers Paid ($5/month).** Staying on the free plan for now. The free plan allows 10 ms of CPU per
      request; measured in production, API requests take 2–13 ms. They succeed today, but Cloudflare doesn't
      promise that.
- [ ] **Milestone 4: agent v1.** Paste a recruiting email → classify it, match the application, update it;
      anything ambiguous goes to a review queue. An eval set of about 100 synthetic emails picks the cheapest
      model that reaches 97% accuracy. Needs an Anthropic API key, and Workers Paid for the CPU and
      subrequest limits.
- [ ] **Milestone 5: Gmail sync.** Read-only OAuth per account; sync on open and every 30 minutes.
- [ ] **Milestone 6 (optional).** Conversational queries over the data.

## Waiting on the owner

- [ ] Make the GitHub repository public, so the README and the code can back the portfolio.
- [ ] GitHub Actions has never run the CI workflow: check that Actions is enabled for the repository.

## Backlog

- [ ] Split the bundle (746 kB, 229 kB gzipped since the redesign): lazy-load the pages other than Applications,
      the settings dialog and the tweak panel.
- [ ] Playwright tests for the core flows: sign-in screen, quick add, stage change.
- [ ] Keep the scripts that captured the README screenshots and animation in the repository, so the media can
      be regenerated after UI changes.
