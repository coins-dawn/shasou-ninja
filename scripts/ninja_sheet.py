"""忍者のコマを並べて撮る（確認用）。python3 scripts/ninja_sheet.py OUT.png"""
import sys
from playwright.sync_api import sync_playwright
JS = """
() => {
  const poses = [];
  for (let i = 0; i < 8; i++) poses.push({ kind: 'run', ph: i * (Math.PI / 4) / 1.5 + 0.01, rot: 0 });
  poses.push({ kind: 'jump', rot: 0 }, { kind: 'fall', rot: 0 }, { kind: 'land', rot: 0 }, { kind: 'idle', rot: 0 }, { kind: 'tuck', rot: 0 });
  const S = 40;
  const c = document.createElement('canvas'); c.width = poses.length * S; c.height = 34;
  const g = c.getContext('2d'); g.fillStyle = '#a9d8f4'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#e8e3d0'; g.fillRect(0, 30, c.width, 4);
  poses.forEach((p, i) => {
    const { outl, GW, GH, PADX, PADY } = ninjaGrid(p);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const ch = outl[gy * GW + gx]; if (!ch) continue;
      g.fillStyle = NPAL[ch]; g.fillRect(i * S + 10 + gx - PADX, 9 + gy - PADY, 1, 1);
    }
  });
  return c.toDataURL();
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    pg.goto("http://localhost:8005/"); pg.wait_for_timeout(2500)
    url = pg.evaluate(JS)
    pg.set_content(f'<body style="margin:0;background:#222"><img src="{url}" style="image-rendering:pixelated;width:{13*40*8}px"></body>')
    pg.set_viewport_size({"width": 13 * 40 * 8, "height": 280})
    pg.wait_for_timeout(300); pg.screenshot(path=sys.argv[1]); b.close()
