"""PLATEAU の建物を、車窓（左の窓）から見下ろした絵の材料にする。

線路に沿った座標 (s, d, z) に直す。s は日暮里からの距離、d は線路からの奥行き（左の窓の方向）、z は地面からの高さ。
画面では x = s、y = z + OFF(d)（奥にあるほど上に見える）で描く。OFF は web/game.js と同じ式。

入力: data/track.json, data/raw/plateau/*.gml, data/raw/liner_feat.geojsonseq, web/data/stage.json（駅・住所）
出力: web/data/scene.json
  near : 奥行き 2〜70m の建物（平面形、または LOD2 の面）
  far  : 奥行き 70〜300m の建物（箱）
  prof : 0.5m ごとの「乗れる屋根」の高さ（いちばん手前の建物の屋根の中央、画面の y）と建物の番号。壁にぶつかる
  prof2: その後ろで屋根が見えている建物（上から着地だけできる）
  ground: 川・公園・学校の敷地（平面形）
"""
import glob
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIDE = "L"            # 下りの左の窓
NEAR_MAX, FAR_MAX = 70.0, 300.0
NEAR_MIN = 2.0
HH, LAM = 22.0, 70.0  # OFF(d) = HH * (1 - exp(-d / LAM))
STEP = 0.5
GEO_MAX = 350.0      # 地図に出す建物（線路の両側）

LAT0 = 35.77
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110540.0
NS = {
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "gml": "http://www.opengis.net/gml",
    "gen": "http://www.opengis.net/citygml/generics/2.0",
    "xAL": "urn:oasis:names:tc:ciq:xsdschema:xAL:2.0",
}


def OFF(d):
    return HH * (1 - math.exp(-d / LAM))


def to_xy(lat, lon):
    return ((lon - 139.77) * KX, (lat - LAT0) * KY)


class Track:
    def __init__(self, pts):
        self.p = [to_xy(a, b) for a, b, _ in pts]
        self.c = [c for _, _, c in pts]
        self.grid = {}
        for i, (x, y) in enumerate(self.p):
            self.grid.setdefault((int(x // 100), int(y // 100)), []).append(i)

    def project(self, x, y, allow_ends=False):
        """(s, 奥行き)。左の窓の方向を正にする。"""
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
                    best = (dist, self.c[a] + (self.c[a + 1] - self.c[a]) * t, cross, t, a)
        dist, s, d, t, a = best
        if not allow_ends and ((a == 0 and t == 0.0) or (a == len(self.p) - 2 and t == 1.0)):
            return None
        return s, (d if SIDE == "L" else -d)


def num(el, path):
    e = el.find(path, NS)
    if e is None or e.text is None:
        return None
    try:
        v = float(e.text)
    except ValueError:
        return None
    return None if v >= 9999 or v < -9000 else v


def rings_of(g):
    out = []
    for pl in g.iter("{%s}posList" % NS["gml"]):
        v = pl.text.split()
        out.append([(float(v[i]), float(v[i + 1]), float(v[i + 2])) for i in range(0, len(v) - 2, 3)])
    return out


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
        foot = None
        for tag in ("bldg:lod0FootPrint", "bldg:lod0RoofEdge"):
            g = el.find(tag, NS)
            if g is not None:
                r = rings_of(g)
                if r:
                    foot = r[0]
                    break
        zmin = None
        lod1 = el.find("bldg:lod1Solid", NS)
        if lod1 is not None:
            rs = rings_of(lod1)
            zs = [p[2] for r in rs for p in r]
            if zs:
                zmin = min(zs)
                if h is None:
                    h = max(zs) - zmin
                if foot is None:
                    foot = min(rs, key=lambda r: sum(p[2] for p in r))
        faces = []
        for bb in el.findall("bldg:boundedBy", NS):
            for kind, tag in (("roof", "RoofSurface"), ("wall", "WallSurface")):
                surf = bb.find("bldg:" + tag, NS)
                if surf is None:
                    continue
                for r in rings_of(surf):
                    faces.append((kind, r))
        if faces:
            zs = [p[2] for _, r in faces for p in r]
            zmin = min(zs) if zmin is None else min(zmin, min(zs))
        el.clear()
        if not foot:
            continue
        if h is None and st:
            h = st * 3.0
        if not h or h < 2.0:
            continue
        yield {"foot": foot, "h": h, "u": usage, "n": int(st) if st else 0, "name": name,
               "addr": addr, "note": note, "faces": faces, "zmin": zmin}


def r1(v):
    return round(v, 1)


def main():
    track = json.load(open(ROOT / "data/track.json"))
    stage = json.load(open(ROOT / "web/data/stage.json"))
    tr = Track(track["points"])
    length = track["length"]
    near, far = [], []
    geo = []
    seen = set()
    for f in sorted(glob.glob(str(ROOT / "data/raw/plateau/*.gml"))):
        for b in buildings(f):
            key = (round(b["foot"][0][0], 7), round(b["foot"][0][1], 7))
            if key in seen:
                continue
            seen.add(key)
            # 右の画面（上空から見た地図）用: 線路の両側 GEO_MAX m までの建物の平面形と高さ
            feat = None
            pa = [tr.project(*to_xy(la, lo), allow_ends=True) for la, lo, _ in b["foot"]]
            if all(p is not None for p in pa) and min(abs(p[1]) for p in pa) <= GEO_MAX:
                feat = {"type": "Feature", "id": len(geo),
                        "properties": {"h": r1(b["h"]), "u": b["u"], "ni": -1},
                        "geometry": {"type": "Polygon",
                                     "coordinates": [[[round(lo, 6), round(la, 6)] for la, lo, _ in b["foot"]]]}}
                geo.append(feat)
            pr = [tr.project(*to_xy(la, lo)) for la, lo, _ in b["foot"]]
            if any(p is None for p in pr) or len(pr) < 4:
                continue
            ds = [p[1] for p in pr]
            if min(ds) <= 0:  # 反対側、または線路にかかる
                continue
            dmin = min(ds)
            if dmin > FAR_MAX:
                continue
            ss = [p[0] for p in pr]
            s0, s1 = min(ss), max(ss)
            if s1 - s0 > 400:
                continue
            if dmin > NEAR_MAX:
                far.append([r1(s0), r1(s1), r1(dmin), r1(b["h"]), b["u"]])
                continue
            if dmin < NEAR_MIN:
                continue
            rec = {"s0": r1(s0), "s1": r1(s1), "d": r1(dmin), "h": r1(b["h"]), "u": b["u"], "n": b["n"],
                   "name": b["name"], "addr": b["addr"], "note": b["note"],
                   "fp": [[r1(s), r1(d)] for s, d in pr], "_feat": feat}
            if b["faces"] and b["zmin"] is not None:
                fl = []
                ok = True
                for kind, ring in b["faces"]:
                    q = []
                    for la, lo, z in ring:
                        p = tr.project(*to_xy(la, lo))
                        if p is None:
                            ok = False
                            break
                        q.append([r1(p[0]), r1(max(0.0, p[1])), r1(z - b["zmin"])])
                    if not ok:
                        break
                    fl.append([0 if kind == "roof" else 1, q])
                if ok and fl:
                    rec["faces"] = fl
            near.append(rec)

    near.sort(key=lambda r: r["s0"])
    for i, r in enumerate(near):
        r["i"] = i
        if r["_feat"] is not None:
            r["_feat"]["properties"]["ni"] = i   # 左の画面の建物番号（忍者が乗っている建物を地図で光らせる）
        del r["_feat"]

    # 店・飲食店（OSM の amenity / shop）: 点がある建物は、1 階をその店らしく描く（ラーメン屋ののれん、居酒屋の提灯など）
    poi_path = ROOT / "data/raw/liner_poi.geojsonseq"
    if poi_path.exists():
        def kind_of(p):
            a, sh, cu = p.get("amenity"), p.get("shop"), p.get("cuisine", "") or ""
            if a in ("pub", "bar") or "izakaya" in cu:
                return "izakaya"
            if a in ("restaurant", "fast_food") and any(k in cu for k in ("ramen", "noodle", "soba", "udon")):
                return "ramen"
            if a in ("restaurant", "fast_food"):
                return "food"
            if a == "cafe" or sh in ("bakery", "confectionery", "pastry", "coffee", "tea"):
                return "cafe"
            if sh in ("convenience", "supermarket"):
                return "conbini"
            if sh in ("hairdresser", "beauty", "massage"):
                return "salon"
            if a in ("pharmacy", "clinic", "dentist", "doctors") or sh == "chemist":
                return "clinic"
            if sh in ("florist", "greengrocer", "garden_centre"):
                return "florist"
            if a == "bank":
                return "bank"
            return "shop" if sh else None
        RANK = {"ramen": 0, "izakaya": 0, "food": 1, "cafe": 1, "conbini": 2, "salon": 3, "clinic": 3, "florist": 3, "bank": 3, "shop": 4}

        def inside(x, y, ring):
            c = False
            for i in range(len(ring)):
                (x1, y1), (x2, y2) = ring[i], ring[i - 1]
                if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                    c = not c
            return c
        buckets = {}
        for r in near:
            for k in range(int(r["s0"] // 20), int(r["s1"] // 20) + 1):
                buckets.setdefault(k, []).append(r)
        hit = 0
        for l in open(poi_path, encoding="utf-8"):
            f = json.loads(l.lstrip("\x1e"))
            p, g = f["properties"], f["geometry"]
            k = kind_of(p)
            if not k:
                continue
            if g["type"] == "Point":
                lo, la = g["coordinates"]
            else:
                ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0] if g["type"] == "MultiPolygon" else g["coordinates"]
                lo, la = sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring)
            pp = tr.project(*to_xy(la, lo))
            if pp is None or pp[1] <= 0 or pp[1] > NEAR_MAX + 5:
                continue
            for r in buckets.get(int(pp[0] // 20), []):
                if inside(pp[0], pp[1], r["fp"]):
                    if "poi" not in r or RANK[k] < RANK[r["poi"]]:
                        if "poi" not in r:
                            hit += 1
                        r["poi"] = k
                    break
        print(f"店・飲食店のある建物 {hit} 棟")

    # 乗れる屋根の高さ: 0.5m ごとに、いちばん手前の建物の「見えている上の線」
    n = int(length / STEP) + 1
    prof = [0.0] * n
    pb = [-1] * n
    pd = [1e9] * n

    def roof_at(r, s):
        """建物 r の、s での屋根の (手前のふちの y, 奥のふちの y, 手前の奥行き)。y = z + OFF(d)。"""
        if "faces" in r:
            polys = [q for k, q in r["faces"] if k == 0] or [[[p[0], p[1], r["h"]] for p in r["fp"]]]
        else:
            polys = [[[p[0], p[1], r["h"]] for p in r["fp"]]]
        pts = []
        for q in polys:
            for a, b in zip(q, q[1:] + q[:1]):
                if (a[0] - s) * (b[0] - s) > 0 or a[0] == b[0]:
                    continue
                t = (s - a[0]) / (b[0] - a[0])
                d = a[1] + (b[1] - a[1]) * t
                z = a[2] + (b[2] - a[2]) * t
                pts.append((d, z + OFF(d)))
        if not pts:
            return None
        front = min(pts, key=lambda p: (p[0], -p[1]))
        top = max(p[1] for p in pts)
        return front[1], top, front[0]

    # 各建物の、0.5m ごとの屋根（中央の高さ・見えている上端）
    cols = [[] for _ in range(n)]  # (奥行き, 中央 y, 上端 y, 建物)
    flat_center = {}
    for r in near:
        ds = [p[1] for p in r["fp"]]
        flat_center[r["i"]] = r["h"] + OFF((min(ds) + max(ds)) / 2)
    for r in near:
        for k in range(max(0, int(math.ceil(r["s0"] / STEP))), min(n, int(r["s1"] / STEP) + 1)):
            v = roof_at(r, k * STEP)
            if v is not None:
                if "faces" in r:
                    center = (v[0] + v[1]) / 2            # LOD2: 屋根の形どおり
                else:
                    center = flat_center[r["i"]]          # 平らな屋根: 建物全体で 1 つの高さ（途中で段にしない）
                cols[k].append((v[2], center, v[1], r["i"]))

    # 建物ごとに役割を決める（途中で扱いを変えない）
    #   手前の列: 横幅の半分以上で、いちばん手前に見えている建物。ぶつかる・乗れる・濃く描く
    #   後ろ    : それ以外（奥行き 45m まで）。上から着地だけできる・薄く描く
    nearest_cnt, total_cnt = {}, {}
    for k in range(n):
        if not cols[k]:
            continue
        c0 = min(cols[k])
        nearest_cnt[c0[3]] = nearest_cnt.get(c0[3], 0) + 1
        for c in cols[k]:
            total_cnt[c[3]] = total_cnt.get(c[3], 0) + 1
    solid = {i for i, t in total_cnt.items()
             if t * STEP >= 3.0 and nearest_cnt.get(i, 0) / t >= 0.5}
    dist = {r["i"]: r["d"] for r in near}
    prof2 = [0.0] * n
    pb2 = [-1] * n
    for k in range(n):
        for c in cols[k]:
            if c[3] in solid:
                if c[1] > prof[k]:
                    prof[k], pb[k] = c[1], c[3]       # 手前の列が重なるところは、高い方の屋根
            elif dist[c[3]] <= 45 and c[1] > prof2[k]:
                prof2[k], pb2[k] = c[1], c[3]
    print(f"手前の列 {len(solid)} 棟（全 {len(near)} 棟）")

    # 幅 3m 未満の小さな区間（物置など）は乗る場所にしない
    def drop_small(pr, pbb):
        k = 0
        while k < n:
            if pbb[k] < 0:
                k += 1
                continue
            j = k
            while j + 1 < n and pbb[j + 1] == pbb[k]:
                j += 1
            if (j - k + 1) * STEP < 3.0:
                for m in range(k, j + 1):
                    pr[m] = 0.0
                    pbb[m] = -1
            k = j + 1
    drop_small(prof, pb)
    drop_small(prof2, pb2)
    print(f"2 層目の屋根 {sum(1 for v in pb2 if v >= 0) * STEP:.0f} m 分、{len(set(v for v in pb2 if v >= 0))} 棟")

    # 地面（川・公園・学校）
    ground = []
    for l in open(ROOT / "data/raw/liner_feat.geojsonseq", encoding="utf-8"):
        f = json.loads(l.lstrip("\x1e"))
        p, g = f["properties"], f["geometry"]
        kind = ("water" if (p.get("natural") == "water" or p.get("waterway") == "riverbank") else
                "park" if p.get("leisure") in ("park", "pitch") else
                "school" if p.get("amenity") == "school" else None)
        if g["type"] != "MultiPolygon" or not kind:
            continue
        for poly in g["coordinates"]:
            q = []
            for lo, la in poly[0]:
                pp = tr.project(*to_xy(la, lo), allow_ends=True)
                if pp is None:
                    q = None
                    break
                q.append([r1(pp[0]), r1(min(FAR_MAX, max(0.0, pp[1])))])
            if not q:
                continue
            ss = [a for a, _ in q]
            dd = [b for _, b in q]
            if max(dd) <= 0 or min(dd) > FAR_MAX or max(ss) < -50 or min(ss) > length + 50:
                continue
            if (max(ss) - min(ss)) * (max(dd) - min(dd)) < 300:
                continue
            ground.append({"k": kind, "name": p.get("name", ""), "r": q})

    # 電光掲示板用: 駅の英語名と乗りかえ（GTFS の translations と、都営のほかの路線の同じ名前の駅）
    import csv
    import os
    gdir = Path(os.environ.get("TOEI_GTFS", str(ROOT / "data/raw/gtfs/toei_train")))  # 都営の GTFS（環境変数 TOEI_GTFS で渡す）
    names = {st["name"] for st in stage["stations"]}
    en = {r["field_value"]: r["translation"] for r in csv.DictReader(open(gdir / "translations.txt", encoding="utf-8-sig"))
          if r["language"] == "en" and r["field_value"] in names}
    gstops = {r["stop_id"]: r["stop_name"] for r in csv.DictReader(open(gdir / "stops.txt", encoding="utf-8-sig"))}
    routes = {r["route_id"]: r["route_long_name"] for r in csv.DictReader(open(gdir / "routes.txt", encoding="utf-8-sig"))}
    trip_route = {r["trip_id"]: r["route_id"] for r in csv.DictReader(open(gdir / "trips.txt", encoding="utf-8-sig"))}
    xfer = {}
    for r in csv.DictReader(open(gdir / "stop_times.txt", encoding="utf-8-sig")):
        nm = gstops[r["stop_id"]]
        if nm in names:
            xfer.setdefault(nm, set()).add(routes[trip_route[r["trip_id"]]])
    # 都営以外の乗りかえ（GTFS に無いので補う）
    other = {"日暮里": ["JR線", "京成線"], "西日暮里": ["JR線", "東京メトロ千代田線"]}
    for i, st in enumerate(stage["stations"]):
        st["code"] = f"NT{i + 1:02d}"
        st["en"] = en.get(st["name"], "")
        lines = sorted(x for x in xfer.get(st["name"], set()) if x != stage["line"])
        lines = [x.replace("東京さくらトラム（都電荒川線）", "都電荒川線") for x in lines]
        st["xfer"] = other.get(st["name"], []) + lines

    out = {
        "line": stage["line"], "length": length, "HH": HH, "LAM": LAM, "step": STEP,
        "stations": stage["stations"], "sources": stage["sources"],
        "near": near, "far": far,
        "prof": [int(round(v * 10)) for v in prof], "pb": pb,
        "prof2": [int(round(v * 10)) for v in prof2], "pb2": pb2,
        "solid": sorted(solid),
        "ground": ground,
    }
    json.dump(out, open(ROOT / "web/data/scene.json", "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"type": "FeatureCollection", "features": geo}, open(ROOT / "web/data/buildings.geojson", "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"地図の建物 {len(geo)} 棟")
    lod2 = sum(1 for r in near if "faces" in r)
    print(f"near {len(near)}（LOD2 {lod2}）, far {len(far)}, ground {len(ground)}")
    tops = sorted(prof)
    print(f"屋根の見かけの高さ 最大 {tops[-1]:.1f}m, 上位1% {tops[int(len(tops)*0.99)]:.1f}m")


if __name__ == "__main__":
    main()
