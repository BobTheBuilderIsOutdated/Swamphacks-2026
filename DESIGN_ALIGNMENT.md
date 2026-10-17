# Design alignment and decisions

The four-page Nudge design document and the user's subsequent corrections define the product. This rebuild removes the fixed opportunity marketplace and local-only template editor.

| Requirement | Rebuild |
| --- | --- |
| Minimal user interaction | Upload documents, connect services, set campaign goal, authorize once; background work handles subsequent research, drafts, replies and follow-ups |
| Auth0 | Website and extension PKCE; API validates Auth0 access tokens; database records keyed by Auth0 subject |
| Resume-derived fit | PDF/DOCX/text extraction, Gemini profile with document evidence, automatic research and skill matching |
| Private writing signature | Encrypted synthesized style, learned from writing samples or expressly authorized sent mail; omitted from dashboard API responses |
| Broad research | Live grounded search across arbitrary public sites; recurring passes, no fixed source list or overall source cap |
| Personalized email | New LLM-generated email for the actual contact and context; no substitution templates; independent claim audit |
| Autonomous campaigns | Explicit campaign authorization; opt-in auto-authorization for future campaigns; pause and takeover controls |
| Threads per lead | Persisted lead/thread association, statuses and timeline; Gmail bodies fetched on demand |
| Reply management | Classify question, positive, rejection, opt-out, bounce, vacation and sensitive replies; generate appropriate responses or hand off |
| Shortlist | Positive/handoff leads appear as promising conversations, with Gmail labels and extension notifications |
| Extension | Full account workspace, onboarding, campaign controls, active-page capture, server research trigger, notifications, two-second tipping wordmark |
| Website | Marketing page plus signed-in account/campaign/conversation dashboard |
| Follow-up restraint | Configurable interval and count, persistent trigger keys, recipient deduplication, stop on opt-out/bounce/rejection |
| Human takeover | Take over thread or entire campaign from the conversation; write and send a manual reply; resume a thread explicitly |

## Conflicts resolved

1. **Review every message versus autonomous delivery.** The document calls for review before sending. The user explicitly chose campaign-level authorization, autonomous sending/replies, and an optional auto-authorize setting. The newer choice governs. Review-every-email remains an optional campaign mode; auto-authorization defaults off.
2. **Auth0 as encryption/storage.** The document calls Auth0 encryption. Auth0 provides identity and access tokens; it is not the application's profile database or general encryption layer. PostgreSQL stores account data and AES-256-GCM encrypts profile/style, mailbox tokens and queued message bodies.
3. **No permanent inbox data versus persistent timelines.** Raw inbox bodies and writing samples are not copied permanently. Gmail IDs, lead research, statuses and summarized events are stored for the requested timeline. The extracted resume profile and supporting quotes are retained as explicitly requested. Pending email bodies are removed after confirmed send or cancellation. This is metadata retention, not a full-inbox archive.
4. **Everything in the extension versus continuous operation.** The extension is the control surface, but the backend runs the model, keeps secrets, persists account state, sends through Gmail, and works while Chrome is closed. A service worker alone cannot guarantee continuous execution.
5. **No limit on research sources versus operational bounds.** There is no hard-coded source allowlist or total source count. Work is divided into continuing passes. Per-request timeouts, page size limits, model context windows, robots rules, email budgets, and provider quotas are necessary operational boundaries and are visible in setup/preferences.

## Deliberately not claimed as finished

- Live service accounts, real Gmail sends, real model quality, production hosting, Chrome end-to-end authentication, and external provider verification are not verified until the owner configures the services.
- No automated bypass of login-required or crawler-blocked websites; no guarantee of exhaustive discovery of every organization in a radius.
- No training dataset/opt-in collection or fine-tuning pipeline. Nudge training collection remains off. No separate learning-based engagement optimizer is implemented.
- No Outlook integration, OCR for image-only PDFs, calendar scheduling, automatic sensitive attachments, or automatic acceptance of an offer or commitment.
- The logo referenced in the PDF was not supplied as a separate asset. The rebuild uses a Nudge wordmark and arrow.
- Taking over a campaign pauses it; requests already handed to Gmail may complete. A paused campaign can be explicitly reauthorized from Campaigns.

These are concrete implementation boundaries, not substitutes for the autonomous outreach objective.
