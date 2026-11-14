"""小さな路線図と、線路沿いの地名（川・公園）を作る。

入力: data/track.json, data/raw/liner_feat.geojsonseq（OSM の川・水面・公園）
出力: web/data/map.json
  line     : 線路（50m ごと）の [緯度, 経度, 日暮里からの距離]
  stations : [駅名, 緯度, 経度]
  water    : 川・水面の形（簡略化した外周）
  parks    : 公園の形
  places   : 線路の上にかかる地名 [s0, s1, 名前, water|park]（ひとっとびの名前に使う）
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAT0 = 35.77
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110540.0
BBOX = (35.722, 139.752, 35.822, 139.790)  # 地図の範囲


def xy(lon, lat):
    return ((lon - 139.77) * KX, (lat - LAT0) * KY)


def inside(pt, ring):
    x, y = pt
    c = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def simplify(ring, tol):
    """間引き（Douglas-Peucker）。閉じた輪は半分に分けてから"""
    if len(ring) < 3:
        return ring
    if ring[0] == ring[-1] and len(ring) > 4:
        mid = len(ring) // 2
        return simplify(ring[:mid + 1], tol)[:-1] + simplify(ring[mid:], tol)
    def rec(a, b):
        (x0, y0), (x1, y1) = ring[a], ring[b]
        L = math.hypot(x1 - x0, y1 - y0) or 1e-9
        best, bi = 0, None
        for i in range(a + 1, b):
            x, y = ring[i]
            d = abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            return rec(a, bi)[:-1] + rec(bi, b)
        return [ring[a], ring[b]]
    return rec(0, len(ring) - 1)


def in_bbox(ring):
    return any(BBOX[0] <= la <= BBOX[2] and BBOX[1] <= lo <= BBOX[3] for lo, la in ring)


def main():
    track = json.load(open(ROOT / "data/track.json"))
    pts = track["points"]
    line = [[p[0], p[1], round(p[2])] for p in pts[::5]] + [[pts[-1][0], pts[-1][1], round(pts[-1][2])]]
    txy = [(xy(p[1], p[0]), p[2]) for p in pts]

    water, parks, hits = [], [], {}
    # 川の中心線と線路が交わるところ → 名前のない水面に名前をつける
    crossings = []
    named_water = []
    for l in open(ROOT / "data/raw/liner_feat.geojsonseq", encoding="utf-8"):
        f = json.loads(l.lstrip("\x1e"))
        p, g = f["properties"], f["geometry"]
        if p.get("waterway") != "river" or not p.get("name") or g["type"] != "LineString":
            continue
        cs = [xy(lo, la) for lo, la in g["coordinates"]]
        for (a0, b0), (a1, b1) in zip(cs, cs[1:]):
            for ((x0, y0), s0), ((x1, y1), s1) in zip(txy, txy[1:]):
                d = (a1 - a0) * (y1 - y0) - (b1 - b0) * (x1 - x0)
                if d == 0:
                    continue
                t = ((x0 - a0) * (y1 - y0) - (y0 - b0) * (x1 - x0)) / d
                u = ((x0 - a0) * (b1 - b0) - (y0 - b0) * (a1 - a0)) / d
                if 0 <= t <= 1 and 0 <= u <= 1:
                    crossings.append((s0 + (s1 - s0) * u, p["name"]))
    print("川との交点:", sorted(set((round(s), n) for s, n in crossings)))
    for l in open(ROOT / "data/raw/liner_feat.geojsonseq", encoding="utf-8"):
        f = json.loads(l.lstrip("\x1e"))
        p, g = f["properties"], f["geometry"]
        name = p.get("name", "")
        kind = "water" if (p.get("natural") == "water" or p.get("waterway") == "riverbank") else (
            "park" if p.get("leisure") == "park" else None)
        if g["type"] != "MultiPolygon" or not kind:
            continue
        for poly in g["coordinates"]:
            outer = poly[0]
            if not in_bbox(outer):
                continue
            ring_xy = [xy(lo, la) for lo, la in outer]
            xs = [a for a, _ in ring_xy]
            ys = [b for _, b in ring_xy]
            area_ext = (max(xs) - min(xs)) * (max(ys) - min(ys))
            if area_ext < (2500 if kind == "park" else 800):
                continue
            if kind == "water" and name:
                named_water.extend((name, vx, vy) for vx, vy in ring_xy[::3])
            simp = simplify(outer, 0.00012)
            (water if kind == "water" else parks).append([[round(la, 5), round(lo, 5)] for lo, la in simp])
            # 線路の点がこの形の中にあるか
            bx = (min(xs) - 40, max(xs) + 40, min(ys) - 40, max(ys) + 40)
            for (tx, ty), s in txy:
                if bx[0] <= tx <= bx[1] and bx[2] <= ty <= bx[3] and inside((tx, ty), ring_xy):
                    nm = name or ("川" if kind == "water" else "公園")
                    hits.setdefault((nm, kind), []).append(s)

    places = []
    for (nm, kind), ss in hits.items():
        ss.sort()
        a = b = ss[0]
        for s in ss[1:]:
            if s - b > 25:
                places.append([round(a), round(b), nm, kind])
                a = s
            b = s
        places.append([round(a), round(b), nm, kind])
    # 名前のない「川」は、いちばん近い川の交点の名前にする
    for pl in places:
        if pl[2] == "川" and crossings:
            mid = (pl[0] + pl[1]) / 2
            s_, n_ = min(crossings, key=lambda c: abs(c[0] - mid))
            if abs(s_ - mid) < 300:
                pl[2] = n_
        if pl[2] == "川":
            # 名前つきの水面の頂点のうち、いちばん近いもの
            mx = min(txy, key=lambda t: abs(t[1] - (pl[0] + pl[1]) / 2))[0]
            best = min(((math.hypot(vx - mx[0], vy - mx[1]), n) for n, vx, vy in named_water), default=None)
            if best and best[0] < 400:
                pl[2] = best[1]
    # OSM でこの区間の隅田川の水面・中心線に名前が入っていないので、手で補う（2026-11-14 確認）
    for pl in places:
        if pl[2] == "川" and 2700 <= (pl[0] + pl[1]) / 2 <= 2950:
            pl[2] = "隅田川"
    places.sort()
    out = {
        "bbox": BBOX, "line": line,
        "line10": [[p[0], p[1], round(p[2], 1)] for p in pts],  # 10m ごと（地図の電車の位置用）
        "stations": [[s["name"], s["lat"], s["lon"]] for s in track["stations"]],
        "water": water, "parks": parks, "places": places,
    }
    json.dump(out, open(ROOT / "web/data/map.json", "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"water {len(water)}, parks {len(parks)}")
    for p in places:
        print("  ", p)


if __name__ == "__main__":
    main()
