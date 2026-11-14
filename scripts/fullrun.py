"""自動操縦で終点まで走らせて、置いていかれた場所を数える（確認用）。python3 scripts/fullrun.py [倍速]"""
import sys
from playwright.sync_api import sync_playwright
ts = sys.argv[1] if len(sys.argv) > 1 else "2"
ap = open('scripts/shot.py').read().split('AUTOPILOT = """')[1].split('"""')[0]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 720})
    pg.goto(f"http://localhost:8005/?god&ts={ts}"); pg.wait_for_timeout(1200); pg.click("#start"); pg.evaluate(ap)
    for i in range(80):
        pg.wait_for_timeout(10000)
        st = pg.evaluate("[Math.round(G.S), G.deaths||0, G.state]")
        if st[2] != 'play':
            break
    print('final [S, しくじった回数, state]', st)
    print('しくじった場所 [s, 種類]', pg.evaluate("G.deathLog || []"))
    b.close()
