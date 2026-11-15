// 3D の地図（ドアの右）: 進む向きの右の上空から左を見下ろし、進む向きを画面の右に（先読み）。手前（右側）の建物は描かない。MapLibre GL
// 色をつけるのは、乗れる屋根（黄）といま乗っている屋根（橙）だけ。高い壁・広い隙間は近づいたら札で知らせる。
// 下地は国土地理院の淡色地図、建物は PLATEAU の平面形と高さを立体に、線路は OSM、駅は GTFS。
'use strict';
// 地図の欄に、いまの状態（読み込み中・失敗の理由）を出す
function mapStatus(msg, isErr) {
  let el = document.getElementById('mapStatus');
  if (!el) {
    el = document.createElement('div'); el.id = 'mapStatus';
    el.style.cssText = 'position:absolute;left:12px;top:12px;right:12px;z-index:5;font:13px/1.6 "DotGothic16",sans-serif;' +
      'background:rgba(30,27,56,.88);color:#fff;padding:8px 12px;border-radius:6px;white-space:pre-wrap';
    document.getElementById('map').appendChild(el);
  }
  el.textContent = msg; el.style.display = msg ? 'block' : 'none';
  el.style.background = isErr ? 'rgba(160,30,40,.92)' : 'rgba(30,27,56,.88)';
}
window.addEventListener('unhandledrejection', (e) => {
  const m = e.reason && e.reason.message ? e.reason.message : String(e.reason);
  mapStatus('地図の表示でエラーが起きました:\n' + m, true);
});
function loadScript(src) {
  return new Promise((ok, ng) => { const t = document.createElement('script'); t.src = src; t.onload = ok; t.onerror = () => ng(new Error(src)); document.head.appendChild(t); });
}
function loadCss(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }

(async function () {
  try {
    mapStatus('地図を読み込んでいます…');
    // MapLibre を読めなかったら、別の配信元から読む
    if (!window.maplibregl) {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js');
        loadCss('https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css');
      } catch (e) { /* 下で知らせる */ }
    }
    if (!window.maplibregl) { mapStatus('地図のライブラリ（MapLibre GL）を読み込めませんでした。\nネットにつながっているか、unpkg.com / cdn.jsdelivr.net が使えるかを確かめてください。', true); return; }
    // MapLibre 4 は WebGL2 が必要
    const test = document.createElement('canvas');
    if (!test.getContext('webgl2')) { mapStatus('このブラウザでは WebGL2（3D の描画）が使えないため、地図を出せません。\nブラウザの設定で「ハードウェア アクセラレーション」が有効か確かめてください。', true); return; }
    await start();
  } catch (e) {
    mapStatus('地図の表示でエラーが起きました:\n' + (e && e.message ? e.message : e), true);
    console.error(e);
  }
})();

async function start() {
  const map3 = await (await fetch('data/map.json', { cache: 'no-cache' })).json();
  const L10 = map3.line10; // [緯度, 経度, 日暮里からの距離]

  const USAGE_COLOR = [
    'match', ['get', 'u'],
    '411', '#f4ead8', '412', '#e8eef4', '413', '#f7dfc8', '414', '#ece0d2', '415', '#efe3c4',
    '401', '#b9cfe6', '402', '#f6d2c4', '404', '#f6d2c4', '403', '#e2d6ef', '421', '#d8e8d0',
    '422', '#fbefc8', '431', '#c9d6de', '441', '#d4d4cc',
    '#e9e6e0',
  ];
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        pale: {
          type: 'raster', tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 18,
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
        },
      },
      layers: [{ id: 'pale', type: 'raster', source: 'pale', paint: { 'raster-saturation': -0.2, 'raster-opacity': 0.95 } }],
    },
    center: [L10[0][1], L10[0][0]], zoom: 16.6, pitch: 62, bearing: -60,
    interactive: false, attributionControl: { compact: true }, maxPitch: 75,
  });

  // 線路沿いの点を距離で引く
  function at(s) {
    let lo = 0, hi = L10.length - 1;
    s = Math.max(L10[0][2], Math.min(L10[hi][2], s));
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L10[m][2] <= s) lo = m; else hi = m; }
    const a = L10[lo], b = L10[hi], t = (s - a[2]) / Math.max(0.01, b[2] - a[2]);
    return [a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t]; // [経度, 緯度]
  }
  const KX = 111320 * Math.cos(35.77 * Math.PI / 180), KY = 110540;
  function heading(s) { // 進む向き（北から時計回り、度）
    const p = at(s - 15), q = at(s + 15);
    return Math.atan2((q[0] - p[0]) * KX, (q[1] - p[1]) * KY) * 180 / Math.PI;
  }
  function offset(s, left) { // 進む向きの左へ left m ずらした点
    const p = at(s), h = heading(s) * Math.PI / 180;
    const ex = Math.cos(h), ny = -Math.sin(h); // 左向き（東西・南北の成分）
    return [p[0] + (-ex * left) / KX * 1, p[1] + (Math.sin(h) * left) / KY];
  }
  // 線路を幅 w の帯にする（s0〜s1）
  function band(s0, s1, w) {
    const L = [], R = [];
    for (let s = s0; s <= s1 + 0.01; s += Math.max(2, (s1 - s0) / 12)) { L.push(offset(s, w / 2)); R.push(offset(s, -w / 2)); }
    return [...L, ...R.reverse(), L[0]];
  }
  const CAR = 9, GAP = 0.6, NCAR = 5;
  function trainFeatures(S) {
    const fs = [];
    for (let i = 0; i < NCAR; i++) {
      const s1 = S + 18 - i * (CAR + GAP), s0 = s1 - CAR;
      fs.push({ type: 'Feature', properties: { c: i === 0 ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [band(s0, s1, 3.2)] } });
    }
    return { type: 'FeatureCollection', features: fs };
  }

  window.addEventListener('insetresize', () => map.resize()); // 右下の小窓の大きさが変わったら
  map.on('error', (e) => {
    const m = e && e.error && e.error.message ? e.error.message : String(e && e.error || e);
    if (/tile|Failed to fetch|NetworkError|404/.test(m)) mapStatus('地図の下地（地理院タイル）の一部を読み込めませんでした: ' + m, true);
    else mapStatus('地図でエラーが起きました: ' + m, true);
    console.error(e);
  });
  map.on('load', async () => {
    mapStatus('建物（PLATEAU）を読み込んでいます…');
    // 高架の線路（帯を少し持ち上げて立体に）
    const guide = [];
    for (let s = L10[0][2]; s < L10[L10.length - 1][2]; s += 40) guide.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [band(s, Math.min(s + 40, L10[L10.length - 1][2]), 7)] } });
    map.addSource('guide', { type: 'geojson', data: { type: 'FeatureCollection', features: guide } });
    map.addLayer({ id: 'guide', type: 'fill-extrusion', source: 'guide',
      paint: { 'fill-extrusion-color': '#8a9099', 'fill-extrusion-base': 7.2, 'fill-extrusion-height': 8.4, 'fill-extrusion-opacity': 1 } });
    // 路線の色の線（地面に）
    map.addSource('line', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: L10.map((p) => [p[1], p[0]]) } } });
    map.addLayer({ id: 'line', type: 'line', source: 'line', paint: { 'line-color': '#e0559a', 'line-width': 4, 'line-opacity': 0.85 } }, 'guide');

    // 建物（PLATEAU）
    const res = await fetch('data/buildings.geojson', { cache: 'no-cache' });
    if (!res.ok) throw new Error('buildings.geojson ' + res.status);
    const bld = await res.json();
    // 線路の左（忍者が走る側）か右か。右の建物は手前になって邪魔なので描かない
    for (const f of bld.features) {
      const g = f.geometry, ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
      let cx = 0, cy = 0;
      for (const q of ring) { cx += q[0]; cy += q[1]; }
      cx /= ring.length; cy /= ring.length;
      let best = 1e18, bi = 0;
      for (let i = 0; i < L10.length; i++) { const dx = (L10[i][1] - cx) * KX, dy = (L10[i][0] - cy) * KY, d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } }
      const a = L10[Math.max(0, bi - 1)], b = L10[Math.min(L10.length - 1, bi + 1)];
      const tx = (b[1] - a[1]) * KX, ty = (b[0] - a[0]) * KY, px = (cx - L10[bi][1]) * KX, py = (cy - L10[bi][0]) * KY;
      f.properties.side = tx * py - ty * px > 0 ? 'L' : 'R'; // 東・北の座標で外積が正なら進む向きの左
    }
    map.addSource('bld', { type: 'geojson', data: bld });
    map.addLayer({ id: 'bld', type: 'fill-extrusion', source: 'bld', filter: ['==', ['get', 'side'], 'L'],
      paint: {
        'fill-extrusion-color': ['case',
          ['boolean', ['feature-state', 'on'], false], '#ff8a1f',     // 忍者がいま乗っている
          ['boolean', ['feature-state', 'row'], false], '#ffd23f',    // 乗れる屋根
          '#e6e4df'],
        'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.94,
        'fill-extrusion-vertical-gradient': true,
      } });

    // しなり竹（届かない隙間の地面）も乗れるところなので黄色
    map.addSource('springs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'springs', type: 'fill-extrusion', source: 'springs',
      paint: { 'fill-extrusion-color': '#ffd23f', 'fill-extrusion-base': 0, 'fill-extrusion-height': 2, 'fill-extrusion-opacity': 0.95 } }, 'bld');
    let infoDone = false;
    function applyInfo() {
      const info = window.mapInfo && window.mapInfo();
      if (!info) return;
      for (const i of info.rows) { const id = byNi.get(i); if (id !== undefined) map.setFeatureState({ source: 'bld', id }, { row: true }); }
      map.getSource('springs').setData({ type: 'FeatureCollection', features: (info.springs || []).map(([a, b]) => {
        const Lp = [], Rp = [];
        for (let x = a; x <= b + 0.01; x += Math.max(2, (b - a) / 6)) { Lp.push(offset(x, 16)); Rp.push(offset(x, 8)); }
        return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...Lp, ...Rp.reverse(), Lp[0]]] } };
      }) });
      infoDone = true;
    }

    // 電車（日暮里・舎人ライナーの色に近い白と青）
    map.addSource('train', { type: 'geojson', data: trainFeatures(L10[0][2]) });
    map.addLayer({ id: 'train', type: 'fill-extrusion', source: 'train',
      paint: { 'fill-extrusion-color': ['case', ['==', ['get', 'c'], 1], '#2f6fd0', '#7fa6dc'],
        'fill-extrusion-base': 8.6, 'fill-extrusion-height': 12.2, 'fill-extrusion-opacity': 1 } });

    // 駅の名前
    for (const [name, la, lo] of map3.stations) {
      const el = document.createElement('div'); el.className = 'st-label'; el.textContent = name;
      new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lo, la]).addTo(map);
    }
    // 忍者の位置
    // 忍者（左の画面と同じドット絵を、乗っている屋根の高さぶん持ち上げて出す）
    const pin = document.createElement('canvas'); pin.width = 44; pin.height = 36; pin.className = 'ninja-sprite';
    const pctx = pin.getContext('2d');
    const ninja = new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat(at(0)).addTo(map);

    // 建物番号（左の画面）→ 地図の建物
    const byNi = new Map();
    for (const f of bld.features) if (f.properties.ni >= 0) byNi.set(f.properties.ni, f.id);
    let lit = -1, bearing = null;
    mapStatus('');

    // 大物（高い壁・広い隙間）の目印。窓に入ってくる 3 秒前から、忍者がそこを越えるまで出す
    const warnEl = document.createElement('div'); warnEl.className = 'warn-pin';
    const warn = new maplibregl.Marker({ element: warnEl, anchor: 'bottom', offset: [0, -16] }).setLngLat(at(0));
    let warnOn = null; // いま出している大物 [s, 種類, m]
    const mapEl = document.getElementById('map');
    function updateWarn(st) {
      const info = window.mapInfo && window.mapInfo();
      let hit = null;
      if (info && info.big && st.state === 'play') {
        const lead = st.ahead + Math.max(45, st.speed * 3);
        hit = info.big.find((b) => b[0] > st.nx - 1 && b[0] - st.nx < lead) || null;
      }
      if (hit !== warnOn) {
        warnOn = hit;
        if (hit) {
          warnEl.innerHTML = hit[1] === 'wall' ? `<b>!</b>高い壁 ${hit[2]}m` : `<b>!</b>広いすきま ${hit[2]}m`;
          warn.setLngLat(offset(hit[0] + (hit[1] === 'gap' ? hit[2] / 2 : 0), 12)).addTo(map);
        } else warn.remove();
      }
      // 窓に入る前だけ、地図のふちを赤く点滅させる（入ったら窓を見る）
      mapEl.classList.toggle('warn', !!hit && hit[0] - st.nx > st.ahead && !st.paused);
    }

    function tick() {
      const st = window.trainState && window.trainState();
      if (!infoDone) applyInfo();
      if (st) updateWarn(st);
      if (st) {
        map.getSource('train').setData(trainFeatures(st.S));
        // 忍者は、乗っている建物のあたり（進む向きの左）
        let npos = offset(st.nx, st.bid >= 0 ? st.d + 6 : 0), nh = Math.max(0, st.y);
        // ひとっとび: 電車に飛びついて（左の窓に貼りつく）、またもどる。左の画面の演出と同じ進み具合
        if (st.leap >= 0) {
          const ease = (t) => t * t * (3 - 2 * t), u = st.leap;
          const w = u < 0.25 ? ease(u / 0.25) : u <= 0.8 ? 1 : 1 - ease((u - 0.8) / 0.2);
          const arc = u < 0.25 ? Math.sin(Math.PI * u / 0.25) : u > 0.8 ? Math.sin(Math.PI * (u - 0.8) / 0.2) : 0;
          const tp = offset(st.S + 4, 1.9); // 2 両目の左の側面
          npos = [npos[0] + (tp[0] - npos[0]) * w, npos[1] + (tp[1] - npos[1]) * w];
          nh = nh + (10.4 - nh) * w + arc * 6;
        }
        ninja.setLngLat(npos);
        const nc = window.ninjaCanvas && window.ninjaCanvas();
        if (nc) { pctx.clearRect(0, 0, 44, 36); pctx.drawImage(nc, 0, 0); }
        // 高さ h[m] を画面の上方向のずれ[px]に（地図の 1px が何 m か × 傾き）
        const mpp = 40075016.686 * Math.cos(npos[1] * Math.PI / 180) / (512 * Math.pow(2, map.getZoom()));
        ninja.setOffset([0, -nh / mpp * Math.sin(map.getPitch() * Math.PI / 180) + 4]);
        const fid = st.bid >= 0 ? byNi.get(st.bid) : undefined;
        if (fid !== lit) {
          if (lit >= 0) map.setFeatureState({ source: 'bld', id: lit }, { on: false });
          if (fid !== undefined) map.setFeatureState({ source: 'bld', id: fid }, { on: true });
          lit = fid === undefined ? -1 : fid;
        }
        // カメラ: 進む向きの右（手前）の上空から、左（忍者の走る側）を見下ろす。進む向きが画面の右、この先が右に広がる
        const target = heading(st.S + 40) - 90;
        if (bearing === null) bearing = target;
        const db = ((target - bearing + 540) % 360) - 180;
        bearing += db * 0.04;
        const el = map.getContainer(), ch = el.clientHeight, cw = el.clientWidth;
        const tall = ch > cw * 1.2;
        // 横幅で約 185m 見える大きさ（縦長の欄でも先が見えるように）。電車は左から 1/4 ほど、この先が右へ
        const zoom = Math.max(15.4, Math.min(17.8, 17.0 + Math.log2(Math.max(200, cw) / 360)));
        const span = cw * 40075016.686 * Math.cos(35.77 * Math.PI / 180) / (512 * Math.pow(2, zoom));
        // 電車は下のほう、忍者の走る側（左）が上に広がる。きょりなどの欄は地図の外にあるので、地図はまるごと見える
        map.jumpTo({ center: offset(st.S + span * 0.27, span * (tall ? 0.42 : 0.22)), bearing, pitch: tall ? 56 : 52, zoom });
      }
      requestAnimationFrame(tick);
    }
    tick();
  });
}
