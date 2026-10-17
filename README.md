# Nudge

Make the first move. An account-backed outreach application and sideloadable Chrome extension for research positions, internships, and jobs.

This replaces the original browser-local opportunity organizer. Users upload their documents, connect Gmail, define a campaign, and authorize Nudge to research contacts, compose original personalized emails, read replies, and follow up. The website explains Nudge and provides a signed-in dashboard; the extension provides the same workspace plus current-page research and notifications.

## Run

Requires Node.js 24 (recommended). No provider credentials are shipped.

```sh
npm ci
npm run build
# Copy .env.example to .env and fill the required service settings.
npm start
```

Open http://localhost:3000. Without credentials, the marketing website and setup status work, but sign-in, research, and email delivery do not. See [SETUP.md](SETUP.md) for Auth0, Gmail, Gemini, database, extension, and deployment configuration.

## Workflow

1. Sign in through Auth0. The API verifies signed access tokens and scopes data to the token's subject.
2. Upload a resume and supporting PDF, DOCX, TXT, or Markdown files. Gemini extracts skills, experiences, education, and evidence. Writing samples or explicitly authorized sent-mail analysis produce a private style description.
3. Connect Gmail and the extension. Set the role, sectors, location/radius, and outreach preferences.
4. Authorize the campaign once. An optional account preference automatically authorizes future campaigns when connections are ready. Review-every-email remains available.
5. A durable backend worker researches across live search sources, checks publicly listed contact addresses and source excerpts, matches the applicant, generates original emails, and independently audits factual support.
6. The worker sends through Gmail, classifies replies, keeps conversations threaded, and generates replies or follow-ups. Opt-outs and bounces suppress further outreach. Uncertain or consequential situations require user input.
7. Inspect any thread, pause its campaign, take over the thread, or send your own reply from its timeline. Positive replies can hand off automatically or continue under the campaign preference.

## Implementation

| Area | Implementation |
| --- | --- |
| Website | Marketing page, account setup, campaigns, dashboard, conversations, private uploads |
| Extension | Manifest V3, Auth0 PKCE, full workspace, popup campaign controls, page DOM capture, notifications, two-second tipping loader |
| Identity | Auth0 SPA for website, Native app for extension, RS256 issuer/audience checks in API |
| Database | PostgreSQL in production; on-disk PGlite for local development and isolated PGlite databases for tests |
| Private data | AES-256-GCM for profiles, mailbox tokens, pending email content; ciphertext bound to account identity |
| AI | Gemini search grounding, source verification, profile extraction, style synthesis, original drafting, claim audit, reply classification |
| Mail | Gmail OAuth with offline access, real send/read/thread/label APIs, sent-message reconciliation |
| Scheduling | Background interval on an always-on Node server; authenticated scheduler endpoint also provided |

There is no hard-coded source allowlist or total research-source count. Research continues in successive passes. Provider quotas, model context windows, per-page download sizes, timeouts, and robots restrictions still apply. Geographic fit is evidence-checked by the model, not a deterministic geospatial database.

## Data handling

- No localStorage workspace or shared demo identity. Every record belongs to an Auth0 subject.
- Original uploaded files and raw sent-mail style samples are processed in memory and discarded. The extracted profile, supporting quotes, and synthesized style are retained privately.
- Gmail message bodies are retrieved on demand and sent to Gemini only for the requested processing. They are not retained as a second inbox. Pending outbound content is encrypted and removed after confirmed delivery or cancellation.
- Thread IDs, contact research, statuses, event summaries, and message IDs persist for the timeline. This metadata retention is explained in [DESIGN_ALIGNMENT.md](DESIGN_ALIGNMENT.md).
- Nudge does not collect a training dataset or fine-tune on user emails. External providers' own processing/retention settings still need review during deployment.
- Disconnecting Gmail pauses campaigns and revokes access. Account-data deletion removes Nudge records but does not delete the Auth0 identity or emails already in Gmail.

## Verification and current limits

```sh
npm run check
npm test
npm run build
```

Tests use real SQL/storage with simulated Gmail and AI adapters. They cover authorization, ownership, encryption, send/reply transitions, rate controls, takeover, opt-outs, and uncertain-delivery reconciliation. They are not proof of live provider behavior. Live Auth0, Gmail, Gemini, and Chrome extension integration must be verified with configured service accounts before enabling sending. `EMAIL_SENDING_ENABLED` defaults to false.

Gmail delivery cannot be made exactly-once across a database and an external provider. Nudge uses a stable Message-ID and durable outbox state. An ambiguous send is checked against Gmail and never automatically resent if absent. Human investigation may be required.

Research may return no verified contacts. Sites that block automated access or need login are not bypassed. Scanned PDFs need OCR before upload. Outlook, calendar integration, automated resume attachment, offer acceptance, model fine-tuning, training opt-in collection, and learned cross-campaign optimization are not implemented. The extension must be signed in again when its short-lived Auth0 session expires; backend campaigns continue using the authorized Gmail refresh token.

The dependency audit currently reports a moderate `sprintf-js` advisory through Mammoth's CLI dependency chain. The application calls Mammoth's library parser and never its CLI formatter. This remains a dependency issue to track; do not use `npm audit fix --force` to downgrade document parsing blindly.

## Source layout

```text
server/       Authenticated API, database, research, Gmail, and worker
web/          Shared website / extension account workspace
extension/    Chrome service worker, popup, options, workspace entry
scripts/      Build and validation commands
tests/        Integration and security behavior tests
public/       Built website and downloadable extension
```

The previous prototype remains recoverable from Git history. This branch is a backend rebuild, not an update to the old ChatGPT Sites deployment.
