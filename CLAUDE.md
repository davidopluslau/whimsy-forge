# Whimsy Forge — notes for Claude

Single-user web app for building 3D interior designs and sharing them as read-only links.

- `docs/SYSTEM_DESIGN.md`: the architecture as built. Read it before starting any feature.
- `docs/WORKFLOW.md`: how work is planned and tracked, through GitHub Issues and feature briefs in `docs/features/`.
- `docs/PRODUCT.md`: requirements, scope and non-goals.

## Autonomy: one-shot each issue

Each `ready-for-agent` issue should be completed in **one uninterrupted session**, from start to merge-ready PR, without stopping to ask questions. Do not continue into the next issue or slice: the owner reviews and merges between them.

- **Decide and keep going** on design choices up to moderately consequential ones, especially reversible ones: library picks within the stack, file layout, UI details, data structures, snapping tolerances, naming. Pick the option that best fits the issue, its brief and `docs/PRODUCT.md`.
- **Record every such decision** in the PR description under a "Decisions made" heading: what you chose, the alternative, and why. That is how the owner reviews them.
- **Stop and ask only for very consequential choices** that are expensive to reverse or change the project's character, e.g. switching infrastructure providers, changing the storage model, adding a paid service, or dropping a requirement. In that case, finish everything that doesn't depend on the choice, then set out the options and a recommendation.
- If something outside the repo blocks you (e.g. a Cloudflare dashboard step), build and test everything you can, write the exact steps the owner must take in the PR, and still open the PR.

## How to work in this repo

- Work on one issue per session, on a branch named `<issue-number>-<short-name>` (e.g. `42-fit-dimensions`). Work with no issue uses a short descriptive name.
- Meet every acceptance criterion in the issue, then open a pull request that says `Closes #<n>`.
- Follow `.github/pull_request_template.md`. `gh pr create --body` doesn't apply it for you.
- Tick the issue's checklist, and the brief's slice table if there is one. The last slice of a feature deletes its brief, as `docs/WORKFLOW.md` describes.
- **Before every push, keep `docs/SYSTEM_DESIGN.md` live.** Review the branch's diff against `origin/main`. If it changes the architecture (components, API, auth, schema, storage, module boundaries, data flow, invariants, build or deploy), update the document and include that commit in the push. The document's "Keeping this document live" section defines what counts and how to edit it. State the outcome in the PR description: `System design: updated (<sections>)` or `System design: no substantive change`. A CI check fails without that line. This applies to all work in this repo.
- Every PR must pass: `npm run build`, `npm test`, and the Playwright smoke test (`npm run test:e2e`).
- If a criterion can't be met, say so in the PR description rather than quietly dropping it.
- **This repository is public,** including issues, briefs and `seed/`. Never commit or post photos of the owner's home, personal details or keys.

## Stack

- TypeScript (strict), Vite, React
- 3D: Three.js via React Three Fiber + drei
- State: Zustand — one store holds the Design document
- Wall cutouts: `three-bvh-csg`
- Asset compression: `gltf-transform`
- Hosting: Cloudflare Pages + Pages Functions (`functions/`)
- Storage: Cloudflare R2 (assets, design JSON); no database
- Tests: Vitest (logic), Playwright (smoke)

## Rules

- **The Design JSON is the source of truth.** The 3D scene is always derived from it; never store design state only in Three.js objects.
- **Units are meters** everywhere in code. The UI may display feet and inches.
- Every load of a design runs `migrate(doc)` to the current `schemaVersion`. Migrations are pure functions with tests.
- Design and snapshot IDs are unguessable (22-char random).
- Never put secrets in the front-end bundle. Write routes are protected by Cloudflare Access.
- Record the license and source URL of every third-party asset in the catalog.

## Folder map

The folders as they exist today, and how they depend on each other, are in `docs/SYSTEM_DESIGN.md`.

```
src/
  editor/      plan editor, 3D editor, panels
  viewer/      read-only share viewer
  scene/       R3F components that render a Design
  store/       Zustand store, commands (undo/redo)
  model/       Design types, migrate(), validation
  api/         client for functions/
functions/     Cloudflare Pages Functions (designs, snapshots)
scripts/       import-asset.ts and other tooling
docs/          product, workflow, system design, feature briefs and setup
```
