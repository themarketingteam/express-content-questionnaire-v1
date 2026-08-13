# Base44 deployment source of truth

This checkout is the only local checkout authorized to deploy Base44 app `6913611c0ea0f6b631343af8`.

- Canonical GitHub origin: `https://github.com/themarketingteam/express-content-questionnaire-v1.git`
- Release branch: `main`
- Canonical local folder: `Express-Content-Questionnaire-v1`

Use the guarded npm scripts for every deployment. The guard rejects a mismatched Base44 app, a different GitHub origin, a dirty tree, a non-`main` branch, or a local commit that is not the exact current GitHub `main` commit.

```bash
npm run deploy:base44
npm run deploy:base44:site
npm run deploy:base44:functions
```

The legacy checkout at `../Express-Content-Questionnaire` intentionally has no `base44/.app.jsonc` link. Do not relink or deploy it. Preserve it only until any unrelated local work has been reviewed and archived.
