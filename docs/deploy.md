# Deploying Outbox

Outbox runs as one Cloudflare Worker: the React app is served as static assets, `/api/*` runs Hono, and data
lives in D1. The same Worker serves the public demo on a second hostname, against a second database. Steps 1–4
are one-time setup; after that, deploying is step 3 alone.

## 1. Cloudflare account and databases

```bash
npx wrangler login
npx wrangler d1 create outbox        # the owner's data
npx wrangler d1 create outbox-demo   # demo visitors' sandboxes
```

Copy each `database_id` that `d1 create` prints into `wrangler.jsonc`: `outbox` goes in the `DB` entry and
`outbox-demo` in the `DEMO_DB` entry.

## 2. Schema

```bash
npm run db:migrate:remote
```

This migrates both databases. Run it again whenever `migrations/` gains a file. Schema changes start in
`worker/db/schema.ts`: `npm run db:generate` writes the migration, and `npm run db:migrate:local` applies it
locally.

## 3. Domains and deploy

In `wrangler.jsonc`, `routes` lists the app's hostname and the demo's as Worker custom domains (their zone has
to be on your Cloudflare account), and `vars.DEMO_HOST` names the demo's. Change them to your own, then:

```bash
npm run deploy
```

Cloudflare creates the DNS records and certificates for both hostnames. The demo works right away; until step 4
is done, the app loads but can't sign anyone in. `workers.dev` stays off, so the app has a single origin.

## 4. Google sign-in and secrets

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials):

1. Configure the OAuth consent screen (External). Sign-in only asks for the basic `openid email profile`
   scopes. Leave the app in **Testing** and add your Google account as a test user: Google then admits only
   that account, and `OWNER_EMAILS` checks again on the server. (Publishing would first require a privacy
   policy and home page on the Branding page.)
2. Create an **OAuth client ID** of type **Web application** with:
   - Authorized JavaScript origin: your app URL
   - Authorized redirect URI: your app URL + `/api/auth/callback/google`
   - To also try real sign-in locally, add `http://localhost:5180` and
     `http://localhost:5180/api/auth/callback/google`.

Then store the configuration as encrypted Worker secrets, so the repository holds no personal details. Each
command prompts for its value; the first generates a random one.

```bash
openssl rand -hex 32 | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_URL        # your app URL
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OWNER_EMAILS           # the Google account(s) allowed in, comma-separated
```

Secrets apply immediately. Only emails in `OWNER_EMAILS` can create an account; anyone else is turned away.

## Local development

```bash
cp .dev.vars.example .dev.vars   # set BETTER_AUTH_SECRET to any long random string
npm run db:migrate:local
npm run dev                      # http://localhost:5180
```

With `DEV_AUTH_BYPASS=true` in `.dev.vars`, the local app signs you in as a built-in developer account. The
Worker honors the bypass only on localhost, and `.dev.vars` is never uploaded. The demo runs locally at
http://demo.localhost:5180, because `.dev.vars` sets `DEMO_HOST=demo.localhost`.
