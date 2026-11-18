"""確認用: どう押しても詰む場所を探す。python3 scripts/sim_deadspots.py [出力JSON] [幅 高さ] [乗る駅の番号] [むずかしい=hard]
ローカルの http://localhost:8005/ を開き、sim_deadspots.js をブラウザの中で走らせる（数十分かかる）。"""
import json, sys, time, os
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else "sim_deadspots.json"
w, h = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (1280, 720)
st0 = int(sys.argv[4]) if len(sys.argv) > 4 else 0
diff = sys.argv[5] if len(sys.argv) > 5 else "easy"
here = os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": w, "height": h})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8005/"); pg.wait_for_timeout(2500)
    pg.select_option("#diffSel", diff)
    pg.add_script_tag(path=os.path.join(here, "sim_deadspots.js"))
    pg.evaluate(f"SIM.init({st0})")
    res = {"log": [], "dead": []}; t0 = time.time()
    while True:
        r = pg.evaluate("SIM.chunk(15000)")
        res["log"] += r["log"]; res["dead"] = r["dead"]; res["goal"] = r["goal"]; res["nodes"] = r["nodes"]
        print(f"{time.time()-t0:6.0f}s 状態 {r['nodes']} 最前 {r['best']}m 詰む {len(r['dead'])}", [(d['x'], d['where']) for d in r['dead'][-2:]], flush=True)
        json.dump(res, open(out, "w"), ensure_ascii=False)
        if r["done"]: break
    print("errors", errs[:3])
    b.close()
