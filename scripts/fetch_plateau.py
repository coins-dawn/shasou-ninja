"""線路沿いの 3 次メッシュ（1km）の PLATEAU 建築物 CityGML を取ってくる。

PLATEAU データカタログ API のメッシュ検索
  https://api.plateauview.mlit.go.jp/datacatalog/citygml/m:{メッシュ}
で、そのメッシュの bldg ファイルの URL を引いてダウンロードする（data/raw/plateau/ に保存）。
"""
import json
import math
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw/plateau"
BUF = 300.0  # 線路から何 m まで（遠景にも使う）


def mesh3(lat, lon):
    p = int(lat * 1.5)
    u = int(lon - 100)
    q = int((lat * 1.5 - p) * 8)
    v = int((lon - 100 - u) * 8)
    r = int(((lat * 1.5 - p) * 8 - q) * 10)
    w = int(((lon - 100 - u) * 8 - v) * 10)
    return f"{p:02d}{u:02d}{q}{v}{r}{w}"


def main():
    track = json.load(open(ROOT / "data/track.json"))
    meshes = set()
    for lat, lon, _ in track["points"]:
        for dx in (-BUF, 0, BUF):
            for dy in (-BUF, 0, BUF):
                meshes.add(mesh3(lat + dy / 110540, lon + dx / (111320 * math.cos(math.radians(lat)))))
    meshes = sorted(meshes)
    print(f"{len(meshes)} meshes")
    RAW.mkdir(parents=True, exist_ok=True)
    index = {}
    for m in meshes:
        info = json.load(urllib.request.urlopen(
            f"https://api.plateauview.mlit.go.jp/datacatalog/citygml/m:{m}", timeout=60))
        for c in info.get("cities", []):
            for f in c["files"].get("bldg", []):
                index.setdefault(f["url"], {"mesh": m, "city": c["cityName"], "year": c["year"],
                                            "size": f.get("fileSize", 0), "features": f.get("features", 0)})
    total = sum(v["size"] for v in index.values())
    print(f"{len(index)} files, {total/1e6:.0f} MB")
    for url, v in index.items():
        dst = RAW / url.rsplit("/", 1)[1].replace(".gml", f"_{v['city']}.gml")
        v["file"] = dst.name
        if dst.exists() and dst.stat().st_size > 0 and (not v["size"] or dst.stat().st_size == v["size"]):
            continue
        print(f"  get {v['city']} {v['mesh']} {v['size']/1e6:.1f} MB", flush=True)
        urllib.request.urlretrieve(url, dst)
    json.dump(index, open(RAW / "index.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
