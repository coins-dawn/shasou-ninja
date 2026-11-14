"""乗客の絵を並べて撮る（確認用）。python3 scripts/pax_sheet.py OUT.png [u]"""
import sys
from playwright.sync_api import sync_playwright
U = float(sys.argv[2]) if len(sys.argv) > 2 else 110
JS = """
(u) => {
  const kinds = (window.__kinds || ['salaryman','salaryman','salaryman','ol','ol','student','student','student','man','woman','kid','kid','elder','elder','elder']);
  const want = window.__cos || [];
  const looks = kinds.map((k, i) => {
    if (k !== 'cosplay') return paxLook(k, 0.1234 * (i + 1) + 0.0071 * i * i);
    for (let t = 0; t < 400; t++) { const L = paxLook(k, 0.37 * t + 0.011 * i); if (L.cos === want[i] || !want[i]) return L; }
  });
  const rows = [];
  rows.push(looks.map((L) => paxSprite(L, 'sit', u, 0.27, 0, 0, false)));
  rows.push(looks.map((L) => paxSprite(L, 'back', u, 0.27, 1.62, 0, false)));
  rows.push(looks.map((L) => paxSprite(L, 'back', u, 0.27, 0, 0, false)));
  for (let f = 0; f < 6; f += 2) rows.push(looks.map((L) => paxSprite(L, 'walk', u, 0.27, 0, f, false)));
  const cw = Math.ceil(u * 0.62), chs = rows.map((r) => Math.max(...r.map((s) => s.c.height)));
  const c = document.createElement('canvas'); c.width = cw * looks.length; c.height = chs.reduce((a, b) => a + b + 6, 0);
  const g = c.getContext('2d'); g.fillStyle = '#e9eaec'; g.fillRect(0, 0, c.width, c.height);
  let y = 0;
  rows.forEach((r, j) => { r.forEach((s, i) => g.drawImage(s.c, i * cw + cw / 2 - s.ax, y + chs[j] - s.c.height)); y += chs[j] + 6; g.fillStyle = '#b8744b'; g.fillRect(0, y - 6, c.width, 2); });
  return [c.toDataURL(), c.width, c.height];
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8005/"); pg.wait_for_timeout(2500)
    if len(sys.argv) > 3: pg.evaluate(sys.argv[3])
    url, w, h = pg.evaluate(JS, U)
    sc = 2
    pg.set_viewport_size({"width": w * sc, "height": h * sc})
    pg.set_content(f'<body style="margin:0"><img src="{url}" style="image-rendering:pixelated;width:{w*sc}px;display:block"></body>')
    pg.wait_for_timeout(300); pg.screenshot(path=sys.argv[1], full_page=True); b.close()
    print(errs, w, h)
