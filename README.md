# Whimsy Forge

Build 3D interior designs and share them as read-only links.

- Plan: [docs/PLAN.md](docs/PLAN.md)
- System design: [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md)
- Milestones: [docs/milestones](docs/milestones)
- Cloudflare setup: [docs/setup/cloudflare.md](docs/setup/cloudflare.md)
- Notes for Claude Code: [CLAUDE.md](CLAUDE.md)

Status: [M0 — Spike and scaffolding](docs/milestones/M0.md) is built and awaiting Cloudflare setup.

## Development

Requires Node 22.18 or newer, which runs the TypeScript scripts directly.

```sh
npm ci
npx playwright install chromium   # first time only
```

| Command | What it does |
| --- | --- |
| `npm run dev:pages` | Builds and serves the whole app, with Functions and local R2, on port 8788 |
| `npm run dev` | Vite with hot reload; forwards `/api` to port 8788, so run `dev:pages` too |
| `npm run build` | Type-checks and builds to `dist/` |
| `npm test` | Unit tests |
| `npm run test:e2e` | Playwright against a fresh build on the Pages runtime with local R2 |
| `npm run import-asset -- <file> …` | Imports one model or image into the catalog; see below |
| `npm run seed:models` | Rebuilds the seed furniture from Poly Haven into `seed/`, without uploading it |
| `npm run seed:remote` | Uploads `seed/` to the real R2 bucket |

Locally, `/editor` and API writes return 401 because Access isn't configured. The e2e tests sign their own short-lived tokens with a throwaway key.

## Importing an asset

One command imports a model or an image and makes it appear in the catalog panel, with no deploy:

```sh
npm run import-asset -- ~/Downloads/oak_table.glb --name "Oak table" --category table --license "CC0 1.0" --source https://example.com/oak-table
```

It normalizes the model to meters with its pivot at bottom center, compresses it (meshopt geometry, WebP textures), renders a thumbnail, writes it to `seed/`, uploads it to R2 and adds it to `seed/catalog.json`. Then commit `seed/`, so the next import starts from this catalog.

A model is assumed to be in meters, as glTF specifies. If it isn't, correct it with `--scale 0.01` or give its real size, such as `--height 0.75`. Models should face +z; `--rotate-y <degrees>` turns one that doesn't. Add `--local` to upload to the local R2 instead, and `--help` for every option.

## Assets

Every asset is CC0 1.0, from [Poly Haven](https://polyhaven.com). `seed/catalog.json` records each one's license and source URL.

The furniture comes from `scripts/seed-models.ts` and goes through the same pipeline as any import. The materials are Poly Haven's 1K maps converted to WebP by `scripts/fetch-materials.mjs`.
