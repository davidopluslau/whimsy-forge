# Spike 0 scripts (#16)

Spike code for comparing image-to-3D generators on the shop evaluation set. It stays on this branch unless a later slice adopts it. The paths are hard-coded to the owner's machine.

The scripts run from `C:\Users\david\whimsy-capture\spike0\`, outside this repository. Their inputs are shop product images and their outputs are models made from those images, so neither may be committed here.

| File | What it does |
| --- | --- |
| `run_generators.py` | One attempt per piece against a free Hugging Face Space: TRELLIS.2, Hunyuan3D-2.1 or Stable Fast 3D |
| `spike_queue.py` | Hourly queue. Generates the next pending piece per generator, moves on when the daily GPU quota runs out, then measures each model and imports it into a private local app |
| `measure.mjs` | Size against the listing: stretch by PR #20's rule (limit 15 %), the error from even scaling, triangles and bytes |
| `serve_local.mjs`, `view-local.cmd` | Serves the private app (a `git archive` of PR #20 with no `.git`) on localhost, with a throwaway Access key that only works on localhost |
| `register-task.ps1`, `run-queue.cmd` | Registers the hourly Windows task, and runs the queue by hand |
| `find_spaces.py`, `view_api.py` | Find generator Spaces and print their APIs |
