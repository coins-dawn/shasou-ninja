"""オート実行で終点まで走らせて、落ちない・置いていかれないかを確かめる（確認用）。python3 scripts/autorun.py [倍速] [乗る駅の番号]"""
import sys
from playwright.sync_api import sync_playwright
ts = sys.argv[1] if len(sys.argv) > 1 else "3"
st0 = sys.argv[2] if len(sys.argv) > 2 else "0"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 720})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://localhost:8005/?ts={ts}"); pg.wait_for_timeout(1500)
    pg.select_option("#startSt", st0); pg.click("#start"); pg.wait_for_timeout(300); pg.click("#autoBtn")
    for i in range(240):
        pg.wait_for_timeout(10000)
        st = pg.evaluate("[Math.round(G.S), G.state, G.autoSaves||0, !!G.auto]")
        print('途中', st, flush=True)
        if st[1] != 'play':
            break
    print('final [S, state, 地面の手前でけり上がった回数, auto]', st)
    print('記録欄', pg.evaluate("[getComputedStyle(document.getElementById('nameRow')).display, getComputedStyle(document.getElementById('overNote')).display, document.getElementById('overWhy').textContent]"))
    print(errs)
    b.close()
