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

This uploads everything in `seed/`: the catalog, the furniture and the material textures. Re-run it whenever `seed/` gains files other than through `npm run import-asset`, which uploads its own.

## 3. Connect the Pages project

Dashboard: **Workers & Pages > Create application**, then the **Continue to Pages** link under "Need to use the legacy Pages workflow?", then **Import an existing Git repository** and pick `davidopluslau/whimsy-forge`.

Don't use **Continue with GitHub** at the top of that page: it creates a Worker, not a Pages project, and this app needs Pages (it uses `pages_build_output_dir` and Pages Functions in `functions/`). If the project page has tabs like **Domains & Routes** or **Access** rather than **Custom domains**, it's a Worker; delete it and start this step again.

| Setting | Value |
| --- | --- |
| Project name | `whimsy-forge` (must match `wrangler.toml`) |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |

`pages.dev` names are global, so the form may show a suffixed hostname. This project's is **`whimsy-forge-cze.pages.dev`**, because `whimsy-forge.pages.dev` belongs to someone else; the steps below use it.

Pushes to `main` then deploy to production, and pushes to other branches get preview URLs (`<branch>.whimsy-forge-cze.pages.dev`). The first build of `main` fails harmlessly until this PR is merged, because `main` has no app yet.

`wrangler.toml` is the source of truth for this project, so the R2 binding and variables come from that file and show as read-only in the dashboard. Deploys fail if the bucket from step 1 doesn't exist.

## 4. Protect the editor with Access

Dashboard: **Zero Trust**. If asked, choose a team name and the Free plan.

1. Go to **Access controls > Applications > Create new application > Self-hosted**.
2. Under **Public hostnames**, select **Switch to custom input** and enter `whimsy-forge-cze.pages.dev/editor`. The **Domain** dropdown only lists your own zones, so `pages.dev` never appears there.
3. Add an **Allow** policy with the selector **Emails** listing everyone who may edit. This project uses a reusable policy named **Editors**; to add or remove an editor later, edit it under **Access controls > Policies**. Editors sign in with a one-time code sent to their email, so they don't need a Cloudflare or GitHub account.
4. Leave **Enforce cookie path attribute** (under **Additional settings > Cookie settings**) off. It is off by default, and the API depends on it (see below).
5. Create the application, then copy the token under **Application Audience (AUD) Tag** in its **Additional settings**.

If saving fails with `domain does not belong to zone`, the hostname isn't a Pages project on this account: check step 3 (a Worker, or the other owner's `whimsy-forge.pages.dev`, both cause it).

**Do not add `/api` to this application.** Access matches by path rather than by method, so covering `/api` would also put public reads behind login, and the Function could no longer guarantee a 401 for unauthenticated writes. Instead, `functions/api/_middleware.ts` verifies the Access token itself on every write. It gets the token from the cookie Access sets when you sign in at `/editor`.

## 5. Point the code at your Access application

`wrangler.toml` holds the two values. They are already filled in for this project's Access team (`cool-feather-83dd`) and the application from step 4; if you recreate either, update them:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "<your-team>.cloudflareaccess.com"
ACCESS_AUD = "<AUD tag from step 4>"
```

These aren't secrets. If either is empty, all writes return 401, and so does `/editor` on production. (Step 6 adds a third value, for previews only.)

## 6. Optional: restrict preview deployments

Preview URLs are public by default, and they read the same bucket as production. To hide them, go to **Workers & Pages > whimsy-forge > Settings > General > Preview access > Restrict previews**. This is turned on for this project.

It creates a separate Access application (**whimsy-forge - Cloudflare Pages**) covering `*.whimsy-forge-cze.pages.dev`, with its own AUD tag. Its default policy lets members of your Cloudflare account in; add the **Editors** policy to it if other editors should see previews too.

That AUD is `ACCESS_PREVIEW_AUD` in `wrangler.toml`, which lets `/editor` open on preview URLs so a branch can be reviewed before merging. If you recreate the application, update the value. Previews still can't write, because that AUD isn't in `ACCESS_AUD`, so the editor on a preview shows **Not saved: signed out**. That's expected. Don't add it to `ACCESS_AUD`: previews share production's bucket.

## 7. Verify the M0 acceptance criteria

Replace the host below if you use a different one.

| Check | How | Expected |
| --- | --- | --- |
| Chair and orbit | Open `https://whimsy-forge-cze.pages.dev/` and drag | The chair is shown and turns |
| Phone | Open the same URL on your phone and drag with a finger | The chair is shown and turns |
| Editor protected | Open `/editor` in a private window | Access login page |
| Round trip | Sign in at `/editor`, click **New design**, change the wall height, wait for **Saved**, then reload | The design reopens with the new height |
| Unauthenticated write | See the command below | `HTTP/2 401` |

```sh
curl -i -X PUT https://whimsy-forge-cze.pages.dev/api/designs/aaaaaaaaaaaaaaaaaaaaaa \
  -H 'Content-Type: application/json' \
  -d '{"schemaVersion":1,"id":"aaaaaaaaaaaaaaaaaaaaaa"}'
```

If the editor shows **Not saved: signed out** while you are signed in, check that the two values from step 5 are deployed and that **Cookie Path Attribute** is off.
