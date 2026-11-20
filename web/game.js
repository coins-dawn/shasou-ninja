// 車窓ニンジャ — 試作（ドット絵 × PLATEAU の建物を高架から見下ろす）
'use strict';


// ---- 色 ----
const INK = '#221d2e';
const HAZE = '#cfe3f3';
const PAL = {
  o: '#1e1b38', n: '#2d3770', N: '#4a5fae', d: '#1f2550', s: '#f7cfa6', S: '#e0a77f', w: '#ffffff', e: '#1e1b38',
  r: '#e2453c', R: '#a52a3a', m: '#dfe5ee', M: '#97a3b5',
};

// ---- 忍者のドット絵（14×20、右向き）。縁取りは描くときに自動でつける ----
const HEAD = [
  '....oooooo....',
  '...oNNNNNno...',
  '..oNNnnnnnndo.',
  '..ommmmmmmMo..',
  '..onnssssssdo.',
  '..onsssswesdo.',
  '..onnnnnnnndo.',
  '...onnnnnnddo.',
  '....oooooooo..',
];
const TORSO = [
  '.....onNno....',
  '....onNNnndo..',
  '....onNnnndo..',
  '....orrrrRRo..',
  '....onnnnddo..',
];
const LEGS = {
  idle: ['....onn.nddo..', '....ond..ndo..', '....ond..ndo..', '...oond..ndoo.', '...ooo...ooo..', '..............'],
  run0: ['....onnnnddo..', '...ondo..ondo.', '..ondo....ondo', '.oddo......ooo', '.ooo..........', '..............'],
  run1: ['....onnnddo...', '.....ondo.....', '.....ondo.....', '....ondo......', '....oooo......', '..............'],
  run2: ['....onnnnddo..', '...ond..ondo..', '..ond....ondo.', '..ooo.....oddo', '..........ooo.', '..............'],
  run3: ['....onnnnddo..', '.....ondonddo.', '.....ondo.oo..', '.....ondo.....', '.....oooo.....', '..............'],
  jump: ['....onnnnddo..', '...onnddnndo..', '...ooo..oooo..', '..............', '..............', '..............'],
  fall: ['....onnnnddo..', '...ond...ondo.', '..ond.....ondo', '..oo.......oo.', '..............', '..............'],
  land: ['...onnnnnddo..', '..ond....ondo.', '.ooo......ooo.', '..............', '..............', '..............'],
};
const ARMS = {
  run0: [[10, 10, 'N'], [11, 10, 'N'], [12, 10, 's'], [3, 11, 'd'], [2, 12, 'S']],
  run2: [[3, 10, 'd'], [2, 10, 'd'], [1, 10, 'S'], [10, 11, 'N'], [11, 12, 's']],
  side: [[10, 11, 'N'], [10, 12, 's'], [3, 11, 'd'], [3, 12, 'S']],
  up: [[10, 9, 'N'], [11, 8, 'N'], [12, 7, 's'], [3, 10, 'd'], [2, 9, 'S']],
  out: [[11, 10, 'N'], [12, 9, 's'], [2, 10, 'd'], [1, 9, 'S']],
};
function frameRows(legs, down) {
  const rows = [...HEAD, ...TORSO, ...LEGS[legs]];
  if (down) { rows.pop(); rows.unshift('..............'); }
  return rows;
}
const SPR_W = 14, SPR_H = 20;

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const low = document.createElement('canvas');      // 窓の中（ドット）
const lc = low.getContext('2d');
const mapLow = document.createElement('canvas');   // 路線図（ドット）
const mc = mapLow.getContext('2d');
const mapBase = document.createElement('canvas');
let D = lc;          // 建物を描く先（ふだんは窓の中、スプライトを作るときはそのキャンバス）
let SPRKEY = 0;      // 画面の大きさが変わったらスプライトを作り直す
let paused = false;
const $ = (id) => document.getElementById(id);
const FONT = '"DotGothic16","Hiragino Sans","Noto Sans JP",monospace';

const QS = new URLSearchParams(location.search);
const GOD = QS.has('god');
const TIMESCALE = Math.min(8, Math.max(0.25, parseFloat(QS.get('ts') || '1') || 1)); // 確認用の早回し

let MAP = null; // SC（走る面）は core.js
let SCN = null;
let W = 0, H = 0, DPR = 1, WIN = null, PX = 2, LW = 0, LH = 0, KL = 3.5, LAYOUT = null; // KL = 1m あたりのドット数
// 見え方は「真横から見た断面図」（奥行きなし）。高架から見下ろす版はやめた（2026-11-14）
const VIEW = 'section';
const OFF = (d) => (VIEW === 'section' ? 0 : SC.HH * (1 - Math.exp(-d / SC.LAM))); // 奥行き → 見かけの持ち上がり

// ---- 左の欄の設定（「しゅっぱつ」で G.opts に写す） ----
const OPTS = { size: 'S', diff: 'easy', crowd: 'grow', cam: 'follow' };
window.OPTS = OPTS;
// 景色・車内のドットの細かさ。2 = 忍者と同じ細かさ（忍者の 1 ドット = 景色の 1 ドット）、1 = 元の粗さ（忍者だけ 2 倍細かい）
const DOT = (() => { const m = /dot=(\d)/.exec(location.search); return m ? Math.max(1, +m[1]) : 2; })();
const SIZE_MUL = { S: 1, M: 1.5, L: 2 };            // ニンジャの大きさ（見た目だけ）
const ninjaMul = () => SIZE_MUL[(G && G.opts ? G.opts : OPTS).size] || 1;

// ---- ランキング ----
// RANK_API: ランキングの API（Google Apps Script のウェブアプリ）の URL。空のあいだは、この端末の中だけに残す
// API では、出発のときに「開始券」をもらい、終わったら押した・離した時刻の記録を送る。点数はサーバーが計算しなおす
const RANK_API = 'https://script.google.com/macros/s/AKfycbz0JUalHjc8X4IdqDRSecQXGT6A8VabcHpbFh-O7HpkUWdbsUN8LZPviLcq3RLkQz7-/exec';
const RANK_OK = !GOD && TIMESCALE === 1; // 確認用の早回し・無敵では送らない
const Rank = {
  KEY: 'shasou-ninja-rank-v1',
  local() { try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch (e) { return []; } },
  async api(q, body) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(RANK_API + (q ? `?a=${q}` : ''), body ? { method: 'POST', body: JSON.stringify(body), signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' } } : { signal: ctl.signal }); // text/plain: 事前の問い合わせ（CORS）を出さない
      return await r.json();
    } finally { clearTimeout(tm); }
  },
  async list() { // 失敗したら null
    if (!RANK_API) return this.local();
    try { const j = await this.api('list'); return j.ok ? j.list : null; } catch (e) { return null; }
  },
  async ticket() {
    if (!RANK_API) return 'local';
    try { const j = await this.api('start'); return j.ok ? j.ticket : null; } catch (e) { return null; }
  },
  async add(rec, run) { // { ok, list, rid, msg }
    if (!RANK_API) {
      const a = this.local();
      a.push(rec);
      a.sort((x, y) => (y.pts ?? y.dist) - (x.pts ?? x.dist)); // ポイント（きょり × 倍率）の順
      const top = a.slice(0, 20);
      try { localStorage.setItem(this.KEY, JSON.stringify(top)); } catch (e) {}
      return { ok: true, list: top, rid: rec.id };
    }
    try { return await this.api('', Object.assign({ name: rec.name, pts: rec.pts }, run)); }
    catch (e) { return { ok: false, msg: 'ランキングにつながりませんでした' }; }
  },
};

// よくまぜる整数の乱数（murmur3 の仕上げ）。並んだ番号でも値がそろわない
function hash32(n) {
  let h = n | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hash(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

// ---- 建物の見た目（PLATEAU の名前・用途・説明注記から） ----
const USAGE_NAME = {
  '401': '事務所', '402': 'お店', '403': 'ホテル', '404': 'お店', '411': '住宅', '412': 'マンション',
  '413': 'お店つき住宅', '414': 'お店つきマンション', '415': '作業場つき住宅', '421': '役所',
  '422': '学校・文化施設', '431': '倉庫・車庫', '441': '工場', '452': '農業の建物', '461': '建物',
};
function kindOf(b) {
  const n = b.name;
  if (/小学校|中学校|高等学校|高校|学園|大学/.test(n)) return 'school';
  if (/病院|医院|クリニック/.test(n)) return 'hospital';
  if (/郵便局/.test(n)) return 'post';
  if (/消防/.test(n)) return 'fire';
  if (/交番|警察/.test(n)) return 'police';
  if (/老人ホーム|ケア|介護/.test(n)) return 'care';
  if (/自転車置場|車庫|物置|倉庫|ごみ|トイレ|東屋|付属/.test(b.note)) return 'shed';
  switch (b.u) {
    case '411': case '415': return 'house';
    case '413': return 'shophouse';
    case '412': case '403': return 'apartment';
    case '414': return 'shopapartment';
    case '401': return 'office';
    case '402': case '404': return 'shop';
    case '421': return 'public';
    case '422': return b.h > 9 ? 'school' : 'public';
    case '431': return 'warehouse';
    case '441': return 'factory';
    default: return b.h > 12 ? 'apartment' : 'house';
  }
}
function labelOf(b) { return b.note || USAGE_NAME[b.u] || '建物'; }
function styleOf(b) {
  const r = hash(b.i, 7), r2 = hash(b.i, 11);
  const k = kindOf(b);
  const S = { kind: k, win: '#4e6f93', lit: '#ffe58a' };
  switch (k) {
    case 'house':
      S.wall = pick(['#f6f1e7', '#fbf8f0', '#e9eef2', '#f3e6cf', '#e4ecf0', '#f7e9d7', '#dfe9df', '#f2e4dc'], r);
      S.roof = pick(['#5d7d9e', '#c0614f', '#6f8f6b', '#4f6680', '#8a6fa8', '#d08a4c', '#3f7fa8'], r2);
      S.pitch = 3.2; S.winW = 1.3; break;
    case 'shophouse':
      S.wall = pick(['#fbf3e2', '#f1f4f7', '#fde9df', '#eaf3fb'], r);
      S.roof = pick(['#5d7d9e', '#c0614f', '#6f8f6b', '#4f6680'], r2); S.pitch = 3.0; S.winW = 1.3; S.shop = true; break;
    case 'apartment': case 'shopapartment':
      S.wall = pick(['#f7f7f2', '#eef1f4', '#f5eee2', '#e6eef6', '#f7efe4', '#e9f0e9', '#dfe7ef', '#f2e9f2'], r);
      S.roof = '#c9cdd2'; S.balcony = true; S.pitch = 3.4; S.winW = 2.0; S.shop = k === 'shopapartment'; break;
    case 'office':
      S.wall = pick(['#a9c6e3', '#c9d6e2', '#93b7da', '#d6dee6'], r); S.roof = '#c4c8cc'; S.band = true;
      S.win = '#3f6f9e'; break;
    case 'shop':
      S.wall = pick(['#fff4e0', '#f1f4f7', '#ffe9e0', '#e9f3ff'], r); S.roof = '#c7c8c6'; S.shop = true; S.pitch = 3.4; S.winW = 1.8; break;
    case 'school':
      S.wall = '#fbf3dc'; S.roof = '#bdbaae'; S.band = true; S.win = '#6fa6d3'; S.mullion = 1.8; S.clock = true; break;
    case 'hospital':
      S.wall = '#ffffff'; S.roof = '#c3c6c8'; S.band = true; S.win = '#6aa3c4'; S.mullion = 2.4; S.cross = true; break;
    case 'post':
      S.wall = '#f8f8f5'; S.roof = '#c2c3c1'; S.pitch = 3.0; S.winW = 2.0; S.stripe = '#d9363e'; S.acc1 = '#d9363e'; break;
    case 'fire':
      S.wall = '#f8f7f2'; S.roof = '#c2c2bd'; S.pitch = 3.2; S.winW = 2.0; S.garage = '#cc302d'; S.stripe = '#cc302d'; S.acc1 = '#cc302d'; break;
    case 'police':
      S.wall = '#eceae4'; S.roof = '#4f6680'; S.pitch = 3.0; S.winW = 1.4; S.lamp = true; S.acc1 = '#e53935'; break;
    case 'care':
      S.wall = '#fbf0dc'; S.roof = '#c0bcb1'; S.balcony = true; S.pitch = 3.4; S.winW = 2.0; break;
    case 'public':
      S.wall = '#eef0ea'; S.roof = '#c0c3be'; S.band = true; S.mullion = 2.2; break;
    case 'warehouse':
      S.wall = pick(['#a9c3d6', '#b9d1c0', '#d8d0bc'], r); S.roof = '#9fb2bf'; S.ribs = true; break;
    case 'factory':
      S.wall = pick(['#c6ced0', '#d6d0c0', '#b9c8d2'], r); S.roof = '#a4abae'; S.ribs = true; S.pitch = 6; S.winW = 2.4; break;
    case 'shed':
      S.wall = '#d3d8d6'; S.roof = '#8fa3ad'; break;
  }
  // OSM の店・飲食店がある建物は、1 階をその店らしく（ラーメン屋ののれん、居酒屋の提灯、コンビニの帯など）
  if (b.poi && k !== 'school' && k !== 'hospital' && k !== 'fire' && k !== 'post' && k !== 'police') {
    S.shop = true; S.shopType = b.poi;
    const SHOP = {
      ramen: ['#d23c2f', '#6b4a32'], izakaya: ['#2a3560', '#5a3a26'], food: ['#e0962a', '#7a8794'], cafe: ['#2e7d5b', '#8a6a4a'],
      conbini: ['#2e9e5b', '#c9d3dc', '#3a6fb8'], salon: ['#d64545', '#7a8794', '#3a6fb8'], clinic: ['#2e9e5b', '#c9d3dc', '#2e9e5b'],
      florist: ['#d64545', '#7a8794'], bank: ['#3a6fb8', '#7a8794'], shop: [null, null],
    }[b.poi] || [null, null];
    if (SHOP[0]) S.acc1 = SHOP[0];
    if (SHOP[1]) S.acc2 = SHOP[1];
    if (SHOP[2]) S.acc3 = SHOP[2];
  }
  if (S.shop && !S.acc1) S.acc1 = pick(['#d64545', '#2e8b62', '#3a6fb8', '#e0962a'], hash(b.i, 5)); // 店先の日よけ
  // 住んでいる人・カーテン・洗濯物の色（建物ごと）
  S.hr = pick(['#2e2a2c', '#3b302c', '#6b4a33', '#a0683e'], hash(b.i, 21)); S.sh = pick(['#7a8fd0', '#e48a4f', '#5aa36a', '#f0b6c6', '#ffffff', '#d4b44a'], hash(b.i, 22));
  S.cu = pick(['#f3d58a', '#bcd9ee', '#f0b6c6', '#cfe6c4', '#e9d8c4'], hash(b.i, 23));
  S.l1 = pick(['#bcd9ee', '#ffffff', '#f3d58a'], hash(b.i, 24)); S.l2 = pick(['#f5a3b5', '#7cc4e6', '#e48a4f', '#9bd18a'], hash(b.i, 25));
  return S;
}

function shade(hex, f, mix, mixCol) {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) * f, g = ((n >> 8) & 255) * f, b = (n & 255) * f;
  if (mix) {
    const m = parseInt((mixCol || HAZE).slice(1), 16);
    r = r * (1 - mix) + ((m >> 16) & 255) * mix; g = g * (1 - mix) + ((m >> 8) & 255) * mix; b = b * (1 - mix) + (m & 255) * mix;
  }
  return `rgb(${Math.min(255, r | 0)},${Math.min(255, g | 0)},${Math.min(255, b | 0)})`;
}

// ---- データの下ごしらえ ----
function prepare(sc) {
  // 忍者が走る建物（乗れる屋根の列）
  const onRow = new Set(sc.solid); // 濃く描くのは手前の列（建物ごとに決めてある）だけ。後ろの建物は背景と同じ薄さ
  for (const b of sc.near) {
    b.row = onRow.has(b.i);
    b.style = styleOf(b);
    // 走れない建物は霞ませて背景にする
    b.haze = b.row ? Math.min(0.08, b.d / 70 * 0.08) : 0.6 + Math.min(0.15, b.d / 70 * 0.15);
    if (b.faces) {
      b.lod2 = b.faces.map(([k, q]) => {
        let nd = 0, nz = 0, md = 0;
        for (let i = 0; i < q.length; i++) {
          const a = q[i], c = q[(i + 1) % q.length];
          nd += (a[2] - c[2]) * (a[0] + c[0]); // 法線（Newell 法）の d 成分
          nz += (a[0] - c[0]) * (a[1] + c[1]); // z 成分
          md += a[1];
        }
        return { roof: k === 0, q, nd, nz, md: md / q.length };
      }).sort((x, y) => y.md - x.md);
    }
    let fp = b.fp.slice();
    if (fp.length > 1 && fp[0][0] === fp[fp.length - 1][0] && fp[0][1] === fp[fp.length - 1][1]) fp.pop();
    fp = simplifyRing(fp, 0.7);
    let area = 0;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], c = fp[(i + 1) % fp.length];
      area += a[0] * c[1] - c[0] * a[1];
    }
    const ccw = area > 0;
    b.walls = [];
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], c = fp[(i + 1) % fp.length];
      const es = c[0] - a[0], ed = c[1] - a[1];
      const nd = ccw ? -es : es; // 外向きの法線の d 成分（負なら線路の方を向く）
      if (nd < 0 && Math.abs(es) > 0.2) {
        const len = Math.hypot(es, ed);
        b.walls.push({ a: es > 0 ? a : c, c: es > 0 ? c : a, md: (a[1] + c[1]) / 2, lit: 0.86 + 0.14 * Math.abs(es) / len });
      }
    }
    b.walls.sort((x, y) => y.md - x.md);
    b.fp2 = fp;
  }
  // 奥から描く。走れない建物を先に、走る列をあとに（手前に）
  sc.back = sc.near.filter((b) => !b.row).sort((x, y) => y.d - x.d);
  sc.front = sc.near.filter((b) => b.row).sort((x, y) => y.d - x.d);
  sc.far.sort((x, y) => y[2] - x[2]);
  // 走る面（屋根の高さ）・駅・しなり竹は core.js の preparePhys で済ませてある

  // 公園の木
  sc.trees = [];
  for (const g of sc.ground) {
    if (g.k !== 'park') continue;
    const ss = g.r.map((p) => p[0]), dd = g.r.map((p) => p[1]);
    const s0 = Math.min(...ss), s1 = Math.max(...ss), d0 = Math.min(...dd), d1 = Math.min(140, Math.max(...dd));
    for (let s = s0; s < s1; s += 7) for (let d = d0; d < d1; d += 7) {
      const js = s + hash(s, d) * 5, jd = d + hash(d, s) * 5;
      if (inside(g.r, js, jd)) sc.trees.push([js, jd, 4 + hash(js, jd, 3) * 5]);
    }
  }
  sc.trees.sort((a, b) => b[1] - a[1]);

}

// 閉じた輪の間引き（Douglas-Peucker）。0.7m 未満のでこぼこは消す
function simplifyRing(ring, tol) {
  if (ring.length <= 4) return ring;
  const dp = (pts) => {
    if (pts.length < 3) return pts;
    const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1e-9;
    let best = 0, bi = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((x1 - x0) * (y0 - pts[i][1]) - (x0 - pts[i][0]) * (y1 - y0)) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best <= tol) return [pts[0], pts[pts.length - 1]];
    return dp(pts.slice(0, bi + 1)).slice(0, -1).concat(dp(pts.slice(bi)));
  };
  // いちばん離れた 2 点で分けて、それぞれ間引く
  let far = 1, fd = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = dp(ring.slice(0, far + 1)), b = dp(ring.slice(far).concat([ring[0]]));
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : ring;
}

// 断面図: 乗れる高さを、真横から見た形の上端に作り直す（建物ごとの役割はそのまま）
function inside(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function describe(b) {
  const parts = [];
  if (b.n > 0 && b.n < 9999) parts.push(`${b.n}階建て`);
  parts.push(`高さ${b.h.toFixed(1)}m`);
  return { name: b.name, addr: b.addr, label: labelOf(b), spec: parts.join('・') };
}

// ---- 状態（動きは core.js。ここでは見た目の分を足す） ----
function newGame(from = 0) {
  startGame(from, { diff: OPTS.diff, crowd: OPTS.crowd });
  G.opts = { ...OPTS };
  G.ev = []; // 押した・離した記録（ランキングのサーバーで計算しなおす）
  layoutEvent(true);
  if (window.paxReset) window.paxReset(from);
  if (SCN && KL) G.camUp = Math.max(0, G.y + 5 - (SCN.gY - SCN.SW.y0) / KL + 1); // 高い屋根なら、はじめからカメラを上げておく
  // カメラはふだん一番下に固定。出発の屋根にいるあいだだけ、忍者が見えるよう上げておく（ほかの屋根に降りたら下ろす）
  G.camHold = G.camUp > 0; G.startBid = G.bid; G.startY = G.y;
}
// 遊んでいるあいだの操作は、刻みの番号といっしょに残してから効かせる
function rec(type, a, b) {
  if (G.ev) G.ev.push(a === undefined ? [G.tick, type] : [G.tick, type, a, b]);
  applyInput(type, a, b);
}
// 窓の左はしまでの距離（画面の割り付けで変わる）。これより遅れると置いていかれる
function layoutEvent(force) {
  if (!G || !SCN || !KL) return;
  const winL = +((SCN.baseX - Math.max(0, SCN.SW.x0)) / KL).toFixed(3), leftDie = +(winL + 4 / KL).toFixed(3);
  if (!force && winL === G.winL && leftDie === G.leftDie) return;
  if (force || G.state !== 'play') applyInput(IN.LEFT, winL, leftDie);
  else rec(IN.LEFT, winL, leftDie);
  if (force && G.ev) { G.ev.length = 0; G.ev.push([0, IN.LEFT, winL, leftDie]); }
}
function press() {
  if (!G || G.state !== 'play' || paused || G.auto) return;
  rec(IN.PRESS);
}
function release() {
  if (G && G.state === 'play' && !paused) rec(IN.RELEASE);
  else pressed = false;
}

// ---- 一時停止 ----
function setPause(on) {
  if (!G || G.state !== 'play') return;
  paused = on;
  rec(IN.CLEAR);
  $('pause').classList.toggle('show', on);
}


// ---- オート実行（自動操縦）。使ったら、その回は記録に残せない ----
function autoPilot() {
  const x = G.S + G.off;
  let want = false;
  if (!G.skip) {
    const look = Math.max(4, G.speed * 0.32);
    for (let d = 0.5; d < look; d += 0.5) if (roofUnder(x + d) > G.y + 0.6) { want = true; break; } // 高い屋根・壁の手前で跳ぶ
    if (G.onGround && roofUnder(x + 1.5) < roofUnder(x) - 0.5) want = true;                          // 屋根のはしで跳ぶ
    if (G.wall) want = true;                                                                          // 壁は押しっぱなしで駆け上がる
    const fut = x + G.speed * 0.25;
    if (!G.onGround && G.vy < -2 && roofUnder(fut) < G.y - 2 && G.jumps > 0 && !springAt(fut) && !springAt(x)) want = true; // 空中ジャンプ
  }
  if (want && !pressed) { pressed = true; G.buffer = P.BUFFER; }
  else if (!want && pressed) release();
}
function setAuto(on) {
  if (!G || G.state !== 'play') return;
  G.auto = on;
  if (on) G.autoUsed = true;
  if (pressed) release();
  updateHud();
}


async function die(kind, goalText) {
  if (G.auto && kind !== 'goal') { // オート実行中は落ちない（念のため）
    G.off = 0; G.y = roofUnder(G.S) + 8; G.vy = 0; G.glide = true;
    return;
  }
  if (GOD && kind !== 'goal') { // 確認用: 死なずに降下し直す
    G.off = 0; G.y = roofUnder(G.S) + 8; G.vy = 0; G.glide = true; G.deaths = (G.deaths || 0) + 1;
    (G.deathLog = G.deathLog || []).push([Math.round(G.S), kind]);
    return;
  }
  G.state = 'dead';
  let why, detail;
  if (kind === 'goal') {
    why = 'ゴール！'; detail = goalText;
  } else if (kind === 'fall') {
    const b = G.bid >= 0 ? SC.near[G.bid] : null;
    why = '地面に落ちた';
    detail = b ? `${whereNow()}、${b.addr || 'どこか'}の${b.name || labelOf(b)}から落ちた` : `${whereNow()}で落ちた`;
  } else {
    const b = G.wallBid >= 0 ? SC.near[G.wallBid] : null;
    why = '窓の外に置いていかれた';
    detail = b ? `${whereNow()}、${b.addr || 'どこか'}の${b.name || labelOf(b)}（${describe(b).spec}）を登りきれなかった`
      : `${whereNow()}で置いていかれた`;
  }
  const from = SC.sts[G.from].name;
  const mult = optMult(G.opts);
  G.dead = { why, where: `${from}から・${kind === 'goal' ? 'ゴール' : whereNow()}`, dist: G.dist, mult, pts: Math.round(Math.round(G.dist) * mult) };
  $('overWhy').textContent = why;
  $('overScore').textContent = `${G.dead.pts.toLocaleString()} 点`;
  const tags = [G.opts.diff === 'hard' ? 'むずかしい ×2' : '', G.opts.crowd === 'high' ? 'こみこみ ×2' : G.opts.crowd === 'grow' ? '少しずつ混む ×1.5' : ''].filter(Boolean).join('・');
  $('overMult').textContent = `${fmtDist(G.dist)}${mult > 1 ? `（${tags}）` : ''}`;
  $('overWhere').textContent = detail;
  const canSave = !G.autoUsed && RANK_OK && !!G.ticket;
  $('nameRow').style.display = canSave ? 'flex' : 'none';
  $('save').disabled = false;
  $('overNote').style.display = canSave ? 'none' : 'block';
  $('overNote').textContent = G.autoUsed ? 'オート実行を使ったので、この回の記録はランキングに残せません。'
    : !RANK_OK ? '確認用の設定で遊んだので、この回の記録はランキングに残せません。'
    : 'ランキングにつながらなかったので、この回の記録は送れません。';
  try { $('name').value = localStorage.getItem('shasou-ninja-name') || ''; } catch (e) {}
  $('over').classList.add('show');
  const g = G;
  rankLoading($('rankOver'));
  const list = await Rank.list();
  if (G === g) renderRank($('rankOver'), list, null);
}

function fmtDist(m) { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; }

function rankLoading(el) { el.innerHTML = '<li><small>読みこんでいます…</small></li>'; }
function renderRank(el, list, me) {
  el.innerHTML = '';
  if (!list) { el.innerHTML = '<li><small>ランキングを読みこめませんでした</small></li>'; return; }
  if (!list.length) { el.innerHTML = '<li><small>まだ記録がありません</small></li>'; return; }
  list.slice(0, 10).forEach((r) => {
    const li = document.createElement('li');
    if (me && r.id === me) li.className = 'me';
    li.textContent = `${(r.pts ?? r.dist).toLocaleString()} 点　${r.name}　`;
    const sm = document.createElement('small');
    sm.textContent = `${fmtDist(r.dist)}${r.mult > 1 ? ` ×${r.mult}` : ''}・${r.where}`;
    li.appendChild(sm);
    el.appendChild(li);
  });
}

// ---- 画面の割り付け ----
function resize() {
  document.body.classList.toggle('narrow', window.innerWidth < 760 || window.innerHeight > window.innerWidth * 1.05);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  // 車内を横から見た場面。画面いっぱいに広げ、配置の基準は横:縦 = 1 : 0.66 の「芯」
  const portrait = H > W * 1.05;
  // 横持ち: 電車の場面はドアの右のふちまで。その右（画面の約 3 割）は全部 3D の地図
  const side = 0;
  const trainW = portrait ? W : Math.round(W * 0.7);
  // 縦持ち（スマホ）: 上から きょり・ボタンの欄 → 車内の場面 → 3D の地図（題名の帯は HTML の側）。案内画面は出さない
  const hudEl = document.getElementById('hud');
  if (hudEl) { hudEl.classList.toggle('portrait', portrait); hudEl.classList.toggle('two', portrait && W < 340); if (portrait) hudEl.style.width = `${W}px`; }
  const hudH = portrait && hudEl ? (hudEl.offsetHeight || 44) : 0;
  // 車内と地図を同じ高さに（きょり・ボタンの欄をはさんで半分ずつ）
  const sw = W, sh = portrait ? Math.max(120, Math.round((H - hudH) / 2)) : H;
  // 縦持ちの車内は、場面の高さに天井から床までが収まる大きさ（幅は芯の 0.68〜0.92 の範囲で見せる）
  const coreW = portrait ? Math.min(sw / 0.68, Math.max(sw / 0.92, sh * 1.65)) : Math.min(sh / 0.66, trainW / 0.9);
  SCN = { x: 0, y: portrait ? hudH : 0, w: sw, h: sh, portrait, side }; // 縦持ちは きょり・ボタンの欄 → 車内 → 地図
  PX = Math.max(2, Math.round((coreW * DPR) / (portrait ? 300 : 480))) / DOT;
  LW = Math.ceil((sw * DPR) / PX); LH = Math.ceil((sh * DPR) / PX);
  low.width = LW; low.height = LH;
  const cw = (coreW * DPR) / PX, ch0 = cw * 0.66;
  const ox = portrait ? Math.round(LW - (sw / coreW - 0.039) * cw) : Math.round((trainW * DPR) / PX - 0.88 * cw - 4); // 横持ちはドアの枠の右はしが地図の左はし
  // 床が見える高さを半分にするため、絵を床の高さの半分だけ下げる（上は天井が広がる）
  const ch = ch0;
  const oy0 = (LH - ch) * 0.45, floor0 = LH - oy0 - 0.885 * ch;
  const oy = portrait ? Math.min(0, oy0 + floor0 / 2) : oy0 + floor0 / 2; // 縦持ちは天井を上にそろえ、余りは床が伸びる
  const X = (f) => Math.round(ox + f * cw);
  const Y = (f) => Math.round(f <= 0.57 ? oy + f * ch : oy + 0.57 * ch + (f - 0.57) * ch0);
  const Yb = (f) => Math.round(oy + 0.57 * ch - (0.57 - f) * ch0); // 側窓の下のふちから、元の縮尺で測った高さ
  SCN.X = X; SCN.Y = Y; SCN.Yb = Yb; SCN.core = { ox, oy, cw, ch: ch0 }; SCN.winH0 = Math.round(0.44 * ch0);
  // 側窓は左はしまで、右の次の側窓は右はしまで
  const SW = { x0: -6, x1: X(0.36), y0: Y(0.13), y1: Y(0.57) };   // ドアの手前（0.36〜0.535）は広告のある壁
  const DR = { x0: X(0.535), x1: X(0.88), y0: Y(0.105), y1: Y(0.885) };
  const lw = Math.round((DR.x1 - DR.x0) / 2);
  const dwin = [0, 1].map((i) => {
    const lx = DR.x0 + i * lw, ww = Math.round(lw * 0.72), wx = lx + Math.round((lw - ww) / 2);
    return { x0: wx, x1: wx + ww, y0: Y(0.185), y1: Y(0.5), r: Math.round(ww * 0.22) };
  });
  const SW2 = { x0: X(1.06), x1: LW + 6, y0: SW.y0, y1: SW.y1 };  // ドアの向こうも 0.88〜1.06 は壁
  SCN.SW = SW; SCN.DR = DR; SCN.dwin = dwin; SCN.SW2 = SW2;
  SCN.visR = portrait ? LW : DR.x1 + 4; // 見えている右はし（その右は地図の下）
  SCN.floorY = Y(0.885);
  // 外の景色: 芯の側窓の幅（芯の 0〜0.445）で約 52m 見える。地面は側窓の下のふち
  KL = (0.445 * cw) / 52;
  SCN.gY = SW.y1 - 1;
  SCN.baseX = X(0.445 * 0.32);
  SPRKEY++;
  const k = PX / DPR;
  LAYOUT = { k, ledX: SCN.x + DR.x0 * k + 6, ledY: Y(0.035) * k, ledW: (DR.x1 - DR.x0) * k - 12, portrait };
  // 3D の地図: 横持ちはドアの右ぜんぶ、縦持ちは場面の下
  const mp = document.getElementById('map');
  if (mp) mp.classList.toggle('portrait', portrait);
  if (mp && portrait) {
    const hud = document.getElementById('hud');
    if (hud) Object.assign(hud.style, { left: '0px', top: '0px', width: `${W}px` });
    const top = hudH + sh;
    Object.assign(mp.style, { left: '0px', top: `${top}px`, width: `${W}px`, height: `${Math.max(80, H - top)}px` });
    const lc2 = document.getElementById('lcd');
    if (lc2) lc2.classList.remove('show');
    window.dispatchEvent(new Event('insetresize'));
  } else if (mp) {
    const mx = Math.round(SCN.visR * k);
    // 横持ちは上・下・右を少しあけて、地図の後ろに車内（ドアの向こうの壁・窓）を見せる
    const m = Math.max(8, Math.min(20, Math.round(H * 0.028)));
    const col = portrait ? { x: 0, y: sh, w: W, h: H - sh } : { x: mx, y: m, w: W - mx - m, h: H - 2 * m };
    // 上は車内の案内画面、下は地図
    // 低い横画面（スマホの横持ち）は案内画面を省いて、地図に場所を回す
    const noLcd = H < 420;
    const lh = noLcd ? -Math.max(6, Math.round(m * 0.6)) : Math.round(Math.max(150, Math.min(col.h * 0.4, col.w * 0.82)));
    const gap = portrait ? 0 : Math.max(6, Math.round(m * 0.6));
    // きょり・時速などの欄は、案内画面と地図のあいだ（地図に重ねない）
    const hud = document.getElementById('hud');
    let hh = 0;
    if (hud) {
      Object.assign(hud.style, { left: `${col.x}px`, top: `${col.y + lh + gap}px`, width: `${col.w}px` });
      hud.classList.toggle('portrait', portrait);
      hud.classList.toggle('two', col.w < 380); // 欄がせまいときは、ボタンを 2 行めに
      hh = hud.offsetHeight;
    }
    const top = col.y + lh + gap + hh + gap;
    const r = { x: col.x, y: top, w: col.w, h: Math.max(80, col.y + col.h - top) };
    Object.assign(mp.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    mp.classList.toggle('portrait', portrait);
    const lc2 = document.getElementById('lcd');
    if (lc2) {
      Object.assign(lc2.style, { left: `${col.x}px`, top: `${col.y}px`, width: `${col.w}px`, height: `${lh}px`, fontSize: `${Math.max(9, Math.min(lh / 18, col.w / 24))}px` });
      lc2.classList.toggle('portrait', portrait); lc2.classList.toggle('show', !noLcd);
      LCD.key = '';
    }
    window.dispatchEvent(new Event('insetresize'));
  }
  buildInterior();
  layoutEvent(false); // 遊んでいる途中に画面が変わったら記録に残す
}

// 角の丸い四角の中か（ドット単位）
function inRound(x, y, R) {
  if (x < R.x0 || x >= R.x1 || y < R.y0 || y >= R.y1) return false;
  const r = R.r || 0;
  const cx = x < R.x0 + r ? R.x0 + r : x >= R.x1 - r ? R.x1 - r - 1 : x;
  const cy = y < R.y0 + r ? R.y0 + r : y >= R.y1 - r ? R.y1 - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// ---- 車内（ドット絵）。窓のところは透明にして、奥の景色が見えるようにする ----
// ---- 車内広告の絵（文字なし）。R(x, y, w, h, 色) で、(x, y, w, h) の枠の中に描く ----
let AD_PICK = null;
const AD_ART = (() => {
  const box = (R, x, y, w, h) => {
    const fx = (f) => x + Math.round(f * w), fy = (f) => y + Math.round(f * h);
    const rect = (x0, y0, x1, y1, c) => R(fx(x0), fy(y0), Math.max(1, fx(x1) - fx(x0)), Math.max(1, fy(y1) - fy(y0)), c);
    const disc = (cx, cy, r, c) => { // r は幅に対する割合
      const rp = r * w, X0 = x + cx * w, Y0 = y + cy * h;
      for (let yy = Math.floor(Y0 - rp); yy <= Math.ceil(Y0 + rp); yy++) {
        const d = rp * rp - (yy + 0.5 - Y0) ** 2; if (d < 0) continue;
        const hw = Math.sqrt(d); R(Math.round(X0 - hw), yy, Math.max(1, Math.round(hw * 2)), 1, c);
      }
    };
    const tri = (cx, y0, y1, half, c) => { // 二等辺三角（山）
      for (let yy = fy(y0); yy < fy(y1); yy++) { const t = (yy - fy(y0)) / Math.max(1, fy(y1) - fy(y0)); const hw = Math.round(t * half * w); R(fx(cx) - hw, yy, hw * 2 + 1, 1, c); }
    };
    const grad = (cols) => cols.forEach((c, i) => rect(0, i / cols.length, 1, (i + 1) / cols.length, c));
    return { fx, fy, rect, disc, tri, grad };
  };
  return {
    beer: { c1: '#f4b330', c2: '#1d55a0', draw(R, x, y, w, h) { // ビール: 泡のあふれるジョッキ
      const b = box(R, x, y, w, h);
      b.grad(['#3f86d0', '#2f74c0', '#2a6ab4', '#1d55a0']); b.rect(0, 0.88, 1, 1, '#b97a3e');
      b.rect(0.2, 0.32, 0.66, 0.88, '#f4b330'); b.rect(0.56, 0.32, 0.66, 0.88, '#d98f1a'); b.rect(0.26, 0.36, 0.31, 0.84, '#ffd767');
      for (const [bx, by] of [[0.4, 0.5], [0.48, 0.66], [0.36, 0.76], [0.5, 0.42]]) b.rect(bx, by, bx + 0.04, by + 0.025, '#ffe9a8');
      b.rect(0.66, 0.42, 0.8, 0.46, '#e9eef3'); b.rect(0.76, 0.42, 0.8, 0.74, '#e9eef3'); b.rect(0.66, 0.7, 0.8, 0.74, '#e9eef3'); // 取っ手
      b.disc(0.27, 0.3, 0.12, '#ffffff'); b.disc(0.44, 0.26, 0.15, '#ffffff'); b.disc(0.6, 0.3, 0.11, '#ffffff');
      b.rect(0.18, 0.3, 0.68, 0.36, '#ffffff'); b.rect(0.6, 0.36, 0.64, 0.44, '#ffffff'); // 泡がたれる
      b.rect(0.82, 0.1, 0.86, 0.13, '#ffffff'); b.rect(0.1, 0.16, 0.13, 0.18, '#ffffff');
    } },
    book: { c1: '#e8c35a', c2: '#8f2622', draw(R, x, y, w, h) { // 本: 表紙に帯
      const b = box(R, x, y, w, h);
      b.grad(['#f6ecd3', '#f1e3c4']);
      b.rect(0.24, 0.16, 0.84, 0.9, '#c9c2b4');                  // 影
      b.rect(0.18, 0.12, 0.78, 0.86, '#b8322f'); b.rect(0.18, 0.12, 0.25, 0.86, '#8f2622');
      b.rect(0.3, 0.24, 0.7, 0.27, '#e8c35a'); b.disc(0.5, 0.48, 0.13, '#e8c35a'); b.disc(0.5, 0.48, 0.08, '#b8322f');
      b.rect(0.18, 0.68, 0.78, 0.8, '#f4f0e6'); b.rect(0.24, 0.72, 0.56, 0.75, '#b8322f'); // 帯
      b.rect(0.64, 0.86, 0.68, 0.96, '#2f5fa8');                  // しおりのひも
    } },
    software: { c1: '#3f86d0', c2: '#1f2a4a', draw(R, x, y, w, h) { // ソフトウェア: ノートパソコンの画面
      const b = box(R, x, y, w, h);
      b.grad(['#2a3760', '#232f55', '#1f2a4a']);
      b.rect(0.08, 0.2, 0.92, 0.7, '#3a3f4b'); b.rect(0.12, 0.24, 0.88, 0.66, '#eef4fb');
      b.rect(0.12, 0.24, 0.88, 0.31, '#3f86d0'); b.rect(0.15, 0.26, 0.18, 0.29, '#ff8a7a'); b.rect(0.2, 0.26, 0.23, 0.29, '#ffd23f');
      b.rect(0.16, 0.36, 0.4, 0.62, '#d7e3f2');                  // 横のメニュー
      for (const [i, hh, c] of [[0, 0.12, '#5fd38a'], [1, 0.2, '#3f86d0'], [2, 0.15, '#f2a65a'], [3, 0.24, '#3f86d0']]) b.rect(0.46 + i * 0.1, 0.62 - hh, 0.52 + i * 0.1, 0.62, c); // グラフ
      b.rect(0.02, 0.7, 0.98, 0.76, '#c3c8d0'); b.rect(0.4, 0.7, 0.6, 0.72, '#9aa1ab');
      b.rect(0.7, 0.4, 0.72, 0.5, '#ffffff'); b.rect(0.72, 0.44, 0.75, 0.46, '#ffffff'); // 矢印のカーソル
    } },
    coffee: { c1: '#d9822b', c2: '#5a3418', draw(R, x, y, w, h) { // コーヒー: 湯気の立つカップ
      const b = box(R, x, y, w, h);
      b.grad(['#e79a45', '#d9822b', '#c4701f']);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) b.rect(0.3 + i * 0.14 + (j % 2) * 0.04, 0.12 + j * 0.05, 0.34 + i * 0.14 + (j % 2) * 0.04, 0.15 + j * 0.05, '#f6d7b0'); // 湯気
      b.rect(0.22, 0.46, 0.72, 0.8, '#f7f3ec'); b.rect(0.62, 0.46, 0.72, 0.8, '#ddd4c6');
      b.rect(0.24, 0.46, 0.7, 0.52, '#5a3418');
      b.rect(0.72, 0.52, 0.84, 0.56, '#f7f3ec'); b.rect(0.8, 0.52, 0.84, 0.7, '#f7f3ec'); b.rect(0.72, 0.66, 0.84, 0.7, '#f7f3ec');
      b.rect(0.1, 0.8, 0.88, 0.86, '#f7f3ec'); b.rect(0.16, 0.86, 0.82, 0.88, '#b3a796');
    } },
    travel: { c1: '#2f7fc0', c2: '#e2453c', draw(R, x, y, w, h) { // 旅行: 山と海と太陽
      const b = box(R, x, y, w, h);
      b.grad(['#7cc4f0', '#93d0f3', '#aedcf6', '#c6e8f9']);
      b.disc(0.76, 0.2, 0.12, '#ffcf4a');
      b.tri(0.42, 0.26, 0.7, 0.42, '#4a6fa8'); b.tri(0.42, 0.26, 0.38, 0.12, '#ffffff');
      b.rect(0, 0.7, 1, 1, '#2f7fc0');
      for (const [wx, wy] of [[0.1, 0.78], [0.5, 0.84], [0.3, 0.92], [0.72, 0.76]]) b.rect(wx, wy, wx + 0.14, wy + 0.02, '#cfe9fb');
      b.tri(0.78, 0.6, 0.72, 0.06, '#ffffff'); b.rect(0.7, 0.72, 0.86, 0.75, '#e2453c'); // ヨット
    } },
    phone: { c1: '#ef7aa8', c2: '#2a2c36', draw(R, x, y, w, h) { // スマートフォン
      const b = box(R, x, y, w, h);
      b.grad(['#f59ac0', '#ef7aa8', '#e7679a']);
      for (let i = 0; i < 6; i++) b.rect(0.08 + (i % 3) * 0.36, 0.08 + Math.floor(i / 3) * 0.78, 0.12 + (i % 3) * 0.36, 0.11 + Math.floor(i / 3) * 0.78, '#ffd0e2');
      b.rect(0.28, 0.1, 0.72, 0.92, '#2a2c36'); b.rect(0.32, 0.16, 0.68, 0.84, '#9ad7f0');
      const ic = ['#ff8a7a', '#ffd23f', '#5fd38a', '#3f86d0', '#b98ae0', '#ffffff'];
      for (let i = 0; i < 6; i++) b.rect(0.36 + (i % 2) * 0.16, 0.22 + Math.floor(i / 2) * 0.16, 0.46 + (i % 2) * 0.16, 0.32 + Math.floor(i / 2) * 0.16, ic[i]);
      b.rect(0.44, 0.87, 0.56, 0.89, '#5a5d6a');
    } },
  };
})();

const inCv = document.createElement('canvas');
const ic = inCv.getContext('2d', { willReadFrequently: true });
let STRAPS = [];
function buildInterior() {
  const iw = LW, ih = LH;
  inCv.width = iw; inCv.height = ih;
  STRAPS = [];
  const R = (x, y, w, h, c) => { ic.fillStyle = c; ic.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const S = SCN, SW = S.SW, DR = S.DR, fl = S.floorY, X = S.X, Y = S.Y;
  // 壁・天井
  R(0, 0, iw, ih, '#e9eaec');
  for (let x = 0; x < iw; x += 24) R(x, SW.y1 + 4, 1, fl - SW.y1 - 4, '#dcdee2');
  R(0, 0, iw, Y(0.028), '#f5f6f7');
  R(0, Y(0.028), iw, 1, '#cfd2d6');
  // 側窓のまわり（枠と柱）。窓の中はあとで透明にする
  const fw = Math.max(3, Math.round(iw * 0.008));
  const frame = (w) => { R(w.x0 - fw, w.y0 - fw, w.x1 - w.x0 + fw * 2, w.y1 - w.y0 + fw * 2, '#c4c8cd'); R(w.x0 - 1, w.y0 - 1, w.x1 - w.x0 + 2, w.y1 - w.y0 + 2, '#8e949b'); };
  frame(SW); frame(S.SW2);
  R(SW.x0, SW.y1 + fw, SW.x1 - SW.x0, 2, '#f4f5f6'); // 窓の下のふち
  // ドアの両わきの壁に、横長の広告（額・絵・文字の行）。絵はそれらしい広告をランダムに（文字は横棒だけ）
  const ads = [[X(0.378), X(0.52)], [X(0.9), X(1.042)]];
  if (!AD_PICK) AD_PICK = Object.keys(AD_ART).sort(() => Math.random() - 0.5).slice(0, 2);
  ads.forEach(([ax0, ax1], i) => {
    const ay = S.Yb(0.17), ah = S.Yb(0.33) - S.Yb(0.17), aw = ax1 - ax0;
    if (ax1 < 0 || ax0 > iw) return;
    R(ax0 - 2, ay - 2, aw + 4, ah + 4, '#a7adb4'); R(ax0 - 1, ay - 1, aw + 2, ah + 2, '#d8dce0');
    R(ax0, ay, aw, ah, '#fbfbf8');
    const art = AD_ART[AD_PICK[i]];
    const pw = Math.round(aw * 0.5), ph = ah - 6;
    art.draw(R, ax0 + 3, ay + 3, pw, ph);                                        // 絵
    const c1 = art.c1, c2 = art.c2, tx = ax0 + pw + 7, tw = ax1 - 3 - tx;
    R(tx, ay + 4, tw, 3, c2);                                                     // 見出し
    for (let k2 = 0; k2 < 3; k2++) R(tx, ay + 10 + k2 * 4, Math.round(tw * (0.95 - k2 * 0.18)), 1, '#9a9fa6'); // 文字の行
    R(tx, ay + ah - 8, Math.round(tw * 0.55), 4, c1);                             // ロゴのところ
  });
  // 窓の下のふち（壁の部分は腰の帯）
  R(X(0.36), SW.y1 + fw, X(0.535) - X(0.36), 2, '#dfe1e4'); R(X(0.88), SW.y1 + fw, X(1.06) - X(0.88), 2, '#dfe1e4');
  // ドア（両開き、ステンレス）
  R(DR.x0 - 4, DR.y0 - 4, DR.x1 - DR.x0 + 8, fl - DR.y0 + 4, '#b7bcc2');   // 戸口の枠
  R(DR.x0, DR.y0, DR.x1 - DR.x0, fl - DR.y0, '#d6d9d2');
  for (let x = DR.x0; x < DR.x1; x += 3) R(x, DR.y0, 1, fl - DR.y0, '#dcdfd8');
  for (let x = DR.x0 + 1; x < DR.x1; x += 5) R(x, DR.y0, 1, fl - DR.y0, '#cdd1c9');
  const mid = Math.round((DR.x0 + DR.x1) / 2);
  R(mid - 1, DR.y0, 2, fl - DR.y0, '#7b8178');                              // 合わせ目
  R(DR.x0, DR.y0, 2, fl - DR.y0, '#eef0ec'); R(DR.x1 - 2, DR.y0, 2, fl - DR.y0, '#aeb3aa');
  for (const w of S.dwin) { // ドアの窓の金属の縁
    for (let y = w.y0 - 3; y < w.y1 + 3; y++) for (let x = w.x0 - 3; x < w.x1 + 3; x++) {
      const big = { x0: w.x0 - 3, x1: w.x1 + 3, y0: w.y0 - 3, y1: w.y1 + 3, r: w.r + 3 };
      const mid2 = { x0: w.x0 - 1, x1: w.x1 + 1, y0: w.y0 - 1, y1: w.y1 + 1, r: w.r + 1 };
      if (inRound(x, y, big) && !inRound(x, y, mid2)) R(x, y, 1, 1, inRound(x, y + 2, big) ? '#9aa097' : '#c3c8bf');
      else if (inRound(x, y, mid2) && !inRound(x, y, w)) R(x, y, 1, 1, '#b4b9b1'); // 窓のふちは明るい金属（黒いふちは付けない）
    }
  }
  // 案内表示の台
  R(DR.x0 + 2, Y(0.043), DR.x1 - DR.x0 - 4, Y(0.098) - Y(0.043), '#3a3a40'); R(DR.x0 + 4, Y(0.043) + 2, DR.x1 - DR.x0 - 8, Y(0.098) - Y(0.043) - 4, '#141416');
  // 座席（緑のロングシート）と袖仕切り
  const seat = (x0, x1) => {
    const bt = Y(0.6), ct = Y(0.77), cb = Y(0.84), sk = Y(0.885);
    R(x0, bt, x1 - x0, ct - bt, '#4f9e5f'); R(x0, bt, x1 - x0, 2, '#7cc189'); R(x0, ct - 2, x1 - x0, 2, '#3d8049');
    R(x0, ct, x1 - x0, cb - ct, '#5aad6a'); R(x0, ct, x1 - x0, 2, '#8fd29b'); R(x0, cb - 2, x1 - x0, 2, '#3d8049');
    R(x0, cb, x1 - x0, sk - cb, '#b6bcc3'); R(x0, cb, x1 - x0, 1, '#8b9299');
  };
  seat(0, X(0.445));
  seat(X(0.895), iw);
  const px = X(0.445), pt = Y(0.66), pw2 = Math.max(4, X(0.022) - X(0));
  R(px, pt, pw2, fl - pt, '#c9ced4'); R(px, pt, 1, fl - pt, '#eef0f2'); R(px + pw2 - 1, pt, 1, fl - pt, '#959ca4');
  // 床
  R(0, fl, iw, ih - fl, '#b8744b');
  for (let y = fl + 1; y < ih; y++) for (let x = (y * 3) % 4; x < iw; x += 4) if (hash(x, y) < 0.3) R(x, y, 1, 1, hash(y, x) < 0.5 ? '#a8663f' : '#c4825a');
  R(DR.x0 - 4, fl - 1, DR.x1 - DR.x0 + 8, 2, '#7a7f86'); // 敷居
  // 網棚（つり革の横棒の上）: 壁からの腕木、網、手前の縁のパイプ
  const rack = (x0, x1) => {
    if (x1 - x0 < 6) return;
    const ry0 = Y(0.04), ry1 = Y(0.062);
    R(x0, ry0, x1 - x0, ry1 - ry0, '#dfe2e5');                                   // 網棚の奥（壁の影）
    for (let x = x0; x < x1; x += 2) for (let y = ry0 + 1; y < ry1 - 1; y += 2) R(x + ((y >> 1) & 1), y, 1, 1, '#b9bec4'); // 網
    R(x0, ry1 - 2, x1 - x0, 2, '#c3c9cf'); R(x0, ry1 - 2, x1 - x0, 1, '#f1f3f5'); // 手前の縁
    R(x0, ry0, x1 - x0, 1, '#a9afb6');
    const bstep = Math.max(20, X(0.12) - X(0));
    for (let x = x0 + 4; x < x1 - 2; x += bstep) { R(x, ry0, 2, ry1 - ry0 + 3, '#a9afb6'); R(x, ry0, 1, ry1 - ry0 + 3, '#d6dbe0'); } // 腕木
  };
  rack(0, X(0.53)); rack(X(0.885), iw);

  // つり革の横棒（側窓の前）
  const by = S.Yb(0.078), step = Math.max(14, X(0.072) - X(0));
  R(0, by, X(0.445), 2, '#c3c9cf'); R(0, by, X(0.445), 1, '#eef1f3');
  R(X(0.895), by, iw - X(0.895), 2, '#c3c9cf'); R(X(0.895), by, iw - X(0.895), 1, '#eef1f3');
  for (let x = X(0.43) - step * Math.floor(X(0.43) / step); x < X(0.43); x += step) if (x > 2) STRAPS.push({ x, y: by + 2 });
  for (let x = X(0.92); x < iw - 2; x += step) STRAPS.push({ x, y: by + 2 });
  // 忍者の横の位置は、いちばん近い 2 本のつり革の真ん中に（輪と重ならないように）
  const near2 = STRAPS.filter((t) => t.x < SW.x1).map((t) => t.x).sort((a, b) => Math.abs(a - S.baseX) - Math.abs(b - S.baseX));
  if (near2.length >= 2) {
    const a = near2[0], b = STRAPS.map((t) => t.x).filter((x) => (S.baseX >= a ? x > a : x < a)).sort((p, q) => Math.abs(p - a) - Math.abs(q - a))[0];
    if (b !== undefined) S.baseX = Math.round((a + b) / 2);
  }
  // 窓の中を透明に
  const img = ic.getImageData(0, 0, iw, ih), d = img.data;
  const holes = [SW, S.SW2, ...S.dwin];
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) if (holes.some((w) => inRound(x, y, w))) d[(y * iw + x) * 4 + 3] = 0;
  ic.putImageData(img, 0, 0);
  // 側窓は柱のない 1 枚の大きな窓
}

// つり革（電車の加速・減速で揺れる）
let sway = 0, swayV = 0, lastSpeed = 0;
function drawStraps(dt) {
  const k = PX / DPR;
  if (G) {
    const acc = dt > 0 ? (G.speed - lastSpeed) / dt : 0;
    lastSpeed = G.speed;
    const target = Math.max(-0.6, Math.min(0.6, -acc * 0.25));
    swayV += ((target - sway) * 18 - swayV * 2.2) * dt;
    sway += swayV * dt;
  }
  const winH = SCN.winH0 || (SCN.SW.y1 - SCN.SW.y0); // 縦持ちで側窓が伸びても、つり革は元の大きさ
  const len = Math.max(8, Math.round(winH * 0.3));      // ベルト
  const rr = Math.max(4, Math.round(winH * 0.075));     // 輪の半径（直径 ≒ 15cm）
  for (const st of STRAPS) {
    const a = sway + Math.sin((G ? G.t : 0) * 1.7 + st.x * 0.3) * 0.02;
    const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(SCN.x + Math.round(x) * k, SCN.y + Math.round(y) * k, k, k); };
    // ベルト（幅 3、ふちは影）。上のほうに留め具
    for (let i = 0; i < len; i++) {
      const cx = st.x + Math.sin(a) * i, cy = st.y + Math.cos(a) * i;
      px(cx - 1, cy, i < 3 ? '#8e959d' : '#d3d8dd'); px(cx, cy, i < 3 ? '#a7aeb6' : '#f6f7f8'); px(cx + 1, cy, i < 3 ? '#8e959d' : '#c3c9cf');
    }
    // 輪（太さ 2 の丸。上は明るく、下は影）
    const ox = st.x + Math.sin(a) * (len + rr), oy = st.y + Math.cos(a) * (len + rr);
    for (let yy = -rr - 1; yy <= rr + 1; yy++) for (let xx = -rr - 1; xx <= rr + 1; xx++) {
      const d = Math.sqrt(xx * xx + yy * yy);
      if (d > rr + 0.5 || d < rr - 1.6) continue;
      px(ox + xx, oy + yy, yy < -rr * 0.3 ? '#ffffff' : yy > rr * 0.4 ? '#b9bfc6' : '#e3e6ea');
    }
  }
}

// ---- 路線図（北が右、ドット） ----
let MAPP = null;
function buildMapBase() {
  if (!MAP) return;
  const mw = Math.max(40, Math.round((LAYOUT.mapW * DPR) / PX)), mh = Math.max(12, Math.round((LAYOUT.mapH * DPR) / PX));
  mapLow.width = mw; mapLow.height = mh; mapBase.width = mw; mapBase.height = mh;
  const lats = MAP.line.map((p) => p[0]);
  const lat0 = Math.min(...lats) - 0.0012, lat1 = Math.max(...lats) + 0.0012;
  const lonC = MAP.line.reduce((a, p) => a + p[1], 0) / MAP.line.length;
  const KY = 110540, KX = 111320 * Math.cos(35.77 * Math.PI / 180);
  const mpx = (mw - 4) / ((lat1 - lat0) * KY);
  const pr = (la, lo) => [2 + (la - lat0) * KY * mpx, mh / 2 + (lo - lonC) * KX * mpx];
  MAPP = { pr, mw, mh };
  const b = mapBase.getContext('2d');
  b.fillStyle = '#efe6cc'; b.fillRect(0, 0, mw, mh);
  const poly = (ring, col) => {
    b.fillStyle = col; b.beginPath();
    ring.forEach(([la, lo], i) => { const [x, y] = pr(la, lo); if (i) b.lineTo(x, y); else b.moveTo(x, y); });
    b.closePath(); b.fill();
  };
  MAP.parks.forEach((r) => poly(r, '#a9d38e'));
  MAP.water.forEach((r) => poly(r, '#6fa9e0'));
  b.strokeStyle = '#4a4458'; b.lineWidth = 2; b.beginPath();
  MAP.line.forEach(([la, lo], i) => { const [x, y] = pr(la, lo); if (i) b.lineTo(x, y); else b.moveTo(x, y); });
  b.stroke();
  // 色数を減らしてドットらしく
  const img = b.getImageData(0, 0, mw, mh), d = img.data;
  const pal = [[0xef, 0xe6, 0xcc], [0xa9, 0xd3, 0x8e], [0x6f, 0xa9, 0xe0], [0x4a, 0x44, 0x58]];
  for (let i = 0; i < d.length; i += 4) {
    let best = 0, bd = 1e9;
    for (let k = 0; k < pal.length; k++) {
      const e = (d[i] - pal[k][0]) ** 2 + (d[i + 1] - pal[k][1]) ** 2 + (d[i + 2] - pal[k][2]) ** 2;
      if (e < bd) { bd = e; best = k; }
    }
    d[i] = pal[best][0]; d[i + 1] = pal[best][1]; d[i + 2] = pal[best][2]; d[i + 3] = 255;
  }
  b.putImageData(img, 0, 0);
  for (const [, la, lo] of MAP.stations) {
    const [x, y] = pr(la, lo);
    b.fillStyle = INK; b.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    b.fillStyle = '#ffffff'; b.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}
function mapPos(s) {
  const Lm = MAP.line;
  let i = 0;
  while (i < Lm.length - 2 && Lm[i + 1][2] < s) i++;
  const a = Lm[i], b = Lm[i + 1];
  const t = Math.max(0, Math.min(1, (s - a[2]) / Math.max(1, b[2] - a[2])));
  return MAPP.pr(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
}

// ---- 窓の中（ドット絵の層） ----
let SX = null, SY = null;

function polyPath(pts) {
  D.beginPath();
  pts.forEach(([x, y], i) => (i ? D.lineTo(x, y) : D.moveTo(x, y)));
  D.closePath();
}

function drawLow() {
  lc.imageSmoothingEnabled = false;
  D = lc;
  // カメラは整数ドット単位で動かす（建物ごとに丸めると、窓や線がちらつく）
  const baseX = SCN.baseX;
  const gY = SCN.gY;
  const cam = Math.round(G.S * KL);
  const camY = Math.round(G.camUp * KL); // 忍者が窓の上に出たときだけ持ち上げる（ふだんは 0 で固定）
  SX = (s) => Math.round(s * KL) - cam + baseX;
  SY = (y) => Math.round(gY - y * KL) + camY;
  const sA = G.S - baseX / KL - 4, sB = G.S + (LW - baseX) / KL + 4;

  // 空（段々のグラデーションに市松のつなぎ）
  const sky = ['#5aa2e6', '#6fb3ec', '#8bc6f1', '#a9d8f4', '#c9e8f6'];
  const horizon = VIEW === 'section' ? SY(0) - Math.round(LH * 0.12) : SY(SC.HH);
  const bh = horizon / sky.length;
  for (let i = 0; i < sky.length; i++) { lc.fillStyle = sky[i]; lc.fillRect(0, Math.floor(i * bh), LW, Math.ceil(bh) + 1); }
  for (let i = 1; i < sky.length; i++) {
    const y0 = Math.floor(i * bh);
    lc.fillStyle = sky[i - 1];
    for (let x = (y0 & 1); x < LW; x += 2) lc.fillRect(x, y0, 1, 1);
  }
  // 雲（陰影つきのドット絵。整数ドットで流す）
  if (!CLOUDS.length) buildClouds();
  for (let k = 0; k < CLOUDS.length; k++) {
    const c = CLOUDS[k];
    const span = LW + c.width + 40;
    const cx = Math.round((((hash(k, 3) * span - G.S * KL * 0.05 - G.t * 2) % span) + span) % span) - c.width - 20;
    const cy = Math.round(horizon * (0.05 + hash(k, 5) * 0.55));
    lc.drawImage(c, cx, cy);
  }

  // 地面（地平線まで。遠くは霞む）
  const gcol = ['#d5e0e2', '#cad4d2', '#bfc9c5', '#b5beba'];
  const gh = (gY - horizon) / gcol.length;
  for (let i = 0; i < gcol.length; i++) { lc.fillStyle = gcol[i]; lc.fillRect(0, Math.floor(horizon + i * gh), LW, Math.ceil(gh) + 1); }
  lc.fillStyle = gcol[3]; lc.fillRect(0, gY, LW, LH);

  // 遠くの建物（70〜300m、視差つき）
  for (const f of SC.far) {
    const [s0, s1, d, hh] = f;
    const p = 70 / d;
    const cp = Math.round(G.S * KL * p);
    const xa = Math.round(s0 * KL * p) - cp + baseX, xb = Math.round(s1 * KL * p) - cp + baseX;
    if (xb < 0 || xa > LW) continue;
    const yb = SY(OFF(d)), yt = Math.round(yb - hh * KL * p);
    const mix = Math.min(0.8, 0.45 + (d - 70) / 230 * 0.35);
    lc.fillStyle = shade('#c3c9d0', 1, mix); lc.fillRect(xa, yt, Math.max(1, xb - xa), yb - yt);
    if (xb - xa > 4) {
      lc.fillStyle = shade('#e8ecef', 1, mix); lc.fillRect(xa, yt, xb - xa, 1);
      if (3 * KL * p >= 3) {
        lc.fillStyle = shade('#9aa6b2', 1, mix);
        for (let z = 3; z < hh - 1; z += 3) {
          const yy = Math.round(yb - z * KL * p);
          for (let x = xa + 1; x < xb - 1; x += 2) lc.fillRect(x, yy, 1, 1);
        }
      }
    }
  }

  // 地面の色分け（公園・校庭）
  for (const g of SC.ground) {
    if (g.k === 'water') continue;
    let mn = 1e9, mx = -1e9;
    for (const p of g.r) { mn = Math.min(mn, p[0]); mx = Math.max(mx, p[0]); }
    if (mx < sA || mn > sB) continue;
    lc.fillStyle = g.k === 'park' ? '#8cc46e' : '#e3d2a8';
    polyPath(g.r.map(([s, d]) => [SX(s), SY(OFF(d))])); lc.fill();
  }
  // 公園の木: 乗れないので、丸い樹冠を霞ませて背景に見せる（乗れる屋根は平らで、くっきり・縁取りつき）
  const hz = rgb(HAZE);
  for (const [s, d, r] of SC.trees) {
    if (s < sA || s > sB) continue;
    const X = SX(s), Y = SY(OFF(d)), rr = Math.max(1.5, r * KL * 0.42);
    const f = Math.min(0.75, 0.42 + d / 260); // 霞み
    const cD = `rgb(${mixRGB([70, 128, 84], hz, f)})`, cL = `rgb(${mixRGB([118, 172, 112], hz, f)})`, cT = `rgb(${mixRGB([110, 86, 66], hz, f)})`;
    const cy = Y - Math.round(rr * 1.9), sway = Math.round(Math.sin(G.t * 1.6 + s) * 0.6);
    lc.fillStyle = cT; lc.fillRect(X, cy, 1, Y - cy);
    for (let dy = -Math.ceil(rr); dy <= Math.ceil(rr); dy++) { // 上がとがり気味の丸（平らな上面をつくらない）
      const w = Math.floor(Math.sqrt(Math.max(0, rr * rr - dy * dy)) * (dy < 0 ? 0.75 + 0.25 * (1 + dy / rr) : 1));
      if (w <= 0) continue;
      const xs = X - w + (dy < 0 ? sway : 0);
      lc.fillStyle = cD; lc.fillRect(xs, cy + dy, w * 2 + 1, 1);
      if (dy < rr * 0.2) { lc.fillStyle = cL; lc.fillRect(xs, cy + dy, Math.max(1, w), 1); }
    }
  }

  // 線路の下の道路（手前 0〜12m）。川の区間は、このあと手前まで水面で上書きする
  const roadTop = SY(OFF(12));
  lc.fillStyle = '#6b707c'; lc.fillRect(0, roadTop, LW, LH - roadTop);
  lc.fillStyle = '#c9ccc4'; lc.fillRect(0, roadTop - 1, LW, 2);
  lc.fillStyle = '#e4e2d4';
  for (const d of [4, 8]) {
    const stp = Math.round(12 * KL), Y = SY(OFF(d)), ph = ((cam % stp) + stp) % stp;
    for (let x = -ph; x < LW; x += stp) lc.fillRect(x, Y, Math.round(4 * KL), 1);
  }
  // 川（線路と交わる区間は、窓の下のふちから地平線まで水面。ひとっとびの忍者はこの上を走る）
  for (const pl of SC.places) {
    if (pl.kind !== 'water' || pl.s1 < sA || pl.s0 > sB) continue;
    const xa = SX(pl.s0), xb = SX(pl.s1);
    const wc = ['#9fc1dc', '#7aa8d2', '#5a8fc4', '#3f78b5'];
    const wh = (LH - horizon) / wc.length;
    for (let i = 0; i < wc.length; i++) { lc.fillStyle = wc[i]; lc.fillRect(xa, Math.floor(horizon + i * wh), xb - xa, Math.ceil(wh) + 1); }
    lc.fillStyle = '#d6ebfb';
    for (let d = 0.6; d < 250; d *= 1.3) {
      const Y = SY(OFF(d));
      for (let s = pl.s0 + ((G.t * 1.5 + d) % 7); s < pl.s1 - 2; s += 7) lc.fillRect(SX(s), Y, Math.max(1, Math.round(3 / (1 + d / 40))), 1);
    }
  }

  // 近くの建物: 走れない建物（霞ませる）→ 走る列（はっきり、手前に）
  const signs = [];
  for (const b of SC.back) if (b.s1 >= sA && b.s0 <= sB) blitBuilding(b, cam, baseX, signs);
  for (const b of SC.front) if (b.s1 >= sA && b.s0 <= sB) blitBuilding(b, cam, baseX, signs);

  // 道路の車と通行人（建物のあとに描き、それより線路に近い建物があるところは隠れる）
  drawTraffic(sA, sB);

  // しなり竹（届かない隙間の地面）: 竹の支柱に、節のある竹を横に渡す。はねたときは真ん中がしなる
  for (const sp of SC.springs) {
    if (sp.b < sA || sp.a > sB) continue;
    const xa = SX(sp.a), xb = SX(sp.b), y0 = SY(0), yr = SY(SPRING_H);
    const amp = sp.t > 0 ? Math.sin((sp.t / 0.4) * Math.PI * 3) * (sp.t / 0.4) * 3 : 0;
    const postStep = Math.max(8, Math.round(4 * KL));
    for (let x = xa; x <= xb; x += postStep) { // 竹の支柱と、黄色いしばり紐・笹の葉
      lc.fillStyle = '#4d7a24'; lc.fillRect(x, yr - 4, 3, y0 - yr + 6); lc.fillStyle = '#9ccc52'; lc.fillRect(x, yr - 4, 1, y0 - yr + 6);
      lc.fillStyle = '#ffd23f'; lc.fillRect(x - 1, yr + 2, 5, 2);
      lc.fillStyle = '#5f9a2c'; lc.fillRect(x + 3, yr - 7, 3, 1); lc.fillRect(x + 5, yr - 8, 2, 1); lc.fillRect(x - 3, yr - 6, 3, 1); lc.fillRect(x - 4, yr - 7, 2, 1);
    }
    const node = Math.max(5, Math.round(1.6 * KL));
    for (let x = xa - 2; x <= xb + 2; x++) { // 節のある太い竹（はねると真ん中がしなる）
      const u = (x - xa) / Math.max(1, xb - xa);
      const yy = yr + Math.round(Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * amp);
      const nd = (x - xa) % node === 0;
      lc.fillStyle = nd ? '#bcd86a' : '#e2f2a2'; lc.fillRect(x, yy - 3, 1, 1);
      lc.fillStyle = nd ? '#3f6420' : '#8cc444'; lc.fillRect(x, yy - 2, 1, 3);
      lc.fillStyle = nd ? '#2c4a16' : '#4d7a24'; lc.fillRect(x, yy + 1, 1, 1);
    }
  }


  // 粒
  for (const p of G.parts) {
    lc.fillStyle = p.col;
    lc.fillRect(SX(p.s), SY(p.h), 1 + (p.life > 0.3 ? 1 : 0), 1);
  }

  // 忍者
  const nX = baseX + Math.round(G.off * KL), nY = SY(G.y);
  if (nY < SCN.SW.y0 + 2) { // 側窓の上に出たとき: 横の位置に吹き出し（drawFrame）
    G.nup = { x: nX, up: (SCN.SW.y0 - nY) / KL };
  } else G.npos = { x: nX, y: nY }; // 忍者は景色より細かいドットで、あとから重ねる（drawFrame）

  // ひとっとびの風
  if (G.skip) {
    lc.fillStyle = 'rgba(255,255,255,0.75)';
    for (let k = 0; k < 14; k++) {
      const yy = Math.floor(hash(k, Math.floor(G.t * 20)) * LH);
      const xx = Math.floor(hash(k + 50, Math.floor(G.t * 20)) * LW);
      lc.fillRect(xx, yy, 10 + (k % 3) * 6, 1);
    }
  }
  return signs;
}

// ---- 線路の下の道路: 車（向こう車線は同じ向き、手前は反対向き）と、歩道の通行人 ----
const CAR_COLS = ['#f4f4f4', '#2a2a35', '#b9bec6', '#c0392b', '#2e5d9e', '#e8c35a', '#4a6a4a', '#f4f4f4', '#9aa1ab'];
function inWater(s) { for (const pl of SC.places) if (pl.kind === 'water' && s > pl.s0 - 2 && s < pl.s1 + 2) return true; return false; }
function drawTraffic(sA, sB) {
  const t = G.t;
  const vis = SC.near.filter((b) => b.s1 >= sA - 15 && b.s0 <= sB + 15);
  const hidden = (s, d) => vis.some((b) => b.d < d && s > b.s0 - 1 && s < b.s1 + 1); // それより手前（線路寄り）に建物がある
  const lane = (d, v, gap, dens, li, draw) => {
    const off = v * t, i0 = Math.floor((sA - 12 - off) / gap), i1 = Math.ceil((sB + 12 - off) / gap);
    for (let i = i0; i <= i1; i++) {
      if (hash(i, li, 1) > dens) continue;
      const s = i * gap + hash(i, li, 2) * gap * 0.5 + off;
      if (s < sA - 12 || s > sB + 12 || inWater(s) || hidden(s, d)) continue;
      draw(SX(s), SY(OFF(d)), i, v);
    }
  };
  const R = (x, y, w, h, c) => { lc.fillStyle = c; lc.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
  const car = (x, y, i, v) => {
    const kind = hash(i, 7, 3), dir = v > 0 ? 1 : -1, c = CAR_COLS[Math.floor(hash(i, 7, 4) * CAR_COLS.length)];
    const L = Math.round((kind < 0.05 ? 10.5 : kind < 0.15 ? 6.5 : 4.4) * KL), H = Math.round((kind < 0.05 ? 3 : kind < 0.15 ? 2.6 : kind < 0.3 ? 1.9 : 1.45) * KL);
    const x0 = Math.round(x - L / 2), front = (f) => (dir > 0 ? x0 + Math.round(L * f) : x0 + L - Math.round(L * f));
    const dk = shade(c, 0.72);
    if (kind < 0.05) { // バス
      R(x0, y - H, L, H - 1, '#f4f4f4'); R(x0, y - H * 0.42, L, H * 0.3, '#3f9a5f');
      for (let k = 2; k < L - 3; k += 4) R(x0 + k, y - H + 2, 3, H * 0.35, '#7fa9cc');
    } else if (kind < 0.15) { // トラック: 運転席と白い荷台
      const cabW = Math.round(L * 0.28);
      R(dir > 0 ? x0 + L - cabW : x0, y - H * 0.75, cabW, H * 0.75 - 1, c); R(dir > 0 ? x0 + L - cabW + 1 : x0 + 1, y - H * 0.7, cabW - 2, H * 0.25, '#9fc3e0');
      R(dir > 0 ? x0 : x0 + cabW, y - H, L - cabW, H - 1, '#eceef0'); R(dir > 0 ? x0 : x0 + cabW, y - H, L - cabW, 1, '#c9cdd2');
    } else if (kind < 0.3) { // ワゴン
      R(x0, y - H, L, H - 1, c); R(x0 + 2, y - H + 1, L - 4, H * 0.38, '#9fc3e0'); R(front(0.2), y - H + 1, 1, H * 0.38, dk);
    } else { // 乗用車: 下の車体と、ガラスの屋根
      R(x0, y - H * 0.55, L, H * 0.55 - 1, c); R(x0 + L * 0.2, y - H, L * 0.58, H * 0.47, c);
      R(x0 + L * 0.24, y - H + 1, L * 0.5, H * 0.34, '#9fc3e0'); R(Math.round(x0 + L * 0.48), y - H + 1, 1, H * 0.34, dk);
      R(x0, y - H * 0.55, L, 1, shade(c, 1.08));
    }
    R(front(0.04) - (dir > 0 ? 1 : 0), y - H * 0.45, 1, 1, '#ffe58a');            // 前の灯り
    R(dir > 0 ? x0 : x0 + L - 1, y - H * 0.45, 1, 1, '#e03a2f');                  // うしろの灯り
    for (const f of [0.2, 0.75]) R(x0 + L * f - 1, y - 2, 3, 2, '#2a2a35');        // 車輪
  };
  const SHIRT = ['#7a8fd0', '#e48a4f', '#5aa36a', '#f0b6c6', '#ffffff', '#d4b44a', '#3d4b66', '#2a2a35'];
  const walker = (x, y, i, v) => {
    const h = Math.round(1.65 * KL), st = Math.floor(G.t * 4 + i) % 2, c = SHIRT[Math.floor(hash(i, 9, 3) * SHIRT.length)];
    const leg = hash(i, 9, 4) < 0.5 ? '#3d4b66' : '#4a6fa5';
    R(x, y - h, 2, 1, hash(i, 9, 5) < 0.8 ? '#3b302c' : '#d9b06a');               // 髪
    R(x, y - h + 1, 2, 1, '#f2c9a0');                                              // 顔
    R(x - (h > 7 ? 0 : 0), y - h + 2, 2, Math.round(h * 0.42), c);                 // 服
    R(x + (st ? -1 : 0), y - h + 2 + Math.round(h * 0.42), 1, h - 2 - Math.round(h * 0.42), leg); // 足（歩く）
    R(x + (st ? 2 : 1), y - h + 2 + Math.round(h * 0.42), 1, h - 2 - Math.round(h * 0.42), leg);
    if (hash(i, 9, 6) < 0.2) R(x + (v > 0 ? -1 : 2), y - h + 3, 1, 2, '#8a5a3c');   // かばん
  };
  lane(10.8, 1.3, 9, 0.4, 3, walker);   // 向こうの歩道
  lane(10.2, -1.2, 11, 0.35, 4, walker);
  lane(7.4, 9, 30, 0.5, 1, car);        // 向こう車線（電車と同じ向き）
  lane(3.6, -11, 26, 0.55, 2, car);     // 手前の車線（反対向き）
}

// 雲のドット絵: 丸を重ねた形を、上は白・下は影色・底のふちは濃い影で塗る
let CLOUDS = [];
function buildClouds() {
  CLOUDS = [];
  const cols = { top: [255, 255, 255], mid: [232, 241, 250], low: [205, 223, 240], edge: [176, 202, 228] };
  for (let k = 0; k < 7; k++) {
    const w = 26 + Math.round(hash(k, 7) * 30), h = 12 + Math.round(hash(k, 8) * 8);
    const blobs = [];
    const nb = 3 + Math.floor(hash(k, 9) * 3);
    for (let i = 0; i < nb; i++) {
      const r = h * (0.35 + hash(k, i, 1) * 0.3);
      blobs.push([r + hash(k, i, 2) * (w - 2 * r), h - r - 1 - hash(k, i, 3) * (h * 0.35), r]);
    }
    blobs.push([w * 0.5, h - h * 0.3, h * 0.3]);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); const img = g.createImageData(w, h), d = img.data;
    const inside = (x, y) => blobs.some(([bx, by, r]) => (x - bx) ** 2 + (y - by) ** 2 <= r * r) && y <= h - 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      let col = y < h * 0.55 ? cols.top : y < h * 0.75 ? cols.mid : cols.low;
      if (!inside(x + 0.5, y + 1.5)) col = cols.edge;
      else if (y >= h * 0.55 && y < h * 0.75 && (x + y) % 2 === 0) col = cols.top; // つなぎの市松
      const i = (y * w + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    CLOUDS.push(c);
  }
}

// ---- 建物のドット絵 ----
// 建物は 1 棟ずつ、色の番号を並べた小さな画（スプライト）として一度だけ描く。
// 多角形は自前で塗る（にじみ無し）。ほぼ水平・ほぼ垂直の辺は格子にそろえ、斜めの辺も一定の段々になるようにする。
const M = { WL: 1, W: 2, WS: 3, WD: 4, WSH: 5, RL: 6, R: 7, RD: 8, G: 9, GH: 10, GL: 11, F: 12, OUT: 13, A1: 14, A2: 15, A3: 16, DOOR: 17, WHITE: 18,
  LAN: 19, FL1: 20, FL2: 21, SK: 22, HR: 23, SH: 24, CU: 25, PL: 26, L1: 27, L2: 28, GLOW: 29 }; // 提灯・花・住んでいる人（肌・髪・服）・カーテン・植木・洗濯物・明るいガラス
const isWall = (m) => m >= 1 && m <= 5;
const isRoof = (m) => m >= 6 && m <= 8;

function blitBuilding(b, cam, baseX, signs) {
  const sp = spriteOf(b);
  lc.drawImage(sp.c, sp.x0 - cam + baseX, sp.y0 + Math.round(G.camUp * KL));
  if (b.name && b.walls.length) signs.push(b);
}

// 多角形を塗る（画素の中心で判定。にじみ無し）
function fillPoly(pts, w, h, put) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(h - 1, Math.ceil(y1));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xa; x <= xb; x++) put(x, y);
    }
  }
}

// 平面形の頂点を、画面の格子にそろえる（x はそのまま、奥行きによる持ち上がりだけ段をそろえる）
function snapRing(vs) {
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = vs[i], b = vs[(i + 1) % n];
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.o - a.o);
    if (dx <= 1 && i + 1 < n) b.x = a.x;                           // ほぼ垂直 → 垂直
    if (dy <= Math.max(1, dx * 0.22) && i + 1 < n) b.o = a.o;        // ほぼ水平 → 水平
  }
  return vs;
}

function spriteOf(b) {
  if (b.spr && b.spr.key === SPRKEY) return b.spr;
  const S = b.style;
  const gYp = Math.round(SCN.gY);
  const hp = Math.max(2, Math.round(b.h * KL));
  // 平面形の頂点: 画面の x と、奥行きによる持ち上がり（ドット）
  const vs = snapRing(b.fp2.map((p) => ({ x: Math.round(p[0] * KL), o: Math.round(OFF(p[1]) * KL), d: p[1] })));
  const faces = [];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const v of vs) { add(v.x, gYp - v.o); add(v.x, gYp - v.o - hp - 4); }
  if (b.lod2) for (const f of b.lod2) for (const p of f.q) add(Math.round(p[0] * KL), gYp - Math.round((p[2] + OFF(p[1])) * KL));
  x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const IDX = new Uint8Array(w * h), WID = new Int16Array(w * h).fill(-1);
  const P = (x, y) => [x - x0, y - y0];

  // 線路を向いた壁（平面形の辺のうち、手前を向いたもの）
  const walls = [];
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], c = vs[(i + 1) % vs.length];
    const fp = b.fp2, pa = fp[i], pc = fp[(i + 1) % fp.length];
    const es = pc[0] - pa[0];
    // 外向き法線の d 成分が負（手前向き）かどうかは、下ごしらえ（b.walls）と同じ判定
    if (!b.walls.some((wl) => (wl.a === pa && wl.c === pc) || (wl.a === pc && wl.c === pa))) continue;
    const L = es > 0 ? a : c, Rr = es > 0 ? c : a;
    if (Rr.x - L.x < 1) continue;
    const lit = Math.abs(Rr.o - L.o) / Math.max(1, Rr.x - L.x) > 0.35 ? M.WS : M.W;
    walls.push({ L, R: Rr, m: lit, id: walls.length });
  }
  walls.sort((p, q) => (p.L.o + p.R.o) - (q.L.o + q.R.o)).reverse(); // 奥から
  const quad = (wl, z0, z1) => [P(wl.L.x, gYp - wl.L.o - z0), P(wl.R.x, gYp - wl.R.o - z0), P(wl.R.x, gYp - wl.R.o - z1), P(wl.L.x, gYp - wl.L.o - z1)];

  if (b.lod2) {
    for (const wl of walls) fillPoly(quad(wl, 0, hp), w, h, (x, y) => { WID[y * w + x] = wl.id; });
    for (const f of b.lod2) {
      if (!f.roof && f.nd > 0) continue;
      const pts = f.q.map((p) => P(Math.round(p[0] * KL), gYp - Math.round((p[2] + OFF(p[1])) * KL)));
      let m;
      if (f.roof) { const steep = Math.abs(f.nd) / (Math.abs(f.nd) + Math.abs(f.nz) + 1e-6); m = steep > 0.35 ? M.R : M.RL; if (f.nd > 0) m = M.RD; }
      else m = M.W;
      fillPoly(pts, w, h, (x, y) => { IDX[y * w + x] = m; });
    }
  } else {
    for (const wl of walls) fillPoly(quad(wl, 0, hp), w, h, (x, y) => { IDX[y * w + x] = wl.m; WID[y * w + x] = wl.id; });
    const roof = vs.map((v) => P(v.x, gYp - v.o - hp));
    fillPoly(roof, w, h, (x, y) => { IDX[y * w + x] = M.R; });
  }

  // 窓など（壁の画素の上だけに描く）
  const setW = (x, y, m, id) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (WID[i] === id && (isWall(IDX[i]) || (IDX[i] >= M.G && IDX[i] !== M.OUT))) IDX[i] = m; // 壁と、壁に描いた窓などの上（人・カーテン）には描ける
  };
  for (const wl of walls) drawFacade(b, S, wl, hp, gYp, x0, y0, w, setW);

  // 陰影: 屋根の手前のふち（下が壁）は明るく、壁の右端は暗く、軒下（上が屋根）は影、地面との境は暗く
  const out = new Uint8Array(IDX);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, m = IDX[i];
    if (!m) continue;
    const up = y > 0 ? IDX[i - w] : 0, dn = y < h - 1 ? IDX[i + w] : 0, rt = x < w - 1 ? IDX[i + 1] : 0, lf = x > 0 ? IDX[i - 1] : 0;
    if (isRoof(m) && isWall(dn)) out[i] = M.RL;
    else if (isRoof(m) && !up) out[i] = m === M.RL ? M.R : M.RD;
    else if (isWall(m) && (m === M.W || m === M.WS)) {
      if (isRoof(up)) out[i] = S.kind === 'house' || S.kind === 'shophouse' ? M.WSH : M.WL;
      else if (!up || up === undefined) out[i] = M.RL;              // 断面図では屋根が線になるので、上のふちを屋根の色で
      else if (!rt || isRoof(rt)) out[i] = M.WD;
      else if (!dn) out[i] = M.WD;
    }
  }
  // 縁取り（走る列だけ）: 外周を、その色を暗くした色で
  const row = b.row;
  const outlineOf = new Uint8Array(w * h);
  if (row) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!IDX[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !IDX[i - 1] || !IDX[i + 1] || !IDX[i - w] || !IDX[i + w]) outlineOf[i] = 1;
    }
  }
  // 色をつける
  const hz = b.haze;
  const pal = buildPalette(S, hz);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) {
    const m = out[i];
    if (!m) continue;
    let col = pal[m];
    if (outlineOf[i]) col = darker(col, isRoof(IDX[i]) ? 0.5 : 0.45);
    d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  b.spr = { c, x0, y0, key: SPRKEY };
  return b.spr;
}

function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixRGB(a, b, t) { return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t].map((v) => Math.round(v)); }
function darker(c, f) { return mixRGB(c.map((v) => v * f), rgb('#241f3a'), 0.25); }
function lighter(c, f) { return c.map((v) => Math.min(255, Math.round(v + (255 - v) * f))); }
function scaled(c, f) { return c.map((v) => Math.min(255, Math.round(v * f))); }

function buildPalette(S, hz) {
  const wall = rgb(S.wall), roof = rgb(S.roof), win = rgb(S.win), haze = rgb(HAZE);
  const p = [];
  p[M.WL] = lighter(wall, 0.45); p[M.W] = wall; p[M.WS] = scaled(wall, 0.9); p[M.WD] = scaled(wall, 0.76); p[M.WSH] = scaled(wall, 0.82);
  p[M.RL] = lighter(roof, 0.3); p[M.R] = roof; p[M.RD] = scaled(roof, 0.78);
  p[M.G] = win; p[M.GH] = lighter(win, 0.55); p[M.GL] = rgb(S.lit); p[M.F] = scaled(wall, 0.7);
  p[M.A1] = rgb(S.acc1 || '#c0392b'); p[M.A2] = rgb(S.acc2 || '#6f8796'); p[M.A3] = rgb(S.acc3 || '#2e9e5b');
  p[M.DOOR] = rgb('#7a5640'); p[M.WHITE] = [255, 255, 255]; p[M.OUT] = rgb('#241f3a');
  p[M.LAN] = rgb('#e03a2f'); p[M.FL1] = rgb('#f39ac0'); p[M.FL2] = rgb('#ffd23f'); p[M.SK] = rgb('#f2c9a0'); p[M.HR] = rgb(S.hr || '#3b302c');
  p[M.SH] = rgb(S.sh || '#7a8fd0'); p[M.CU] = rgb(S.cu || '#f3d58a'); p[M.PL] = rgb('#4f9a52'); p[M.L1] = rgb(S.l1 || '#bcd9ee'); p[M.L2] = rgb(S.l2 || '#f5a3b5');
  p[M.GLOW] = rgb('#eaf6ff');
  if (hz) for (let i = 1; i < p.length; i++) if (p[i]) p[i] = mixRGB(p[i], haze, hz);
  return p;
}

// 1 階の店先（店の種類ごと）。col(x, 下, 上, 色) は、その列の地面から数えた段に塗る
function drawShopFront(type, b, xa, xc, Fp, col) {
  const W = xc - xa, z62 = Math.round(Fp * 0.62), z85 = Math.round(Fp * 0.85), mid = Math.round((xa + xc) / 2);
  const awning = (c) => { for (let x = xa + 1; x < xc - 1; x++) col(x, z62, z85, ((x - xa) >> 1) % 2 ? c : M.WHITE); };
  const glass = (x0, x1, m, mul) => { for (let x = x0; x < x1; x++) col(x, 1, z62, mul && (x - x0) % mul === mul - 1 ? M.WL : m); };
  const lantern = (x) => { col(x, Math.round(Fp * 0.4), z62, M.LAN); col(x + 1, Math.round(Fp * 0.4), z62, M.LAN); col(x, z62 - 1, z62, M.OUT); col(x + 1, z62 - 1, z62, M.OUT); };
  switch (type) {
    case 'ramen': case 'izakaya': { // 木の店構え、のれん（布の切れ目）、提灯、看板の帯
      for (let x = xa + 1; x < xc - 1; x++) col(x, 1, z62, M.A2);
      const dw = Math.max(4, Math.round(2.4 * KL)), d0 = mid - (dw >> 1);
      glass(d0, d0 + dw, M.GL, 3);
      for (let x = d0 - 1; x < d0 + dw + 1; x++) if ((x - d0) % 3 !== 2) col(x, Math.round(Fp * 0.42), z62, M.A1);
      col(mid, Math.round(Fp * 0.5), Math.round(Fp * 0.5) + 1, M.WHITE);
      if (d0 - 4 > xa) lantern(d0 - 4);
      if (type === 'izakaya' && d0 + dw + 3 < xc - 1) lantern(d0 + dw + 2);
      for (let x = xa + 1; x < xc - 1; x++) col(x, z62, z85, M.A1);                           // 看板（文字は描かない）
      for (let x = xa + 3; x < xc - 3; x += 3) col(x, Math.round(Fp * 0.7), Math.round(Fp * 0.76), M.WHITE);
      break;
    }
    case 'food': glass(xa + 1, xc - 1, M.GL, 4); awning(M.A1); break;            // 明るい店内と日よけ
    case 'cafe': {                                                                 // 緑の日よけと鉢植え
      glass(xa + 1, xc - 1, M.GL, 5); awning(M.A1);
      for (const x of [xa + 2, xc - 4]) { col(x, 1, 3, M.A2); col(x + 1, 1, 3, M.A2); col(x, 3, 5, M.PL); col(x + 1, 3, 6, M.PL); }
      break;
    }
    case 'conbini': {                                                              // 大きなガラスと色の帯
      glass(xa + 1, xc - 1, M.GLOW, 5);
      const zb = z62, n = Math.max(3, z85 - z62), t = Math.max(1, Math.round(n / 3));
      for (let x = xa + 1; x < xc - 1; x++) { col(x, zb, zb + t, M.A3); col(x, zb + t, zb + 2 * t, M.WHITE); col(x, zb + 2 * t, z85, M.A1); }
      break;
    }
    case 'salon': {                                                                // サインポール（赤・白・青のななめ）
      glass(xa + 1, xc - 1, M.A2, 4); awning(M.A1);
      const px = xa + 2;
      for (let z = 1; z < z62; z++) { const c = [M.A1, M.WHITE, M.A3][(z + 3) % 3]; col(px, z, z + 1, c); col(px + 1, z, z + 1, [M.A1, M.WHITE, M.A3][(z + 2) % 3]); }
      break;
    }
    case 'clinic': {                                                               // 白い店先に緑の十字
      for (let x = xa + 1; x < xc - 1; x++) col(x, 1, z85, M.WHITE);
      glass(mid - 4, mid + 4, M.GLOW, 4);
      const cz = Math.round((z62 + z85) / 2), cx = xa + 4;
      for (let d = -2; d <= 2; d++) { col(cx + d, cz, cz + 1, M.A3); col(cx, cz + d, cz + d + 1, M.A3); }
      break;
    }
    case 'florist': {                                                              // 店先に花のバケツ
      glass(xa + 1, xc - 1, M.A2, 4); awning(M.A1);
      for (let x = xa + 1; x < xc - 1; x++) {
        const r = hash(b.i, x, 9);
        col(x, 1, 2, M.PL); col(x, 2, 3 + (r < 0.5 ? 1 : 0), r < 0.25 ? M.FL1 : r < 0.5 ? M.FL2 : r < 0.75 ? M.LAN : M.PL);
      }
      break;
    }
    case 'bank': glass(xa + 1, xc - 1, M.GLOW, 6); for (let x = xa + 1; x < xc - 1; x++) col(x, z62, z85, M.A1); break;
    default: // ふつうの店: ガラスと日よけ
      for (let x = xa + 1; x < xc - 1; x++) {
        col(x, 1, z62, M.A2);
        col(x, z62, z85, ((x - xa) >> 1) % 2 ? M.A1 : M.WHITE);
      }
  }
}

// 壁の模様（窓・ベランダ・お店・車庫・時計など）。y は壁の傾きに沿って列ごとに計算する
function drawFacade(b, S, wl, hp, gYp, x0, y0, w, setW) {
  if (S.kind === 'shed') return;
  const xa = wl.L.x, xc = wl.R.x, W = xc - xa;
  if (W < 4) return;
  const baseAt = (x) => gYp - Math.round(wl.L.o + (wl.R.o - wl.L.o) * (x - xa) / Math.max(1, W)); // その列の地面
  const n = b.n > 0 && b.n < 200 ? b.n : Math.max(1, Math.round(b.h / 3.2));
  const Fp = Math.max(3, Math.min(Math.round(4.2 * KL), Math.round(hp / n)));  // 1 階ぶんのドット
  const floors = Math.max(1, Math.floor(hp / Fp));
  const put = (x, y, m) => setW(x - x0, y - y0, m, wl.id);
  const col = (x, zb, zt, m) => { const B = baseAt(x); for (let z = zb; z < zt; z++) put(x, B - 1 - z, m); };
  const shop = S.shop, startF = shop ? 1 : 0;
  if (shop) drawShopFront(S.shopType, b, xa, xc, Fp, col);
  if (S.garage) { // 消防署の赤い車庫
    const gw = Math.round(3.4 * KL), gs = Math.round(5 * KL);
    for (let k = 0; k < 3; k++) {
      const gx = xa + Math.round(0.8 * KL) + k * gs;
      if (gx + gw > xc - 1) break;
      for (let x = gx; x < gx + gw; x++) col(x, 0, Math.round(3.6 * KL), (x - gx) % 3 === 0 ? M.WD : M.A1);
    }
  }
  if (S.stripe) for (let x = xa; x < xc; x++) col(x, hp - Math.round(0.9 * KL), hp - Math.round(0.35 * KL), M.A1);
  if (S.ribs) for (let x = xa + 2; x < xc - 1; x += 3) col(x, 1, hp - 1, M.WS);
  if (S.band) { // 横に続く窓
    const mul = S.mullion ? Math.max(3, Math.round(S.mullion * KL)) : 0;
    for (let f = startF; f < floors; f++) {
      const zb = f * Fp + Math.round(Fp * 0.3), zt = f * Fp + Math.round(Fp * 0.8);
      if (zt > hp - 2) break;
      for (let x = xa + 2; x < xc - 2; x++) {
        const isMul = mul && (x - xa - 2) % mul === mul - 1;
        col(x, zb, zt, isMul ? M.WL : M.G);
        if (!isMul) col(x, zt - 1, zt, M.GH);
      }
      for (let x = xa + 2; x < xc - 2; x++) col(x, zb - 1, zb, M.WL); // 窓の下の明るい帯
    }
    if (S.clock && W > 18 * KL / 4 && b.h > 9) { // 学校の時計
      const cx = Math.round((xa + xc) / 2), z = hp - Math.round(1.2 * KL);
      for (let dx = -2; dx <= 2; dx++) col(cx + dx, z - 2, z + 3, Math.abs(dx) === 2 ? M.F : M.WHITE);
      col(cx, z, z + 2, M.OUT); col(cx + 1, z, z + 1, M.OUT);
    }
    if (S.cross && b.h > 6) { // 病院の十字
      const cx = xa + 4, z = hp - Math.round(1.5 * KL);
      for (let dx = -1; dx <= 1; dx++) col(cx + dx, z - 3, z + 4, M.A3);
      for (let dx = -3; dx <= 3; dx++) col(cx + dx, z - 1, z + 2, M.A3);
    }
    return;
  }
  // ひとつずつの窓（住宅・マンション）
  const pitch = Math.max(4, Math.round((S.pitch || 3.4) * KL)), ww = Math.max(2, Math.round((S.winW || 1.6) * KL));
  const cols = Math.max(1, Math.floor((W - 2) / pitch));
  const margin = Math.round((W - cols * pitch) / 2);
  const wh = Math.max(2, Math.min(Math.round(Fp * 0.45), 6));
  for (let f = startF; f < floors; f++) {
    const fb = f * Fp;
    if (fb + Fp > hp + 1) break;
    if (S.balcony) { // ベランダ: 手すりの帯と、上のふち
      const bb = fb + 1, bt = fb + Math.max(2, Math.round(Fp * 0.32));
      for (let x = xa + 1; x < xc - 1; x++) { col(x, bb, bt, M.WS); col(x, bt - 1, bt, M.WL); }
    }
    const zb = fb + (S.balcony ? Math.max(3, Math.round(Fp * 0.36)) : Math.round(Fp * 0.3));
    const zt = Math.min(fb + Fp - 1, zb + wh);
    const hw = (k, salt) => hash32(b.i * 1000003 + f * 1009 + (xa + margin + k * pitch) * 17 + salt * 7919); // 窓ごとの乱数（位置で決める。行・列でそろわない）
    for (let k = 0; k < cols; k++) {
      if (S.kind === 'house' && hash(b.i, f, k) < 0.25) continue;
      const wx = xa + margin + k * pitch + Math.round((pitch - ww) / 2);
      let lit = hw(k, 1) < 0.1;
      // 住まい（家・マンション）は、ところどころの窓に暮らしが見える（全部だとうるさいので 2 割ほど）
      const home = S.kind === 'house' || S.kind === 'apartment' || S.kind === 'shopapartment' || S.kind === 'shophouse';
      const life = home ? hw(k, 3) : 1;
      const person = life < 0.06 && wh >= 4 && ww >= 3, curtain = life >= 0.06 && life < 0.13;
      if (person) lit = true;
      for (let x = wx; x < wx + ww; x++) {
        col(x, zb, zt, lit ? M.GL : M.G);
        if (x === wx && !lit) col(x, zt - 1, zt, M.GH);              // ガラスの光
      }
      if (curtain) { col(wx, zb, zt, M.CU); col(wx + ww - 1, zb, zt, M.CU); if (ww >= 5) { col(wx + 1, zb + 1, zt, M.CU); col(wx + ww - 2, zb + 1, zt, M.CU); } }
      if (person) { // 窓辺の人（肩・顔・髪）
        const px = wx + Math.max(1, Math.round(ww * (0.3 + 0.4 * hw(k, 7)))) - 1;
        for (let x = px - 1; x <= px + 2; x++) col(x, zb, zb + 2, M.SH);
        col(px, zb + 2, zb + 4, M.SK); col(px + 1, zb + 2, zb + 4, M.SK);
        col(px, zb + 3, zb + 4, M.HR); col(px + 1, zb + 3, zb + 4, M.HR);
        if (wh >= 5) { col(px - 1, zb + 3, zb + 4, M.HR); col(px, zb + 4, zb + 5, M.HR); col(px + 1, zb + 4, zb + 5, M.HR); }
      }
      if (S.balcony && home) { // ベランダの洗濯物・ふとん・植木
        const bl = hw(k, 4), bt = fb + Math.max(2, Math.round(Fp * 0.32));
        if (bl < 0.08) for (let x = wx; x < wx + ww; x++) col(x, bt - 1, bt + 2, (x - wx) % 3 === 0 ? M.WHITE : (x - wx) % 3 === 1 ? M.L1 : M.L2); // 洗濯物
        else if (bl < 0.13) for (let x = wx - 1; x < wx + ww + 1; x++) col(x, fb + 1, bt + 1, M.L1);                                        // ふとんを干す
        else if (bl < 0.18) { col(wx + ww, bt - 1, bt + 2, M.PL); col(wx + ww + 1, bt, bt + 1, M.PL); }                                   // 植木
      }
      if (!S.balcony) for (let x = wx - 1; x <= wx + ww; x++) col(x, zb - 1, zb, M.WL); // 窓の下の水切り
    }
  }
  if (S.kind === 'house' && n <= 3 && W > 12) { // 玄関
    const dx = xa + Math.round(W * 0.22);
    for (let x = dx; x < dx + Math.max(2, Math.round(0.9 * KL)); x++) col(x, 0, Math.round(2.1 * KL), M.DOOR);
  }
  if (S.lamp) { const cx = Math.round((xa + xc) / 2); col(cx, hp - 2, hp, M.A1); col(cx + 1, hp - 2, hp, M.A1); }
}

// 忍者のコマを選ぶ
// ---- 忍者（頭・胴・腕・脚の骨組みから、升目に点を置いて描く。頭は身長の約 1/5）----
// 走りは「忍者走り」: 上体を前に倒し、両腕を後ろへ伸ばしたまま脚を回す
const NPAL = {
  o: '#1b2440', N: '#5d86cc', n: '#3b62a8', d: '#284682', b: '#1f2f55',
  s: '#f6d3ad', w: '#ffffff', e: '#1b2440', g: '#c9cfda', G: '#a0a8b8', k: '#2a2a35',
  F: '#2f9a57', f: '#1d6b3a', W: '#e6f3df', S: '#e2b48a', p: '#f9a8a0', // 風呂敷（緑に白の唐草）、手のひらの影、ほお
};
const NW = 20, NH = 22; // 升目（右向き、足の裏は 21 段目）

function ninjaPose() {
  // 状態から、姿勢の種類と走りの位相を決める
  if (G.skip && G.skip.mid) return { kind: 'run', ph: G.runPhase, rot: 0 };
  if (G.skip) return { kind: G.vy > 0 ? 'jump' : 'fall', rot: 0 };
  if (G.flip > 0) return { kind: 'tuck', rot: Math.min(3, Math.floor((1 - G.flip / 0.36) * 4)) };
  if (G.wall && G.vy > 0) return { kind: 'climb', ph: G.t * 9, rot: 0 };   // 鉤縄で登る
  if (G.wall) return { kind: 'run', ph: G.t * 9, rot: 3 };
  if (G.glide) return { kind: G.opts && G.opts.diff === 'hard' ? 'fall' : 'momonga', rot: 0 };
  if (G.momo) return { kind: 'momonga', rot: 0 }; // 高いところから落ちる: 風呂敷を広げて、ふわっと
  if (!G.onGround) return { kind: G.vy > 2 ? 'jump' : 'fall', rot: 0 };
  if (G.landT > 0) return { kind: 'land', rot: 0 };
  if (G.speed < 0.5) return { kind: 'idle', rot: 0 };
  return { kind: 'run', ph: G.runPhase, rot: 0 };
}

function ninjaGrid(pose) {
  const PADX = 8, PADY = 3, GW = NW + PADX * 2, GH = NH + 6;
  const grid = new Array(GW * GH).fill('');
  const put = (x, y, ch) => {
    const gx = Math.floor(x) + PADX, gy = Math.floor(y) + PADY;
    if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) grid[gy * GW + gx] = ch;
  };
  const disk = (cx, cy, r, ch) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) put(x, y, ch);
  };
  const cap = (a, b, r, ch) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3) + 1; for (let i = 0; i <= n; i++) disk(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, r, ch); };
  const add = (p, l, ang) => [p[0] + Math.sin(ang) * l, p[1] + Math.cos(ang) * l]; // ang: 真下から前へ

  // 姿勢ごとの骨組み
  let lean = 0.1, hip = [9, 12.5], legs, arms;
  const leg = (th, bend) => ({ th, bend });
  const k = pose.kind;
  // 走りの位相は 8 コマに区切る（ドット絵らしく）
  const ph = pose.ph !== undefined ? Math.floor((pose.ph * 1.5) / (Math.PI / 4)) * (Math.PI / 4) : 0;
  if (k === 'run') {
    lean = 0.78;
    const L = (p) => leg(0.9 * Math.sin(p), 0.3 + 1.0 * Math.max(0, Math.cos(p)));
    legs = [L(ph), L(ph + Math.PI)];
    arms = [[-5.6, 3.4], [-5.0, 2.2]];                  // 両腕は後ろ下へまっすぐ（忍者走り）
  } else if (k === 'jump') {
    lean = 0.7; hip = [9, 11];
    legs = [leg(0.7, 1.7), leg(-0.5, 1.2)];
    arms = [[4.6, -1.8], [-4.4, 1.2]];                   // 片手を前へ突き出す
  } else if (k === 'fall') {
    lean = 0.25; hip = [9, 11];
    legs = [leg(0.35, 0.5), leg(-0.3, 0.35)];
    arms = [[3.2, -3.2], [-3.2, -2.6]];
  } else if (k === 'climb') { // 両手で縄をたぐり、足は壁につく（手を交互に）
    lean = 0.05; hip = [9, 13];
    const a = Math.floor((pose.ph || 0) / Math.PI) % 2;
    legs = a ? [leg(1.35, 1.5), leg(0.8, 1.9)] : [leg(0.8, 1.9), leg(1.35, 1.5)];
    arms = a ? [[1.6, -6.8], [0.9, -4.6]] : [[0.9, -4.6], [1.6, -6.8]];
  } else if (k === 'momonga') { // 腹ばいで、手は前・足は後ろへ伸ばし、風呂敷を張る
    lean = 1.35; hip = [8, 13];
    legs = [leg(-1.45, 0.2), leg(-1.25, 0.3)];
    arms = [[4.4, -1.4], [3.9, -2.3]];
  } else if (k === 'tuck') {
    lean = 0.9; hip = [9, 12];
    legs = [leg(1.2, 2.2), leg(0.9, 2.1)];
    arms = [[2.5, 2.5], [1.5, 2.8]];
  } else if (k === 'land') {
    lean = 0.45; hip = [9, 14.5];
    legs = [leg(0.8, 1.7), leg(-0.45, 1.4)];
    arms = [[2.8, 2.2], [-3.4, 1.6]];
  } else { // idle
    lean = 0.05 + (Math.floor(G.t * 2) % 2) * 0.03;
    legs = [leg(0.12, 0.05), leg(-0.12, 0.05)];
    arms = [[0.9, 4.4], [-0.7, 4.4]];
  }
  const thigh = 4.3, shin = 4.6, torso = 5.2;
  const sh = add(hip, -torso, -lean); // 肩（上へ、前に傾く）
  const sh2 = [hip[0] + Math.sin(lean) * torso, hip[1] - Math.cos(lean) * torso];
  const shoulder = sh2;
  const head = [shoulder[0] + Math.sin(lean) * 2.9, shoulder[1] - Math.cos(lean) * 2.9];
  // 足もとをそろえる（地面にいるときは、低いほうの足を 21 段目に）
  const legPts = legs.map((l) => { const kn = add(hip, thigh, l.th); const ft = add(kn, shin, l.th - l.bend); return [kn, ft]; });
  if (k === 'run' || k === 'land' || k === 'idle') {
    const dy = 21 - Math.max(...legPts.map((p) => p[1][1]));
    hip[1] += dy; shoulder[1] += dy; head[1] += dy; legPts.forEach((p) => { p[0][1] += dy; p[1][1] += dy; });
  }
  // ももんがの風呂敷: 前の手から後ろの足まで、上へふくらむ（風ではためく）
  if (k === 'momonga') {
    const hA = [shoulder[0] + arms[1][0], shoulder[1] + arms[1][1]], fA = legPts[1][1];
    const x0 = Math.floor(fA[0]) - 1, x1 = Math.ceil(hA[0]) + 1, bl = 5.2 + (Math.floor(G.t * 12) % 2) * 0.7;
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / Math.max(1, x1 - x0);
      const base = fA[1] + (hA[1] - fA[1]) * t - 2.2 * Math.sin(Math.PI * t); // 体の線より上で止める（四すみだけ手足につく）
      const top = base - bl * Math.sin(Math.PI * t) - 0.6;
      for (let y = Math.floor(top); y <= Math.ceil(base); y++) {
        const edge = y === Math.floor(top) || y >= Math.ceil(base);
        const kara = ((x * 2 + y * 3) % 7 === 0) || ((x + y * 2) % 9 === 4); // 唐草のつもりの白い渦
        put(x, y, edge ? 'f' : kara ? 'W' : 'F');
      }
    }
  }
  // 奥の腕・奥の脚
  const handFar = [shoulder[0] + arms[1][0], shoulder[1] + arms[1][1]];
  cap(shoulder, handFar, 0.85, 'd');
  const [knF, ftF] = legPts[1];
  cap(hip, knF, 1.1, 'd'); cap(knF, ftF, 0.9, 'G'); disk(ftF[0] + 0.6, ftF[1] - 0.3, 0.9, 'k');
  // 頭巾の結び目のたれ（後ろへなびく）
  const hb = [head[0] - 2.3, head[1] - 0.6];
  for (let i = 1; i <= 3; i++) {
    const wav = Math.sin(G.t * 14 - i) * 0.5 + (k === 'jump' ? i * 0.3 : k === 'fall' ? -i * 0.3 : -0.4 * i);
    disk(hb[0] - i * 1.0, hb[1] + wav, 0.6, i % 2 ? 'n' : 'N');
  }
  // 胴（帯）
  cap(hip, shoulder, 1.7, 'n');
  disk(shoulder[0] + 0.4, shoulder[1] + 0.6, 1.2, 'N');
  const belt = [hip[0] + Math.sin(lean) * 1.2, hip[1] - Math.cos(lean) * 1.2];
  cap([belt[0] - 1.6, belt[1] + 0.4], [belt[0] + 1.6, belt[1] - 0.4], 0.5, 'b');
  // 手前の脚
  const [knN, ftN] = legPts[0];
  cap(hip, knN, 1.15, 'n'); cap(knN, ftN, 0.95, 'g'); disk(ftN[0] + 0.6, ftN[1] - 0.3, 0.95, 'k');
  // 頭（頭巾）と目元
  disk(head[0], head[1], 2.5, 'n');
  disk(head[0] - 0.5, head[1] - 0.8, 1.4, 'N');
  for (let x = Math.round(head[0] - 0.3); x <= Math.round(head[0] + 2.2); x++) put(x, head[1] - 0.4, 's');
  put(head[0] + 1.3, head[1] - 0.4, 'e'); put(head[0] + 0.5, head[1] - 0.4, 'w');
  // 手前の腕（手は肌）
  const handNear = [shoulder[0] + arms[0][0], shoulder[1] + arms[0][1]];
  cap(shoulder, handNear, 0.9, 'n'); disk(handNear[0], handNear[1], 0.8, 's');
  // 縁取り
  const outl = grid.slice();
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx;
    if (grid[i]) continue;
    if ((gx > 0 && grid[i - 1]) || (gx < GW - 1 && grid[i + 1]) || (gy > 0 && grid[i - GW]) || (gy < GH - 1 && grid[i + GW])) outl[i] = 'o';
  }
  return { outl, GW, GH, PADX, PADY };
}

// ---- 鉤縄（壁を駆け上がるとき）: 屋根のふちに鉤をかけ、縄をたぐって登る。絵だけで、登る速さは変えない ----
function drawRope(OX, OY, k) {
  const climbing = G.wall && G.vy > 0 && G.state === 'play';
  const nx = G.S + G.off;
  if (climbing && !G.hook) G.hook = { t: 0, rel: 0, face: nx + P.FOOT, top: roofUnder(nx + P.FOOT + 0.8) };
  if (!G.hook) return;
  const hk = G.hook, dt = frame.dt || 0;
  if (climbing) { hk.t += dt; hk.top = Math.max(hk.top, roofUnder(hk.face + 0.8)); }
  else { hk.rel += dt; if (hk.rel > 0.22) { G.hook = null; return; } }
  const hx = OX + SX(hk.face) * k, hy = OY + SY(hk.top) * k;                 // 鉤（屋根のふち）
  const nm = ninjaMul(), nxp = OX + (G.npos.x + (P.FOOT * KL - 0.3 * DOT) * nm) * k, nyp = OY + (G.npos.y - 2.3 * KL * nm) * k; // 手
  let e = Math.min(1, hk.t / 0.09);                                              // 投げた鉤が上がっていく
  if (hk.rel > 0) e = 1 - hk.rel / 0.22;                                         // 登りきったら縄をたぐり寄せる
  const ex = nxp + (hx - nxp) * e, ey = nyp + (hy - nyp) * e;
  const u = Math.max(2, Math.round(k * 0.8));                                  // 縄の太さ・鉤の 1 升
  const n = Math.max(2, Math.ceil(Math.hypot(ex - nxp, ey - nyp) / u));
  for (let i = 0; i <= n; i++) { // より縄（2 色の点）
    const t = i / n;
    ctx.fillStyle = i % 3 === 0 ? '#7a5530' : '#c99a5c';
    ctx.fillRect(Math.round(nxp + (ex - nxp) * t), Math.round(nyp + (ey - nyp) * t), u, u);
  }
  // 鉤（三つ又の鉄の爪）
  const bx = Math.round(ex), by = Math.round(ey);
  ctx.fillStyle = '#2b2f3a';
  ctx.fillRect(bx - u, by - 3 * u, 2 * u, 4 * u);
  ctx.fillRect(bx - 3 * u, by - 4 * u, 2 * u, u); ctx.fillRect(bx - 4 * u, by - 3 * u, u, 2 * u);
  ctx.fillRect(bx + u, by - 4 * u, 2 * u, u); ctx.fillRect(bx + 3 * u, by - 3 * u, u, 2 * u);
  ctx.fillStyle = '#9aa3b5'; ctx.fillRect(bx - u, by - 3 * u, u, u);
}

// ---- ひとっとびの演出: こちら（電車）へ跳んできて側窓に貼りつき、またもどる。時間はひとっとびそのまま ----
const FRONT = {}; // 正面向き・大の字の忍者（40×48 升）。はためき 2 コマ×まばたき
function frontNinja(fr, blink) {
  const key = fr * 2 + (blink ? 1 : 0);
  if (FRONT[key]) return FRONT[key];
  const GW = 40, GH = 48, grid = new Array(GW * GH).fill('');
  const put = (x, y, ch) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < GW && y < GH) grid[y * GW + x] = ch; };
  const disk = (cx, cy, r, ch) => { for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) put(x, y, ch); };
  const cap = (a, b, r, ch) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3) + 1; for (let i = 0; i <= n; i++) disk(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, r, ch); };
  // 頭巾のたれ（風で後ろ＝左へ）
  for (let i = 1; i <= 6; i++) disk(13 - i * 1.6, 9 + Math.sin(i * 1.3 + fr * 1.7) * 1.1 + i * 0.25, 1.1, i % 2 ? 'n' : 'N');
  // 脚（がにまた）・足袋
  cap([17, 31], [11, 39], 2.6, 'd'); cap([11, 39], [9, 45], 2.2, 'G'); disk(8.5, 45.5, 2, 'k');
  cap([23, 31], [29, 39], 2.6, 'n'); cap([29, 39], [31, 45], 2.2, 'g'); disk(31.5, 45.5, 2, 'k');
  // 胴・帯
  cap([20, 20], [20, 31], 5.4, 'n'); disk(18, 22, 2.4, 'N');
  for (let x = 15; x <= 25; x++) { put(x, 29, 'b'); put(x, 30, 'b'); }
  // 腕（窓のふちへ大の字）・手のひら（ガラスに押しつけて大きい）
  cap([15, 21], [6, 9], 2.2, 'd'); cap([25, 21], [34, 9], 2.2, 'n');
  for (const [hx, hy] of [[5, 7.5], [35, 7.5]]) {
    disk(hx, hy, 3.1, 's'); disk(hx + 0.8, hy + 0.9, 1.6, 'S');
    for (let f = -2; f <= 2; f++) cap([hx + f * 1.2, hy - 1], [hx + f * 1.6, hy - 4.2], 0.55, 's'); // 指
  }
  // 頭（頭巾）・目元（ガラスにおでこをつけて、目を見ひらく）
  disk(20, 12, 7.2, 'n'); disk(17, 9, 3, 'N');
  for (let y = 11; y <= 14; y++) for (let x = 13; x <= 27; x++) put(x, y, 's');
  if (blink) { for (let x = 15; x <= 18; x++) put(x, 13, 'e'); for (let x = 22; x <= 25; x++) put(x, 13, 'e'); }
  else {
    for (const ex of [15, 22]) { for (let y = 11; y <= 14; y++) for (let x = ex; x <= ex + 3; x++) put(x, y, 'w'); put(ex + 1, 12, 'e'); put(ex + 2, 12, 'e'); put(ex + 1, 13, 'e'); put(ex + 2, 13, 'e'); }
  }
  put(13, 14, 'p'); put(27, 14, 'p');
  // 縁取り
  const c = document.createElement('canvas'); c.width = GW; c.height = GH;
  const g = c.getContext('2d');
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    let ch = grid[y * GW + x];
    if (!ch && ((x > 0 && grid[y * GW + x - 1]) || (x < GW - 1 && grid[y * GW + x + 1]) || (y > 0 && grid[(y - 1) * GW + x]) || (y < GH - 1 && grid[(y + 1) * GW + x]))) ch = 'o';
    if (ch) { g.fillStyle = NPAL[ch]; g.fillRect(x, y, 1, 1); }
  }
  FRONT[key] = c;
  return c;
}
// 窓に貼りついた忍者の真ん中の x（景色のドット）。乗客がふり向く向きにも使う
function leapSpotX() { const SW = SCN.SW, Hb = Math.round((SCN.winH0 || (SW.y1 - SW.y0)) * 0.8); return Math.round(Math.min(SW.x1 - Hb * 0.5, SW.x1 * 0.56)); }
// 忍者が窓の上の外にいるとき: 窓の上のふち、忍者の真下に「上にいるよ」の吹き出し（忍者の絵と高さ）
function drawNinjaUp(OX, OY, k) {
  const SW = SCN.SW, nc = window.ninjaCanvas();
  if (!nc) return;
  const bw = 54, bh = 58, tip = 8;
  const xL = OX + Math.max(0, SW.x0) * k + bw / 2 + 4, xR = OX + SW.x1 * k - bw / 2 - 4;
  const cx = Math.round(Math.max(xL, Math.min(xR, OX + G.nup.x * k))), top = Math.round(OY + SW.y0 * k + 4);
  const ax = Math.round(Math.max(cx - bw / 2 + 6, Math.min(cx + bw / 2 - 6, OX + G.nup.x * k))); // とがりは忍者の真下
  const y0 = top + tip, x0 = cx - bw / 2;
  ctx.fillStyle = INK;
  ctx.fillRect(x0 - 2, y0 - 2, bw + 4, bh + 4);
  ctx.beginPath(); ctx.moveTo(ax - tip - 2, y0); ctx.lineTo(ax, top - 3); ctx.lineTo(ax + tip + 2, y0); ctx.fill();
  ctx.fillStyle = '#fbf6e6';
  ctx.fillRect(x0, y0, bw, bh);
  ctx.beginPath(); ctx.moveTo(ax - tip + 1, y0 + 1); ctx.lineTo(ax, top); ctx.lineTo(ax + tip - 1, y0 + 1); ctx.fill();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(nc, cx - 40, y0 - 14, 80, 65); // 44×36 の絵を約 1.8 倍（忍者は絵の真ん中、上の余白は透明）
  text(`↑${Math.max(1, Math.round(G.nup.up))}m`, cx, y0 + bh - 8, 12, INK, 'center', false);
}
function drawLeap(OX, OY, k) {
  const kk = G.skip, u = kk.u || 0, SW = SCN.SW;
  const ease = (t) => t * t * (3 - 2 * t);
  const small = 11 * DOT * ninjaMul();                            // ふだんの忍者の背の高さ（景色のドット）
  const Hb = Math.round((SCN.winH0 || (SW.y1 - SW.y0)) * 0.8);              // 窓に貼りついたときの背の高さ
  const cx = leapSpotX(), cy = Math.round(SW.y1 - Hb * 0.69); // 貼りつく場所（側窓の中）
  const sx0 = SCN.baseX, sy0 = SY(kk.y0) - 3 * DOT, sy1 = SY(kk.y1) - 3 * DOT;
  const fr = Math.floor(G.t * 8) % 2, blink = (G.t % 2.6) < 0.12;
  ctx.imageSmoothingEnabled = false;
  const blit = (img, x, y, h, sqx = 1, sqy = 1) => { // (x, y) は真ん中（景色のドット）、h は背の高さ
    const w = (h * img.width) / img.height;
    ctx.drawImage(img, Math.round(OX + (x - (w * sqx) / 2) * k), Math.round(OY + (y - (h * sqy) / 2) * k), Math.round(w * sqx * k), Math.round(h * sqy * k));
  };
  if (u < 0.25) {          // こちらへ跳んでくる（だんだん大きく）
    const t = u / 0.25, e = ease(t);
    const h = small * Math.pow(Hb / small, e);
    const x = sx0 + (cx - sx0) * e, y = sy0 + (cy - sy0) * e - Math.sin(Math.PI * t) * 14;
    const sq = t > 0.92 ? 1.08 : 1;
    blit(frontNinja(fr, false), x, y, h, sq, 2 - sq);
  } else if (u <= 0.8) {   // 側窓に貼りつく
    const t = (u - 0.25) / 0.55;
    const sq = t < 0.06 ? 1.08 : 1;                          // ぺたっ
    blit(frontNinja(fr, blink), cx, cy + (Math.floor(G.t * 3) % 2), Hb, sq, 2 - sq);
    if (t < 0.18) text('ぺたっ', OX + (cx + Hb * 0.42) * k, OY + (cy - Hb * 0.45) * k, Math.max(14, Math.round(k * 5)), '#ffffff');
  } else {                 // もどっていく（だんだん小さく、横向きで向こうの屋根へ）
    const t = (u - 0.8) / 0.2, e = ease(t);
    const nc = window.ninjaCanvas();
    const h = Hb * Math.pow(small / Hb, e);
    const x = cx + (sx0 - cx) * e, y = cy + (sy1 - cy) * e - Math.sin(Math.PI * t) * 10;
    blit(nc, x, y, h * (36 / 22));
  }
}

function drawNinja(x, y, tgt = lc, dotsPerPx = 1, poseOverride = null) {
  const pose = poseOverride || ninjaPose();
  const { outl, GW, GH, PADX, PADY } = ninjaGrid(pose);
  const rot = pose.rot;
  let ox, oy;
  if (rot === 0 && pose.kind === 'climb') { ox = x + Math.round(P.FOOT * KL * dotsPerPx) - 13; oy = y - 21; }
  else if (rot === 0) { ox = x - 10; oy = y - 21; }
  else if (rot === 3) { ox = x + Math.round(P.FOOT * KL * dotsPerPx) - NH + 1; oy = y - NW - 2; } // 壁を駆け上がる
  else { ox = x - 11; oy = y - 18; }
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const ch = outl[gy * GW + gx];
    if (!ch) continue;
    const px = gx - PADX, py = gy - PADY;
    let qx = px, qy = py;
    if (rot === 1) { qx = NH - 1 - py; qy = px; }
    else if (rot === 2) { qx = NW - 1 - px; qy = NH - 1 - py; }
    else if (rot === 3) { qx = py; qy = NW - 1 - px; }
    tgt.fillStyle = NPAL[ch]; tgt.fillRect(ox + qx, oy + qy, 1, 1);
  }
}

// ---- 描画（画面全体） ----
function text(t, x, y, size, col, align = 'left', shadow = true, maxW) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (shadow) { ctx.fillStyle = 'rgba(27,22,38,.85)'; ctx.fillText(t, x + 2, y + 2, maxW); }
  ctx.fillStyle = col; ctx.fillText(t, x, y, maxW); // 幅に収まらないときは横に詰める
}

// 地図の上の欄（きょり・時速・駅・ストップ）。変わったときだけ書きかえる
const hudLast = {};
function hudSet(id, v) { if (hudLast[id] !== v) { hudLast[id] = v; const el = document.getElementById(id); if (el) el.textContent = v; } }
function updateHud() {
  hudSet('hDist', fmtDist(G.dist));
  hudSet('hPts', Math.round(Math.round(G.dist) * optMult(G.opts || OPTS)).toLocaleString()); // スコア（きょり × 倍率。終わったときの点と同じ）
  hudSet('hKmh', G.skip ? '―' : `${Math.round(G.speed * 3.6)}`);
  hudSet('hSt', `${G.stationsPassed}`);
  const pn = document.getElementById('playingNote');
  if (pn) { const v = G.state === 'play' ? 'block' : 'none'; if (pn.style.display !== v) pn.style.display = v; }
  const hb = document.getElementById('hud');
  // 数字が伸びて欄が 2 行になったら（または戻ったら）、並べ直す
  if (hb && hb.offsetHeight !== (updateHud.h || 0)) { const first = !updateHud.h; updateHud.h = hb.offsetHeight; if (!first) setTimeout(resize, 0); }
  if (hb) { hb.classList.toggle('playing', G.state === 'play'); hb.classList.toggle('paused', !!paused); hb.classList.toggle('auto', !!G.auto); }
  hudSet('autoLabel', G.auto ? 'オート実行中' : 'オート実行');
  updateLcd();
}

// ---- 車内の案内画面: 行き先、次の駅（大きく）、現在時刻、号車、この先の駅までの分（GTFS の所要時間）・駅番号・乗りかえ ----
const LCD = { key: '', min: '' };
function lcdMinutes(i0) { // いまの位置から、駅 i0, i0+1, ... までの分（都営 GTFS の所要時間と停車時間。ゲームの速さではなく実際の時刻表）
  const st = SC.sts, sp = trainSpeed(G.S), a = sp.prev, b = sp.next, ia = st.indexOf(a);
  let sec = G.dwell > 0 ? 0 : (a.run || 60) * Math.max(0, Math.min(1, (b.s - G.S) / Math.max(1, b.s - a.s)));
  const out = [];
  for (let i = ia + 1; i < st.length; i++) {
    if (i > ia + 1) sec += (st[i - 1].dwell || 0) + (st[i - 1].run || 60);
    if (i >= i0) out.push(Math.max(1, Math.ceil(sec / 60)));
  }
  return out;
}
function updateLcd() {
  const el = document.getElementById('lcd');
  if (!el || !SC || !G) return;
  const st = SC.sts, sp = trainSpeed(G.S), b = sp.next, ib = st.indexOf(b);
  const atSt = G.dwell > 0 || (G.state === 'title' && Math.abs(G.S - sp.prev.s) < 30);
  const cur = atSt ? (G.dwell > 0 ? st.indexOf(b) : st.indexOf(sp.prev)) : -1;
  const nxt = cur >= 0 ? cur : ib;                                       // 大きく出す駅
  const soon = cur < 0 && b.s - G.S < 250;
  const label = cur >= 0 ? 'ただいま' : soon ? 'まもなく' : '次は';
  const en = Math.floor(G.t / 5) % 3 === 2;                              // 3 回に 1 回は英語で
  const d = new Date(), clock = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  // 路線図はいつも 7 駅。ふだんは 1 つ前の駅から。終点が近づいたら、通った駅（灰色）を左に残して 7 駅にする
  const N = 7, n = st.length, here = cur >= 0 ? cur : ib;
  const a = Math.max(0, Math.min(here - 1, n - N));
  const firstAhead = cur >= 0 ? cur + 1 : ib;
  const mins = lcdMinutes(firstAhead);
  const key = [label, nxt, en, clock, a, cur, ib, mins.slice(0, N).join(',')].join('|');
  if (key === LCD.key) return;
  LCD.key = key;
  const S0 = st[nxt], dest = st[st.length - 1];
  const code = (c) => `<span class="code">${c.slice(0, 2)}<br>${c.slice(2)}</span>`;
  const vname = (x) => `<span class="vnw"><span class="vn" style="font-size:${Math.min(1.05, 5.2 / x.name.length).toFixed(2)}em">${x.name}</span></span>`;
  const cols = [], dots = [], codes = [];
  const nowCol = () => { cols.push(`<div class="col"><span class="vnw"></span></div>`); dots.push(`<div class="dot now"><i></i></div>`); codes.push(`<div class="col"><span class="xf"></span></div>`); };
  for (let i = a; i < a + N && i < n; i++) {
    const x = st[i], past = i < here || (cur >= 0 && i === cur && false);
    if (cur < 0 && i === ib) nowCol();                                   // 走っているあいだは、駅と駅のあいだに「いまここ」
    const isCur = cur >= 0 && i === cur;
    cols.push(`<div class="col${i < here ? ' past' : ''}">${vname(x)}</div>`);
    if (isCur) dots.push(`<div class="dot now"><i></i></div>`);           // 停車中はその駅が「いまここ」
    else if (i < here) dots.push(`<div class="dot past"><i></i></div>`);
    else dots.push(`<div class="dot${i === ib && cur < 0 ? ' next' : ''}"><i>${mins[i - firstAhead]}</i></div>`);
    codes.push(`<div class="col${i < here ? ' past' : ''}">${code(x.code)}<span class="xf">${(x.xfer || []).slice(0, 2).join('<br>')}</span></div>`);
  }
  el.innerHTML = `
    <div class="head">
      <div class="kind"><b>各駅停車</b><span class="dest">${dest.name}<small>ゆき</small></span></div>
      <div class="nx">
        <div class="r1"><span class="lab">${en ? (cur >= 0 ? 'Now stopping at' : 'Next') : label}</span><span class="clock">現在時刻<b>${clock}</b></span><span class="car"><b>2</b>号車</span></div>
        <div class="r2">${code(S0.code)}<span class="name${en ? ' en' : ''}">${en ? S0.en : S0.name}</span></div>
      </div>
    </div>
    <div class="body">
      <div class="cols">${cols.join('')}</div>
      <div class="band"><div class="bar"></div><div class="arrow"></div><div class="dots">${dots.join('')}</div></div>
      <div class="cols">${codes.join('')}</div>
    </div>
    <div class="foot">（分）は時刻表での所要時間のめやすです</div>`;
  // 長い駅名（赤土小学校前など）は欄の幅に収まるまで縮める
  const nm = el.querySelector('.r2 .name');
  if (nm && nm.scrollWidth > nm.clientWidth + 1) nm.style.fontSize = `${(parseFloat(getComputedStyle(nm).fontSize) * nm.clientWidth / nm.scrollWidth) * 0.97}px`;
}
function drawFrame() {
  const L = LAYOUT, k = PX / DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); // 左右の余白は白
  // 外の景色（場面いっぱい。車内の窓のところだけ見える）
  const signs = drawLow();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(low, Math.round(SCN.x * DPR), Math.round(SCN.y * DPR), LW * PX, LH * PX);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const OX = SCN.x, OY = SCN.y;
  ctx.save(); ctx.beginPath(); ctx.rect(OX, OY, SCN.w, SCN.h); ctx.clip(); // 看板や駅名が左右の余白にはみ出さないように
  // 名前のある建物の看板（縦書き）
  for (const b of signs) {
    const wl = b.walls.reduce((a, c) => (Math.abs(c.c[0] - c.a[0]) > Math.abs(a.c[0] - a.a[0]) ? c : a));
    const name = b.name.replace(/^東京消防庁/, '').replace(/[「」]/g, '').slice(0, 12);
    const sx = OX + (SX(wl.a[0]) + 2) * k, sy = OY + (SY(b.h - 0.6 + OFF(wl.a[1]))) * k;
    if (sx > OX + LW * k || sx < OX - 20) continue;
    const fs = Math.max(10, Math.min(13, k * 3.5));
    const maxH = Math.max(fs * 3, (b.h - 1) * KL * k);
    const nch = Math.max(1, Math.min(name.length, Math.floor((maxH - 6) / (fs + 1))));
    const hgt = nch * (fs + 1) + 6;
    ctx.fillStyle = INK; ctx.fillRect(sx - 1, sy - 1, fs + 8, hgt + 2);
    ctx.fillStyle = b.row ? '#fbf6e6' : '#d9dde2'; ctx.fillRect(sx + 1, sy + 1, fs + 4, hgt - 2);
    ctx.font = `${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = INK;
    [...name].slice(0, nch).forEach((ch, j) => ctx.fillText(ch, sx + 3 + fs / 2, sy + 3 + j * (fs + 1)));
  }
  // 駅名標（ホームの柱に）
  for (const st of SC.sts) {
    const x = OX + SX(st.s) * k;
    if (x < OX - 60 || x > OX + LW * k + 60) continue;
    ctx.font = `12px ${FONT}`;
    const tw = ctx.measureText(st.name).width + 12;
    const sy = OY + (SCN.SW.y0 + 10) * k + 10;
    ctx.fillStyle = INK; ctx.fillRect(x - tw / 2 - 2, sy - 10, tw + 4, 22);
    ctx.fillStyle = '#fbf6e6'; ctx.fillRect(x - tw / 2, sy - 8, tw, 18);
    ctx.fillStyle = '#2f6f5e'; ctx.fillRect(x - tw / 2, sy + 6, tw, 4);
    text(st.name, x, sy, 12, INK, 'center', false);
  }
  // 忍者: 景色の 1 ドットに忍者の 2×2 ドット（大きさは半分、ドットは倍の細かさ）
  G.npos = G.npos || null;
  if (G.skip && !G.skip.water && G.state === 'play') drawLeap(OX, OY, k); // ひとっとび: こちらへ跳んで窓に貼りつき、もどる
  else if (G.npos && window.ninjaCanvas) {
    const nc = window.ninjaCanvas();
    const sp = ((k * DOT) / 2) * ninjaMul(); // 左の欄の「ニンジャの大きさ」（足もとを基準に大きくする）
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(nc, OX + G.npos.x * k - 22 * sp, OY + G.npos.y * k - 31 * sp, 44 * sp, 36 * sp);
    drawRope(OX, OY, k); // 縄は忍者の手から（手前に）
  } else G.hook = null;
  G.npos = null;
  // 車内（窓のところは透明）、乗客、つり革
  ctx.drawImage(inCv, OX, OY, LW * k, LH * k);
  if (window.drawPax) window.drawPax(frame.dt || 0, OX, OY, k);
  drawStraps(frame.dt || 0);
  if (G.nup && !G.skip && window.ninjaCanvas) drawNinjaUp(OX, OY, k);
  G.nup = null;
  ctx.restore();

  // 案内表示（ドアの上の電光掲示板）
  drawLED(OX, OY, k);

  // 距離・時速・駅数（地図の上の欄）
  updateHud();
  // 側窓の真ん中あたりに知らせ
  const cx = OX + ((SCN.X(0) + SCN.SW.x1) / 2) * k, wy = OY + SCN.SW.y0 * k, wh = (SCN.SW.y1 - SCN.SW.y0) * k, ww = (SCN.SW.x1 - SCN.X(0)) * k;
  if (G.msg && G.msgT > 0) {
    ctx.globalAlpha = Math.min(1, G.msgT * 2);
    text(G.msg, cx, wy + wh * 0.22, Math.min(26, ww / 12), '#ffffff', 'center');
    ctx.globalAlpha = 1;
  }
  if (G.banner) {
    ctx.globalAlpha = Math.min(1, G.banner.t * 1.5);
    const t = `― ${G.banner.text}に入った ―`;
    const fs = Math.min(20, ww / 14);
    ctx.font = `${fs}px ${FONT}`;
    const tw = ctx.measureText(t).width + 24;
    const bx = cx - tw / 2, by = wy + wh * 0.38;
    ctx.fillStyle = INK; ctx.fillRect(bx, by, tw, fs + 16);
    ctx.fillStyle = '#211d2c'; ctx.fillRect(bx + 3, by + 3, tw - 6, fs + 10);
    text(t, cx, by + fs / 2 + 8, fs, '#ffc843', 'center', false);
    ctx.globalAlpha = 1;
  }
}

// ---- ドアの上の電光掲示板 ----
// 実物に寄せて、場面ごとに文を順に出す（行き先 → つぎは（駅ナンバリング）→ 英語 → 乗りかえ）。長い文は横に流す
const LED_G = '#7dff6a', LED_O = '#ffa531', LED_W = '#ffe9c2';
let ledState = '', ledIdx = 0, ledT = 0;
function ledMessages() {
  const sp = trainSpeed(G.S);
  const last = SC.sts[SC.sts.length - 1];
  const stopped = G.dwell > 0 || (G.state !== 'play' && Math.abs(G.S - sp.prev.s) < 30);
  const nx = sp.next, isLast = nx === last;
  const xfer = (st) => (st.xfer.length ? [[[`${st.xfer.join('・')}`, LED_O], ['は おのりかえです', LED_W]]] : []);
  if (stopped) {
    const st = sp.prev;
    return { key: 'stop' + st.name, msgs: [
      [[`${st.code} `, LED_G], [st.name, LED_O], [st === last ? '　終点です' : '　です', LED_W]],
      [[st.en, LED_O], [st === last ? '  (Terminal)' : '', LED_W]],
      ...xfer(st),
    ] };
  }
  if (nx.s - G.S < 250) {
    return { key: 'soon' + nx.name, msgs: [
      [['まもなく ', LED_G], [isLast ? '終点 ' : '', LED_W], [nx.name, LED_O]],
      [['Arriving at ', LED_G], [nx.en, LED_O]],
      ...xfer(nx),
    ] };
  }
  return { key: 'next' + nx.name, msgs: [
    [['この電車は ', LED_W], [`${SC.dest}`, LED_O], [' ゆきです', LED_W]],
    [['つぎは ', LED_G], [isLast ? '終点 ' : '', LED_W], [`${nx.code} `, LED_G], [nx.name, LED_O]],
    [['Next ', LED_G], [`${nx.code} `, LED_G], [nx.en, LED_O]],
    ...xfer(nx),
  ] };
}
function drawLED(OX, OY, k) {
  const DR = SCN.DR;
  const bx = OX + (DR.x0 + 6) * k, by = OY + SCN.Y(0.043) * k + 4, bw = (DR.x1 - DR.x0 - 12) * k, bh = (SCN.Y(0.098) - SCN.Y(0.043)) * k - 8;
  const { key, msgs } = ledMessages();
  if (key !== ledState) { ledState = key; ledIdx = 0; ledT = 0; }
  ledT += frame.dt || 0;
  const msg = msgs[ledIdx % msgs.length];
  const fs = Math.max(12, Math.round(bh * 0.7));
  ctx.font = `${fs}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const tw = msg.reduce((a, [t]) => a + ctx.measureText(t).width, 0);
  let x;
  let dur = 3.2;
  if (tw <= bw - 12) x = bx + (bw - tw) / 2;
  else { const sp = Math.max(110, bw * 0.35); dur = (tw + bw) / sp + 0.3; x = bx + bw - ledT * sp; } // 入りきらない文は右から左へ流す
  if (ledT > dur) { ledT = 0; ledIdx++; }
  ctx.save();
  ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
  for (const [t, c] of msg) { ctx.fillStyle = c; ctx.fillText(t, x, by + bh / 2 + 1); x += ctx.measureText(t).width; }
  // 点の並び（LED らしく）
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  for (let yy = by; yy < by + bh; yy += 3) ctx.fillRect(bx, yy, bw, 1);
  for (let xx = bx; xx < bx + bw; xx += 3) ctx.fillRect(xx, by, 1, bh);
  ctx.restore();
}

// 右の地図に出す忍者（左と同じコマ）
const ninjaCv = document.createElement('canvas');
ninjaCv.width = 44; ninjaCv.height = 36;
const nctx = ninjaCv.getContext('2d');
// タイトルの「ぼくらの」の右の忍者（ゲームと同じドット絵が走る）
function drawLogoNinja() {
  const c = document.getElementById('logoNinja');
  if (!c || !KL) return;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  drawNinja(14, 24, g, 2, { kind: 'run', ph: performance.now() / 1000 * 7, rot: 0 }); // 28×26 の升に、足の裏が下から 2 升目
}
window.ninjaCanvas = () => {
  if (!G || !KL) return null;
  nctx.clearRect(0, 0, 44, 36);
  drawNinja(22, 31, nctx, 2 / DOT);
  return ninjaCv;
};

// 右の画面（上空からの地図）に渡す
// 地図の先読み用: 乗れる屋根（手前の列）、駆け上がりが要る壁の建物、跳ぶ必要のある隙間 [s0, s1, 幅]
window.mapInfo = () => {
  if (!SC) return null;
  if (SC.mapInfo) return SC.mapInfo;
  const st = SC.step, n = SC.prof.length;
  const top = (k) => Math.max(SC.prof[k] || 0, (SC.prof2 && SC.prof2[k]) || 0);
  const rows = SC.near.map((b, i) => (b.row ? i : -1)).filter((i) => i >= 0);
  const walls = new Set(), gaps = [];
  // 直前に乗っていた屋根より 8m 以上高い（長押し＋空中ジャンプで届くのは 8m ほど）→ 壁の駆け上がりが要る
  let last = 0;
  const big = []; // 大物（地図に「あぶない」を出す）: 高さ 20m 以上を駆け上がる壁、幅 20m 以上の隙間 [s, 種類, m]
  for (let k = 1; k < n; k++) {
    const rise = SC.prof[k] - last;
    if (SC.prof[k] > 0 && SC.pb[k] >= 0 && rise > 8 && !walls.has(SC.pb[k])) {
      walls.add(SC.pb[k]);
      if (rise >= 20) big.push([k * st, 'wall', Math.round(rise)]);
    }
    if (top(k) > 0) last = top(k);
  }
  for (let k = 0; k < n;) {
    if (top(k) > 0) { k++; continue; }
    let j = k; while (j < n && top(j) <= 0) j++;
    const w = (j - k) * st;
    if (w >= 10 && w <= P.BIG_GAP && k > 0 && j < n) { // 大きい隙間は自動でひとっとびなので出さない
      gaps.push([k * st, j * st, w]);
      if (w >= 20) big.push([k * st, 'gap', Math.round(w)]);
    }
    k = j;
  }
  big.sort((a, b) => a[0] - b[0]);
  SC.mapInfo = { rows, walls: [...walls], gaps, big, springs: SC.springs.map((sp) => [sp.a, sp.b]) };
  return SC.mapInfo;
};
window.trainState = () => (G && SC ? { S: G.S, nx: G.S + G.off, y: G.y, bid: G.bid, speed: G.speed, state: G.state, paused: !!paused,
  ahead: (SCN.SW.x1 - SCN.baseX) / KL, // 側窓で忍者の前に見えている距離 [m]
  leap: G.skip && !G.skip.water ? G.skip.u || 0 : -1, // ひとっとびで電車に貼りついている演出の進み具合（地図でも電車に飛びつく）
  d: G.bid >= 0 ? SC.near[G.bid].d : 0, h: G.bid >= 0 ? SC.near[G.bid].h : 0 } : null);

function frame(ts) {
  if (!SC) return;
  const now = ts / 1000;
  const dt = Math.min(0.05, now - (frame.last || now));
  frame.last = now; frame.dt = dt;
  if (G && G.state === 'play' && !paused) {
    // いつも同じ刻み（DT）で進める。押した記録を同じ刻みで計算しなおせば、同じ結果になる
    frame.acc = (frame.acc || 0) + dt * TIMESCALE;
    while (frame.acc >= DT && G.state === 'play') { G.tick++; step(DT); frame.acc -= DT; }
  } else if (G) { G.t += dt; frame.acc = 0; }
  if (G) {
    // カメラ「固定」: 一番下に固定（忍者が窓の上に出たら吹き出しで知らせる）。出発の屋根にいるあいだだけ忍者についていく
    // カメラ「ニンジャをおいかける」: 窓の上に出そうなときだけ上げる（すぐ反映。見た目だけでポイントには関係しない）
    if (G.camHold && ((G.onGround && G.bid !== G.startBid) || G.y < G.startY - 1)) G.camHold = false;
    const follow = OPTS.cam === 'follow' || G.camHold;
    const need = follow ? Math.max(0, G.y + 5 - (SCN.gY - SCN.SW.y0) / KL + 1) : 0;
    G.camUp = need > G.camUp ? G.camUp + (need - G.camUp) * Math.min(1, dt * 8) : Math.max(need, G.camUp - dt * 25);
    drawFrame();
    drawLogoNinja();
  }
  requestAnimationFrame(frame);
}

// ---- 起動 ----
async function main() {
  const [sc, mp] = await Promise.all([
    fetch('data/scene.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('data/map.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  try { await Promise.race([document.fonts.load('16px DotGothic16'), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {}
  MAP = mp; SC = sc;
  preparePhys(SC, MAP.places);
  prepare(SC);
  $('credit').innerHTML = '<ul>' + [
    `建物: 国土交通省 PLATEAU（${SC.sources.plateau.join('、')}）を加工して作成`,
    '駅・時刻表: 東京都交通局 GTFS（<a href="https://www.odpt.org/" target="_blank" rel="noopener">公共交通オープンデータセンター</a>経由、CC BY 4.0、2026-09-16 版）',
    '線路・川・公園・学校・お店: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors（ODbL）',
    '地図: 国土地理院 地理院タイル（淡色地図）',
    '文字: DotGothic16（SIL OFL）',
  ].map((t) => `<li>${t}</li>`).join('') + '</ul>';
  $('startSt').innerHTML = SC.sts.slice(0, -1).map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
  $('startSt').onchange = () => { // 乗る駅を変えたら、窓の外・忍者・地図もその駅へ
    startFrom = +$('startSt').value || 0;
    newGame(startFrom); G.state = 'title';
  };

  // 左の欄の設定
  const sync = () => {
    OPTS.size = $('sizeSel').value; OPTS.diff = $('diffSel').value; OPTS.crowd = $('crowdSel').value; OPTS.cam = $('camSel').value;
    const m = optMult(OPTS);
    $('multNote').textContent = m > 1 ? `ポイント ×${m}` : 'ポイント ×1（きょり）';
    if (!G || G.state !== 'play') { newGame(startFrom); G.state = 'title'; } // 遊んでいないときは、その設定で見せる
  };
  for (const id of ['sizeSel', 'diffSel', 'crowdSel', 'camSel']) $(id).onchange = sync;

  resize();
  newGame(); G.state = 'title';
  sync();
  document.body.classList.add('menu');
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
cv.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  press();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) setPause(true); });
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); setPause(!paused); return; }
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); if (!e.repeat) press(); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') release(); });

let startFrom = 0;
const begin = () => {
  paused = false; newGame(startFrom); say(`${SC.sts[startFrom].name} → ${SC.dest}`);
  // 開始券（ランキングに送るときに要る）。遊んでいるあいだに届けばよい
  const g = G;
  if (RANK_OK) Rank.ticket().then((t) => { g.ticket = t; });
};
const toTitle = () => {
  paused = false;
  for (const id of ['pause', 'over', 'rank', 'about']) $(id).classList.remove('show');
  if (G) G.state = 'title';
  document.body.classList.add('menu'); // せまい画面では左の欄（メニュー）を出す
};
$('pauseBtn').onclick = (e) => { e.stopPropagation(); setPause(!paused); };
$('autoBtn').onclick = (e) => { e.stopPropagation(); if (!paused) setAuto(!G.auto); };
$('start').onclick = () => {
  startFrom = +$('startSt').value || 0;
  for (const id of ['pause', 'over', 'rank', 'about']) $(id).classList.remove('show');
  document.body.classList.remove('menu');
  begin();
};
$('retry').onclick = () => { $('over').classList.remove('show'); begin(); };
$('overTitle').onclick = toTitle;
$('resume').onclick = () => setPause(false);
$('toTitle').onclick = toTitle;
$('save').onclick = async () => {
  if ($('save').disabled || !G || !G.dead) return;
  const name = ($('name').value || 'ななしの忍').trim().slice(0, 10);
  try { localStorage.setItem('shasou-ninja-name', name); } catch (e) {}
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const g = G;
  $('save').disabled = true; $('save').textContent = '送っています…';
  const r = await Rank.add({ id, name, dist: Math.round(g.dead.dist), pts: g.dead.pts, mult: g.dead.mult, where: g.dead.where, at: new Date().toISOString() },
    { ticket: g.ticket, ver: CORE_VER, from: g.from, opts: { diff: g.opts.diff, crowd: g.opts.crowd }, ev: g.ev, T: g.tick });
  $('save').textContent = '記録する';
  if (G !== g) return;
  if (r.ok) {
    $('nameRow').style.display = 'none';
    if (r.pts !== undefined && r.pts !== g.dead.pts) $('overScore').textContent = `${r.pts.toLocaleString()} 点`;
    $('overNote').style.display = 'none';
    g.ticket = null;
  } else {
    $('overNote').textContent = r.msg || '記録を送れませんでした';
    $('overNote').style.display = 'block';
    $('save').disabled = !!r.list || !!r.old; // 確かめで止まったもの・古い版は送りなおさない
    if (r.list || r.old) $('nameRow').style.display = 'none';
  }
  if (r.list) renderRank($('rankOver'), r.list, r.rid);
};
$('showRank').onclick = async () => {
  if (G && G.state === 'play') setPause(true);
  $('pause').classList.remove('show'); rankLoading($('rankList')); $('rank').classList.add('show');
  renderRank($('rankList'), await Rank.list(), null);
};
$('closeRank').onclick = () => { $('rank').classList.remove('show'); if (paused) $('pause').classList.add('show'); };
// せまい画面の上の帯: 題名を押すと読みこみ直し、三本線でランキング・このサービスについて
$('titleH').onclick = () => { if (document.body.classList.contains('narrow')) location.reload(); };
const hmenu = (open) => { $('hmenu').classList.toggle('open', open); $('hamb').setAttribute('aria-expanded', String(open)); };
$('hamb').onclick = (e) => { e.stopPropagation(); hmenu(!$('hmenu').classList.contains('open')); };
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#hmenu, #hamb')) hmenu(false); });
$('mRank').onclick = () => { hmenu(false); $('showRank').onclick(); };
$('mAbout').onclick = () => { hmenu(false); $('aboutBtn').onclick(); };
$('aboutBtn').onclick = () => { if (G && G.state === 'play') setPause(true); $('pause').classList.remove('show'); $('about').classList.add('show'); };
$('closeAbout').onclick = () => { $('about').classList.remove('show'); if (paused) $('pause').classList.add('show'); };

main();
