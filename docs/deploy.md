# Deploying Outbox

Outbox runs as one Cloudflare Worker: the React app is served as static assets, `/api/*` runs Hono, and data
lives in D1. Everything below is a one-time setup except the last step.

## 1. Cloudflare

```bash
npx wrangler login
npx wrangler d1 create outbox
```

Copy the `database_id` that `d1 create` prints into `wrangler.jsonc`, replacing the all-zero placeholder.

The app will be served at `https://outbox.<your-subdomain>.workers.dev`. Your workers.dev subdomain is shown
in the Cloudflare dashboard under **Workers & Pages**. To use your own domain instead, add a route or custom
domain in the dashboard and use that URL below.

## 2. Google sign-in

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials):

1. Configure the OAuth consent screen (External). Sign-in only asks for the basic `openid email profile`
   scopes, which need no verification.
2. Create an **OAuth client ID** of type **Web application** with:
   - Authorized JavaScript origin: `https://outbox.<your-subdomain>.workers.dev`
   - Authorized redirect URI: `https://outbox.<your-subdomain>.workers.dev/api/auth/callback/google`
   - To also try real sign-in locally, add `http://localhost:5180` and
     `http://localhost:5180/api/auth/callback/google`.

## 3. Secrets

Configuration is stored as encrypted Worker secrets, so the repository holds no personal details.

```bash
openssl rand -hex 32 | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_URL        # https://outbox.<your-subdomain>.workers.dev
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OWNER_EMAILS           # the Google account(s) allowed in, comma-separated
```

Only emails in `OWNER_EMAILS` can create an account; anyone else is turned away at sign-in.

## 4. Database and deploy

```bash
npm run db:migrate:remote
npm run deploy
```

Run both again whenever `migrations/` gains a new file. Schema changes start in `worker/db/schema.ts`:
`npm run db:generate` writes the migration, and `npm run db:migrate:local` applies it to the local database.

## Local development

```bash
cp .dev.vars.example .dev.vars   # set BETTER_AUTH_SECRET to any long random string
npm run db:migrate:local
npm run dev                      # http://localhost:5180
```

With `DEV_AUTH_BYPASS=true` in `.dev.vars`, the local app signs you in as a built-in developer account. The
Worker honors the bypass only on localhost, and `.dev.vars` is never uploaded.
