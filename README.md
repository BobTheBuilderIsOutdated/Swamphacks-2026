# Nudge

A responsive outreach workspace and Chrome opportunity clipper.

## Run

Serve `dist` with any static HTTP server. No build step or JavaScript dependencies are required. For example, with Python installed:

```sh
python -m http.server 8080 --directory dist
```

Open http://localhost:8080 in your browser.

To try the Chrome extension, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension` directory. Open an opportunity page and click the extension to copy its title and URL. Add those details to a new opportunity in the website.

## Project structure

```text
dist/          Static website and downloadable extension archive
extension/     Chrome Manifest V3 extension source
```

Any static web host can serve `dist`. Publishing this repository to GitHub does not itself deploy a website. No API credentials are needed for the current implementation.

## Implemented

- Responsive discovery workspace with six explicitly fictional examples, search, type and location filters.
- User-created opportunities with source links and skill overlap ranking.
- Profile, shortlist, template-based drafts, draft editing, clipboard copy, and MIME email export.
- Manual outreach status tracking, JSON backup export, and local data deletion.
- Chrome active-tab title/URL capture with no broad host or inbox permissions.

## Boundaries

This is a working browser-local MVP, not a production full-stack service. Data is stored in localStorage, without cross-device sync or at-rest application encryption. Hosted access is provided by private Sites hosting. Auth0, live job scraping, Gemini generation, resume parsing, automated voice matching, mailbox OAuth, inbox classification, and automatic sending are not implemented. The app explicitly labels example data and template generation. There are no API keys in the client. No emails are sent by the application.

## Next production slice

Add an authenticated server, per-user database authorization and a secrets-backed model endpoint. Store verified source excerpts alongside generated claims and evaluate unsupported-claim rates. Integrate email provider OAuth with minimal scopes, per-draft explicit send approval, idempotent sending, reply detection and deletion policies. Keep provider credentials on the server. Browser storage should be migrated only with user consent.

## QA

JavaScript syntax checks passed for the website and extension. Browser checks exercised profile saving, skill overlap, template draft creation and saving, persistence after reload, placeholder export validation, manual outreach status, and the search empty state. The extension has not been tested inside Chrome, and live email export delivery has not been tested. No automated test suite is included.

Run the syntax checks with Node.js:

```sh
node --check dist/app.js
node --check extension/popup.js
```
