# Connect the real services

The code does not contain working provider credentials. Complete these steps before expecting live automation. Use a test Gmail account for the first end-to-end run. Do not paste secrets into GitHub or chat.

## 1. Local server and encryption

Install Node.js 24, run `npm ci`, and copy `.env.example` to `.env`. Generate an encryption key locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set that output as `DATA_ENCRYPTION_KEY`. Keep it stable and back it up securely: changing it makes existing encrypted profiles and Gmail credentials unreadable. Set `APP_URL=http://localhost:3000` for local development.

Leave `DATABASE_URL` empty locally to use the private on-disk database in `data/nudge`. Never commit that directory. Production requires a PostgreSQL connection string with TLS verification configured according to the database provider. The server applies `server/schema.sql` idempotently at startup. Use a dedicated application database and server-only credentials, not a browser-exposed database key. For multi-instance production, apply schema changes during a controlled migration step before scaling.

## 2. Auth0

Create an Auth0 tenant and a custom API with identifier such as `https://nudge-api`; use RS256 signing. Set `AUTH0_DOMAIN` (hostname only) and `AUTH0_AUDIENCE` to the API identifier.

Create a **Single Page Application** for the website:

- Allowed callback URL: `http://localhost:3000/auth/callback`
- Allowed logout URL: `http://localhost:3000`
- Allowed web origin / CORS origin: `http://localhost:3000`
- Set its public client ID as `AUTH0_CLIENT_ID`.

Create a **Native Application** for the extension with Authorization Code + PKCE and no client secret. Set `AUTH0_EXTENSION_CLIENT_ID`. After loading the extension, its Settings page displays the exact redirect URI and extension origin. Register:

- Callback URL: `https://YOUR_EXTENSION_ID.chromiumapp.org/auth0`
- Allowed CORS / web origin where supported: `chrome-extension://YOUR_EXTENSION_ID`
- Server `.env`: `EXTENSION_ORIGINS=chrome-extension://YOUR_EXTENSION_ID`

Use the same Auth0 tenant and user identity for website and extension. When deploying, add the real HTTPS website callback/logout/origin URLs. A Native application's public client ID is not a secret. No Auth0 management token is needed.

## 3. Gmail

Create a Google Cloud project, enable Gmail API, and configure an OAuth consent screen. During development, add the Gmail account as a test user.

Create a **Web application** OAuth client with redirect URI:

```text
http://localhost:3000/api/gmail/callback
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server. Production uses `https://YOUR_HOST/api/gmail/callback`. Nudge requests `gmail.modify` because the workflow needs sending, reading thread replies, and managing Nudge labels. This is a restricted scope; public distribution can require Google's verification and security review. Testing-mode refresh tokens can expire; reconnect if needed. Auth0 login and Google mailbox consent are separate steps.

Do not enable a service account or domain-wide delegation for this consumer mailbox flow. Users connect their own mailbox through OAuth. The server stores refresh tokens encrypted, and the extension never receives a Gmail refresh token.

## 4. Gemini

Create a Gemini API key in Google AI Studio and set `GEMINI_API_KEY` on the server. The configured model defaults to `gemini-2.5-flash`. Confirm that your project has access to the model, structured JSON output, and Google Search grounding; configure `GEMINI_MODEL` if needed. Provider quotas and charges apply; this build does not promise free unlimited usage.

No API key is embedded in browser or extension code. Resume content and relevant conversation content go to Gemini for the user-requested tasks. Review provider data settings before deploying to other users.

## 5. Build and sideload

```sh
npm run build
npm start
```

Open Chrome's `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the repository's `extension` directory. Alternatively unzip `public/nudge-extension.zip` and load that folder. The build includes all local JavaScript; there are no remote executable scripts.

Open extension Settings, set the server origin, grant that host permission, and register the extension origin/callback in Auth0 and `.env` as described above. Reload the server after changing environment variables, then sign in through the extension.

From the extension workspace or website dashboard: upload a resume, connect Gmail, create a campaign, review its authorization, and start it. The extension is required to activate a campaign. Account-level automatic authorization is off by default and can be enabled explicitly in Account settings.

## 6. Verify before enabling delivery

Keep `EMAIL_SENDING_ENABLED=false` initially. Confirm all of the following:

1. Website and extension sign in as the same user and show the same account data.
2. A second user cannot read the first user's profile or threads.
3. Document extraction and private writing style work with your actual input.
4. Research returns real, public, source-verified contacts with an appropriate geographic fit.
5. Drafts use truthful evidence and naturally match your voice.
6. Use a controlled campaign/contact and your test mailbox to verify delivery, Gmail threading, replies, opt-outs, follow-ups, pause, takeover, and notifications.

To permit actual sending, set `EMAIL_SENDING_ENABLED=true` and restart. An active authorized campaign can then send queued emails without another click. Enabling sending does not itself authorize a paused campaign.

## 7. Deploy the full backend

This implementation is an always-on Node server with PostgreSQL. Run it on a service that supports a long-lived Node process or the provided Dockerfile. Set environment variables in the hosting provider's secret store. Use HTTPS and a production PostgreSQL instance. Configure Auth0 and Google redirect URLs for the final origin.

```sh
docker build -t nudge .
docker run --env-file .env -p 3000:3000 nudge
```

Do not upload only `public/` and expect automation: the server and database are required. This is not currently packaged as Vercel serverless functions. A serverless deployment would need an adapter and a durable job runner; simply deploying the frontend to Vercel is insufficient.

The default worker runs every 60 seconds while the server is alive. Multiple server instances coordinate with a PostgreSQL advisory lock. For an external scheduler, set `WORKER_ENABLED=false`, generate a strong `CRON_SECRET`, and call `POST /api/cron` with `Authorization: Bearer YOUR_CRON_SECRET`. Avoid overlapping request timeouts; campaign work can take longer than a serverless execution limit. Restarted workers reconcile uncertain sends before proceeding.

## Live verification status

No Auth0 tenant, Google OAuth app, Gemini key, or production database was connected during implementation. Automated tests simulate the external providers. Chrome PKCE, provider quota behavior, geographic inference, model output quality, production PostgreSQL advisory locks, and real-mail delivery require the live smoke test above.

Official references: [Auth0 token verification](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens), [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [Gmail threading](https://developers.google.com/workspace/gmail/api/guides/threads), [Gemini search grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search).
# GitHub Pages website

The public website is hosted at https://bobthebuilderisoutdated.github.io/Swamphacks-2026/ from the `gh-pages` branch. It includes the marketing site, extension download, and an explicit setup screen. GitHub Pages cannot run the Node backend, database, or email worker; those features require the server setup below. No API keys belong in the Pages build.

To update this deployment, run `node scripts/build-pages.mjs` and publish the contents of `pages-dist/` to the root of `gh-pages`. Keep backend source on `feat/autonomous-outreach`. The standard `npm run build` remains the full server/extension build.



## Permanent Nudge account deletion

Create a server-only Auth0 Machine to Machine application authorized for the Auth0 Management API with only `delete:users`. Set `AUTH0_MANAGEMENT_CLIENT_ID` and `AUTH0_MANAGEMENT_CLIENT_SECRET` in Vercel Production, using the same tenant as `AUTH0_DOMAIN`, then redeploy. Never put this secret in an extension or browser configuration. See https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api.

The account deletion dialog deletes the authenticated user's Nudge Auth0 user and local profile/campaign data, and revokes Gmail access. It does not delete their Google account or Gmail messages. Missing configuration prevents deletion; provider failures leave campaigns paused and allow retry. A hash of the deleted Auth0 subject remains to reject old bearer tokens and prevent automatic account recreation. That same Auth0 subject cannot be reused in Nudge; signing up with a newly issued Auth0 subject creates a separate account. Use a separate test identity to verify deletion, never a real demo account. Auth0 deletion cannot be rolled back with a code rollback.

## Single-person research

Use **Research one person** on Overview or Campaigns. Supply the exact professional name, organization, public professional page, and your actual outreach objective. Only one verified contact can be added; unrelated people are rejected and missing public email evidence is not guessed. Name/organization matching is conservative: spelling differences may produce no result. Geographic radius is not applied to an explicitly named person. Every email requires review, the campaign starts paused, and the global sending switch still applies. This is public professional-source research, not private-account access.

## Rollback for this change

The previous UI and extension code is commit `2cd6003`. Redeploy that revision to roll back this code. The new `deleted_identities` table is additive and can remain. Rolling back to older code also removes its old-token rejection, so do not roll back after deleting real accounts without retaining that check. Keep `EMAIL_SENDING_ENABLED=false` for the hackathon demo.
