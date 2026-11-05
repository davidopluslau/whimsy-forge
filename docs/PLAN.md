# Whimsy Forge — Plan

Live, editable version: https://claude.ai/artifact/BZ14gWjvevRqd2Tpncr411 (this file is the copy Claude Code works from).

## Overview

Whimsy Forge is a single-user web app for building 3D interior designs and sharing them as read-only links. It is built milestone by milestone by Claude Code, on the cheapest infrastructure that still serves 3D model files and public share links.

**Requirements**

1. Model a room in 3D at real-world scale and place objects in it: furniture, paintings, rugs, lights.
2. Send a design to other people, who can view it without an account.

**In scope:** one editor (the owner), any number of read-only viewers, a personal furniture catalog, desktop editing, phone-friendly viewing.

**Non-goals:** multi-user editing, real-time collaboration, photoreal ray-traced renders, e-commerce links, a public catalog for other users.

## Architecture decision

**Decision (provisional): a static site on Cloudflare Pages, 3D assets in Cloudflare R2, designs as JSON documents in R2 or D1.** Milestone M0 confirms it before any feature work.

| Option | What it is | Strengths | Weaknesses |
| --- | --- | --- | --- |
| A. Claude artifact | Page, database and uploads all hosted on claude.ai | No setup; sharing and roles built in | Asset store does not list `.glb`/`.gltf`; sandbox likely blocks calls to outside services; its database needs a signed-in Claude viewer |
| **B. Static host + object storage (chosen)** | Cloudflare Pages for the app, R2 for models and textures, D1/KV or R2 JSON for designs | Any file type; public links; custom domain; free tiers fit one user | You own deploys, CORS and write-auth |
| C. No backend | Static site; a design travels as a compressed blob in the URL or a downloaded file | Simplest possible | No gallery or history; long links; assets still need a home |

Why B: requirement 2 needs links that open for people without a Claude account, and the catalog needs binary 3D files. The design document format does not depend on the host, so switching later means swapping one storage adapter.

## Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language / build | TypeScript, Vite | Strict mode on |
| UI | React | Panels, catalog, forms |
| 3D | Three.js via React Three Fiber + drei | `OrbitControls`, `TransformControls`, `useGLTF`, `Environment` |
| State | Zustand | One store holds the Design document; the scene renders from it |
| Geometry | `three-bvh-csg` | Door and window cutouts in walls |
| Asset compression | `gltf-transform` CLI | Draco/meshopt meshes, KTX2 or WebP textures |
| Hosting | Cloudflare Pages + Pages Functions | Small API: save/load designs, issue share links |
| Storage | R2 (assets, design JSON), optional D1 (index of designs) | |
| Tests | Vitest (logic), Playwright (smoke test that a scene loads) | |

## Data model

A design is one small, versioned JSON document that references assets by ID. The 3D scene is always derived from it.

```typescript
type Design = {
  schemaVersion: 1;
  id: string;            // unguessable, e.g. 22-char random
  name: string;
  updatedAt: string;     // ISO timestamp
  room: {
    wallHeight: number;  // meters
    walls: { id: string; start: [number, number]; end: [number, number]; thickness: number; materialId?: string }[];
    openings: { id: string; wallId: string; kind: 'door' | 'window'; offset: number; width: number; height: number; sill: number }[];
    floorMaterialId?: string;
  };
  items: {
    id: string;
    assetId: string;     // key into the catalog
    position: [number, number, number];
    rotationY: number;   // radians
    scale: [number, number, number];
    mount: 'floor' | 'wall' | 'ceiling';
    wallId?: string;     // set when mount = 'wall'
    materialOverrides?: Record<string, string>;
  }[];
  cameras: { name: string; position: [number, number, number]; target: [number, number, number] }[];
};

type Asset = {
  id: string;
  name: string;
  kind: 'model' | 'picture' | 'rug' | 'material';
  url: string;           // R2 path: GLB for models, image for pictures/rugs/materials
  thumbnailUrl: string;
  dimensions: [number, number, number]; // meters, after normalization
  license: string;       // e.g. CC0, with source URL
};
```

- **Versioning:** every load runs `migrate(doc)` up to the current `schemaVersion`; migrations are pure functions with tests.
- **Storage layout:** `designs/<id>.json` (latest), `designs/<id>/snapshots/<timestamp>.json` (shared snapshots), `assets/<assetId>/…`, `catalog.json`.
- **Materials** are tiling PBR textures. A `material` asset's `url` is its color map, with `normalUrl`, `roughnessUrl`, the `surface` it suits, a plain fallback `color`, and the size of one tile in meters as its `dimensions`.
- **Pictures and rugs** are not models: an image applied to a thin box (frame) or a flat plane, sized from the image's aspect ratio and a typed width.

## Design considerations

**Room modeling.** Draw the floor plan in 2D and extrude it into 3D. Walls snap to a grid and to each other's endpoints. Doors and windows are openings cut into walls.

**Where furniture comes from.**

- Free CC0 sources: Poly Haven (models and textures), Kenney furniture kits.
- Sketchfab: large, but the license varies per model; record it in `Asset.license`.
- Parametric pieces: a sofa, table or shelf generated from typed dimensions.
- Paintings and rugs: upload a photo, set the width.
- Every imported model goes through one script: normalize to meters, pivot at bottom center, compress, render a thumbnail.

**Editor behavior.** Click to select; move and rotate with gizmos; arrow keys nudge. Snap to grid, floor and wall surfaces. Undo/redo with a command pattern. Autosave a few seconds after the last change. Overlap warnings instead of hard collisions.

**Rendering.** PBR materials, an HDRI environment, soft shadows. Phone budget: textures at most 2048 px, a design under roughly 30 MB of assets.

**Sharing.** A share link opens a frozen snapshot in a read-only viewer at `/v/<snapshotId>`, with touch orbit and camera presets. "Export image" saves a PNG of the view.

**Security.** Editor and write API behind Cloudflare Access (or a single secret). Viewer routes and asset reads are public, with unguessable IDs. No secrets in the front-end bundle. Access covers `/editor` at the edge. Because Access matches paths and not methods, `/api/*` stays outside it and a Function verifies the Access token on every write, so reads stay public and unauthenticated writes get a 401.

## Cloudflare free-tier limits

Checked against Cloudflare's docs on 2026-11-04. Recheck before relying on them.

| Service | Limit on the free tier |
| --- | --- |
| Pages builds | 500 per month, 1 at a time, 20-minute timeout |
| Pages site | 20,000 files, 25 MiB per file, 100 custom domains per project, unlimited preview deployments |
| Functions requests | 100,000 per day, shared with Workers, reset at midnight UTC (Error 1027 beyond that) |
| Functions runtime | 10 ms CPU per request, 128 MB memory, 50 subrequests per invocation, 64 MiB bundle |
| Request body | 100 MB (set by the domain's Cloudflare plan) |
| R2 storage | 10 GB-month per month, Standard storage only |
| R2 operations | 1 million Class A and 10 million Class B per month |
| R2 egress | Free |

What this means for Whimsy Forge:

- **CPU is the tightest limit.** 10 ms rules out heavy work in Functions, such as image processing, so asset processing stays in `scripts/`. Design documents are capped at 1 MiB to keep JSON parsing cheap.
- **Every asset read counts as a Function request** because assets are served through `/api/assets/*`. One user stays far below 100,000 per day, and assets carry a one-day browser cache. If a popular share link ever gets close, serve assets from an R2 custom domain instead.
- **At a 30 MB per-design budget**, 10 GB holds roughly 300 designs' worth of unique assets.

Sources: [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

## Milestones

**Each milestone is built in one shot.** Claude Code completes a milestone in a single session without stopping for questions, deciding design choices up to moderately consequential (especially reversible) ones itself and listing them in the PR under "Decisions made". It stops only for very consequential choices, such as switching infrastructure providers. Milestones are not chained: the owner reviews and merges each PR before the next milestone starts. Details in `CLAUDE.md`.

| Milestone | Needs | File |
| --- | --- | --- |
| M0 Spike and scaffolding | — | [M0.md](milestones/M0.md) |
| M1 Room | M0 | [M1.md](milestones/M1.md) |
| M2 Openings and surfaces | M1 | [M2.md](milestones/M2.md) |
| M3 Catalog and asset pipeline | M0 | [M3.md](milestones/M3.md) |
| M4 Placement and editing | M1, M3 | [M4.md](milestones/M4.md) |
| M5 Persistence | M2, M4 | [M5.md](milestones/M5.md) |
| M6 Sharing | M5 | [M6.md](milestones/M6.md) |
| M7 Polish | M6 | [M7.md](milestones/M7.md) |

## Open questions

- [ ] Do recipients need to view without any account? (Assumed yes.)
- [ ] Metric or imperial in the UI by default?
- [ ] Should a share link update when the design changes, or stay frozen? (Assumed frozen.)
- [ ] Is a custom domain wanted, or is `*.pages.dev` fine?
- [ ] Rooms only, or whole floors with several rooms?

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Too few good free furniture models | Rooms look sparse or mismatched | Parametric pieces; budget time in M3; record licenses |
| Large models make phones slow | Viewers see a blank or choppy scene | Compression in the import script; asset budget; M7 check |
| Free-tier limits or terms change | Unexpected cost or outage | One user stays far below limits; check current terms in M0 |
| Schema changes break saved designs | Old designs fail to open | `schemaVersion` + tested migrations from M5 |
| Editor UX is fiddly | Placing items is frustrating | Keep M4 scoped; test with a real room early |
