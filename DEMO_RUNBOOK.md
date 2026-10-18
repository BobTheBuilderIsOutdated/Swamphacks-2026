# Dartmouth AI/ML presentation scenario

Open `https://nudge-alpha-mocha.vercel.app/?demo=DARTMOUTH-AI-2026` after deploying this branch. No login, credentials, or environment-variable change is needed. The exact trigger is `DARTMOUTH-AI-2026`; entering it as a campaign name also opens the scenario instead of submitting that campaign (other required form fields must be filled).

This is a browser-only scripted fixture. Researcher names, affiliations, topics, and source links come from Dartmouth institutional pages. Alex Morgan, their projects, all messages, replies, delivery counts, timeline times, and workflow outcomes are fabricated. They do not establish actual openings, interest, or endorsements. The presenter will disclose this verbally. No disclosure banner is added to the application.

## Three-minute route

1. Start on Overview: introduce Alex, a student interested in trustworthy AI near Hanover. The account profile contains three concrete projects that support the draft claims.
2. Click **Continue walkthrough**: three organizations appear in the timeline: Minds, Machines, and Society; Pervasive Intelligent Systems Lab; Hassanpour Lab. Explain the organization-first stage. Source city labels are used; no precise distances or live search timing is fabricated.
3. Click again: three faculty contacts appear in Conversations. Open a contact and expand Research & sources for an actual Dartmouth source.
4. Close the dialog and click again: three different drafts await review. Show how the wording changes for LLM interpretability, human-centered NLP, and multimodal pathology research. A résumé is not uploaded or sent anywhere.
5. Click again: a scripted later state shows two sent introductions and two requests for project materials. The third draft remains unsent for comparison. The two replies are invented for the scenario, not received from the named researchers. Open a thread, inspect the exchange, and demonstrate takeover or a local reply.
6. **Start over** resets just this browser tab’s scenario. **Exit** returns to the normal website.

The scenario is isolated even when production EMAIL_SENDING_ENABLED=true. All API routes are intercepted locally; unsupported actions fail locally rather than falling through to the backend. Profile uploads, Gmail connection, deletion, and new real campaigns are unavailable within the scenario. Existing live campaigns continue independently; this mode does not pause them.

The stage-4 transition is a prepared snapshot, not a real approval or send operation. Use Continue walkthrough to advance; Run now also advances one stage. Pausing the scenario campaign prevents advancement until resumed. Session state survives reloads in this tab; use Start over before presenting.

## Public sources checked October 18, 2026

- https://qss.dartmouth.edu/people/soroush-vosoughi
- https://web.cs.dartmouth.edu/people/sarah-m-preum
- https://geiselmed.dartmouth.edu/faculty/facultydb/view.php/?uid=6539

## Rollback

Previous main is `6bbd762`. This feature is additive and does not modify the server, database schema, credentials, or email sender. Deploying the previous commit removes the scenario entry point.
