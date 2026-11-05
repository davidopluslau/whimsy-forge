# How work happens

GitHub Issues track the work. Checked-in docs hold what stays true. A checked-in feature brief exists only while a big feature is being built.

## Where things live

| Question | Home | Lifetime |
| --- | --- | --- |
| What is this project for? | [PRODUCT.md](PRODUCT.md) | Permanent, changes rarely |
| What might we do, and what's next? | [GitHub Issues](https://github.com/davidopluslau/whimsy-forge/issues) | Closed when done |
| How will this big feature work? | `docs/features/<slug>.md`, from [TEMPLATE.md](features/TEMPLATE.md) | Deleted when the feature ships |
| How does the system work now? | [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) | Permanent, always current |
| What was decided in this change? | The PR's "Decisions made", and SYSTEM_DESIGN.md if it's architecture | Permanent |

Intent goes stale, so intent docs are disposable. Git keeps a deleted brief, and SYSTEM_DESIGN.md keeps what it turned into.

**This repository is public,** including issues and briefs. Never commit or post photos of the owner's home, personal details, keys, or files whose license doesn't allow it. Anything in `seed/` is public too.

## From idea to merged

Every idea starts as an issue labeled `needs-triage`. Triage picks one of three routes.

| Route | Use when | What gets written |
| --- | --- | --- |
| **Small** | One PR, clear outcome, no design unknowns | The issue is the spec: outcome and acceptance criteria |
| **Feature** | Several PRs, or it touches schema, storage, auth or an outside service | A brief, a parent issue, and one issue per slice |
| **Spike** | We don't know whether something works or which option is best | A spike issue with a question, a time box and the evidence that would answer it |

Bugs follow the small route, with reproduction steps.

### Labels

| Label | Meaning |
| --- | --- |
| `needs-triage` | Not assessed yet |
| `needs-info` | Waiting on an answer or an owner decision |
| `ready-for-agent` | Fully specified: an agent can build it in one session without asking |
| `ready-for-human` | Needs the owner: a dashboard step, a real-device check, a judgment call |
| `spike` | Answers a question; working code isn't the goal |
| `enhancement`, `bug`, `wontfix` | GitHub's defaults, used as usual |

### Slices

A feature is built as slices, each one issue, one branch, one PR and one session.

- **Each slice is usable and testable when it merges.** It cuts through every layer it needs, rather than building one layer at a time.
- **Each has acceptance criteria** a reviewer can check, and lists the slices it needs.
- **The parent issue links the slices** and the brief, so its checklist shows progress.

### Spikes

- **Answer the question, then stop.** "No" and "not yet" are good outcomes.
- **Stay inside the time box.** If it runs out, report what's known.
- **Record numbers and evidence in the brief,** or in the issue if there's no brief. Spike code stays on its branch unless a later slice adopts it through normal review.
- **A spike's result can reshape the slices.** Update the brief before starting them.

### Outside services, generated output and uncertain results

Some features depend on a paid API, a machine-learning model or a third-party website. These rules apply on top of the usual ones.

- **Adding a paid service is the owner's decision.** Set out the options, costs and a recommendation first.
- **Heavy work doesn't run in Functions,** because of their [10 ms CPU limit](SYSTEM_DESIGN.md#cloudflare-free-tier-limits). It runs in `scripts/`, in the browser or on an outside service.
- **Tests never call a paid or external service.** Put the service behind a small interface, and test against a stub and checked-in fixtures that are licensed for a public repo.
- **Keys stay out of the bundle and out of git.** Use a gitignored `.env` file locally and an encrypted secret in Cloudflare.
- **Judge quality on a fixed evaluation set,** chosen before looking at results, with the numbers recorded. Rerun it when the service or model changes.
- **A person reviews generated output** before it joins the catalog.

## Every PR

CI runs build, unit tests and e2e. The rest is on the author.

1. Meet the acceptance criteria, or say in the PR which one wasn't met and why.
2. List "Decisions made": what was chosen, the alternative and why.
3. Check [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md#keeping-this-document-live) before every push, and update it in that push if the architecture changed.
4. Add the line `System design: updated (<sections>)` or `System design: no substantive change`. A CI check fails if it's missing.
5. Write any steps only the owner can do, such as a Cloudflare dashboard change, in the PR.

## Finishing a feature

The last slice's PR also:

1. Moves the feature's notes out of "Planned architecture" in SYSTEM_DESIGN.md, and makes sure the as-built sections describe it.
2. Updates PRODUCT.md if scope, requirements or settled decisions changed.
3. Deletes the brief.
4. Closes the parent issue.
