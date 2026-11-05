# Whimsy Forge

Build 3D interior designs and share them as read-only links.

- Plan: [docs/PLAN.md](docs/PLAN.md)
- Milestones: [docs/milestones](docs/milestones)
- Cloudflare setup: [docs/setup/cloudflare.md](docs/setup/cloudflare.md)
- Notes for Claude Code: [CLAUDE.md](CLAUDE.md)

Status: [M0 — Spike and scaffolding](docs/milestones/M0.md) is built and awaiting Cloudflare setup.

## Development

Requires Node 22 or newer.

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
| `npm run seed:remote` | Uploads `seed/` to the real R2 bucket |

Locally, `/editor` and API writes return 401 because Access isn't configured. The e2e tests sign their own short-lived tokens with a throwaway key.

## Assets

| Asset | Source | License |
| --- | --- | --- |
| Painted Wooden Chair 01 | [Poly Haven](https://polyhaven.com/a/painted_wooden_chair_01) | CC0 1.0 |
| Laminate Floor 02 | [Poly Haven](https://polyhaven.com/a/laminate_floor_02) | CC0 1.0 |
| Herringbone Parquet | [Poly Haven](https://polyhaven.com/a/herringbone_parquet) | CC0 1.0 |
| Floor Tiles 06 | [Poly Haven](https://polyhaven.com/a/floor_tiles_06) | CC0 1.0 |
| White Plaster 02 | [Poly Haven](https://polyhaven.com/a/white_plaster_02) | CC0 1.0 |
| Painted Plaster Wall | [Poly Haven](https://polyhaven.com/a/painted_plaster_wall) | CC0 1.0 |
| Red Brick | [Poly Haven](https://polyhaven.com/a/red_brick) | CC0 1.0 |

The chair was packed to a GLB with `gltf-transform`, with textures converted to 1024 px WebP. The materials are Poly Haven's 1K maps converted to WebP by `scripts/fetch-materials.mjs`. Each asset's license and source are also in `seed/catalog.json`.
