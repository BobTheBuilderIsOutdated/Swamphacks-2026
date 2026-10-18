# Preconfigured test extension

The extension defaults to https://nudge-alpha-mocha.vercel.app and obtains public Auth0 configuration from its API. No API keys or client secrets are bundled. Existing custom server settings are preserved; Settings offers a reset to the standard server.

## Owner setup (once)

Create an Auth0 Native application named Nudge Chrome. Enable Authorization Code with PKCE (no client secret/token endpoint authentication). Register:

- Allowed callback URL: `https://akhpkkmdedkkpffmaacbogcickkflamp.chromiumapp.org/auth0`
- Allowed origin (CORS): `chrome-extension://akhpkkmdedkkpffmaacbogcickkflamp`
- Authorize this application for user-delegated access to Nudge API (`https://api.nudge.app`).

In Vercel Production, set `AUTH0_EXTENSION_CLIENT_ID` to this Native application's public Client ID and append `chrome-extension://akhpkkmdedkkpffmaacbogcickkflamp` to `EXTENSION_ORIGINS` (comma-separated; preserve any existing entries). Redeploy the current working production version to apply these values. Existing backend code already supports these variables; this extension branch need not be promoted to test its local ZIP.

## Tester setup

Build with `npm run build`. Extract `public/nudge-extension.zip`, visit `chrome://extensions`, enable Developer mode, and Load unpacked the folder containing manifest.json. Confirm ID `akhpkkmdedkkpffmaacbogcickkflamp`, then open the popup and Sign in to Nudge. No server settings should be needed on a fresh install. Native Chrome login must be tested manually; automated tests mock configuration requests only.

The checked-in public manifest key stabilizes unpacked IDs. It is not a secret. A future Chrome Web Store listing has its own store identity; use its public key and update callback/origin registrations before distributing that release.

Keep `EMAIL_SENDING_ENABLED=false` during testing. Confirm the website Account page shows the extension connected after login, then test opening the extension workspace. Do not activate outreach merely to test installation.

## Rollback

Known-working release: `eaf1e8e`.
GitHub tag: `rollback/pre-extension-plug-and-play-eaf1e8e`.
Changes are isolated on `feat/extension-plug-and-play`; the original `feat/autonomous-outreach` branch is unchanged.

To restore files without overwriting this work, create a separate checkout with `git worktree add ../nudge-before-extension rollback/pre-extension-plug-and-play-eaf1e8e`. In Vercel restore the deployment built from eaf1e8e if this branch was promoted. Remove the test extension in Chrome. Restore previous extension-specific environment values if changed; the Git tag does not back up cloud settings, databases, or user data.
