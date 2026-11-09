import sys
from gradio_client import Client
for sid in sys.argv[1:]:
    print("=" * 20, sid)
    try:
        c = Client(sid, verbose=False)
        c.view_api(all_endpoints=False)
    except Exception as e:
        print("ERR", type(e).__name__, e)
