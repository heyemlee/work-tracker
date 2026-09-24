# Outbox — Design

A job-application tracker for one person applying to dozens of SWE / AI-agent roles a day, often to the
same posting from several email accounts. Daily-use tool first, portfolio piece second.

Status: design settled 2026-09-23 · Milestone 1 (prototype) in progress.

## 1. Goals

- Log an application in under 5 seconds — the owner applies to dozens of roles a day.
- Track one posting applied to from several identities (email accounts), each progressing independently.
- Keep statuses current with little manual work: an email-reading agent (milestones 4–5).
- Be a credible portfolio project: clean TypeScript, a live demo, measured evals.

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
  that applied is a chip showing its own status. Rejected jobs are dimmed; one click hides them.
- **Header** — a KPI row (applied today, this week, active OAs, offers), a segmented control
  `All · Saved · Applied · OA · Offer`, and search.
- **Composer (quick add)** — a floating bar; `N` focuses it. Company → `Tab` → title → account chips → `Enter`.
  Selecting N accounts creates N applications; selecting none saves the job. Typing a company lists its existing
  jobs; picking one attaches new accounts to it, and accounts that already applied are disabled.
- **Detail** — a glass side panel on desktop, a bottom sheet on mobile: per-account stage control, rejected
  toggle, apply with another account, notes, timeline.
- **Settings** — accounts, resume versions, channels, language, CSV export.
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
- **API** — Hono under `/api/*`, consumed through Hono's typed RPC client.
- **Cron triggers** — reset the demo database daily; sync Gmail every 30 minutes (milestone 5).
- **Data** — D1 (SQLite) through Drizzle, as two databases: `outbox` (real data) and `outbox-demo` (sandbox,
  reseeded daily). Physically separate, so demo traffic can never reach real data.
- **Auth** — Better Auth with Google sign-in, allowlisted to the owner's email. Demo visitors get a session bound
  to `outbox-demo`.
- **LLM calls** — the Anthropic API through Cloudflare AI Gateway (request logs, cost stats, rate-limiting the
  demo's live try-out).
- **Deploy** — `wrangler` from GitHub Actions. A `workers.dev` subdomain until a custom domain is chosen.
- **Cost** — free plan through milestone 3. Workers Paid ($5/month) from milestone 4: the free plan allows 10 ms
  of CPU and 50 subrequests per invocation, too little for batch email processing.

Frontend: React 19, TypeScript (strict), Vite, Tailwind CSS v4, Motion, Radix primitives, and TanStack Query over
a repository interface — a local mock during the prototype, the API afterwards.

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

## 8. Demo and privacy

Same deployment. "Try the demo" opens a sandbox on `outbox-demo` with fictional companies, reset daily. The agent
demo replays a recorded run over a mock inbox; a rate-limited "paste an email" box runs it live.

## 9. Milestones

1. **Prototype** — the full UI on mock data; confirm visuals and interactions. ← current
2. **MVP** — Worker + Hono + D1 + auth, deployed; daily use starts.
3. **Demo sandbox** and an English README (architecture diagram, demo GIF).
4. **Agent v1** — paste an email → classify, match, update; review queue; eval set.
5. **Agent v2** — Gmail sync.
6. _(Optional)_ conversational queries over the data.

Engineering: strict TypeScript, Vitest for domain logic, Playwright for core flows, GitHub Actions. Public GitHub
repository.

## 10. Open items

- Custom domain on Cloudflare, or stay on `workers.dev` — decide at milestone 2.
- The owner's Google account for sign-in — milestone 2.
- An Anthropic API key — milestone 4.
