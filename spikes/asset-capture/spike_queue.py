"""Spike 0 (#16) unattended queue, run hourly by the Windows task "whimsy-spike0".

Each run: for each generator in priority order, generate its next pending piece; on a quota error move on
to the next generator (it may ask for less GPU time). After each success, measure the model and import it
into the private local app (spike0/app, local R2 only). When every job is done or given up, the task
disables itself. State: out/runs.jsonl (attempts), out/STATUS.md (summary), out/queue.log (log).
"""
import json, os, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # -I leaves the script dir off sys.path
import run_generators as rg  # noqa: E402

ROOT = HERE.parent
OUT = ROOT / "out"
APP = ROOT / "app"
NODE = r"C:\nvm4w\nodejs\node.exe"
REPO_ENV = Path(r"C:\Users\david\code\whimsy-forge\.env")
TASK = "whimsy-spike0"
MAX_FAILURES = 3
NO_WINDOW = subprocess.CREATE_NO_WINDOW  # the hourly task runs under pythonw; no console flashes
ORDER = ["trellis2", "hunyuan21", "sf3d"]
CATEGORY = {"lisabo-table": "table", "kivik-sofa": "sofa", "sandsberg-chair": "chair",
            "baggebo-shelf": "shelf", "vittsjo-coffee-table": "table"}


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(OUT / "queue.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def token():
    t = rg.hf_token()
    if t:
        return t
    if REPO_ENV.exists():
        for line in REPO_ENV.read_text(encoding="utf-8").splitlines():
            if line.startswith("HF_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"')
    return None


def runs():
    p = OUT / "runs.jsonl"
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def job_state(gen, item, history):
    if (OUT / gen / f"{item}.glb").exists():
        return "done"
    fails = [r for r in history if r["generator"] == gen and r["item"] == item and not r["ok"]
             and "quota" not in r.get("error", "").lower()]
    return "gave up" if len(fails) >= MAX_FAILURES else "pending"


def import_local(gen, item, rec):
    """Import into the private app's local R2. Exact 3-axis fit; uniform-by-width if the stretch is refused."""
    glb = OUT / gen / f"{item}.glb"
    if glb.suffix != ".glb" or not glb.exists():
        return "not imported: no .glb"
    cap = json.loads((rg.SHOP / item / "capture.json").read_text(encoding="utf-8"))
    d = cap["dimensions"]
    base = [NODE, "scripts/import-asset.ts", str(glb), "--category", CATEGORY[item],
            "--name", f"{cap['name'].split(',')[0]} ({gen})", "--id", f"{item}-{gen}",
            "--license", "Private test: generated from shop product image", "--source", cap["sourceUrl"],
            "--local", "--replace"]
    exact = ["--width", str(d["width"]), "--height", str(d["height"]), "--depth", str(d["depth"])]
    for label, extra in [("exact fit", exact),
                         ("exact fit, OVER the 15 % limit (allowed up to 30 % for viewing)", exact + ["--max-stretch", "30"]),
                         ("uniform by width (stretch over 30 %)", ["--width", str(d["width"])])]:
        r = subprocess.run(base + extra, cwd=APP, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        text = (r.stdout + r.stderr).strip()
        if r.returncode == 0:
            report = " | ".join(l for l in text.splitlines() if l.startswith(("Imported", "Stretched", "Largest")))
            return f"{label}: {report}"
        log(f"import {gen}/{item} ({label}) failed: {text[-400:]}")
    return "import failed (see queue.log)"


def measure_all():
    r = subprocess.run([NODE, str(HERE / "measure.mjs"), "--all"], capture_output=True, text=True, encoding="utf-8", creationflags=NO_WINDOW)
    (OUT / "measurements.jsonl").write_text(r.stdout, encoding="utf-8")
    return {(m["generator"], m["item"]): m for m in map(json.loads, r.stdout.splitlines()) if m}


def write_status(history, imports):
    m = measure_all()
    lines = ["# Spike 0 status", "", f"Updated {time.strftime('%Y-%m-%d %H:%M')}.", "",
             "| Generator | Piece | State | Stretch to fit | Even-scale error (cm, W/H/D) | Triangles | MB | Local import |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for gen in ORDER:
        for item in rg.ITEMS:
            st = job_state(gen, item, history)
            x = m.get((gen, item))
            best = x["best"] if x and "best" in x else None
            lines.append(f"| {gen} | {item} | {st} | "
                         f"{f'{best['stretchPct']} % ({best['facing']})' if best else ''} | "
                         f"{' / '.join(map(str, best['uniformErrorCm'])) if best else ''} | "
                         f"{x['triangles'] if x else ''} | {round(x['bytes'] / 1e6, 1) if x else ''} | "
                         f"{imports.get((gen, item), '')} |")
    (OUT / "STATUS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    OUT.mkdir(exist_ok=True)
    tok = token()
    if not tok:
        log("No HF_TOKEN found; stopping.")
        return
    imports_file = OUT / "imports.json"
    imports = {tuple(k.split("/")): v for k, v in json.loads(imports_file.read_text()).items()} if imports_file.exists() else {}
    for gen in ORDER:  # catch up: models generated earlier but not yet imported, or imported uniformly
        for item in rg.ITEMS:
            stale = imports.get((gen, item), "").startswith("uniform by width (stretch refused)")
            if ((gen, item) not in imports or stale) and (OUT / gen / f"{item}.glb").exists():
                imports[(gen, item)] = import_local(gen, item, None)
                log(f"imported earlier model {gen} / {item}: {imports[(gen, item)]}")
                imports_file.write_text(json.dumps({"/".join(k): v for k, v in imports.items()}, indent=1))
    blocked = set()
    while True:
        history = runs()
        progressed = False
        for gen in ORDER:
            if gen in blocked:
                continue
            item = next((i for i in rg.ITEMS if job_state(gen, i, history) == "pending"), None)
            if not item:
                continue
            log(f"trying {gen} / {item}")
            rec = rg.generate(gen, item, tok)
            if rec["ok"]:
                imports[(gen, item)] = import_local(gen, item, rec)
                log(f"done {gen} / {item} in {rec['seconds']} s; {imports[(gen, item)]}")
                imports_file.write_text(json.dumps({"/".join(k): v for k, v in imports.items()}, indent=1))
                progressed = True
                break  # re-read history and start from the top priority again
            if "quota" in rec.get("error", "").lower():
                log(f"quota: {gen} blocked until it resets ({rec['error'][:160]})")
                blocked.add(gen)
            else:
                # A broken Space fails every piece; skip it until next hour so retries are spread out.
                log(f"failed {gen} / {item}: {rec['error'][:200]}; skipping {gen} until the next run")
                blocked.add(gen)
        if not progressed:
            break
    history = runs()
    write_status(history, imports)
    if all(job_state(g, i, history) != "pending" for g in ORDER for i in rg.ITEMS):
        log("Queue finished; disabling the scheduled task.")
        subprocess.run(["schtasks", "/Change", "/TN", TASK, "/DISABLE"], capture_output=True, creationflags=NO_WINDOW)


if __name__ == "__main__":
    main()
