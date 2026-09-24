# Outbox

A job-application tracker for people who apply to the same posting from more than one email account. Each
account's application moves through its own stages, logging one takes about five seconds, and the interface
follows Apple's Liquid Glass. An agent that reads recruiting email and keeps statuses current is next.

**Status:** MVP in progress. Product and architecture decisions are in [docs/design.md](docs/design.md).

## Stack

- **App:** React 19, TypeScript, Vite, Tailwind CSS v4, Motion, Radix primitives, TanStack Query
- **Backend:** one Cloudflare Worker — static assets for the app, Hono for `/api`, D1 (SQLite) through
  Drizzle, Better Auth with Google sign-in

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars   # set BETTER_AUTH_SECRET to any long random string
npm run db:migrate:local
npm run dev                      # http://localhost:5180, signed in as a local developer
npm run dev:local                # the original prototype: sample data in the browser, no backend
```

## Test

```bash
npm test
```

Covers the domain logic and a repository contract that runs twice — against the in-browser store and against
D1 (an in-memory database run by workerd) — so the offline prototype and the real backend behave the same.

## Deploy

See [docs/deploy.md](docs/deploy.md).
