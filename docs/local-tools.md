# Discover and Resume tools in development

Discover and Resume tools run on the NestJS service in [`backend/`](../backend), with its own PostgreSQL
database. The app reaches it only through the Vite dev server, so the service runs next to `npm run dev`.

## Start

For a first-time setup, follow [backend/README.md](../backend/README.md). Then start PostgreSQL and the service in
a separate terminal:

```bash
npm --prefix backend run infra:up
npm --prefix backend run dev      # 127.0.0.1:3100; leave running alongside npm run dev
```

Open [Discover](http://127.0.0.1:5180/discover) or [Resume tools](http://127.0.0.1:5180/resume-tools). Both pages
have their own routes, survive a reload, work with back and forward, and share the app's themes, glass and
English and Chinese copy. On a narrow screen the navigation shows Tracker, Discover, Tools and More, with Resumes,
Profile and Insights under More.

## Discover

Discover starts with company selection. A searchable company dialog holds source setup; the main page focuses on
search and compact job rows, with optional filters and a detail side panel. Saving uses the tracker's repository
and posting matching rules, checks a fresh snapshot and suppresses repeated clicks. It creates a saved job only,
with no application attached.

## Resume tools

Resume tools read PDF/DOCX files up to 5 MB locally, or pasted text. Page visits and text extraction never invoke
a model. The flow is **Add resume → Check text → Review result**, with a readable summary and collapsed JSON.

- Only **Parse resume** invokes a model, with the provider, Base URL and model set in the service. The **Parsing
  settings** dialog never accepts or returns keys: configure them in `backend/.env` and restart the service.
  Model lists and connection checks run only on request.
- Results can be downloaded as JSON or reviewed in Profile: contact details fill blanks, selected education and
  experience replace those sections in the draft, skills are merged, and a separate Save is required. Unsaved
  edits have a leave guard.
- Results and text are held in memory, not persisted across a reload. The resume library and the extension
  attach PDFs only.

## The dev-server bridge

The Vite-only `/local-tools/*` bridge targets the fixed loopback service and allowlists routes. It checks the
local Host, peer address, same-origin writes and `x-outbox-local`, then adapts the origin for the NestJS
`LocalGuard`. It strips main-site cookies and authorization headers. `/api/*` goes to the Worker, resume
attachments included. Do not expose the dev server or the service publicly.

## Not hosted

A production build shows these pages as unavailable and never contacts a visitor's localhost. Hosting them would
take a separately hosted service and database, data and secrets scoped to each signed-in user, and a same-origin
gateway; deploying the Worker hosts neither the service nor its database.

## Browser tests

`npm run test:ui` covers routing and history, company selection and sync, saved-job deduplication, explicit
parsing, selective profile review and save with leave guards, service failures, and 320–1440 px layouts in
English and Chinese and in light and dark themes. It also makes a read-only bridge health check and rejected
cross-origin requests; it never sends a paid model request. It saves a screenshot of each layout
to `test-results/screenshots/`, which git ignores. `npx vitest run` runs only the main-app, Worker and bridge
tests.
