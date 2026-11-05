# Cloudflare setup checklist

These steps need your Cloudflare account. The code is ready for them; nothing here costs money on the free tiers listed in [PLAN.md](../PLAN.md#cloudflare-free-tier-limits). Dashboard menu names were taken from Cloudflare's docs on 2026-11-04 and may differ slightly.

Work through them in order.

## 1. Create the R2 bucket

Dashboard: **R2 Object Storage > Create bucket**. Name it exactly `whimsy-forge` and leave public access off. The app reads the bucket through a Function, so it never needs to be public.

Cloudflare may ask you to add a payment method before enabling R2, even for free-tier use.

## 2. Upload the chair

From a checkout of this branch:

```sh
npm ci
npx wrangler login
npm run seed:remote
```

This uploads `seed/assets/painted-wooden-chair-01/model.glb` and `seed/catalog.json`.

## 3. Connect the Pages project

Dashboard: **Workers & Pages > Create application > Pages > Connect to Git**, then pick `davidopluslau/whimsy-forge`.

| Setting | Value |
| --- | --- |
| Project name | `whimsy-forge` (must match `wrangler.toml`) |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |

Pushes to `main` then deploy to production, and pushes to other branches get preview URLs (`<branch>.whimsy-forge.pages.dev`). The first build of `main` fails harmlessly until this PR is merged, because `main` has no app yet.

`wrangler.toml` is the source of truth for this project, so the R2 binding and variables come from that file and show as read-only in the dashboard. Deploys fail if the bucket from step 1 doesn't exist.

## 4. Protect the editor with Access

Dashboard: **Zero Trust**. If asked, choose a team name and the Free plan.

1. Go to **Access controls > Applications > Add an application > Self-hosted**.
2. Add the public hostname `whimsy-forge.pages.dev` with the path `editor`.
3. Add an **Allow** policy with the selector **Emails** set to your address.
4. Leave **Cookie Path Attribute** off. It is off by default, and the API depends on it (see below).
5. Save, then copy the **Application Audience (AUD) Tag** from the application's **Additional settings**.

**Do not add `/api` to this application.** Access matches by path rather than by method, so covering `/api` would also put public reads behind login, and the Function could no longer guarantee a 401 for unauthenticated writes. Instead, `functions/api/_middleware.ts` verifies the Access token itself on every write. It gets the token from the cookie Access sets when you sign in at `/editor`.

## 5. Point the code at your Access application

In `wrangler.toml`, fill in the two values and commit to `main`:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "<your-team>.cloudflareaccess.com"
ACCESS_AUD = "<AUD tag from step 4>"
```

These aren't secrets. Until they are set, all writes and `/editor` return 401.

## 6. Optional: restrict preview deployments

Preview URLs are public by default, and they read the same bucket as production. They can't write, because Access doesn't cover those hostnames. To hide them, go to **Workers & Pages > whimsy-forge > Settings > General > Enable access policy**.

## 7. Verify the M0 acceptance criteria

Replace the host below if you use a different one.

| Check | How | Expected |
| --- | --- | --- |
| Chair and orbit | Open `https://whimsy-forge.pages.dev/` and drag | The chair is shown and turns |
| Phone | Open the same URL on your phone and drag with a finger | The chair is shown and turns |
| Editor protected | Open `/editor` in a private window | Access login page |
| Round trip | Sign in at `/editor`, then click **Run save and load check** | "Round trip OK for design ..." |
| Unauthenticated write | See the command below | `HTTP/2 401` |

```sh
curl -i -X PUT https://whimsy-forge.pages.dev/api/designs/aaaaaaaaaaaaaaaaaaaaaa \
  -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,"id":"aaaaaaaaaaaaaaaaaaaaaa"}'
```

If the round trip reports `Save failed (401)` while you are signed in, check that the two values from step 5 are deployed and that **Cookie Path Attribute** is off.
