"""画面を撮る（自動操縦で遊ばせて、何秒か後を撮る）。
python3 scripts/shot.py OUT_DIR [幅 高さ]
"""
import sys
from playwright.sync_api import sync_playwright

out = sys.argv[1]
w = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
h = int(sys.argv[3]) if len(sys.argv) > 3 else 720

AUTOPILOT = """
window.__ap = setInterval(() => {
  if (!G || G.state !== 'play') return;
  const x = G.S + G.off;
  const look = Math.max(4, G.speed * 0.32);
  let want = false, wallAt = null;
  for (let d = 0.5; d < look; d += 0.5) {
    const h = roofUnder(x + d);
    if (h > G.y + 0.6) { want = true; wallAt = d; break; }
  }
  const under = roofUnder(x), ahead = roofUnder(x + 1.5);
  if (G.onGround && ahead < under - 0.5) {
    want = true;
  }
  if (G.wall) want = true; // 壁は押しっぱなしで駆け上がる
  if (!G.onGround && G.vy < -2 && roofUnder(x + G.speed * 0.25) < G.y - 2 && G.jumps > 0) want = true;
  if (want && !pressed) press();
  if (!want && pressed) release();
}, 16);
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 900 else 1)
    logs = []
    pg.on("console", lambda m: logs.append(m.text))
    pg.on("pageerror", lambda e: logs.append("ERR " + str(e)))
    pg.goto("http://localhost:8005/" + (sys.argv[4] if len(sys.argv) > 4 else ""))
    pg.wait_for_timeout(1200)
    pg.screenshot(path=f"{out}/title_{w}.png")
    pg.click("#start")
    pg.evaluate(AUTOPILOT)
    for t in (3, 8, 15, 25, 40):
        pg.wait_for_timeout((t - (0 if t == 3 else prev)) * 1000) if False else None
    last = 0
    for t in ((4, 10, 20, 35, 50, 70, 90) if len(sys.argv) <= 5 else tuple(int(x) for x in sys.argv[5].split(','))):
        pg.wait_for_timeout((t - last) * 1000)
        last = t
        st = pg.evaluate("({s:G.S, dist:G.dist, y:G.y, state:G.state, lap:G.lap, deaths:G.deaths||0, pace:G.pace, why: G.dead && G.dead.why, where: G.dead && G.dead.where})")
        print(t, st)
        pg.screenshot(path=f"{out}/play_{w}_{t:02d}.png")
        if st["state"] == "dead":
            break
    print("\n".join(logs[:20]))
    b.close()
