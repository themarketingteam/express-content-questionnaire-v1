# Local Express questionnaire

Run `npm run local:start`, then open [the local Express questionnaire](http://localhost:5174). Double-clicking `Start Local Express Questionnaire.command` does both. Use `npm run local:status` and `npm run local:stop` to manage it, or `npm run dev:local` to keep the server in your terminal.

This entry uses the actual Express questionnaire and submission flow with a separate local adapter. Base44, Zapier, remote authentication, Google Places, analytics, and external integrations are disconnected. Native keepalive requests also point to this local API. Unknown routes fail locally. The loopback server and browser Content Security Policy prevent external requests.

The first visit loads a synthetic legacy sample with all questions answered, three services, and one industry. The toolbar can load a new sample or a blank draft, inspect/export JSON, view saved versions, restore a version into a separate draft, and inspect exact submission captures. Original Express limits remain three to six services and one to three industries. Every selected page counts once, including custom parents. Legacy answers keep their original format until an organizer edit is made.

Drafts, immutable prior versions, and captures are saved in `.local-preview/state.json`. Writes use atomic rename and roll back in-memory changes on failure. No production client records are loaded or changed. Loading another local fixture keeps previous local drafts/history. Local browser storage lives at port5174, separate from the Pro preview at port5173.

`npm run build:local` builds the isolated UI into `dist-local`. `node --test tests/local-preview-api.test.mjs` verifies the local API without network calls. Use the explicit local commands above for isolated testing. Standard dev/build/preview commands use the production configuration so Base44 and hosting builds cannot accidentally ship the local adapter; deployment commands are separate from local testing.

An example of the complete outbound payload is saved in [docs/examples/full-express-submission-example.json](docs/examples/full-express-submission-example.json). It was generated through the real mapper, repair, and wire builder with networking disabled. Run `node scripts/generate-local-example.mjs` to regenerate it. Its organized service and industry nodes contain labels and sources, plus children for nonempty parents; editor IDs remain in raw local drafts only.
