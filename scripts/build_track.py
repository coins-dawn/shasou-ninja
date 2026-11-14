"""線路の中心線と駅を作る。

入力:
  - GTFS（ODPT 公開の東京都交通局 GTFS）: 駅の順番・位置・所要時間
  - OSM の線路（osmium で書き出した geojsonseq）: 線路の形
出力:
  data/track.json  … 10m 間隔の中心線（距離つき）と駅
"""
import csv
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
import os
# 都営の GTFS（展開したディレクトリ）。引数か環境変数 TOEI_GTFS で渡す
GTFS = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TOEI_GTFS", str(ROOT / "data/raw/gtfs/toei_train")))
OSM = ROOT / "data/raw/liner_rail.geojsonseq"
ROUTE_ID = "5"          # 日暮里・舎人ライナー
LINE_NAME = "日暮里・舎人ライナー"
STEP = 10.0             # 中心線の間隔 [m]

LAT0 = 35.77
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110540.0


def to_xy(lat, lon):
    return ((lon - 139.77) * KX, (lat - LAT0) * KY)


def to_ll(x, y):
    return (y / KY + LAT0, x / KX + 139.77)


def hms(t):
    h, m, s = map(int, t.split(":"))
    return h * 3600 + m * 60 + s


def load_gtfs():
    trips = [t for t in csv.DictReader(open(GTFS / "trips.txt", encoding="utf-8-sig"))
             if t["route_id"] == ROUTE_ID and t["direction_id"] == "0"]
    stops = {s["stop_id"]: s for s in csv.DictReader(open(GTFS / "stops.txt", encoding="utf-8-sig"))}
    by_trip = {}
    tids = {t["trip_id"] for t in trips}
    for r in csv.DictReader(open(GTFS / "stop_times.txt", encoding="utf-8-sig")):
        if r["trip_id"] in tids:
            by_trip.setdefault(r["trip_id"], []).append(r)
    # 全駅に止まる便のうち、最も多い停車パターンを代表にする
    longest = max(len(v) for v in by_trip.values())
    full = [sorted(v, key=lambda r: int(r["stop_sequence"])) for v in by_trip.values() if len(v) == longest]
    rep = full[len(full) // 2]
    # 駅間の所要時間は、全便の中央値
    n = len(rep)
    runs = [[] for _ in range(n - 1)]
    dwells = [[] for _ in range(n)]
    for v in full:
        for i in range(n):
            dwells[i].append(hms(v[i]["departure_time"]) - hms(v[i]["arrival_time"]))
            if i < n - 1:
                runs[i].append(hms(v[i + 1]["arrival_time"]) - hms(v[i]["departure_time"]))
    med = lambda a: sorted(a)[len(a) // 2]
    out = []
    for i, r in enumerate(rep):
        s = stops[r["stop_id"]]
        out.append({
            "name": s["stop_name"],
            "lat": float(s["stop_lat"]), "lon": float(s["stop_lon"]),
            "dwell": med(dwells[i]),
            "run_to_next": med(runs[i]) if i < n - 1 else None,
        })
    return out, len(full)


def load_osm_points():
    pts = []
    for line in open(OSM, encoding="utf-8"):
        f = json.loads(line.lstrip("\x1e"))
        p = f["properties"]
        if f["geometry"]["type"] != "LineString" or "舎人" not in p.get("name", ""):
            continue
        cs = f["geometry"]["coordinates"]
        for (a, b), (c, d) in zip(cs, cs[1:]):
            # 線路の頂点を 2m 刻みに補間して点群にする
            x0, y0 = to_xy(b, a)
            x1, y1 = to_xy(d, c)
            L = math.hypot(x1 - x0, y1 - y0)
            k = max(1, int(L / 2))
            for j in range(k):
                t = j / k
                pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    return pts


def resample(poly, step):
    out = [poly[0]]
    acc = 0.0
    for (x0, y0), (x1, y1) in zip(poly, poly[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        t = step - acc
        while t <= L:
            out.append((x0 + (x1 - x0) * t / L, y0 + (y1 - y0) * t / L))
            t += step
        acc = L - (t - step)
    out.append(poly[-1])
    return out


def main():
    stations, ntrips = load_gtfs()
    pts = load_osm_points()
    # 格子で近傍探索
    grid = {}
    for p in pts:
        grid.setdefault((int(p[0] // 50), int(p[1] // 50)), []).append(p)

    def near_mean(x, y, r=25.0):
        gx, gy = int(x // 50), int(y // 50)
        acc = []
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for p in grid.get((gx + i, gy + j), []):
                    if math.hypot(p[0] - x, p[1] - y) < r:
                        acc.append(p)
        if not acc:
            return None
        # 上下線の 2 本の中ほどを取る
        return (sum(p[0] for p in acc) / len(acc), sum(p[1] for p in acc) / len(acc))

    # 駅を結んだ折れ線を、OSM の線路に寄せていく（3 回くり返す）
    line = resample([to_xy(s["lat"], s["lon"]) for s in stations], STEP)
    for it in range(6):
        # 最初は粗い線から、近い線路の点を広めに探す
        r = 120.0 if it == 0 else 30.0
        moved = []
        for (x, y) in line:
            m = near_mean(x, y, r)
            moved.append(m if m else (x, y))
        # 平滑化
        sm = [moved[0]]
        for i in range(1, len(moved) - 1):
            sm.append(((moved[i - 1][0] + 2 * moved[i][0] + moved[i + 1][0]) / 4,
                       (moved[i - 1][1] + 2 * moved[i][1] + moved[i + 1][1]) / 4))
        sm.append(moved[-1])
        line = resample(sm, STEP)

    # 距離
    chain = [0.0]
    for (x0, y0), (x1, y1) in zip(line, line[1:]):
        chain.append(chain[-1] + math.hypot(x1 - x0, y1 - y0))

    # 駅の距離（中心線への最近点）
    for s in stations:
        x, y = to_xy(s["lat"], s["lon"])
        i = min(range(len(line)), key=lambda k: (line[k][0] - x) ** 2 + (line[k][1] - y) ** 2)
        s["s"] = round(chain[i], 1)
        s["offset"] = round(math.hypot(line[i][0] - x, line[i][1] - y), 1)

    out = {
        "line": LINE_NAME,
        "length": round(chain[-1], 1),
        "trips_used": ntrips,
        "points": [[round(to_ll(x, y)[0], 6), round(to_ll(x, y)[1], 6), round(c, 1)]
                   for (x, y), c in zip(line, chain)],
        "stations": stations,
    }
    (ROOT / "data").mkdir(exist_ok=True)
    json.dump(out, open(ROOT / "data/track.json", "w"), ensure_ascii=False)
    print(f"length {out['length']:.0f} m, points {len(line)}, trips {ntrips}")
    for s in stations:
        print(f"  {s['s']:7.0f} m  {s['name']}  (駅の点から {s['offset']} m)  停車{s['dwell']}s  次まで{s['run_to_next']}s")


if __name__ == "__main__":
    main()
