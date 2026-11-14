"""PLATEAU の建物を線路に投影して、ゲームの面（左右の窓から見える屋根の並び）を作る。

入力: data/track.json, data/raw/plateau/*.gml
出力: web/data/stage.json
  sides.R / sides.L … 下り（見沼代親水公園ゆき）の進行方向の右・左
    fg  : 手前の列の建物 [s0, s1, 高さ, 用途コード, 地上階数, 名前, 住所の番号, 説明注記]（距離 s は日暮里からの m）
  addrs : 住所（町丁目）の一覧
    bg1 : 中景の屋根の高さ（2m ごと、70〜150m）
    bg2 : 遠景の屋根の高さ（2m ごと、150〜300m）
"""
import glob
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FG_MIN, FG_MAX = 3.0, 70.0
BG1_MAX, BG2_MAX = 150.0, 300.0
BIN = 2.0
LAT0 = 35.77
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110540.0

NS = {
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "gml": "http://www.opengis.net/gml",
    "gen": "http://www.opengis.net/citygml/generics/2.0",
    "xAL": "urn:oasis:names:tc:ciq:xsdschema:xAL:2.0",
}


def to_xy(lat, lon):
    return ((lon - 139.77) * KX, (lat - LAT0) * KY)


class Track:
    def __init__(self, pts):
        self.p = [to_xy(a, b) for a, b, _ in pts]
        self.c = [c for _, _, c in pts]
        self.grid = {}
        for i, (x, y) in enumerate(self.p):
            self.grid.setdefault((int(x // 100), int(y // 100)), []).append(i)

    def project(self, x, y):
        """(距離 s, 符号つきの横距離 d) 右が正。"""
        gx, gy = int(x // 100), int(y // 100)
        cand = []
        for r in (1, 2, 4):
            for i in range(-r, r + 1):
                for j in range(-r, r + 1):
                    cand += self.grid.get((gx + i, gy + j), [])
            if cand:
                break
        if not cand:
            return None
        best = None
        for k in set(cand):
            for a in (k - 1, k):
                if a < 0 or a + 1 >= len(self.p):
                    continue
                (x0, y0), (x1, y1) = self.p[a], self.p[a + 1]
                dx, dy = x1 - x0, y1 - y0
                L2 = dx * dx + dy * dy
                t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / L2))
                px, py = x0 + dx * t, y0 + dy * t
                dist = math.hypot(x - px, y - py)
                if best is None or dist < best[0]:
                    L = math.sqrt(L2)
                    cross = (dx * (y - y0) - dy * (x - x0)) / L  # 左が正
                    best = (dist, self.c[a] + (self.c[a + 1] - self.c[a]) * t, -cross, t, a)
        if best is None:
            return None
        dist, s, d, t, a = best
        # 線路の端より外は使わない
        if (a == 0 and t == 0.0) or (a == len(self.p) - 2 and t == 1.0):
            return None
        return s, d


def num(el, path):
    e = el.find(path, NS)
    if e is None or e.text is None:
        return None
    try:
        v = float(e.text)
    except ValueError:
        return None
    return None if v >= 9999 or v < -9000 else v


def buildings(path):
    for ev, el in ET.iterparse(path, events=("end",)):
        if el.tag != "{%s}Building" % NS["bldg"]:
            continue
        h = num(el, "bldg:measuredHeight")
        st = num(el, "bldg:storeysAboveGround")
        us = el.find("bldg:usage", NS)
        usage = us.text if us is not None else ""
        nm = el.find("gml:name", NS)
        name = (nm.text or "").strip() if nm is not None else ""
        ad = el.find(".//xAL:LocalityName", NS)
        addr = (ad.text or "").strip().replace("東京都", "") if ad is not None else ""
        note = ""
        for ga in el.findall("gen:stringAttribute", NS):
            if ga.get("name") == "説明注記":
                v = ga.find("gen:value", NS)
                note = (v.text or "").strip() if v is not None else ""
        ring = None
        for tag in ("bldg:lod0FootPrint", "bldg:lod0RoofEdge", "bldg:lod1Solid"):
            g = el.find(tag, NS)
            if g is not None:
                pl = g.find(".//gml:posList", NS)
                if pl is not None:
                    ring = pl.text.split()
                    zs = None
                    if tag == "bldg:lod1Solid" and h is None:
                        allz = [float(v) for p in g.iter("{%s}posList" % NS["gml"]) for v in p.text.split()[2::3]]
                        if allz:
                            h = max(allz) - min(allz)
                    break
        el.clear()
        if not ring:
            continue
        if h is None and st:
            h = st * 3.0
        if not h or h < 2.0:
            continue
        pts = [(float(ring[i]), float(ring[i + 1])) for i in range(0, len(ring) - 2, 3)]
        yield pts, h, usage, int(st) if st else 0, name, addr, note


def main():
    track = json.load(open(ROOT / "data/track.json"))
    tr = Track(track["points"])
    length = track["length"]
    nb = int(length // BIN) + 1
    sides = {k: {"fg": [], "bg1": [0] * nb, "bg2": [0] * nb} for k in ("R", "L")}
    cand = {"R": [], "L": []}
    n_all = n_near = 0
    seen = set()
    addrs = []
    addr_ix = {}

    def addr_id(a):
        if a not in addr_ix:
            addr_ix[a] = len(addrs)
            addrs.append(a)
        return addr_ix[a]

    for f in sorted(glob.glob(str(ROOT / "data/raw/plateau/*.gml"))):
        for pts, h, usage, st, name, addr, note in buildings(f):
            n_all += 1
            key = (round(pts[0][0], 7), round(pts[0][1], 7))
            if key in seen:  # 区の境のメッシュで重複
                continue
            seen.add(key)
            pr = [tr.project(*to_xy(la, lo)) for la, lo in pts]
            pr = [p for p in pr if p]
            if len(pr) < 3:
                continue
            ss = [p[0] for p in pr]
            ds = [p[1] for p in pr]
            if min(ds) < 0 < max(ds):  # 線路をまたぐ建物（駅舎など）
                continue
            side = "R" if ds[0] > 0 else "L"
            dmin = min(abs(d) for d in ds)
            s0, s1 = min(ss), max(ss)
            if s1 - s0 < 1.0 or s1 - s0 > 400:
                continue
            if dmin > BG2_MAX:
                continue
            n_near += 1
            if FG_MIN <= dmin <= FG_MAX:
                cand[side].append((s0, s1, dmin, h, usage, st, name, addr_id(addr), note))
            arr = sides[side]["bg1" if dmin <= BG1_MAX else "bg2"]
            for b in range(int(s0 // BIN), min(nb, int(s1 // BIN) + 1)):
                arr[b] = max(arr[b], int(round(h)))

    for side in ("R", "L"):
        # 1m ごとに、いちばん手前の建物を選ぶ
        n1 = int(length) + 1
        best = [None] * n1
        for i, c in enumerate(cand[side]):
            s0, s1, dmin = c[0], c[1], c[2]
            for m in range(max(0, int(math.ceil(s0))), min(n1, int(s1) + 1)):
                if best[m] is None or cand[side][best[m]][2] > dmin:
                    best[m] = i
        segs = []
        m = 0
        while m < n1:
            if best[m] is None:
                m += 1
                continue
            j = m
            while j + 1 < n1 and best[j + 1] == best[m]:
                j += 1
            c = cand[side][best[m]]
            # 幅 3m 未満の小さな建物（物置など）は、乗る場所にしない
            if j + 1 - m >= 3:
                segs.append([m, j + 1, round(c[3], 1), c[4], c[5], c[6], c[7], c[8]])
            m = j + 1
        sides[side]["fg"] = segs
        gaps = [b[0] - a[1] for a, b in zip(segs, segs[1:])]
        big = sorted(g for g in gaps if g > 40)
        print(f"{side}: 手前の建物 {len(segs)} 区間, 隙間 >40m {len(big)} 個 (最大 {max(gaps) if gaps else 0} m)")

    stations = [{"name": s["name"], "s": s["s"], "run": s["run_to_next"], "dwell": s["dwell"]}
                for s in track["stations"]]
    index = json.load(open(ROOT / "data/raw/plateau/index.json"))
    cities = sorted({(v["city"], v["year"]) for v in index.values()})
    out = {
        "line": track["line"], "length": length, "bin": BIN,
        "stations": stations, "sides": sides, "addrs": addrs,
        "sources": {"plateau": [f"{c}（{y}年度）" for c, y in cities]},
    }
    (ROOT / "web/data").mkdir(parents=True, exist_ok=True)
    json.dump(out, open(ROOT / "web/data/stage.json", "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"建物 {n_all} 件中、線路から {BG2_MAX:.0f}m 以内 {n_near} 件")


if __name__ == "__main__":
    main()
