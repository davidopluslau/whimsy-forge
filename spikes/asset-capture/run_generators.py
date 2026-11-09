"""Spike 0 (#16): send each shop-set product shot to free Hugging Face Space generators.

Usage: python -I run_generators.py <generator> [item ...]
generator: trellis2 | hunyuan21 | sf3d
Outputs go to ../out/<generator>/<item>.glb and results are appended to ../out/runs.jsonl.
Nothing here is committed: inputs are IKEA images, outputs are derived from them.
"""
import json, shutil, sys, time, traceback
from pathlib import Path
from gradio_client import Client, handle_file

ROOT = Path(__file__).resolve().parent.parent
SHOP = ROOT.parent / "shop-set"
OUT = ROOT / "out"
ITEMS = ["lisabo-table", "kivik-sofa", "sandsberg-chair", "baggebo-shelf", "vittsjo-coffee-table"]


def product_image(item):
    cap = json.loads((SHOP / item / "capture.json").read_text(encoding="utf-8"))
    img = next(i for i in cap["images"] if i["role"] == "product")
    return SHOP / item / img["file"]


def run_trellis2(client, img):
    client.predict(api_name="/start_session")
    pre = client.predict(handle_file(str(img)), api_name="/preprocess_image")
    client.predict(handle_file(pre), 0, "1024", api_name="/image_to_3d")
    glb, _ = client.predict(100000, 1024, api_name="/extract_glb")
    return glb


def run_hunyuan21(client, img):
    res = client.predict(image=handle_file(str(img)), seed=1234, randomize_seed=False,
                         check_box_rembg=True, api_name="/generation_all")
    shape, textured = res[0], res[1]
    return textured or shape


def run_sf3d(client, img):
    _, glb = client.predict(handle_file(str(img)), 0.85, "None", -1, 1024, api_name="/run_button")
    return glb


RUNNERS = {
    "trellis2": ("microsoft/TRELLIS.2", run_trellis2),
    "hunyuan21": ("tencent/Hunyuan3D-2.1", run_hunyuan21),
    "sf3d": ("stabilityai/stable-fast-3d", run_sf3d),
}


def hf_token():
    """HF_TOKEN from the environment or from ../.env (outside the repo). Never printed."""
    import os
    if os.environ.get("HF_TOKEN"):
        return os.environ["HF_TOKEN"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("HF_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"')
    return None


def main():
    gen = sys.argv[1]
    token = hf_token()
    print("token:", "found" if token else "none (anonymous quota)")
    items = sys.argv[2:] or ITEMS
    space, fn = RUNNERS[gen]
    (OUT / gen).mkdir(parents=True, exist_ok=True)
    for item in items:
        img = product_image(item)
        rec = {"generator": gen, "space": space, "item": item, "input": img.name,
               "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        t0 = time.time()
        try:
            client = Client(space, token=token, verbose=False)
            path = fn(client, img)
            src = Path(path if isinstance(path, str) else path["path"])
            dst = OUT / gen / f"{item}{src.suffix}"
            shutil.copy(src, dst)
            rec.update(ok=True, file=str(dst.relative_to(ROOT)), bytes=dst.stat().st_size)
        except Exception as e:
            rec.update(ok=False, error=f"{type(e).__name__}: {e}"[:600])
            traceback.print_exc()
        rec["seconds"] = round(time.time() - t0, 1)
        print(json.dumps(rec), flush=True)
        with open(OUT / "runs.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
        if "quota" in rec.get("error", "").lower():
            print("Daily GPU quota used up; stopping. Rerun after it resets.")
            break


if __name__ == "__main__":
    main()
