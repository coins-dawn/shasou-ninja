# shasou-ninja

ブラウザで動く 2D の横スクロールゲームの試作。

## 動かし方

```sh
cd web
python3 -m http.server 8005
# http://localhost:8005/ を開く（?god をつけると、死なない確認用モード）
```

## データを作り直す

```sh
# 1. 線路の形（OSM の関東の pbf から切り出す）
osmium extract -b 139.75,35.72,139.79,35.82 kanto-latest.osm.pbf -o data/raw/liner_area.pbf
osmium tags-filter data/raw/liner_area.pbf w/railway -o data/raw/liner_rail.pbf
osmium export data/raw/liner_rail.pbf -f geojsonseq -o data/raw/liner_rail.geojsonseq

# 2. 駅と所要時間（都営の GTFS を展開したディレクトリ）→ data/track.json
export TOEI_GTFS=path/to/toei_train/gtfs   # build_scene.py（駅の英語名・乗りかえ）でも使う
python3 scripts/build_track.py

# 3. 建物の CityGML を取る（約 1GB）→ data/raw/plateau/
python3 scripts/fetch_plateau.py

# 4. 面を作る → web/data/stage.json
python3 scripts/build_stage.py

# 5. 路線図・川・公園・学校（OSM。関係も含めて切り出す）→ web/data/map.json
osmium extract -s smart -b 139.74,35.715,139.80,35.825 kanto-latest.osm.pbf -o data/raw/liner_area_smart.pbf
osmium tags-filter data/raw/liner_area_smart.pbf nwr/waterway=river,canal,riverbank nwr/natural=water nwr/leisure=park,pitch nwr/amenity=school -o data/raw/liner_feat.pbf
osmium export data/raw/liner_feat.pbf -f geojsonseq -o data/raw/liner_feat.geojsonseq
python3 scripts/build_map.py

# 6. 店・飲食店（OSM の amenity / shop）→ data/raw/liner_poi.geojsonseq
python3 scripts/extract_poi.py

# 7. 建物の形（平面形・LOD2 の面）を線路の座標に直す → web/data/scene.json、地図用 web/data/buildings.geojson
python3 scripts/build_scene.py

# 画面を撮る（Playwright）
python3 scripts/shot.py OUT_DIR [幅 高さ]
python3 scripts/scenes.py OUT_DIR 幅 高さ   # 決まった場面
python3 scripts/fullrun.py [倍速]           # 自動操縦で終点まで
```

## 公開（GitHub Pages）

`.github/workflows/pages.yml` が `web/` をそのまま出す（main への push で動く）。
最初の一度だけ、リポジトリの Settings → Pages → Source を「GitHub Actions」にする。

## 作り

- `scripts/` … データの加工（Python 標準ライブラリのみ）
- `web/index.html`, `web/game.js` … 左の画面（ドアの窓、Canvas 2D）
- `web/map3d.js` … 右の画面（上空からの地図。MapLibre GL JS 4.7.1 を CDN から）
- `web/data/scene.json`, `web/data/map.json`, `web/data/buildings.geojson` … 加工済みのデータ（`stage.json` は scene.json の材料）
- 文字は DotGothic16（Google Fonts）

## データの出典・ライセンス

- 建物: 国土交通省 [PLATEAU](https://www.mlit.go.jp/plateau/)（3D 都市モデル、建築物モデル）を加工して作成。
  [PLATEAU Site Policy](https://www.mlit.go.jp/plateau/site-policy/) に従う
- 駅・時刻表: 東京都交通局 GTFS（[公共交通オープンデータセンター](https://www.odpt.org/) 経由、CC BY 4.0）
- 線路の形・川・公園・学校: © OpenStreetMap contributors（ODbL）
- 地図: 国土地理院 地理院タイル（淡色地図）
- 文字: DotGothic16（SIL Open Font License 1.1）
