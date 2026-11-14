"""OSM の抜き出し（data/raw/liner_area_smart.pbf）から、店・飲食店などの点を取り出す。
出力: data/raw/liner_poi.geojsonseq（build_scene.py が、建物の 1 階を店らしく描くのに使う）
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src, mid, out = ROOT / "data/raw/liner_area_smart.pbf", ROOT / "data/raw/liner_poi.pbf", ROOT / "data/raw/liner_poi.geojsonseq"
subprocess.run(["osmium", "tags-filter", str(src),
                "nwr/amenity=restaurant,cafe,fast_food,bar,pub,pharmacy,bank,clinic,dentist,doctors", "nwr/shop",
                "-o", str(mid), "-O"], check=True)
subprocess.run(["osmium", "export", str(mid), "-f", "geojsonseq", "-o", str(out), "-O"], check=True)
print(out, sum(1 for _ in open(out, encoding="utf-8")), "件")
