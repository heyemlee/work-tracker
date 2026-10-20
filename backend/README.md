# Outbox service

The NestJS service behind Outbox's **Discover** and **Resume tools** pages. It runs on your machine: it gathers
the open roles of the companies you follow from their public job boards, and reads resumes into profile facts
with an LLM. The tracker and the extension don't need it. The deployed app reaches it through a Cloudflare Tunnel
once one is connected (below), and shows these two pages as unavailable until then; it never calls a visitor's
machine.

TypeScript · NestJS · Prisma · PostgreSQL · zod · pdf.js · Mammoth · Redis · Vitest · Playwright

## Run it

Needs Node 22+ and Docker.

```bash
cd backend
npm ci
npm run infra:up   # PostgreSQL in Docker on 127.0.0.1:55432
npm run setup      # migrations, then the board catalog
npm run dev        # http://127.0.0.1:3100
```

Then run `npm run dev` in the repository root and open <http://127.0.0.1:5180/discover> or `/resume-tools`. The
app reaches the service through a same-origin bridge that exists only in development; see
[docs/local-tools.md](../docs/local-tools.md). The service also serves pages of its own at
<http://127.0.0.1:3100> and `/resume-lab`.

Settings live in `.env` (copy `.env.example`): `ENABLE_SYNC=true` syncs the followed boards once a day (checked
every hour, so a computer that slept through it catches up), and `ENABLE_RESUME_AI=true` with a provider, model and
key turns on parsing. The model settings in the app's Resume tools page and on the service's own `/resume-lab` page
write the same file; only the service's page takes a key. `npm run sync` runs one sync by hand, and
`npm run infra:down` stops the database.

## From the deployed site

The deployed app uses this same service, with its data, model settings and spending ledger, while it runs on your
computer. The Worker checks your session and forwards the pages' calls through a Cloudflare Tunnel with a token the
two share. The service takes them on a second loopback port, 127.0.0.1:3101, which opens only when `TOOLS_TOKEN` is
set in `.env` and serves the API alone. Connecting the tunnel and the Worker is in
[docs/deploy.md](../docs/deploy.md#discover-and-resume-tools).

To keep it running, set Docker Desktop to start when you sign in (the database container restarts with Docker),
then install a login agent that starts the built service and starts it again if it stops:

```bash
npm run build
npm run autostart -- install   # now and at every login; logs to ~/Library/Logs/outbox-tools.log
npm run autostart -- restart   # after the next build
npm run autostart -- remove
```

The agent holds port 3100, so stop it before `npm run dev`. If the repository sits in a folder macOS protects
(Desktop, Documents), allow Node to read it when macOS asks, or the agent can't start.

## Job boards

```mermaid
flowchart LR
  follow[Follow a company] --> read[Read its public board API]
  read --> check[Validate and normalize]
  check --> store[(PostgreSQL)]
  store --> search[Search and filter]
  search --> apply[The company's own posting]
```

- The catalog in `config/boards.json` starts with nothing followed. Any Greenhouse, Lever or Ashby board can be
  added by its careers URL; the source is checked before it's saved.
- Connectors read each provider's public API ([Greenhouse](https://docs.greenhouse.io/job-board.html),
  [Lever](https://github.com/lever/postings-api),
  [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api)). All of Lever's pages are read before
  anything is written.
- A company is written in one transaction. `(boardId, externalId)` is unique, so a posting read again is updated
  in place, and postings from different boards are never merged. A posting missing from a complete read is
  marked closed and reopens if it comes back; a timeout, a failed page or a malformed reply keeps what's stored
  and records the error on the board.
- Unfollowing hides a company's postings and keeps their history. A sync skips a board that was unfollowed while
  it was being read.
- Queries are parameterized SQL, with full-text search and the indexes the keyword, location, company and remote
  filters use.

## Resume parsing

1. **Read.** A PDF of up to 30 pages or a DOCX, up to 5 MB, is read with pdf.js or Mammoth in a worker thread
   that is stopped on a timeout; DOCX archives have size and file-count limits. Text over 60,000 characters is
   refused rather than cut, and scanned pages need OCR, which isn't included. No model is called and the file
   isn't kept.
2. **Parse.** Only **Parse resume** sends the reviewed text, by function calling or structured output: to OpenAI
   or a compatible endpoint through the Responses API (`store: false`; strict tools and JSON schema required),
   or to Anthropic. The answer must pass a strict zod schema compatible with the app's `ResumeFacts`: a
   refusal, a truncated reply, a missing or repeated tool call, an unknown field or a bad date fails instead of
   being patched or retried.
3. **Review.** The facts open in the app's profile as a draft, and nothing is saved until you save it.

AI stays off until it's enabled. Keys are kept in `.env` with mode 0600 (plain text, not a vault), never sent
back to the page or kept in browser storage, and changing the base URL asks for the key again, so a saved key is
never sent to a new address. The model list comes from the endpoint's Models API, without sending a resume. The
service listens on 127.0.0.1 only, and its settings endpoints also require a same-origin request with a local
header.

## Resume eval

The CLI runs either method over a manifest of resumes and scores the answers against reference facts.

```bash
npm run build
npm run resume -- extract evals/synthetic/sample.docx   # read a file, no model
npm run resume -- plan evals/synthetic/manifest.json    # check a manifest
npm run resume -- quote <manifest>                      # worst-case cost, offline
ENABLE_RESUME_AI=true npm run resume -- run <manifest> evals/runs/<new>.jsonl --live --budget-usd=<cap> \
  --method=function-calling                             # or structured-output
npm run --silent resume -- score <manifest> evals/runs/<new>.jsonl > evals/runs/<new>-score.json
```

- `evals/synthetic/` holds one fictional resume as a PDF and a DOCX with hand-written facts: it checks the
  pipeline, not accuracy. Real or licensed resumes, their reference facts and every run stay in the git-ignored
  `evals/private/` and `evals/runs/`.
- `npm run resume:data` downloads pinned public resumes whose license covers their content into
  `evals/private/public-v2/`, checking the commit, file and license checksums listed in
  `evals/public-sources.json`. A source withdrawn after review stays listed under `excludedSources`, and the CLI
  refuses it before any paid request.
- A live run needs `--live`, `ENABLE_RESUME_AI=true` and `--budget-usd`. Each request first reserves its
  worst-case cost in a local ledger, which the Resume tools page shares, and nothing is sent past the cap. One
  request per resume, no retries: the first failure stops the run, failures are recorded rather than dropped,
  and the output file must be new.
- Scoring is exact per field after Unicode, case and whitespace normalization, with skills and languages as sets
  and experience and education in order. Empty fields earn nothing, a failed or missing case still counts
  against recall, and predictions made from a different file (by SHA-256) are refused. Scores stay provisional
  while any non-synthetic reference hasn't been reviewed by a person.

## Performance lab

`npm run perf:up`, `npm run build`, then `npm run perf` runs read-path experiments in a database of their own,
`outbox_performance_lab`, on generated companies and jobs:

| Experiment        | Compares                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- |
| Indexes           | the job table with only its constraints → with the app's indexes; same rows, same order |
| Materialized view | live company counts → precomputed ones, with the stale snapshot and the refresh cost    |
| Partitioning      | one history table → 12 monthly partitions, for one month and for all of it              |
| Redis             | direct reads → a cold and a warm cache, timing reads and counting job SELECTs           |

By default it makes 20,000 jobs and two 120,000-row histories, and warms each query twice before timing it 11
times (`--rows`, `--repetitions`, `--requests` and `--concurrency` change that, within limits). Every run writes
a new, git-ignored `performance/results/<run>/` with `REPORT.md` and the raw `results.json`. The cache tests
also cover expiry, revision invalidation, keys per set of followed boards, coalesced concurrent requests,
corrupt entries and falling back to the database when Redis is down. Redis runs under its own Compose profile on
127.0.0.1:56380 without persistence, and `npm run perf:stop` stops it. The numbers come from one machine,
synthetic data and warm caches: they explain the design, not production performance.

## Checks

```bash
npm run build
npm run lint
npm run format:check
npm test                   # unit tests, with model calls mocked
npm run test:integration   # needs the PostgreSQL above
npx playwright install chromium
npm run test:ui            # the service's own pages
```

This is a Node project of its own, with its own lockfile; the root lint and format checks skip it.
`npm run build` first generates the pages' styles from the main app's `src/index.css`, logo and glass refraction
into `web/.generated/`, and `npm run design` alone refreshes them.
