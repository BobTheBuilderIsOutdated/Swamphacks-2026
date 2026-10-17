# Vercel deployment

Deploy `feat/autonomous-outreach`, not the older `main` branch or the static `gh-pages` branch. Import the branch URL if the import screen defaults to main:

https://github.com/BobTheBuilderIsOutdated/Swamphacks-2026/tree/feat/autonomous-outreach

Use Other preset, root `./`, Node.js 24, build `npm run build`, output `public`, install `npm ci`. The checked-in vercel.json routes API requests to the server function and serves the full website from the same deployment.

## First deployment and database

You can deploy the static interface before adding secrets. API requests return a setup error until configured. In the Vercel dashboard, add a PostgreSQL database through Storage / Marketplace (for example Neon), then connect it to the project. Use a **direct/unpooled** TLS connection as DATABASE_URL: the worker uses PostgreSQL session advisory locks, which require a session-preserving connection. Do not use a transaction-mode pooled URL for this implementation.

Set these variables in the project environment, then redeploy:

| Variable | Value |
| --- | --- |
| APP_URL | Exact stable HTTPS Vercel production origin, without trailing slash |
| AUTH0_DOMAIN | dev-855gadshd5z5hly6.us.auth0.com |
| AUTH0_CLIENT_ID | ytA2X0Ze9Is4OXjz8dw9TQQ2a3YldnYQ |
| AUTH0_AUDIENCE | https://api.nudge.app |
| DATABASE_URL | Private direct PostgreSQL connection string |
| DATA_ENCRYPTION_KEY | Private random 32-byte base64 key |
| EMAIL_SENDING_ENABLED | false |
| WORKER_ENABLED | false |

Generate DATA_ENCRYPTION_KEY locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and paste it only into Vercel's environment settings. Keep it stable; replacing it makes existing encrypted records unreadable. Add Gemini, Google OAuth, extension and scheduler settings from SETUP.md later. Keep production secrets out of untrusted preview deployments.

## Auth0 URLs

Keep existing GitHub Pages entries, and add these using the actual deployment origin:

- Allowed Callback URLs: `https://YOUR-PROJECT.vercel.app/auth/callback`
- Allowed Logout URLs: `https://YOUR-PROJECT.vercel.app`
- Allowed Web Origins: `https://YOUR-PROJECT.vercel.app`

The signed-in workspace runs on Vercel. The GitHub Pages website remains the marketing/download site until explicitly linked to that workspace.

## Automation limitations — required before enabling sending

The Vercel entrypoint does not start an in-memory interval. Manual Run now and the authenticated `/api/cron` endpoint await their work instead of starting detached promises. No schedule is silently enabled by this deployment. Hobby built-in cron supports at most one run per day; it is insufficient for frequent reply handling.

Use a separate always-on Node worker (`npm start`, same database/encryption/provider configuration) for sustained outreach, or implement bounded queued jobs before scheduling substantial work on Vercel. The current worker pass has no guaranteed upper duration and may exceed the 300-second function limit at scale. A hard interruption can delay research and require uncertain-delivery reconciliation. This adapter is not a completed durable serverless job system. Keep sending disabled until live testing and the worker arrangement are complete.

Vercel request bodies are limited to 4.5 MB in total, including multipart overhead. Keep combined documents and writing samples below 4 MB per upload on this deployment. Large uploads need direct object storage, which is not implemented. Sent-mail style learning can also exceed the function duration for large mailboxes.

Validation before launch: `/api/health` returns ok; Auth0 login returns to dashboard; two accounts cannot see each other's records; document profile extraction works; Gmail test mailbox send/reply and worker resumption are verified. Provider integration and Vercel deployment must be tested with actual service accounts.
