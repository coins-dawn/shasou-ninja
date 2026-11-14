"""車内の乗客を撮る（確認用）。python3 scripts/pax_scene.py OUT_DIR 幅 高さ"""
import sys
from playwright.sync_api import sync_playwright
D, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8005/?god"); pg.wait_for_timeout(2000)
    pg.click("#start"); pg.wait_for_timeout(1500)
    pg.screenshot(path=f"{D}/start.png")
    print('start pax', pg.evaluate("PAX.length"))
    pg.evaluate("paxFill()"); pg.wait_for_timeout(400)
    pg.screenshot(path=f"{D}/full.png")
    pg.evaluate("PAX=[]; PAX_FROM=0; paxStation(8)"); 
    print('boarding', pg.evaluate("PAX.length"))
    pg.wait_for_timeout(4500); pg.screenshot(path=f"{D}/walkin.png")
    pg.wait_for_timeout(9000); pg.screenshot(path=f"{D}/walkin2.png")
    print(errs)
    b.close()
