"""確認用: 人に近い押し方で何度も走らせ、落ちた場所と「何秒前から助からなかったか」を集める。
python3 scripts/sim_human.py [出力JSON] [回数] [幅 高さ] [むずかしい=hard]"""
import json, sys, os, time
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else "sim_human.json"
n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (1280, 720)
diff = sys.argv[5] if len(sys.argv) > 5 else "easy"
here = os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": w, "height": h})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8005/"); pg.wait_for_timeout(2500)
    pg.select_option("#diffSel", diff)
    pg.add_script_tag(path=os.path.join(here, "sim_human.js"))
    runs = []; t0 = time.time()
    for i in range(n):
        r = pg.evaluate(f"HSIM.run(0, {1000 + i * 7919}, 900)")
        runs.append(r)
        print(f"{time.time()-t0:5.0f}s 回 {i+1}/{n} 落ちた {len(r['deaths'])} 回", flush=True)
        json.dump(runs, open(out, "w"), ensure_ascii=False)
    print("errors", errs[:3]); b.close()
