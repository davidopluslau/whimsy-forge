# Whimsy Forge — Product

What this project is for, and what it deliberately isn't. It changes rarely. For how it works today, see [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md). For how new work is planned and built, see [WORKFLOW.md](WORKFLOW.md).

## What it is

A single-user web app for building 3D interior designs and sharing them as read-only links, on the cheapest infrastructure that still serves 3D model files and public share links.

## Requirements

1. Model a room in 3D at real-world scale and place objects in it: furniture, paintings, rugs, lights.
2. Send a design to other people, who can view it without an account.

## Scope

**In scope:** one editor (the owner), any number of read-only viewers, a personal furniture catalog, desktop editing, phone-friendly viewing.

**Non-goals:** multi-user editing, real-time collaboration, photoreal ray-traced renders, buying or selling through the app, a public catalog for other users.

A shop's product page may be a source for a personal catalog asset ([asset capture](features/asset-capture.md)). An asset sourced that way keeps a link to its product page, so the owner can get back to it.

Changing a requirement or non-goal is a very consequential choice: the owner decides it, and this file records it.

## Settled product decisions

- Recipients view without any account.
- A share link is a frozen snapshot. It doesn't change when the design does.
- Furniture sourced from a shop links to its product page.

## Open product questions

File an issue when one of these needs an answer.

- Is a custom domain wanted, or is `*.pages.dev` fine?
- Rooms only, or whole floors with several rooms?
- Should the editor keep opening in meters, or default to feet and inches?

## Ideas not yet planned

- Parametric furniture: a sofa, table or shelf generated from typed dimensions.
- Sketchfab as a model source. Licenses vary per model, so each must be recorded.

## Standing product risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Too few good furniture models | Rooms look sparse or mismatched | Asset capture; parametric pieces; record licenses |
| Free-tier limits or terms change | Unexpected cost or outage | One user stays far below the [limits](SYSTEM_DESIGN.md#cloudflare-free-tier-limits); recheck them when a feature adds load |
| Editor UX is fiddly | Placing items is frustrating | Test with a real room |

## History

The app was built in eight milestones, M0 to M7, from an original plan. Neither is maintained any more. To read them, see [`docs/` at the last commit that had them](https://github.com/davidopluslau/whimsy-forge/tree/eb2b613/docs).
