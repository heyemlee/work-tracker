# Deploying Outbox

Outbox runs as one Cloudflare Worker: the React app is served as static assets, `/api/*` runs Hono, and data
lives in D1. Steps 1–4 are one-time setup; after that, deploying is step 3 alone.

Vite's built files under `/assets` are kept by the browser for a day (`public/_headers`). The Worker answers that
path first (`run_worker_first` in `wrangler.jsonc`, `worker/assets.ts`): a file the build has comes from the assets as
before, with that header, and a name it doesn't have is a 404 kept by no one. Before 2026-10-14 such a name got the
app's page, as any route does, with the day's header: a deploy reaching one Cloudflare machine before another could
hand a browser that page for a script the new build asks for, a blank screen kept through reloads for the day. Each
asset request now counts as a Worker request (a page load asks for three or four).

## Self-hosting

The files name one deployment's addresses. For your own copy, change them before the steps below:

- `wrangler.jsonc`: the hostname in `routes` (step 3), the `DB` entry's `database_id` (step 1), and the `TOOLS`
  entry under `vpc_services`: yours from [Discover and Resume tools](#discover-and-resume-tools), or none.
- `extension/src/hosts.ts`: `OUTBOX_MATCHES`, the pages where the extension takes Outbox's session and
  answers its messages.
- `extension/src/storage.ts`: `outboxUrl` in `DEFAULT_SETTINGS`, where the extension sends its API calls until
  another address is saved under **More** on its options page.

Two tests use the same address: `extension/src/content/bridge.test.ts` and `extension/e2e/outbox-bridge.spec.ts`.
Everything else that is yours (the auth secret, the Google client, the allowed emails) is a Worker secret
(step 4), not a file.

## 1. Cloudflare account and database

```bash
npx wrangler login
npx wrangler d1 create outbox
```

Copy the `database_id` that `d1 create` prints into the `DB` entry in `wrangler.jsonc`.

## 2. Schema

```bash
npm run db:migrate:remote
```

Run it again whenever `migrations/` gains a file. Schema changes start in
`worker/db/schema.ts`: `npm run db:generate` writes the migration, and `npm run db:migrate:local` applies it
locally.

## 3. Domains and deploy

In `wrangler.jsonc`, `routes` names the app's hostname as a Worker custom domain (its zone has to be on your
Cloudflare account). Change it to your own, then:

```bash
npm run deploy
```

Cloudflare creates the DNS record and certificate. Until step 4 is done, the app loads but can't sign anyone
in. `workers.dev` stays off, so the app has a single origin.

### Discover and Resume tools

These pages run on the NestJS service in `backend/`, on your own computer, and the deployed app reaches it through
`/api/tools`: the Worker checks the session, lets through only the routes the pages call, and forwards them over a
Cloudflare Tunnel with a token the service checks on a port of its own ([`worker/tools.ts`](../worker/tools.ts)).
Nothing is opened to the internet, and the service, its database and the model keys stay on that computer. The
pages work while it's awake and the service runs, and say they can't reach it otherwise. Until the steps below are
done, they say no service is connected; the tracker and profile work either way.

1. Set `TOOLS_TOKEN` in `backend/.env` to a long random string, and keep the service running at login
   ([backend/README.md](../backend/README.md#from-the-deployed-site)).
2. On the dashboard's **Workers VPC** page, create a tunnel and run the install command it shows on that computer,
   which keeps `cloudflared` running as a service.
3. Register the service on the tunnel, and put the ID this prints in `wrangler.jsonc` under `vpc_services`, as the
   `TOOLS` binding:

   ```bash
   npx wrangler vpc service create outbox-tools --type http --tunnel-id <tunnel id> --ipv4 127.0.0.1 --http-port 3101
   ```

4. Give the Worker the same token, then deploy:

   ```bash
   npx wrangler secret put TOOLS_TOKEN
   ```

Workers VPC is in open beta and free on every plan while it is.

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

Secrets apply immediately. Only emails in `OWNER_EMAILS` can create an account; anyone else is turned away. To
let someone else in, add their email there and to the consent screen's test users
([chrome-web-store.md](chrome-web-store.md#letting-someone-in)).

Migration `0003_profiles` adds the autofill profile's table: run `npm run db:migrate:remote` before deploying
this version.

## Autofill extension

The extension can go on the Chrome Web Store as an unlisted item, installed from its link: how is in
[chrome-web-store.md](chrome-web-store.md). For your own Outbox, build it and load it unpacked:

1. Build it:

   ```bash
   npm run ext:build   # writes extension/.output/chrome-mv3
   ```

2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick
   `extension/.output/chrome-mv3`. After each rebuild, press the reload arrow on the extension's card. This build
   takes no page on this machine for Outbox: with Outbox running locally, build with `npm run ext:dev` and load
   `extension/.output/chrome-mv3-dev` instead.
3. On Outbox, open the resumes panel (the document icon in the toolbar) and upload each resume PDF you send; each
   becomes a resume version. The extension downloads the one picked on its card.
4. Press **Fill profile** on a resume (this needs step 6's API key), or import a profile saved as JSON once from
   the profile panel (the card icon), then fill whatever **Still empty** lists and save. The extension fetches the
   profile before each fill, and whenever its options page (**Details → Extension options**) opens; **Status**
   there shows whose profile it holds.
5. Sign in to Outbox in the same Chrome profile; **Status** on the options page says whether the extension reaches
   it. The address (your app URL, or `http://localhost:5180` while developing) is under **More**.
   Logging uses Outbox's session cookie. If Chrome withholds it, the extension borrows the session of an open Outbox
   tab as a bearer token, which needs a Worker deployed with the `bearer` plugin (step 3 above, from this version
   on).
6. For AI, under **AI** on the options page, the provider is **OpenAI-compatible**, at OpenAI's own address unless
   you enter another. Pick the model, paste the key and press **Save**, which also tries it; **Load list** shows
   what the endpoint offers. To use Claude instead, pick **Anthropic**, and paste a key from the
   [Anthropic Console](https://console.anthropic.com) with a monthly spend limit. Without a key the rules still
   fill every field they can; the rest are listed for you.

The card opens on application pages, where its **Fill** button fills. On other sites, click the toolbar icon.

The free-text eval drafts 20 essay questions with each model and writes a side-by-side report to
`extension/evals/`. A run costs about $1:

```bash
ANTHROPIC_API_KEY=sk-ant-… EVAL_PROFILE=path/to/profile.json npm run eval -w extension
```

## Local development

```bash
cp .dev.vars.example .dev.vars   # set BETTER_AUTH_SECRET to any long random string
npm run db:migrate:local
npm run dev                      # http://localhost:5180
```

With `DEV_AUTH_BYPASS=true` in `.dev.vars`, the local app signs you in as a built-in developer account. The
Worker honors the bypass only on localhost, and `.dev.vars` is never uploaded.
