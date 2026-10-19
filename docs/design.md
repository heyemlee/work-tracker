# Outbox — Design

A job-application tracker for one person applying to dozens of SWE / AI-agent roles a day.

Status: design settled 2026-09-23 · Milestones 1–3 (prototype, MVP, README) done · Milestone 4 (agent v1) on
hold · Milestone 7 (autofill extension) built and waiting on the owner to install it, see [autofill.md](autofill.md)
· Redesigned 2026-09-28 after Jobright, Simplify, Teal and Huntr: labelled pages, a first-run guide, insights.

## 1. Goals

- Log an application in under 5 seconds — the owner applies to dozens of roles a day.
- Track one posting applied to from several identities (email accounts), each progressing independently.
- Keep statuses current with little manual work: an email-reading agent (milestones 4–5).
- Hold the code to a high bar: clean TypeScript, measured evals.

Non-goals: multi-tenant SaaS, storing portal passwords, interview-round tracking, JD / salary / location fields.

## 2. Domain model

```
Company 1─n Job 1─n Application 1─n Event
                    ├─ Account        which email identity applied
                    ├─ Channel        how it was submitted
                    └─ ResumeVersion  which resume was sent
```

| Entity        | Fields                                                                | Notes                                                                            |
| ------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Company       | name                                                                  | Unique by normalized name; drives autocomplete                                   |
| Job           | company\*, title, url, notes                                          | One posting. Title, link and notes are optional                                  |
| Application   | job\*, account\*, channel, resume, stage, rejected, appliedAt, source | At most one per (job, account)                                                   |
| Account       | label, email, color                                                   | Never stores passwords — use a password manager                                  |
| ResumeVersion | name, file                                                            | A name (e.g. `SDE-v3`) and its PDF, up to 1.4 MB; the file is loaded on its own  |
| Channel       | name, builtin                                                         | Built-ins: Company site, LinkedIn, Referral, Recruiter, Other; user can add more |
| Event         | job, application, type, from, to, at, actor                           | Append-only timeline written on every change; actor is `user` or `agent`         |

**Stages are fixed.** An application moves Applied → OA → Offer. _Saved_ is not an application stage: it is a
job with no applications yet. _Rejected_ is a flag rather than a stage, so "rejected after OA" keeps its stage.
There is no stored "ghosted" state: an application still at Applied 30 days after it went out reads _No reply_,
worked out from its date, so a late answer only needs its stage changed.

**Rollup.** A job displays the furthest stage among its non-rejected applications; if every application is
rejected, it displays the furthest rejected one, dimmed. Filters use the rollup.

**Defaults.** Channel and resume default to the last values used. Applied date defaults to today.

## 3. UX

- **Pages** — Applications `/`, Resumes `/resumes`, Profile `/profile` and Insights `/insights`, each with its own
  address, as labelled tabs in the floating toolbar (a glass tab bar at the bottom on phones, with a round New
  button beside it). The toolbar also holds search, New, and one ⋯ menu for everything else: Settings (Outbox's and
  the extension's, in one window since 2026-10-19), CSV export, the setup guide, sign-out. What the extension needs
  (its key, AI turned on, installing) is said in a line under Settings, which then opens where it's dealt with, and
  the ⋯ button carries a dot only while it needs something. Until 2026-10-19 the extension's settings had a row of
  their own there, saying "Connected" when all was well; until 2026-10-10 the state had a button of its own, lit
  green when all was well, and the menu sat behind the account's picture with a language toggle that Settings has
  too. Jobright's sidebar was the alternative; a sidebar was tried and dropped on 2026-09-24, and Simplify gets by
  with a top bar alone.
- **First run** — a guide at `/welcome`, six steps, each skippable: the emails applied with, the resumes, the
  extension and its key (checked live), a resume read into the profile, the answers no resume holds (work
  authorization, preferences, EEO — rules only, never AI), done (with a daily goal). It opens by itself for an
  owner with no accounts and no jobs. On the home page a checklist tracks the same steps and ends with the first
  application the extension logs; hidden once, it's back a week later, hidden twice it stays hidden.
- **Main view** — a list grouped by date (Today / Yesterday / This week / Earlier), one row per job. Each account
  that applied is a chip showing its own status. Rejected jobs are dimmed, and so are jobs whose applications got
  no reply in 30 days; one click hides rejected ones. Accounts are shown by their email address everywhere, since
  that's what tells them apart.
- **Paging** — the list comes 25 jobs to a page since 2026-10-10, about a day's applications, so the page is as
  long after a year as after a week and only 25 rows are ever drawn. A pager (`‹ 1 / 3 ›`) sits at the right of the
  filter and again under the list (under it alone on a phone), and not at all while everything fits on one page.
  A section a page cuts shows again on the next one, with its whole count on both. Another filter or another
  search starts from the first page; search and the filter's counts still cover every job. Turned from the foot
  of a page, the next one starts at its top. The owner's first idea was a page that is whatever the window holds,
  with no scrolling: measured, that is 12 rows on their window and 7 on a laptop's, so every day's applications
  would be cut into two to five pages, and a page would change with the window. No keys turn the page, the
  address doesn't keep it, and its size isn't a setting.
- **Header** — a KPI row (applied today against the daily goal, the last 7 days, active OAs), then a segmented
  control `All · Saved · Applied · OA · Offer` with a count on each. The OA rate over 30 days was on the row until
  2026-10-07; Insights has it.
- **Insights** — for 7 days, 30 days or everything: the funnel (applied → OA → offer, with the rest split into
  rejected, no reply and still waiting), applications per day against the goal, and the OA rate by resume version,
  account and channel. Small samples are marked. Everything is worked out from the snapshot; nothing is stored.
- **Composer (quick add)** — a glass panel over the list, opened from the toolbar's New button or `N` (a bottom
  sheet on phones). Company → `Tab` → title → account chips → `Enter`; the panel closes and a toast offers Undo.
  Selecting N accounts creates N applications; selecting none saves the job. Typing a company lists its existing
  jobs; picking one attaches new accounts to it, and accounts that already applied are disabled. Pasting the
  posting's link instead of a company fills the company in — from an applicant-tracking board (Greenhouse, Lever,
  Ashby, Workday, …) or the career site's domain — and, for Workday, the title. The link is saved with the job, and
  a link that's already tracked attaches to its job, so applying from another account is paste, pick, `Enter`.
- **Detail** — a glass side panel on desktop, a bottom sheet on mobile: per-account stage control, rejected
  toggle, apply with another account, the posting's link, notes, timeline.
- **Settings** — one window for Outbox's settings and the extension's (decided 2026-10-19, where they had been two
  windows of two looks, side by side in the menu): Outbox's pages — accounts (an email address and a color each),
  channels, and General (language, appearance, the daily goal, hiding rejected jobs, CSV export, sign-out) — and
  then the extension's — Connection, AI, Fill reports, Remembered answers, Other — down the left, the open one to
  their right. The extension's pages are its own settings page in a frame of its own origin, so its API key stays out
  of Outbox's reach ([autofill.md](autofill.md), "Settings"); where it isn't running, its part of the list is one
  page saying so, with the way to the guide's step for installing it. The language chosen here is the extension's
  too, unless one is chosen in the extension's own window. Phones have no extension, and get Outbox's settings
  alone, one under another. The window opens at the page asked for: the account list from New, the AI page from the
  guide's extension step, and from the menu whatever the extension needs.
- **Resumes** — their own page: upload a PDF (or drop it), and it becomes a version named after the file. Each can
  be renamed, opened, replaced, deleted, or read into the profile, and shows how often it went out and its OA rate.
  The extension attaches these PDFs, so each version is uploaded once, here.
- **Profile** — its own page: a completeness score weighted by what forms ask most, each blank a link to its
  section, and the sections the extension fills from; see [autofill.md](autofill.md). Leaving with unsaved edits
  asks first.
- English (default) and Simplified Chinese. Installable as a PWA.

## 4. Visual design

Apple Liquid Glass, used the way Apple uses it: glass is the floating control layer (toolbar, composer, panels,
popovers); content sits on clean, opaque surfaces so dense lists stay readable.

- **Canvas** — near-white / near-black with a faint ambient color glow, so the glass has something to refract.
- **Color** — monochrome UI; the accent is the foreground color. Status colors are low-saturation: Applied
  slate-blue, OA amber, Offer green, Rejected gray.
- **Type** — the system stack (SF Pro / PingFang SC); tabular numerals for counts.
- **Glass** — blur + saturation + specular edge highlight in every browser; SVG displacement refraction as a
  Chromium-only progressive enhancement.
- **The pet** (`src/ui/pet`, 2026-10-18) — Outbox's mark, alive: a black mochi with upright pill eyes (white on
  the dark theme), drawn as SVG paths by a small engine of springs, no library. It is the toolbar's logo and the
  sign-in page's, the app and extension icons (`npm run icons` draws them from its resting frame), and what loading
  looks like everywhere: three dots taking turns to hop (`PetDots`). Opening slowly (past 300 ms), the dots wait in
  the middle of the page, run back into the pet, and it hops into the toolbar as the page shows through. Signing
  in, it looks down at the button the pointer or the keyboard is on, turns into the dots while Google answers, and
  shakes when sign-in doesn't go through. Its eyes never follow the pointer: it looks where something happens.
  Under reduced motion it only blinks (the dots pulse in place); a small pet waiting for its next blink draws
  nothing until then. The character is Outbox's own; the engine's debts are in `engine.ts`.
- Light and dark follow the system. Honors `prefers-reduced-motion` and `prefers-reduced-transparency`.
- The prototype has a hidden tweak panel (`?tweaks`) for accent, glass blur / tint, refraction, and glow.

## 5. Architecture (Cloudflare)

A single Worker serves everything:

- **Static assets** — the React SPA built by Vite. Asset requests are free and use no Worker CPU. The page is
  checked on every visit; the files it names are kept by the browser for a day (`public/_headers`).
- **API** — Hono under `/api/*`: plain REST, bodies validated with zod, every query scoped to the signed-in user.
- **Cron triggers** — sync Gmail every 30 minutes (milestone 5).
- **Data** — D1 (SQLite) through Drizzle, one database: `outbox`.
- **Auth** — Better Auth with Google sign-in, allowlisted to the owner's email. A session is looked up in D1,
  then carried in a signed cookie for five minutes, so most requests are checked without a query; measured in
  production on 2026-10-07, a query costs a request about 40 ms and the lookup is two.
- **LLM calls** — the Anthropic API through Cloudflare AI Gateway (request logs, cost stats).
- **Deploy** — `npm run deploy` (wrangler). Custom domain `tracker.haoyang.us`; `workers.dev` is off. GitHub
  Actions runs the checks.
- **Cost** — free plan through milestone 3. Workers Paid ($5/month) from milestone 4: the free plan allows 10 ms
  of CPU and 50 subrequests per invocation, too little for batch email processing. Measured in production, API
  requests already take 2–13 ms of CPU. They succeed, but the free plan doesn't promise that.

Frontend: React 19, TypeScript (strict), Vite, Tailwind CSS v4, Motion, Radix primitives, and TanStack Query.

**One contract, three implementations.** The UI talks only to a `Repository` interface (`src/domain`). It is
implemented in the browser (the offline prototype, `npm run dev:local`), over D1 in the Worker, and over HTTP in
the SPA, which reaches the D1 one. The rules for every write — which timeline entries a stage change records,
what undoing a quick-add removes — are pure functions in `src/domain/commands.ts` that both stores call, and one
contract test suite runs against both the browser store and D1.

**Data details.** The list loads one snapshot without timelines; a job's timeline loads when its panel opens.
Deleting a job is a soft delete, so it can be undone. Stage and rejection changes apply optimistically in the UI.
Built-in channels live in code; only custom channels are rows.

## 6. Email agent (milestones 4–5)

**Ingestion.** Gmail read-only OAuth, connected per account. The Google app is published unverified for
personal use, so refresh tokens don't expire after 7 days. Gmail search pulls only recruiting mail, and past
mail can be backfilled. Paste-an-email is the fallback for any account. Sync runs when the app opens and on cron.

**Storage.** Extracted fields, a short snippet, and a link to the original message — never full bodies. OAuth
tokens are encrypted at rest and revocable from the Google account.

| Email                    | Agent action                                                            |
| ------------------------ | ----------------------------------------------------------------------- |
| Application confirmation | Matching application exists → nothing; none → create one (tagged agent) |
| Rejection                | Set rejected                                                            |
| OA invite                | Stage → OA; extract the deadline and show a countdown                   |
| Interview invite         | Timeline event only (there is no interview stage)                       |
| Offer                    | Review queue                                                            |
| Ambiguous match          | Review queue                                                            |

Every agent change is tagged and can be undone in one click.

**Model.** Develop with Claude Opus 5. Once the eval set exists, run Claude Haiku 4.5, Sonnet 5, and Opus 5 and
ship the cheapest that reaches ≥ 97% accuracy; publish the accuracy-vs-cost table in the README. Cron-driven
processing uses the Message Batches API (50% off). Estimated $4–34/month at 60–100 emails/day, depending on model.

## 7. Evals

About 100 synthetic emails in the repo: six classes (confirmation, rejection, OA, interview, offer, unrelated)
of ~15 each, plus ~20 hard cases — several postings at one company, soft-worded rejections, OA invites sent by
HackerRank rather than the company, recruiter blasts. The owner's real emails, anonymized, stay local and
gitignored. CI runs evals only when agent code changes (~$0.2–1 per run).

## 8. Privacy

The app has a single user, the owner. Everyone else only ever sees the sign-in screen. The agent's live try-out
(milestone 4) would need its own isolated sandbox if it is ever made public.

## 9. Milestones

1. **Prototype** — the full UI on mock data; confirm visuals and interactions. ✓
2. **MVP** — Worker + Hono + D1 + auth, deployed; daily use starts. ✓
3. **English README** (architecture diagram, an animated walkthrough, screenshots). ✓ A public demo sandbox
   was built too, then removed on 2026-09-25: the app is for the owner's own use.
4. **Agent v1** — paste an email → classify, match, update; review queue; eval set.
5. **Agent v2** — Gmail sync.
6. _(Optional)_ conversational queries over the data.
7. **Autofill extension** — a Chrome extension fills applications from a local profile, and each submission logs
   itself to Outbox; see [autofill.md](autofill.md).

Engineering: strict TypeScript, Vitest for domain logic, Playwright for core flows, GitHub Actions. Public GitHub
repository.

## 10. Open items

- ~~Custom domain~~ — `tracker.haoyang.us`, a Worker custom domain; `workers.dev` is off so there is one origin.
- ~~Owner account~~ — set through the `OWNER_EMAILS` secret.
- ~~Google OAuth client~~ — in Testing mode with the owner as the only test user; publishing would need a
  privacy policy and home page.
- Workers Paid — deferred on 2026-09-24; **Cost** in section 5 gives the free plan's limits.
- An Anthropic API key — milestone 4.
