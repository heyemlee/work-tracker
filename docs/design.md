# Outbox — Design

A job-application tracker for one person applying to dozens of SWE / AI-agent roles a day, often to the
same posting from several email accounts. Daily-use tool first, portfolio piece second.

Status: design settled 2026-09-23 · Milestones 1–3 (prototype, MVP, README) done · Milestone 4 (agent v1) on
hold. Deferred work is listed in [todo.md](todo.md).

## 1. Goals

- Log an application in under 5 seconds — the owner applies to dozens of roles a day.
- Track one posting applied to from several identities (email accounts), each progressing independently.
- Keep statuses current with little manual work: an email-reading agent (milestones 4–5).
- Be a credible portfolio project: clean TypeScript, measured evals.

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
| Job           | company\*, title, notes                                               | One posting. Title and notes are optional                                        |
| Application   | job\*, account\*, channel, resume, stage, rejected, appliedAt, source | At most one per (job, account)                                                   |
| Account       | label, email, color                                                   | Never stores passwords — use a password manager                                  |
| ResumeVersion | name                                                                  | Names only (e.g. `SDE-v3`), no files                                             |
| Channel       | name, builtin                                                         | Built-ins: Company site, LinkedIn, Referral, Recruiter, Other; user can add more |
| Event         | job, application, type, from, to, at, actor                           | Append-only timeline written on every change; actor is `user` or `agent`         |

**Stages are fixed.** An application moves Applied → OA → Offer. _Saved_ is not an application stage: it is a
job with no applications yet. _Rejected_ is a flag rather than a stage, so "rejected after OA" keeps its stage.
There is no "ghosted" state; the UI shows age instead ("Applied · 23d").

**Rollup.** A job displays the furthest stage among its non-rejected applications; if every application is
rejected, it displays the furthest rejected one, dimmed. Filters use the rollup.

**Defaults.** Channel and resume default to the last values used. Applied date defaults to today.

## 3. UX

- **Main view** — a list grouped by date (Today / Yesterday / This week / Earlier), one row per job. Each account
  that applied is a chip showing its own status. Rejected jobs are dimmed; one click hides them. Accounts are
  shown by their email address everywhere, since that's what tells them apart.
- **Header** — a KPI row (applied today, this week, active OAs, offers), a segmented control
  `All · Saved · Applied · OA · Offer`, and search.
- **Composer (quick add)** — a glass panel over the list, opened from the toolbar's New button or `N` (a bottom
  sheet on phones). Company → `Tab` → title → account chips → `Enter`; the panel closes and a toast offers Undo.
  Selecting N accounts creates N applications; selecting none saves the job. Typing a company lists its existing
  jobs; picking one attaches new accounts to it, and accounts that already applied are disabled.
- **Detail** — a glass side panel on desktop, a bottom sheet on mobile: per-account stage control, rejected
  toggle, apply with another account, notes, timeline.
- **Settings** — accounts (an email address and a color each), resume versions, channels, language, CSV export.
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
- Light and dark follow the system. Honors `prefers-reduced-motion` and `prefers-reduced-transparency`.
- The prototype has a hidden tweak panel (`?tweaks`) for accent, glass blur / tint, refraction, and glow.

## 5. Architecture (Cloudflare)

A single Worker serves everything:

- **Static assets** — the React SPA built by Vite. Asset requests are free and use no Worker CPU.
- **API** — Hono under `/api/*`: plain REST, bodies validated with zod, every query scoped to the signed-in user.
- **Cron triggers** — sync Gmail every 30 minutes (milestone 5).
- **Data** — D1 (SQLite) through Drizzle, one database: `outbox`.
- **Auth** — Better Auth with Google sign-in, allowlisted to the owner's email.
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

Engineering: strict TypeScript, Vitest for domain logic, Playwright for core flows, GitHub Actions. Public GitHub
repository.

## 10. Open items

- ~~Custom domain~~ — `tracker.haoyang.us`, a Worker custom domain; `workers.dev` is off so there is one origin.
- ~~Owner account~~ — set through the `OWNER_EMAILS` secret.
- ~~Google OAuth client~~ — in Testing mode with the owner as the only test user; publishing would need a
  privacy policy and home page.
- Workers Paid — deferred on 2026-09-24; the risks of staying on the free plan are in [todo.md](todo.md).
- An Anthropic API key — milestone 4.
