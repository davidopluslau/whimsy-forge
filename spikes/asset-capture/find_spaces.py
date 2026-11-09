import requests
import gradio_client
print("gradio_client", gradio_client.__version__)
for q in ["TRELLIS", "Hunyuan3D", "TripoSG", "stable-fast-3d", "SPAR3D", "Step1X-3D"]:
    r = requests.get("https://huggingface.co/api/spaces",
                     params={"search": q, "sort": "likes", "limit": 4, "full": "true"}, timeout=30).json()
    for s in r:
        rt = s.get("runtime") or {}
        print(q, "|", s["id"], s.get("likes"), rt.get("stage"), (rt.get("hardware") or {}).get("current"))
