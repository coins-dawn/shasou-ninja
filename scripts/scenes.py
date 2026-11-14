"""見せ場を撮る（確認用）。python3 scripts/scenes.py OUT_DIR 幅 高さ"""
import sys
from playwright.sync_api import sync_playwright
D, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ap = open('scripts/shot.py').read().split('AUTOPILOT = """')[1].split('"""')[0]
def tp(pg, s, stop):
    pg.evaluate(f"G.S={s}; G.off=0; G.y=roofUnder({s})+0.01; G.vy=0; G.glide=false; G.onGround=true; G.stopAt={stop}; G.skip=null")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": w, "height": h})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8005/" + (sys.argv[4] if len(sys.argv) > 4 else "?god")); pg.wait_for_timeout(1500)
    pg.screenshot(path=f"{D}/title_{w}.png")
    pg.click("#start"); pg.evaluate(ap)
    # 1. 消防署の看板の手前
    tp(pg, 1150, 647); pg.wait_for_timeout(1800); pg.screenshot(path=f"{D}/sign_{w}.png")
    # 2. 走っているところ
    tp(pg, 4600, 4487); pg.wait_for_timeout(2500); pg.screenshot(path=f"{D}/run_{w}.png")
    # 3. 隅田川のひとっとび
    tp(pg, 2700, 2287)
    for i in range(120):
        pg.wait_for_timeout(100)
        if pg.evaluate("!!G.skip"):
            pg.wait_for_timeout(1300); pg.screenshot(path=f"{D}/skip_{w}.png"); break
    # 4. 区の境（荒川区→足立区）: 荒川を渡ったあと
    for i in range(80):
        pg.wait_for_timeout(100)
        if pg.evaluate("!!G.banner"):
            pg.wait_for_timeout(300); pg.screenshot(path=f"{D}/ward_{w}.png"); break
    print(errs)
    b.close()
