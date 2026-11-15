// 乗客: 乗った駅では車内は空いていて、終点に近づくほど混んでくる。
// 座った人はこちら向き、立っている人は窓やドアのほう（向こう向き）。歩くときは横向き。
// 乗る人は画面の外から歩いてきて、降りる人は画面の外へ歩いていく。
// 絵: 頭の大きいドット絵。部品ごとに 明・中・影・線 の 4 色で塗り、外側は濃い線で縁取る。
'use strict';

const PAX_OUT = '#2b2530';
const PAX_EYE = '#2b2233';
const PAX_RES = (() => { const m = /paxres=(\d)/.exec(location.search); return m ? Math.max(1, +m[1]) : 1; })();
const PAX_KINDS = ['salaryman', 'salaryman', 'salaryman', 'ol', 'ol', 'student', 'student', 'couple', 'friends', 'kid', 'elder', 'elder',
  'worker', 'tourist', 'cosplay']; // コスプレの人はたまに（1/15）
let PAX = [];          // いま車内にいる人
let PAX_FROM = 0;      // 乗った駅
let PAX_SEED = 0;      // その回の乱数の種（遊ぶたびに乗ってくる人が変わる）
let paxId = 0;
const paxCache = new Map();

// ---- 色: 1 色から 明・中・影・線 を作る（影は青紫へ、明かりは黄色へ少し寄せる） ----
const toneCache = new Map();
function hsl(hx) {
  const n = parseInt(hx.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslHex(h, s, l) {
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function tones(c) {
  if (toneCache.has(c)) return toneCache.get(c);
  const [h, s, l] = hsl(c);
  const toward = (tgt, amt) => { const d = ((tgt - h + 540) % 360) - 180; return (h + Math.sign(d) * Math.min(Math.abs(d), amt) + 360) % 360; };
  const t = {
    base: c,
    hi: hslHex(toward(50, 8), s * 1.02, l + (1 - l) * 0.3 + 0.03),
    sh: hslHex(toward(250, 14), s * 1.08 + 0.04, l * 0.76),
    dk: hslHex(toward(260, 20), s * 1.1 + 0.06, l * 0.5),
  };
  if (l < 0.25) { t.hi = hslHex(toward(220, 10), s, l + 0.14); t.sh = hslHex(h, s, l * 0.72); t.dk = hslHex(h, s, l * 0.45); }
  if (l > 0.9 && s < 0.5) { t.sh = hslHex(toward(225, 40), Math.max(s, 0.12), l * 0.84); t.dk = hslHex(toward(230, 40), Math.max(s, 0.14), l * 0.62); }
  if (l > 0.68 && s > 0.3 && h > 10 && h < 55) { t.sh = hslHex(toward(10, 8), s * 0.95, l * 0.86); t.dk = hslHex(toward(5, 12), s * 0.8, l * 0.66); } // 肌: 影は赤くしすぎない
  toneCache.set(c, t);
  return t;
}

// ---- 塗り（メートルで形を指定し、ドットに落とす） ----
function Painter(W, H, U, ox, fy) {
  Object.assign(this, { W, H, U, ox, fy });
  this.P = new Int16Array(W * H).fill(-1);  // どの部品か
  this.D = new Array(W * H).fill(null);     // 上から描く点（目・ボタンなど）
  this.parts = [];
}
Painter.prototype.X = function (x) { return this.flip ? this.ox - x * this.U : this.ox + x * this.U; }; // flip: 左右を裏返す
Painter.prototype.Y = function (y) { return this.fy - y * this.U; };
// 部品を 1 つ塗る。opt: sw 影の幅, hi 明かり, edge 後ろの部品との境に線, line 同じ色でも線, far 奥の手足（暗め）, ring 髪のつや
Painter.prototype.fill = function (mat, shapes, opt = {}) {
  const pi = this.parts.length;
  this.parts.push(Object.assign({ mat, sw: 0.28, hi: true, edge: true, cast: true }, opt));
  const { W, H, U, ox, fy, P } = this;
  if (this.flip) shapes = shapes.map(([f, b]) => [(x, y) => f(-x, y), [-b[2], b[1], -b[0], b[3]]]);
  for (const [fn, bb] of shapes) {
    const x0 = Math.max(0, Math.floor(ox + bb[0] * U) - 1), x1 = Math.min(W - 1, Math.ceil(ox + bb[2] * U) + 1);
    const y0 = Math.max(0, Math.floor(fy - bb[3] * U) - 1), y1 = Math.min(H - 1, Math.ceil(fy - bb[1] * U) + 1);
    for (let py = y0; py <= y1; py++) {
      const ym = (fy - (py + 0.5)) / U;
      for (let px = x0; px <= x1; px++) if (fn((px + 0.5 - ox) / U, ym)) P[py * W + px] = pi;
    }
  }
  return pi;
};
Painter.prototype.dot = function (px, py, c, w = 1, h = 1) {
  if (this.flip) px = px - w + 1; // 裏返しのときは、左はしではなく右はしが渡される
  for (let y = py; y < py + h; y++) for (let x = px; x < px + w; x++)
    if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.D[y * this.W + x] = c;
};
// 部品の上にだけ点を打つ（ひだ・縫い目など）
Painter.prototype.dotOn = function (pi, px, py, c) { if (px >= 0 && py >= 0 && px < this.W && py < this.H && this.P[py * this.W + px] === pi) this.D[py * this.W + px] = c; };
Painter.prototype.vline = function (pi, x, y0, y1, c) { const px = Math.round(this.X(x)); for (let y = Math.round(this.Y(y0)); y < this.Y(y1); y++) this.dotOn(pi, px, y, c); };
Painter.prototype.hline = function (pi, x0, x1, y, c) { const py = Math.round(this.Y(y)); for (let x = Math.round(this.X(x0)); x < this.X(x1); x++) this.dotOn(pi, x, py, c); };
Painter.prototype.render = function () {
  const { W, H, P, D, parts } = this;
  const out = new Array(W * H).fill(null);
  const cs = Math.max(1, Math.round(this.U * 0.02));
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const p = P[y * W + x];
      if (p < 0) { x++; continue; }
      let xb = x;
      while (xb + 1 < W && P[y * W + xb + 1] === p) xb++;
      const pp = parts[p], T0 = tones(pp.mat);
      const T = pp.far ? { base: T0.sh, sh: T0.dk, hi: T0.base, dk: T0.dk } : T0;
      const rw = xb - x + 1;
      const nsh = pp.sw > 0 && rw >= 3 ? Math.max(1, Math.round(rw * pp.sw)) : 0;
      const nhi = pp.hi && rw >= 6 ? Math.max(1, Math.round(rw * 0.12)) : 0;
      for (let i = x; i <= xb; i++) {
        let c = T.base;
        if (i > xb - nsh) c = T.sh;
        else if (i < x + nhi) c = T.hi;
        if (pp.ring) { // 髪のつや（左上に弧）
          const R = pp.ring, dx = (i + 0.5 - R.cx) / R.rx, dy = (y + 0.5 - R.cy) / R.ry, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
          if (r > 0.56 && r < 0.7 && a > -2.7 && a < -1.15 && (i + y * 2) % 13) c = T.hi;
        }
        if (pp.cast && c !== T.sh) {
          for (let d = 1; d <= cs; d++) {
            const yy = y - d, xx = i - (d >> 1);
            if (yy < 0 || xx < 0) break;
            const q = P[yy * W + xx];
            if (q > p && parts[q].caster !== false) { c = T.sh; break; }
          }
        }
        if (pp.edge) {
          const nb = [y > 0 ? P[(y - 1) * W + i] : -1, y < H - 1 ? P[(y + 1) * W + i] : -1, i > 0 ? P[y * W + i - 1] : -1, i < W - 1 ? P[y * W + i + 1] : -1];
          for (const q of nb) if (q >= 0 && q < p && (pp.line || parts[q].mat !== pp.mat)) { c = T.dk; break; }
        }
        out[y * W + i] = c;
      }
      x = xb + 1;
    }
  }
  for (let i = 0; i < W * H; i++) if (D[i]) out[i] = D[i];
  // 外側の縁取り
  const fin = out.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (out[i]) continue;
    if ((x > 0 && out[i - 1]) || (x < W - 1 && out[i + 1]) || (y > 0 && out[i - W]) || (y < H - 1 && out[i + W])) fin[i] = PAX_OUT;
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'), img = cx.createImageData(W, H), d = img.data;
  for (let i = 0; i < W * H; i++) {
    const c = fin[i]; if (!c) continue;
    const n = parseInt(c.slice(1), 16);
    d[i * 4] = (n >> 16) & 255; d[i * 4 + 1] = (n >> 8) & 255; d[i * 4 + 2] = n & 255; d[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return cv;
};

// ---- 形 ----
const shE = (cx, cy, rx, ry, cut) => [(x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && (!cut || cut(x, y)), [cx - rx, cy - ry, cx + rx, cy + ry]];
const shR = (x0, y0, x1, y1) => [(x, y) => x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1), [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]];
const shQ = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [(x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]];
};
const shL = (x0, y0, x1, y1, r0, r1 = r0) => {
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-9, rm = Math.max(r0, r1);
  return [(x, y) => {
    let t = ((x - x0) * dx + (y - y0) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const r = r0 + (r1 - r0) * t;
    return (x - x0 - dx * t) ** 2 + (y - y0 - dy * t) ** 2 <= r * r;
  }, [Math.min(x0, x1) - rm, Math.min(y0, y1) - rm, Math.max(x0, x1) + rm, Math.max(y0, y1) + rm]];
};
const mirror = (pts) => pts.map(([x, y]) => [-x, y]);
const tooth = (t) => { const f = t - Math.floor(t); return f < 0.5 ? f * 2 : 2 - f * 2; }; // 0〜1 のぎざぎざ

// ---- 見た目（乗客ごとに乱数で決める） ----
function paxLook(kind, r) {
  const seed = (r * 1e6) | 0;
  const rnd = (i) => hash(seed, i);
  const pk = (a, i) => a[Math.floor(rnd(i) * a.length) % a.length];
  const L = { kind, seed, skin: pk(['#fbe1c6', '#f7d4b0', '#f0c8a0', '#fde8d4'], 1), scale: 0.86, headK: 1,
    brow: false, blush: false, glasses: false, mask: rnd(30) < 0.12, shoe: '#2c2a30', shoeStyle: 'dress', legs: null };
  const darkHair = ['#2e2a2c', '#3b302c', '#4a3828', '#2a2833'];
  switch (kind) {
    case 'salaryman':
      Object.assign(L, { sex: 'm', hair: pk([...darkHair, '#6b4a33'], 2), hairStyle: pk(['short', 'side', 'side', 'spiky'], 3),
        top: pk(['#3d4b66', '#2f3c5c', '#5d636e', '#2d2f36', '#4b5a73'], 4), topStyle: 'suit', shirt: pk(['#ffffff', '#ffffff', '#dbe9f7'], 5),
        tie: pk(['#c0392b', '#2e5d9e', '#7a2f4f', '#2e7d5b', '#c9a227'], 6), bottomStyle: 'pants', brow: true,
        glasses: rnd(7) < 0.35, bag: rnd(8) < 0.6 ? 'brief' : null, bagC: pk(['#2c2a30', '#5a3a26'], 9) });
      L.bottom = L.top; break;
    case 'ol':
      Object.assign(L, { sex: 'f', hair: pk(['#4a3828', '#6b4a33', '#2e2a2c', '#7a5236'], 2), hairStyle: pk(['pony', 'long', 'bob', 'pony'], 3),
        top: pk(['#33405e', '#e8e0d0', '#6b6f78', '#2d2f36', '#c9b79a'], 4), topStyle: 'ol', shirt: pk(['#ffffff', '#fbe9ef', '#ffffff'], 5),
        bottom: pk(['#2d2f36', '#33405e', '#6b6f78'], 6), bottomStyle: 'skirt', legs: '#e9cdb5', shoeStyle: 'pump', blush: true,
        bag: 'shoulder', bagC: pk(['#b0473a', '#d9c3a3', '#2c2a30', '#8a5a3c'], 7) });
      break;
    case 'student':
      if (rnd(10) < 0.5) Object.assign(L, { sex: 'm', hair: '#2a2731', hairStyle: pk(['spiky', 'short'], 2), top: '#272a38', topStyle: 'gakuran',
        bottom: '#272a38', bottomStyle: 'pants', brow: true, bag: 'sports', bagC: pk(['#2b3f73', '#2c2a30', '#7a2830'], 3), shoeStyle: 'sneaker', shoe: '#f2f2f2', sole: pk(['#2b6cc4', '#d23c3c', '#2c2a30'], 4) });
      else Object.assign(L, { sex: 'f', hair: pk(['#2a2731', '#3b302c'], 2), hairStyle: pk(['long', 'bob', 'pony'], 3),
        top: pk(['#f6f6f4', '#26315f'], 4), collar: '#26315f', scarf: '#d23c3c', topStyle: 'sailor', bottom: '#26315f', bottomStyle: 'pleats',
        socks: pk(['#26315f', '#f4f4f4'], 5), shoeStyle: 'loafer', shoe: '#3a2a24', blush: true, bag: 'hand', bagC: '#2a2d3a' });
      break;
    case 'man':
      Object.assign(L, { sex: 'm', hair: pk(['#6b4a33', '#3b302c', '#8a6040'], 2), hairStyle: pk(['short', 'side', 'spiky'], 3),
        top: pk(['#e48a4f', '#5aa36a', '#7a8fd0', '#d4b44a', '#9a6fb0'], 4), topStyle: 'hoodie', bottom: pk(['#4a6fa5', '#3a5683'], 5),
        bottomStyle: 'pants', shoeStyle: 'sneaker', shoe: '#f2f2f2', sole: pk(['#d23c3c', '#2c2a30', '#2b6cc4'], 6), brow: true });
      break;
    case 'woman':
      Object.assign(L, { sex: 'f', hair: pk(['#7a5236', '#a0683e', '#4a3828'], 2), hairStyle: pk(['long', 'bob', 'pony'], 3),
        top: pk(['#f0b6c6', '#f3d58a', '#bcd9ee', '#cfe6c4'], 4), topStyle: 'cardigan', shirt: '#ffffff', bottom: pk(['#c98b6a', '#7d8fb3', '#e6dcc8'], 5),
        bottomStyle: 'midi', legs: '#efd3bb', shoeStyle: 'pump', shoe: pk(['#8a5a3c', '#2c2a30'], 6), blush: true, bag: 'shoulder', bagC: pk(['#e6dcc8', '#8a5a3c'], 7) });
      break;
    case 'kid':
      Object.assign(L, { sex: rnd(11) < 0.5 ? 'm' : 'f', hair: '#2e2a2c', top: pk(['#7cc4e6', '#f2a65a', '#ffffff', '#f5a3b5', '#9bd18a'], 3),
        topStyle: 'tee', bottom: pk(['#26315f', '#4a6fa5', '#c98b6a'], 5), bottomStyle: 'shorts', socks: '#f4f4f4', hat: '#f5d33c',
        randoseru: pk(['#d23c3c', '#2b6cc4', '#2a2a2a', '#8a5bb5', '#8a5a3c'], 4), shoeStyle: 'sneaker', shoe: '#f2f2f2', sole: '#2b6cc4',
        scale: 0.62, headK: 1.22, blush: true });
      L.hairStyle = L.sex === 'f' ? 'bob' : 'short';
      break;
    case 'elder':
      if (rnd(12) < 0.5) Object.assign(L, { sex: 'm', hair: '#d9d9d9', hairStyle: 'bald', cap: pk(['#a8957a', '#6f7480', null], 2),
        top: pk(['#8d8f74', '#a9a39a', '#7a6a5a'], 3), sleeve: '#e9e4d8', topStyle: 'vest', bottom: '#6f6f72', bottomStyle: 'pants',
        cane: true, glasses: rnd(13) < 0.6, brow: true, eyes: 'smile', scale: 0.82, shoe: '#4a3a30' });
      else Object.assign(L, { sex: 'f', hair: '#dedede', hairStyle: 'bun', top: pk(['#c9a9c9', '#b8c7a6', '#d9b48f'], 3), topStyle: 'cardigan', shirt: '#f4efe6',
        bottom: pk(['#6f6a78', '#5b5f6b'], 4), bottomStyle: 'long', legs: '#d8c3b0', shoeStyle: 'pump', shoe: '#4a3a30', glasses: rnd(13) < 0.4,
        blush: true, eyes: 'smile', bag: 'hand', bagC: pk(['#7a4a3a', '#2c2a30'], 5), scale: 0.8 });
      break;
    case 'worker': // 作業着にヘルメット
      Object.assign(L, { sex: 'm', hair: pk(darkHair, 2), hairStyle: 'short', hat: '#f4f4f4', top: pk(['#4a5a72', '#6b6a4e', '#3d5a4a'], 4), topStyle: 'cardigan',
        shirt: pk(['#d9d4c4', '#c9d3dc'], 5), bottomStyle: 'pants', brow: true, shoe: '#5a4a3a', scale: 0.88 });
      L.bottom = L.top; break;
    case 'tourist': // リュックの旅行者
      Object.assign(L, { sex: rnd(11) < 0.5 ? 'm' : 'f', skin: pk(['#fde8d4', '#f7d4b0', '#e8b890'], 1), hair: pk(['#e8c87a', '#c98a4a', '#3b302c', '#d9b06a'], 2),
        top: pk(['#f2a65a', '#7cc4e6', '#ffffff', '#e2453c', '#9bd18a'], 4), topStyle: 'tee', bottom: pk(['#c9b58a', '#4a6fa5', '#6b6a4e'], 5), bottomStyle: 'shorts',
        socks: '#f4f4f4', randoseru: pk(['#e2453c', '#2b6cc4', '#5aa36a', '#e8a23c'], 6), shoeStyle: 'sneaker', shoe: '#f2f2f2', sole: '#2c2a30', brow: true });
      L.hairStyle = L.sex === 'f' ? 'pony' : 'short';
      if (L.sex === 'm' && rnd(12) < 0.6) L.cap = pk(['#e2453c', '#2b6cc4', '#2c2a30'], 13);
      break;
    case 'cosplay': { // たまにいる: 魔女・ねこ耳メイド・着ぐるみ
      const v = pk(['witch', 'maid', 'kigurumi'], 2);
      L.cos = v; L.mask = false;
      if (v === 'witch') Object.assign(L, { sex: 'f', hair: pk(['#9a6fd0', '#e8c87a', '#2e2a2c', '#d24a5a'], 3), hairStyle: 'long', witch: pk(['#3a2a5a', '#2a2a35', '#5a2a3a'], 4),
        cape: pk(['#4a2f70', '#2a2a35', '#6a2a40'], 5), top: '#3a2a5a', topStyle: 'cardigan', shirt: '#3a2a5a', bottom: '#3a2a5a', bottomStyle: 'long',
        legs: '#2a2a35', shoe: '#2a2a35', shoeStyle: 'pump', blush: true });
      else if (v === 'maid') Object.assign(L, { sex: 'f', hair: pk(['#f2a0c8', '#c8d0e0', '#7ac8e8', '#f5d33c'], 3), hairStyle: pk(['long', 'bob'], 4), ears: 'cat', frill: true,
        top: '#2a2830', topStyle: 'maid', bottom: '#2a2830', bottomStyle: 'skirt', legs: '#f4f4f4', shoe: '#2a2830', shoeStyle: 'pump', blush: true });
      else {
        const c = pk(['#f5d33c', '#f5a3b5', '#9b7a5a', '#f4f4f4', '#7cc4e6'], 3);
        Object.assign(L, { sex: rnd(11) < 0.5 ? 'm' : 'f', hair: c, hairStyle: 'bald', hood: c, // 髪はフードの中 hoodEars: pk(['cat', 'bear', 'rabbit'], 5), tail: true,
          top: c, topStyle: 'hoodie', bottom: c, bottomStyle: 'pants', shoeStyle: 'sneaker', shoe: '#f2f2f2', sole: '#2c2a30', blush: true });
      }
      break;
    }
  }
  // 髪を染めている人も少し
  if (['man', 'woman', 'ol', 'student'].includes(kind) && rnd(40) < 0.18) L.hair = pk(['#a0683e', '#c98a4a', '#d9b06a', '#8a8f9a', '#b05a3a'], 41);
  if (L.mask && (kind === 'kid' || kind === 'elder')) L.mask = false;
  L.sleeve = L.sleeve || L.top;
  // 座ったときにすること
  const sitActs = { salaryman: ['none', 'phone', 'sleep', 'read', 'lap'], ol: ['phone', 'none', 'sleep', 'phone'], student: ['phone', 'none', 'sleep'],
    man: ['phone', 'none'], woman: ['none', 'phone'], kid: ['none', 'none'], elder: ['none', 'sleep', 'read'],
    worker: ['sleep', 'none', 'phone'], tourist: ['phone', 'none'], cosplay: ['phone', 'none'] }[kind];
  L.sitAct = pk(sitActs, 20);
  if (L.sitAct === 'lap' && L.bag !== 'brief') L.sitAct = 'none';
  return L;
}

// ---- 頭 ----
// 髪の形: 顔の中心からの位置（u: 横、v: 縦。どちらも顔の半径で割った値。v は上が正）で決める
function hairFront(style) {
  switch (style) {
    case 'short': return { cap: [1.1, 0.1, 1.1], fr: (u) => 0.36 + 0.14 * tooth(u * 2.6 + 0.3), side: 0.8, sideV: 0.0 };
    case 'side': return { cap: [1.1, 0.1, 1.12], fr: (u) => 0.18 + 0.32 * (u + 1) / 2 + 0.08 * tooth(u * 2.2), side: 0.8, sideV: -0.05 };
    case 'spiky': return { cap: [1.12, 0.12, 1.12], fr: (u) => 0.26 + 0.2 * tooth(u * 2.2 + 0.5), side: 0.8, sideV: 0.0, spikes: true };
    case 'bob': return { cap: [1.2, 0.0, 1.16], fr: (u) => 0.3 + 0.06 * tooth(u * 4), side: 0.72, sideV: -0.9, nape: -1.0 };
    case 'long': return { cap: [1.18, 0.02, 1.14], fr: (u) => 0.52 - 0.36 * Math.abs(u) + 0.05 * tooth(u * 4), side: 0.74, sideV: -1.1, back: true, nape: -1.1 };
    case 'pony': return { cap: [1.12, 0.06, 1.12], fr: (u) => 0.3 + 0.12 * tooth(u * 2.4 + 0.2), side: 0.78, sideV: -0.35, pony: true, nape: -0.45 };
    case 'bun': return { cap: [1.1, 0.08, 1.1], fr: (u) => 0.58 - 0.18 * Math.abs(u), side: 0.84, sideV: -0.1, bun: true, nape: -0.45 };
    case 'bald': return { bald: true };
  }
  return hairFront('short');
}

function hats(pt, L, hd, view) {
  const { x: hx, y: hy, rx, ry } = hd;
  const side = view === 'side';
  const ear = (shape, sx, c, inner) => { // 動物の耳（sx: 左右 -1 / 1）
    if (shape === 'cat') pt.fill(c, [shQ([[hx + sx * rx * 0.95, hy + ry * 0.75], [hx + sx * rx * 0.3, hy + ry * 1.05], [hx + sx * rx * 0.85, hy + ry * 1.62]])], { line: true, sw: 0.25 });
    if (shape === 'bear') pt.fill(c, [shE(hx + sx * rx * 0.82, hy + ry * 1.08, rx * 0.36, ry * 0.34)], { line: true, sw: 0.25 });
    if (shape === 'rabbit') pt.fill(c, [shE(hx + sx * rx * 0.42, hy + ry * 1.75, rx * 0.2, ry * 0.68)], { line: true, sw: 0.25 });
    if (inner && view === 'front') {
      const ix = Math.round(pt.X(hx + sx * rx * (shape === 'rabbit' ? 0.42 : 0.72))), iy = Math.round(pt.Y(hy + ry * (shape === 'rabbit' ? 1.75 : shape === 'cat' ? 1.18 : 1.1)));
      pt.dot(ix - 1, iy - (shape === 'rabbit' ? 3 : 1), '#f4a8b8', 2, shape === 'rabbit' ? 6 : 2);
    }
  };
  if (L.hood) { // 着ぐるみのフード（顔のまわりだけあく）
    const sides = side ? [1] : [-1, 1];
    for (const sx of sides) ear(L.hoodEars, side ? -0.3 : sx, L.hood, true);
    const faceCut = view === 'front' ? (x, y) => ((x - hx) / (rx * 0.84)) ** 2 + ((y - hy + ry * 0.12) / (ry * 0.8)) ** 2 > 1
      : side ? (x, y) => !(x > hx + rx * 0.2 && ((x - hx - rx * 0.4) / (rx * 0.7)) ** 2 + ((y - hy + ry * 0.12) / (ry * 0.8)) ** 2 <= 1) : null;
    pt.fill(L.hood, [shE(hx - (side ? rx * 0.08 : 0), hy + ry * 0.04, rx * 1.28, ry * 1.26, faceCut)], { sw: 0.24 });
    return;
  }
  if (L.ears) { // ねこ耳とフリルのカチューシャ
    for (const sx of side ? [-0.4] : [-1, 1]) ear('cat', sx, L.hair, true);
    pt.fill('#ffffff', [shE(hx - (side ? rx * 0.1 : 0), hy + ry * 0.95, rx * (side ? 0.75 : 0.92), ry * 0.13)], { line: true, sw: 0.2 });
  }
  if (L.witch) { // 魔女の帽子（先が後ろへ折れる）
    const lean = side ? -0.35 : 0.2;
    pt.fill(L.witch, [shQ([[hx - rx * 0.9, hy + ry * 0.72], [hx + rx * 0.9, hy + ry * 0.72], [hx + rx * (0.15 + lean), hy + ry * 2.2], [hx + rx * (lean - 0.15), hy + ry * 2.2]])], { sw: 0.28 });
    pt.fill(L.witch, [shQ([[hx + rx * (lean - 0.15), hy + ry * 2.1], [hx + rx * (0.15 + lean), hy + ry * 2.2], [hx + rx * (lean - 0.9), hy + ry * 2.55]])], { line: true, sw: 0.3 });
    pt.fill('#e8c35a', [shR(hx - rx * 0.86, hy + ry * 0.78, hx + rx * 0.86, hy + ry * 0.98)], { line: true, sw: 0.2 });
    pt.fill(L.witch, [shE(hx, hy + ry * 0.7, rx * (side ? 1.6 : 1.8), ry * 0.2)], { line: true, sw: 0.22 });
  }
  if (L.hat) { // 黄色い安全帽（ふちが一周）
    pt.fill(L.hat, [shE(hx, hy + ry * 0.2, rx * 1.12, ry * 1.08, (x, y) => y > hy + ry * 0.34)], { sw: 0.26 });
    pt.fill(L.hat, [shE(hx + (side ? rx * 0.05 : 0), hy + ry * 0.3, rx * (side ? 1.38 : 1.32), ry * 0.12)], { line: true, sw: 0.22 });
  }
  if (L.cap) { // ハンチング
    pt.fill(L.cap, [shE(hx - rx * (side ? 0.1 : 0.0), hy + ry * 0.45, rx * 1.12, ry * 0.75, (x, y) => y > hy + ry * 0.45)], { sw: 0.26 });
    if (side) pt.fill(L.cap, [shE(hx + rx * 0.8, hy + ry * 0.47, rx * 0.5, ry * 0.12)], { line: true, sw: 0.2 });
    else pt.fill(L.cap, [shE(hx, hy + ry * 0.47, rx * 1.05, ry * 0.12)], { line: true, sw: 0.26 });
  }
}

// 前向き（座っている人）
function drawHeadFront(pt, L, hd, o) {
  const { x: hx, y: hy, rx, ry } = hd;
  const H = hairFront(L.hairStyle);
  if (H.pony) pt.fill(L.hair, [shL(hx + rx * 1.0, hy + ry * 0.3, hx + rx * 1.35, hy - ry * 0.9, rx * 0.3, rx * 0.16)], { sw: 0.3 });
  pt.fill(L.skin, [shE(hx - rx * 0.98, hy - ry * 0.1, rx * 0.17, ry * 0.22), shE(hx + rx * 0.98, hy - ry * 0.1, rx * 0.17, ry * 0.22)], { sw: 0.4, hi: false });
  pt.fill(L.skin, [shE(hx, hy, rx, ry)], { sw: 0.18 });
  if (H.bald) {
    pt.fill(L.hair, [shE(hx, hy, rx * 1.06, ry * 1.02, (x, y) => { const u = (x - hx) / rx, v = (y - hy) / ry; return Math.abs(u) > 0.74 && v > -0.3 && v < 0.5; })], { sw: 0.3 });
  } else {
    const [cr, coy, cry] = H.cap;
    const inHair = (x, y) => {
      const u = (x - hx) / rx, v = (y - hy) / ry;
      if ((u / cr) ** 2 + ((v - coy) / cry) ** 2 > 1) return false;
      if (v > H.fr(u)) return true;
      return Math.abs(u) > H.side && v > H.sideV;
    };
    const shapes = [[inHair, [hx - rx * 1.25, hy - ry * 1.2, hx + rx * 1.25, hy + ry * 1.3]]];
    if (H.spikes) shapes.push(shE(hx, hy + ry * 0.2, rx * 1.1, ry * 1.06, (x, y) => y > hy + ry * 0.6)); // 立てた髪: 上を少し高く、てっぺんはまるく
    pt.fill(L.hair, shapes, { sw: 0.24, ring: { cx: pt.X(hx), cy: pt.Y(hy + coy * ry), rx: cr * rx * pt.U, ry: cry * ry * pt.U } });
    if (H.bun) pt.fill(L.hair, [shE(hx, hy + ry * 1.12, rx * 0.42, ry * 0.32)], { line: true, sw: 0.3 });
    if (H.pony) pt.dot(Math.round(pt.X(hx + rx * 1.02)), Math.round(pt.Y(hy + ry * 0.28)), '#d24a5a', 2, 2);
  }
  hats(pt, L, hd, 'front');
  faceFront(pt, L, hd, o);
}

// 顔のパーツ（ドット単位）
function faceFront(pt, L, hd, o) {
  const U = pt.U, cx = Math.round(pt.X(hd.x)), cy = pt.Y(hd.y), rx = hd.rx * U, ry = hd.ry * U;
  const ew = Math.max(1, Math.round(rx * 0.13)), eh = Math.max(2, Math.round(ry * 0.27));
  const ey = Math.round(cy + ry * 0.06);
  const m = Math.round(rx * 0.38 + ew / 2);
  const exs = [cx - m, cx + m - ew];
  const eyes = o.surprise ? 'wide' : o.blink ? 'closed' : o.eyes || L.eyes || 'open';
  const gw = Math.max(1, Math.round(ew * 0.9));
  const lk = o.look || 0; // 話し相手のほうを見る
  for (const ex0 of exs) {
    const ex = ex0 + (eyes === 'open' ? lk : 0);
    if (eyes === 'wide') { pt.dot(ex - 1, ey - 1, '#ffffff', ew + 2, eh + 2); pt.dot(ex, ey, PAX_EYE, ew, eh); } // 目を見ひらく
    else if (eyes === 'open') {
      pt.dot(ex, ey, PAX_EYE, ew, eh);
      if (ew >= 2 && eh >= 3) pt.dot(ex, ey, '#ffffff');
    } else if (eyes === 'down') {
      pt.dot(ex, ey + Math.ceil(eh / 2), PAX_EYE, ew, Math.max(1, Math.floor(eh / 2)));
      pt.dot(ex - 1, ey + Math.ceil(eh / 2) - 1, tones(L.skin).dk, ew + 2, 1);
    } else if (eyes === 'smile') {
      pt.dot(ex - 1, ey + eh - 1, PAX_EYE); pt.dot(ex, ey + eh - 2, PAX_EYE, ew, 1); pt.dot(ex + ew, ey + eh - 1, PAX_EYE);
    } else { // 閉じている
      pt.dot(ex - (ew > 1 ? 1 : 0), ey + eh - 1, PAX_EYE, ew + (ew > 1 ? 2 : 1), 1);
    }
    if (L.brow) pt.dot(ex - 1, ey - Math.max(2, Math.round(ry * 0.2)), tones(L.hair).dk, ew + 2, 1);
    if (L.glasses) {
      const gc = '#4a3f45', g0 = ex - gw - 1, g1 = ex + ew + gw, gy0 = ey - 2, gy1 = ey + eh + 1;
      pt.dot(g0, gy0, gc, g1 - g0 + 1, 1); pt.dot(g0, gy1, gc, g1 - g0 + 1, 1); pt.dot(g0, gy0, gc, 1, gy1 - gy0 + 1); pt.dot(g1, gy0, gc, 1, gy1 - gy0 + 1);
    }
  }
  if (L.glasses) pt.dot(exs[0] + ew + gw + 1, ey - 1, '#4a3f45', Math.max(1, exs[1] - exs[0] - ew - 2 * gw - 2), 1);
  pt.dot(cx, Math.round(cy + ry * 0.36), tones(L.skin).sh); // 鼻（右下に影）
  const my = Math.round(cy + ry * 0.58), mw = 2 * Math.max(1, Math.round(rx * 0.11));
  if (L.mask) {
    const mx0 = Math.round(cx - rx * 0.72), mx1 = Math.round(cx + rx * 0.72) - 1, my0 = Math.round(cy + ry * 0.3), my1 = Math.round(cy + ry * 0.86);
    for (let y = my0; y <= my1; y++) {
      const ins = y === my0 || y === my1 ? 1 : 0;
      pt.dot(mx0 + ins, y, y > my1 - 1 ? '#c9d0db' : '#f2f4f7', mx1 - mx0 + 1 - ins * 2, 1);
    }
    pt.dot(mx0 + 1, Math.round((my0 + my1) / 2), '#dde2ea', mx1 - mx0 - 1, 1);
  } else {
    const mc = '#a2473f';
    if (o.surprise) pt.dot(cx - mw / 2, my - 1, '#6e2a28', mw, mw + 1); // 口を「お」の形に
    else if (o.talk) { pt.dot(cx - mw / 2 + lk, my - 1, '#6e2a28', mw, 2); pt.dot(cx - mw / 2 + lk, my + 1, mc, mw, 1); } // 口をあけてしゃべる
    else pt.dot(cx - mw / 2, my, mc, mw, 1);
    if (L.kind === 'kid' || L.sex === 'f' || L.eyes === 'smile') { pt.dot(cx - mw / 2 - 1, my - 1, mc); pt.dot(cx + mw / 2, my - 1, mc); }
  }
  if (L.blush && !L.mask) {
    const bw = Math.max(2, Math.round(rx * 0.26)), by = Math.round(cy + ry * 0.4), d = Math.round(rx * 0.62 + bw / 2);
    pt.dot(cx - d, by, '#f4a8a0', bw, 1); pt.dot(cx + d - bw, by, '#f4a8a0', bw, 1);
  }
}

// 後ろ向き（立っている人）: 髪・うなじ・耳だけ
function drawHeadBack(pt, L, hd) {
  const { x: hx, y: hy, rx, ry } = hd;
  const H = hairFront(L.hairStyle);
  pt.fill(L.skin, [shE(hx - rx * 0.98, hy - ry * 0.1, rx * 0.17, ry * 0.22), shE(hx + rx * 0.98, hy - ry * 0.1, rx * 0.17, ry * 0.22)], { sw: 0.4, hi: false });
  pt.fill(L.skin, [shE(hx, hy, rx, ry)], { sw: 0.2 });
  const ring = { cx: pt.X(hx), cy: pt.Y(hy + ry * 0.08), rx: rx * 1.12 * pt.U, ry: ry * 1.12 * pt.U };
  if (H.bald) {
    pt.fill(L.hair, [shE(hx, hy, rx * 1.05, ry * 1.02, (x, y) => { const v = (y - hy) / ry; return v > -0.5 + 0.08 * tooth((x - hx) / rx * 3) && v < 0.1; })], { sw: 0.3 });
  } else {
    const nape = H.nape ?? -0.55;
    const [cr, coy, cry] = H.cap;
    pt.fill(L.hair, [[(x, y) => {
      const u = (x - hx) / rx, v = (y - hy) / ry;
      if (v >= coy) return (u / cr) ** 2 + ((v - coy) / cry) ** 2 <= 1;
      // 下のほう: 丸みのある四角（長い髪は肩の下まで）
      const dep = coy - nape + 0.12;
      if ((u / cr) ** 2 + ((coy - v) / dep) ** 4 > 1) return false;
      return v > nape + 0.07 * tooth(u * 3 + 0.25);
    }, [hx - rx * 1.25, hy - ry * 1.25, hx + rx * 1.25, hy + ry * 1.3]],
    ...(H.spikes ? [shE(hx, hy + ry * 0.2, rx * 1.1, ry * 1.06, (x, y) => y > hy + ry * 0.6)] : [])],
    { sw: 0.24, ring });
    if (H.bun) pt.fill(L.hair, [shE(hx, hy + ry * 0.75, rx * 0.45, ry * 0.36)], { line: true, sw: 0.3 });
    if (H.pony) {
      pt.fill(L.hair, [shL(hx, hy + ry * 0.1, hx + rx * 0.05, hy - ry * 1.5, rx * 0.3, rx * 0.12)], { line: true, sw: 0.3 });
      pt.dot(Math.round(pt.X(hx)) - 1, Math.round(pt.Y(hy + ry * 0.12)), '#d24a5a', 3, 2);
    }
  }
  hats(pt, L, hd, 'back');
}

// 横向き（歩いている人。右向きに描き、左へ歩くときは裏返す）
function drawHeadSide(pt, L, hd, o = {}) {
  const { x: hx, y: hy, rx, ry } = hd;
  const st = L.hairStyle;
  const longish = st === 'long' || st === 'bob';
  if (st === 'pony') pt.fill(L.hair, [shL(hx - rx * 1.0, hy + ry * 0.4, hx - rx * 1.45, hy - ry * 0.9, rx * 0.3, rx * 0.14)], { sw: 0.3 });
  pt.fill(L.skin, [shE(hx, hy, rx, ry)], { sw: 0.12 });
  pt.fill(L.skin, [shE(hx + rx * 0.98, hy - ry * 0.28, rx * 0.11, ry * 0.12)], { edge: false, sw: 0 }); // 鼻
  if (st === 'bald') {
    pt.fill(L.hair, [shE(hx, hy, rx * 1.05, ry * 1.02, (x, y) => { const u = (x - hx) / rx, v = (y - hy) / ry; return u < 0.15 && v > -0.4 && v < 0.5; })], { sw: 0.3 });
  } else {
    const nape = longish ? -1.0 : st === 'pony' || st === 'bun' ? -0.35 : -0.55;
    const front = st === 'bun' ? 0.55 : st === 'side' ? 0.3 : 0.34;
    const inHair = (x, y) => {
      const u = (x - hx) / rx, v = (y - hy) / ry;
      if (((u + 0.08) / 1.12) ** 2 + ((v - 0.08) / 1.12) ** 2 > 1) return false;
      if (u < -0.15) return v > nape;
      if (u < 0.3) return v > (longish ? nape : 0.3 - (u + 0.15) * 0.2);
      return v > front + 0.12 * tooth(u * 3 + 0.2) + (st === 'spiky' ? 0.06 : 0);
    };
    const shapes = [[inHair, [hx - rx * 1.3, hy - ry * 1.2, hx + rx * 1.2, hy + ry * 1.3]]];
    if (st === 'spiky') shapes.push(shE(hx - rx * 0.1, hy + ry * 0.2, rx * 1.08, ry * 1.06, (x, y) => y > hy + ry * 0.6));
    pt.fill(L.hair, shapes, { sw: 0.2, ring: { cx: pt.X(hx - rx * 0.08), cy: pt.Y(hy + ry * 0.08), rx: rx * 1.12 * pt.U, ry: ry * 1.12 * pt.U } });
    if (st === 'bun') pt.fill(L.hair, [shE(hx - rx * 0.55, hy + ry * 0.95, rx * 0.4, ry * 0.32)], { line: true, sw: 0.3 });
  }
  if (!longish) pt.fill(L.skin, [shE(hx - rx * 0.12, hy - ry * 0.12, rx * 0.16, ry * 0.22)], { line: true, sw: 0.3, hi: false }); // 耳
  hats(pt, L, hd, 'side');
  // 顔のパーツ
  const U = pt.U, cx = pt.X(hx), cy = pt.Y(hy), prx = rx * U, pry = ry * U;
  const ew = Math.max(1, Math.round(prx * 0.12)), eh = Math.max(2, Math.round(pry * 0.27));
  const ex = Math.round(cx + prx * 0.5), ey = Math.round(cy + pry * 0.06);
  const eyes = o.surprise ? 'wide' : L.eyes || 'open';
  if (eyes === 'wide') { pt.dot(ex - 1, ey - 1, '#ffffff', ew + 2, eh + 2); pt.dot(ex, ey, PAX_EYE, ew, eh); } // 目を見ひらく
  else if (eyes === 'open') { pt.dot(ex, ey, PAX_EYE, ew, eh); if (ew >= 2 && eh >= 3) pt.dot(ex, ey, '#ffffff'); }
  else { pt.dot(ex - 1, ey + eh - 1, PAX_EYE); pt.dot(ex, ey + eh - 2, PAX_EYE, ew, 1); pt.dot(ex + ew, ey + eh - 1, PAX_EYE); }
  if (L.brow || o.surprise) pt.dot(ex - 1, ey - Math.max(2, Math.round(pry * 0.2)) - (o.surprise ? 2 : 0), tones(L.hair).dk, ew + 2, 1); // おどろくと眉が上がる
  if (L.glasses) {
    const gc = '#4a3f45', g0 = ex - 2, g1 = ex + ew + 1, gy0 = ey - 2, gy1 = ey + eh + 1;
    pt.dot(g0, gy0, gc, g1 - g0 + 1, 1); pt.dot(g0, gy1, gc, g1 - g0 + 1, 1); pt.dot(g0, gy0, gc, 1, gy1 - gy0 + 1); pt.dot(g1, gy0, gc, 1, gy1 - gy0 + 1);
    pt.dot(Math.round(cx - prx * 0.1), gy0 + 1, gc, g0 - Math.round(cx - prx * 0.1), 1); // つる
  }
  if (L.mask) {
    for (let y = Math.round(cy + pry * 0.3); y <= Math.round(cy + pry * 0.86); y++) pt.dot(Math.round(cx + prx * 0.3), y, '#f2f4f7', Math.round(prx * 0.78), 1);
    pt.dot(Math.round(cx - prx * 0.1), Math.round(cy + pry * 0.35), '#e6e9ee', Math.round(prx * 0.4), 1);
  } else if (o.surprise) { const mw = Math.max(2, Math.round(prx * 0.16)); pt.dot(Math.round(cx + prx * 0.62), Math.round(cy + pry * 0.5), '#6e2a28', mw, mw + 1); } // 口を「お」の形に
  else pt.dot(Math.round(cx + prx * 0.68), Math.round(cy + pry * 0.58), '#a2473f', Math.max(2, Math.round(prx * 0.14)), 1);
  if (L.blush && !L.mask) pt.dot(Math.round(cx + prx * 0.3), Math.round(cy + pry * 0.4), '#f4a8a0', Math.max(2, Math.round(prx * 0.24)), 1);
}

const isSkirt = (L) => ['skirt', 'pleats', 'midi', 'long'].includes(L.bottomStyle);
const HEM = { suit: 0.68, ol: 0.72, gakuran: 0.68, sailor: 0.74, hoodie: 0.68, cardigan: 0.7, tee: 0.72, vest: 0.7, maid: 0.72 };

// ---- 体（座っている人はこちら向き、立っている人は向こう向き）----
// o: { sit, back, seatH, grab, blink }
function drawFigure(pt, L, o) {
  const sit = o.sit, back = o.back;
  const Hs = o.seatH || 0.3;
  const dy = sit ? Hs + 0.05 - 0.7 : 0;
  const Y = (y) => y + dy;
  const up = (pts) => pts.map(([x, y]) => [x, y + dy]);
  const hk = L.headK;
  const hd = { x: 0, y: 1.34 + dy + (hk - 1) * 0.1, rx: 0.15 * hk, ry: 0.158 * hk };
  let act = sit ? L.sitAct : 'none';
  if (sit && act === 'sleep' && o.wake) act = 'none';          // はっと目覚めた
  if (sit && act === 'sleep') { hd.x += 0.025; hd.y -= 0.02; if (o.nod) { hd.x += 0.03; hd.y -= 0.04; } } // こっくり
  const skirt = isSkirt(L);
  const H = hairFront(L.hairStyle);
  const ts = L.topStyle, hem = HEM[ts] || 0.7;
  const U = pt.U;
  const button = (x, y, c) => { const r = Math.max(1, Math.round(U * 0.012)); pt.dot(Math.round(pt.X(x)) - (r >> 1), Math.round(pt.Y(Y(y))), c, r, r); };
  // こちら向きのとき、後ろにあるもの: 長い髪・ランドセル
  if (!back && H.back && !L.hat) pt.fill(L.hair, [shQ([[-0.17 * hk, hd.y], [0.17 * hk, hd.y], [0.19, hd.y - 0.33], [0.15, hd.y - 0.37], [-0.15, hd.y - 0.37], [-0.19, hd.y - 0.33]])], { sw: 0.18 });
  if (!back && L.randoseru) pt.fill(L.randoseru, [shR(-0.25, Y(0.84), 0.25, Y(1.17))], { sw: 0.22 });
  if (!back && L.cape) pt.fill(L.cape, [shQ([[-0.2, Y(1.16)], [0.2, Y(1.16)], [0.3, sit ? Hs - 0.02 : 0.12], [-0.3, sit ? Hs - 0.02 : 0.12]])], { sw: 0.22 });
  // 脚と靴
  const shoes = (yb, spread) => {
    const pump = L.shoeStyle === 'pump';
    for (const sgn of [-1, 1]) {
      const xa = sgn * (spread + (pump ? 0.03 : 0.0)), w = pump ? 0.085 : 0.125;
      const x0 = sgn < 0 ? xa - w : xa, x1 = sgn < 0 ? xa : xa + w;
      const h = back ? 0.055 : 0.07;
      const pi = pt.fill(L.shoe, [shQ([[x0, yb + h], [x1, yb + h], [x1 + sgn * 0.01, yb], [x0 - (sgn < 0 ? 0.015 : 0), yb]])], { sw: 0.3 });
      if (L.shoeStyle === 'sneaker') pt.hline(pi, Math.min(x0, x1) - 0.02, Math.max(x0, x1) + 0.02, yb + 0.012, L.sole || '#2c2a30');
    }
  };
  if (!sit) {
    if (skirt) {
      for (const s of [-1, 1]) pt.fill(L.legs || L.skin, [shQ([[s * 0.02, 0.62], [s * 0.125, 0.62], [s * 0.105, 0.06], [s * 0.035, 0.06]])], { sw: 0.3 });
      if (L.socks) for (const s of [-1, 1]) pt.fill(L.socks, [shQ([[s * 0.03, 0.3], [s * 0.115, 0.3], [s * 0.105, 0.06], [s * 0.035, 0.06]])], { sw: 0.3 });
      shoes(0, 0.03);
    } else if (L.bottomStyle === 'shorts') {
      for (const s of [-1, 1]) pt.fill(L.skin, [shQ([[s * 0.025, 0.5], [s * 0.125, 0.5], [s * 0.11, 0.06], [s * 0.04, 0.06]])], { sw: 0.3 });
      for (const s of [-1, 1]) pt.fill(L.socks, [shQ([[s * 0.035, 0.2], [s * 0.115, 0.2], [s * 0.11, 0.06], [s * 0.04, 0.06]])], { sw: 0.3 });
      for (const s of [-1, 1]) pt.fill(L.bottom, [shQ([[0, 0.74], [s * 0.17, 0.74], [s * 0.165, 0.46], [s * 0.025, 0.46]])], { sw: 0.28 });
      shoes(0, 0.025);
    } else {
      const legs = [-1, 1].map((s) => pt.fill(L.bottom, [shQ([[s * 0.004, 0.72], [s * 0.165, 0.72], [s * 0.14, 0.07], [s * 0.025, 0.07]])], { sw: 0.3 }));
      if (ts === 'suit') [-1, 1].forEach((s, i) => pt.vline(legs[i], s * 0.085, 0.6, 0.1, tones(L.bottom).sh));
      shoes(0, 0.02);
    }
  } else {
    // 座っているとき: すねは下へ、太ももは手前（短く見える）
    const foot = Math.max(0, Hs - 0.62);
    const lc = skirt ? L.legs || L.skin : L.bottomStyle === 'shorts' ? L.skin : L.bottom;
    for (const s of [-1, 1]) pt.fill(lc, [shQ([[s * 0.03, Hs], [s * 0.15, Hs], [s * 0.135, foot + 0.06], [s * 0.04, foot + 0.06]])], { sw: 0.3 });
    if (L.socks) for (const s of [-1, 1]) { const t = Math.min(Hs - 0.04, foot + 0.27); pt.fill(L.socks, [shQ([[s * 0.037, t], [s * 0.143, t], [s * 0.135, foot + 0.06], [s * 0.04, foot + 0.06]])], { sw: 0.3 }); }
    shoes(foot, 0.03);
  }
  // スカート（立っているとき）
  if (!sit && skirt) {
    if (L.bottomStyle === 'skirt') pt.fill(L.bottom, [shQ([[-0.165, 0.76], [0.165, 0.76], [0.17, 0.44], [-0.17, 0.44]])], { sw: 0.28 });
    if (L.bottomStyle === 'midi') pt.fill(L.bottom, [shQ([[-0.165, 0.76], [0.165, 0.76], [0.225, 0.34], [-0.225, 0.34]])], { sw: 0.28 });
    if (L.bottomStyle === 'long') pt.fill(L.bottom, [shQ([[-0.17, 0.76], [0.17, 0.76], [0.2, 0.16], [-0.2, 0.16]])], { sw: 0.28 });
    if (L.bottomStyle === 'pleats') {
      const sk = pt.fill(L.bottom, [shQ([[-0.17, 0.78], [0.17, 0.78], [0.225, 0.47], [-0.225, 0.47]])], { sw: 0.26 });
      for (let k = -2; k <= 2; k++) for (let y = Math.round(pt.Y(0.74)); y < pt.Y(0.47); y++) {
        const t = (y - pt.Y(0.78)) / (pt.Y(0.47) - pt.Y(0.78));
        pt.dotOn(sk, Math.round(pt.X(k * 0.07 * (1 + 0.3 * t))), y, tones(L.bottom).dk);
      }
    }
  }
  // 首・胴
  pt.fill(L.skin, [shR(-0.045, Y(1.08), 0.045, Y(1.24))], { sw: 0.3 });
  const torsoPts = (hm, w = 1) => up([[-0.07, 1.18], [-0.165 * w, 1.165], [-0.2 * w, 1.12], [-0.19 * w, 0.95], [-0.165 * w, hm], [0.165 * w, hm], [0.19 * w, 0.95], [0.2 * w, 1.12], [0.165 * w, 1.165], [0.07, 1.18]]);
  if (ts === 'vest') pt.fill(L.sleeve, [shQ(torsoPts(0.72))], { sw: 0.26 });
  const torso = pt.fill(L.top, [shQ(torsoPts(hem, ts === 'hoodie' ? 1.05 : 1))], { sw: 0.26 });
  const dk = tones(L.top).dk;
  if (back) {
    // 背中: 縫い目・襟・フード・ランドセル
    if (ts === 'suit' || ts === 'ol' || ts === 'gakuran') {
      pt.vline(torso, 0, Y(1.15), Y(hem), tones(L.top).sh);
      if (ts === 'suit') pt.vline(torso, 0, Y(0.82), Y(hem), dk);
      pt.fill(ts === 'gakuran' ? L.top : L.shirt, [shQ(up([[-0.075, 1.2], [0.075, 1.2], [0.07, 1.16], [-0.07, 1.16]]))], { line: true, sw: 0.2 });
      if (ts === 'gakuran') pt.dot(Math.round(pt.X(-0.06)), Math.round(pt.Y(Y(1.205))), '#ffffff', Math.round(0.12 * U), 1);
    } else if (ts === 'sailor') {
      const col = pt.fill(L.collar, [shQ(up([[-0.19, 1.15], [-0.07, 1.19], [0.07, 1.19], [0.19, 1.15], [0.18, 0.95], [-0.18, 0.95]]))], { line: true, sw: 0.18 });
      pt.hline(col, -0.155, 0.155, Y(0.985), '#ffffff'); pt.vline(col, -0.155, Y(1.14), Y(0.985), '#ffffff'); pt.vline(col, 0.15, Y(1.14), Y(0.985), '#ffffff');
    } else if (ts === 'hoodie') {
      pt.fill(L.top, [shQ(up([[-0.13, 1.19], [0.13, 1.19], [0.11, 1.02], [0, 0.96], [-0.11, 1.02]]))], { line: true, sw: 0.3 });
    } else if (ts === 'cardigan' || ts === 'vest') pt.vline(torso, 0, Y(1.15), Y(hem), tones(L.top).sh);
    else if (ts === 'tee') pt.fill(tones(L.top).sh, [shE(0, Y(1.185), 0.06, 0.015)], { line: true, sw: 0 });
    if (L.randoseru) {
      pt.fill(L.randoseru, [shQ(up([[-0.2, 1.17], [0.2, 1.17], [0.21, 0.8], [0.18, 0.77], [-0.18, 0.77], [-0.21, 0.8]]))], { sw: 0.22 });
      const lid = pt.fill(L.randoseru, [shQ(up([[-0.2, 1.17], [0.2, 1.17], [0.2, 0.92], [0.16, 0.88], [-0.16, 0.88], [-0.2, 0.92]]))], { line: true, sw: 0.22 });
      button(0, 0.9, '#d8d8d8'); pt.hline(lid, -0.18, 0.18, Y(1.12), tones(L.randoseru).hi);
    }
    if (ts === 'maid') { // エプロンの後ろのリボン
      pt.fill('#ffffff', [shE(-0.07, Y(hem + 0.05), 0.07, 0.04), shE(0.07, Y(hem + 0.05), 0.07, 0.04)], { line: true, sw: 0.25 });
      pt.fill('#ffffff', [shL(0, Y(hem + 0.05), -0.05, Y(hem - 0.12), 0.018), shL(0, Y(hem + 0.05), 0.05, Y(hem - 0.12), 0.018)], { line: true, sw: 0.2 });
    }
    if (L.tail) pt.fill(L.top, [shE(0, Y(hem + 0.02), 0.06, 0.055)], { line: true, sw: 0.3 });
    if (L.cape) {
      const cp = pt.fill(L.cape, [shQ([[-0.21, 1.17], [0.21, 1.17], [0.29, 0.12], [-0.29, 0.12]])], { sw: 0.24 });
      for (const fx of [-0.12, 0.0, 0.12]) pt.vline(cp, fx, 1.0, 0.14, tones(L.cape).sh);
    }
    if (H.back && !L.hat && !L.hood) pt.fill(L.hair, [shQ([[-0.17 * hk, hd.y], [0.17 * hk, hd.y], [0.175, hd.y - 0.3], [0.15, hd.y - 0.37], [0.09, hd.y - 0.41], [0, hd.y - 0.38], [-0.09, hd.y - 0.41], [-0.15, hd.y - 0.37], [-0.175, hd.y - 0.3]])], { sw: 0.22 });
  } else if (ts === 'suit' || ts === 'ol') {
    pt.fill(L.shirt, [shQ(up([[-0.075, 1.185], [0.075, 1.185], [0, ts === 'suit' ? 0.9 : 0.94]]))], { sw: 0.2 });
    if (ts === 'suit') pt.fill(L.tie, [shQ(up([[-0.02, 1.175], [0.02, 1.175], [0.013, 1.14], [0.03, 0.95], [0, 0.915], [-0.03, 0.95], [-0.013, 1.14]]))], { sw: 0.3 });
    const lap = [[-0.08, 1.19], [-0.008, 0.9], [-0.08, 1.03], [-0.115, 1.12]];
    for (const s of [-1, 1]) pt.fill(L.top, [shQ(up(s < 0 ? lap : mirror(lap)))], { line: true, sw: 0.3 });
    pt.vline(torso, 0, Y(0.9), Y(hem), dk);
    button(0.02, 0.84, dk); if (ts === 'suit') { button(0.02, 0.76, dk); pt.hline(torso, 0.08, 0.16, Y(0.78), dk); }
  } else if (ts === 'gakuran') {
    pt.fill(L.top, [shR(-0.06, Y(1.14), 0.06, Y(1.215))], { line: true, sw: 0.3 });
    pt.dot(Math.round(pt.X(-0.05)), Math.round(pt.Y(Y(1.215))), '#ffffff', Math.round(0.1 * U), 1);
    pt.vline(torso, 0, Y(1.14), Y(hem), dk);
    for (let y = 1.1; y > hem + 0.04; y -= 0.09) button(0.01, y, '#e2b84a');
  } else if (ts === 'sailor') {
    const col = pt.fill(L.collar, [shQ(up([[-0.2, 1.13], [-0.075, 1.185], [0, 1.0], [0.075, 1.185], [0.2, 1.13], [0.17, 1.06], [0, 0.93], [-0.17, 1.06]]))], { line: true, sw: 0.2 });
    for (const s of [-1, 1]) for (let t = 0.05; t < 0.95; t += 0.5 / U / 0.2) pt.dotOn(col, Math.round(pt.X(s * 0.17 * (1 - t))), Math.round(pt.Y(Y(1.09 - 0.13 * t))), '#ffffff');
    pt.fill(L.scarf, [shQ(up([[-0.06, 1.0], [0.06, 1.0], [0.0, 0.88]])), shE(0, Y(0.99), 0.03, 0.025)], { sw: 0.3 });
  } else if (ts === 'hoodie') {
    pt.fill(L.top, [shE(0, Y(1.18), 0.11, 0.045)], { line: true, sw: 0.3 });
    for (const s of [-1, 1]) pt.dot(Math.round(pt.X(s * 0.035)), Math.round(pt.Y(Y(1.15))), '#f4f4f4', 1, Math.round(0.12 * U));
    pt.fill(L.top, [shQ(up([[-0.12, 0.88], [0.12, 0.88], [0.13, 0.74], [-0.13, 0.74]]))], { line: true, sw: 0.3 });
  } else if (ts === 'cardigan') {
    pt.fill(L.shirt, [shQ(up([[-0.06, 1.18], [0.06, 1.18], [0.045, hem], [-0.045, hem]]))], { sw: 0.2 });
    const fr = [[-0.07, 1.18], [-0.04, 1.0], [-0.03, hem], [-0.1, hem], [-0.1, 1.15]];
    for (const s of [-1, 1]) pt.fill(L.top, [shQ(up(s < 0 ? fr : mirror(fr)))], { line: true, sw: 0.25 });
  } else if (ts === 'tee') {
    pt.fill(tones(L.top).sh, [shE(0, Y(1.18), 0.07, 0.025)], { line: true, sw: 0 });
  } else if (ts === 'maid') {
    pt.fill('#ffffff', [shE(0, Y(1.17), 0.09, 0.03)], { line: true, sw: 0.2 });                       // 白いえり
    pt.fill('#ffffff', [shQ(up([[-0.1, 1.06], [0.1, 1.06], [0.13, hem], [-0.13, hem]]))], { sw: 0.18 }); // エプロンの胸当て
    pt.fill('#d24a5a', [shE(0, Y(1.13), 0.03, 0.02)], { sw: 0 });                                         // 胸のリボン
  } else if (ts === 'vest') {
    pt.fill(L.sleeve, [shQ(up([[-0.07, 1.18], [0.07, 1.18], [0, 1.02]]))], { sw: 0.2 });
    for (let y = 0.98; y > hem + 0.03; y -= 0.08) button(0.0, y, dk);
  }
  if (!back && L.hood) pt.fill('#fff4dc', [shE(0, Y(0.86), 0.1, 0.12)], { sw: 0.2, line: true }); // 着ぐるみのおなか
  if (!back && L.randoseru) {
    const st = [[-0.13, 1.17], [-0.08, 1.17], [-0.085, 0.86], [-0.13, 0.86]];
    for (const s of [-1, 1]) { pt.fill(L.randoseru, [shQ(up(s < 0 ? st : mirror(st)))], { sw: 0.3 }); button(s * 0.107, 0.95, '#d8d8d8'); }
  }
  if (L.bag === 'sports') pt.fill(L.bagC, [back ? shL(0.16, Y(1.14), -0.19, Y(0.78), 0.016) : shL(-0.16, Y(1.14), 0.19, Y(0.78), 0.016)], { sw: 0 });
  if (L.bag === 'shoulder' && !sit) pt.fill('#5a4038', [shL(0.15, Y(1.15), 0.22, Y(0.8), 0.009)], { sw: 0, edge: false });
  // 太もも（座っているとき）
  if (sit) {
    if (skirt) {
      const sk = pt.fill(L.bottom, [shQ([[-0.19, Hs + 0.15], [0.19, Hs + 0.15], [0.2, Hs - 0.07], [-0.2, Hs - 0.07]])], { sw: 0.26 });
      if (L.bottomStyle === 'pleats') for (let k = -2; k <= 2; k++) pt.vline(sk, k * 0.075, Hs + 0.12, Hs - 0.07, tones(L.bottom).dk);
    } else {
      const th = [[-0.18, Hs + 0.13], [-0.005, Hs + 0.13], [-0.01, Hs - 0.04], [-0.165, Hs - 0.04]];
      for (const s of [-1, 1]) pt.fill(L.bottom, [shQ(s < 0 ? th : mirror(th))], { sw: 0.28 });
    }
    if (ts === 'maid') pt.fill('#ffffff', [shR(-0.15, Hs + 0.15, 0.15, Hs - 0.05)], { sw: 0.18 });
    if (act === 'lap') {
      pt.fill(L.bagC, [shR(-0.2, Hs + 0.07, 0.2, Hs + 0.25)], { sw: 0.2 });
      pt.fill('#c9a227', [shR(-0.02, Hs + 0.2, 0.02, Hs + 0.22)], { sw: 0, edge: false });
    }
    if (act === 'read') {
      pt.fill(L.kind === 'elder' ? '#8a5a3c' : '#e9e4d8', [shQ([[-0.13, Y(0.86)], [0.13, Y(0.86)], [0.12, Y(1.02)], [-0.12, Y(1.02)]])], { sw: 0.15 });
      pt.fill('#f6f2e6', [shR(-0.11, Y(0.9), 0.11, Y(1.0))], { sw: 0.1, edge: false });
      for (let y = Math.round(pt.Y(Y(0.985))); y < pt.Y(Y(0.91)); y += 2) pt.dot(Math.round(pt.X(-0.09)), y, '#b9b3a6', Math.round(0.07 * U), 1);
    }
  }
  // 腕（肩 → 肘 → 手）
  const short = ts === 'tee';
  const arm = (s, ex, ey, hx, hy) => {
    const sx = s * 0.19, sy = Y(1.11);
    if (short) {
      pt.fill(L.sleeve, [shL(sx, sy, sx + (ex - sx) * 0.55, sy + (ey - sy) * 0.55, 0.056, 0.052)], { sw: 0.3 });
      pt.fill(L.skin, [shL(sx + (ex - sx) * 0.55, sy + (ey - sy) * 0.55, ex, ey, 0.04), shL(ex, ey, hx, hy, 0.038, 0.035)], { sw: 0.3 });
    } else {
      pt.fill(L.sleeve, [shL(sx, sy, ex, ey, 0.052, 0.048), shL(ex, ey, hx + (ex - hx) * 0.12, hy + (ey - hy) * 0.12, 0.048, 0.043)], { sw: 0.3 });
      if (ts === 'suit' || ts === 'ol') pt.fill(L.shirt, [shL(hx + (ex - hx) * 0.15, hy + (ey - hy) * 0.15, hx + (ex - hx) * 0.06, hy + (ey - hy) * 0.06, 0.04)], { sw: 0.2 });
    }
    pt.fill(L.skin, [shE(hx, hy, 0.042 * hk ** 0.5, 0.048 * hk ** 0.5)], { sw: 0.3, hi: false });
  };
  let phoneAt = null;
  if (sit) {
    if (act === 'phone') { arm(-1, -0.22, Y(0.9), -0.04, Y(0.93)); arm(1, 0.22, Y(0.9), 0.04, Y(0.93)); phoneAt = [0, Y(0.97)]; }
    else if (act === 'read') { arm(-1, -0.22, Y(0.88), -0.12, Y(0.94)); arm(1, 0.22, Y(0.88), 0.12, Y(0.94)); }
    else if (act === 'lap') { arm(-1, -0.22, Y(0.9), -0.1, Hs + 0.23); arm(1, 0.22, Y(0.9), 0.1, Hs + 0.23); }
    else { arm(-1, -0.215, Y(0.9), -0.09, Hs + 0.11); arm(1, 0.215, Y(0.9), 0.09, Hs + 0.11); }
  } else {
    arm(-1, -0.215, 0.92, -0.205, 0.71);
    if (L.bag === 'brief' || L.bag === 'hand') {
      const w = L.bag === 'brief' ? 0.12 : 0.1;
      pt.fill(L.bagC, [shR(-0.205 - w, 0.42, -0.205 + w, 0.66)], { sw: 0.22 });
      pt.fill(L.bag === 'brief' ? '#c9a227' : tones(L.bagC).dk, [shR(-0.215, 0.6, -0.195, 0.63)], { sw: 0, edge: false });
    }
    if (o.grab) arm(1, 0.27, Math.min(o.grab - 0.12, 1.12 + (o.grab - 1.12) * 0.55), 0.2, o.grab); // 右手でつり革
    else arm(1, 0.215, 0.92, 0.205, 0.71);
    if (L.bag === 'shoulder') {
      pt.fill(L.bagC, [shQ([[0.17, 0.82], [0.29, 0.82], [0.31, 0.62], [0.15, 0.62]])], { sw: 0.24 });
      pt.fill(L.bagC, [shQ([[0.17, 0.82], [0.29, 0.82], [0.28, 0.74], [0.18, 0.74]])], { line: true, sw: 0.2 });
    }
    if (L.cane) pt.fill('#6b4a32', [shL(-0.21, 0.7, -0.24, 0.0, 0.012)], { sw: 0, edge: false });
  }
  if (phoneAt) pt.fill('#2c2a30', [shR(phoneAt[0] - 0.04, phoneAt[1] - 0.05, phoneAt[0] + 0.04, phoneAt[1] + 0.05)], { sw: 0, hi: false });
  // 頭
  if (back && o.turn) { // ふり向いて横顔（おどろいた顔）。忍者のいるほうを向く（左なら裏返して描く）
    pt.flip = !!o.turnL;
    drawHeadSide(pt, L, { ...hd, x: hd.x + 0.02 }, { surprise: true });
    pt.flip = false;
  }
  else if (back) drawHeadBack(pt, L, hd);
  else drawHeadFront(pt, L, hd, { blink: o.blink && !o.wake, look: o.look, talk: o.talk, surprise: o.surprise,
    eyes: (phoneAt || act === 'read') && !o.up ? 'down' : sit && act === 'sleep' ? 'closed' : o.wake ? 'open' : null });
}

// ---- 横向きで歩く（右向き）。f: 歩きのコマ（0〜5） ----
function drawWalk(pt, L, f) {
  const ph = (f / 6) * Math.PI * 2;
  const lean = L.kind === 'elder' ? 0.1 : 0.03;
  const leg = (side) => {
    const sgn = side ? -1 : 1;
    const th = 0.42 * Math.sin(ph) * sgn;
    const bend = 0.7 * Math.max(0, Math.cos(ph) * sgn);
    const kx = Math.sin(th) * 0.34, ky = -Math.cos(th) * 0.34;
    const sa = th - bend;
    return { kx, ky, ax: kx + Math.sin(sa) * 0.33, ay: ky - Math.cos(sa) * 0.33 };
  };
  const lg = [leg(0), leg(1)];
  const hipY = 0.065 - Math.min(lg[0].ay, lg[1].ay);
  const T = (x, y) => [x + lean * (y - hipY), y]; // 上半身を前へ少し傾ける
  const dy = hipY - 0.7;
  const P = (pts) => pts.map(([x, y]) => T(x, y + dy));
  const skirt = isSkirt(L);
  const legC = skirt ? L.legs || L.skin : L.bottom;
  const hk = L.headK;
  const hd = { x: 0.035 + lean * 0.64, y: 1.34 + dy + (hk - 1) * 0.1, rx: 0.15 * hk, ry: 0.158 * hk };
  const sh = T(0.0, 1.1 + dy);
  const drawArm = (i, far) => {
    const a = (i ? 0.45 : -0.45) * Math.sin(ph) * (L.cane && !far ? 0.3 : 1);
    const ex = sh[0] + Math.sin(a) * 0.26, ey = sh[1] - Math.cos(a) * 0.26;
    const fa = a + 0.35;
    const hx = ex + Math.sin(fa) * 0.24, hy = ey - Math.cos(fa) * 0.24;
    const opt = { sw: 0.3, far };
    if (L.topStyle === 'tee') { pt.fill(L.sleeve, [shL(sh[0], sh[1], (sh[0] + ex) / 2, (sh[1] + ey) / 2, 0.055)], opt); pt.fill(L.skin, [shL((sh[0] + ex) / 2, (sh[1] + ey) / 2, ex, ey, 0.04), shL(ex, ey, hx, hy, 0.037)], opt); }
    else pt.fill(L.sleeve, [shL(sh[0], sh[1], ex, ey, 0.052, 0.047), shL(ex, ey, hx, hy, 0.047, 0.042)], opt);
    pt.fill(L.skin, [shE(hx + Math.sin(fa) * 0.03, hy - Math.cos(fa) * 0.03, 0.042, 0.046)], { sw: 0.2, far, hi: false, edge: false });
    return [hx + Math.sin(fa) * 0.04, hy - Math.cos(fa) * 0.04];
  };
  const drawLeg = (i, far) => {
    const g = lg[i], kx = g.kx, ky = hipY + g.ky, ax = g.ax, ay = hipY + g.ay;
    const opt = { sw: 0.3, far };
    pt.fill(L.bottomStyle === 'shorts' ? L.skin : legC, [shL(0, hipY, kx, ky, 0.065, 0.05), shL(kx, ky, ax, ay, 0.05, 0.04)], opt);
    if (L.bottomStyle === 'shorts') pt.fill(L.bottom, [shL(0, hipY, g.kx * 0.55, hipY + g.ky * 0.55, 0.075)], opt);
    if (L.socks) pt.fill(L.socks, [shL(kx + (ax - kx) * 0.45, ky + (ay - ky) * 0.45, ax, ay, 0.047, 0.042)], opt);
    const toe = L.shoeStyle === 'pump' ? 0.09 : 0.12;
    const si = pt.fill(L.shoe, [shQ([[ax - 0.05, ay + 0.03], [ax + 0.035, ay + 0.03], [ax + toe, ay - 0.025], [ax + toe, ay - 0.06], [ax - 0.055, ay - 0.06]])], { sw: 0.2, far });
    if (L.shoeStyle === 'sneaker') pt.hline(si, ax - 0.06, ax + 0.13, ay - 0.05, L.sole || '#2c2a30');
  };
  if (L.hairStyle === 'long' && !L.hat && !L.hood) pt.fill(L.hair, [shQ([[hd.x - 0.16, hd.y], [hd.x - 0.02, hd.y], [hd.x - 0.04, hd.y - 0.36], [hd.x - 0.15, hd.y - 0.38], [hd.x - 0.19, hd.y - 0.3]])], { sw: 0.2 });
  if (L.cape) pt.fill(L.cape, [shQ(P([[-0.1, 1.17], [0.02, 1.17], [-0.12, 0.14], [-0.36 - 0.04 * Math.sin(ph), 0.2]]))], { sw: 0.24 }); // マントは後ろへなびく
  if (L.tail) pt.fill(L.top, [shE(...T(-0.13, hipY + 0.12), 0.055, 0.05)], { line: true, sw: 0.3 });
  drawArm(1, true);
  drawLeg(1, true);
  drawLeg(0, false);
  if (skirt) {
    const len = { skirt: 0.3, pleats: 0.3, midi: 0.42, long: 0.6 }[L.bottomStyle];
    const sw = 0.04 * Math.sin(ph);
    pt.fill(L.bottom, [shQ([[-0.11, hipY + 0.08], [0.11, hipY + 0.08], [0.14 + sw, hipY + 0.06 - len], [-0.15 + sw, hipY + 0.06 - len]])], { sw: 0.26 });
  } else if (L.bottomStyle === 'shorts') pt.fill(L.bottom, [shQ([[-0.11, hipY + 0.06], [0.1, hipY + 0.06], [0.1, hipY - 0.1], [-0.11, hipY - 0.1]])], { sw: 0.28 });
  else pt.fill(L.bottom, [shQ([[-0.105, hipY + 0.06], [0.1, hipY + 0.06], [0.09, hipY - 0.08], [-0.1, hipY - 0.08]])], { sw: 0.28, edge: false });
  pt.fill(L.skin, [shQ(P([[-0.035, 1.08], [0.045, 1.08], [0.045, 1.24], [-0.035, 1.24]]))], { sw: 0.3 });
  const ts = L.topStyle, hem = HEM[ts] - 0.02;
  if (ts === 'hoodie') pt.fill(L.top, [shE(...T(-0.075, 1.19 + dy), 0.06, 0.06)], { sw: 0.3 });
  if (L.randoseru) pt.fill(L.randoseru, [shQ(P([[-0.25, 1.17], [-0.085, 1.17], [-0.085, 0.84], [-0.25, 0.84]]))], { sw: 0.2 });
  pt.fill(L.top, [shQ(P([[-0.085, 1.175], [0.06, 1.175], [0.11, 1.08], [0.105, 0.92], [0.095, hem], [-0.105, hem], [-0.115, 0.95], [-0.11, 1.12]]))], { sw: 0.24 });
  const r = Math.max(1, Math.round(pt.U * 0.012));
  if (ts === 'suit' || ts === 'ol') {
    pt.fill(L.shirt, [shQ(P([[0.05, 1.18], [0.105, 1.1], [0.102, 0.93], [0.07, 1.0]]))], { sw: 0, line: true });
    if (ts === 'suit') pt.fill(L.tie, [shQ(P([[0.08, 1.15], [0.105, 1.1], [0.105, 0.94], [0.088, 0.96]]))], { sw: 0, line: true });
  }
  if (ts === 'gakuran') {
    pt.fill(L.top, [shQ(P([[-0.07, 1.14], [0.06, 1.14], [0.06, 1.21], [-0.07, 1.21]]))], { line: true, sw: 0.3 });
    for (let y = 1.08; y > hem + 0.04; y -= 0.09) { const [x, yy] = T(0.095, y + dy); pt.dot(Math.round(pt.X(x)), Math.round(pt.Y(yy)), '#e2b84a', r, r); }
  }
  if (ts === 'sailor') {
    pt.fill(L.collar, [shQ(P([[-0.115, 1.17], [0.0, 1.17], [-0.02, 1.0], [-0.115, 1.0]]))], { line: true, sw: 0.2 });
    pt.fill(L.scarf, [shQ(P([[0.07, 1.04], [0.115, 1.06], [0.1, 0.94]]))], { sw: 0.2 });
  }
  if (ts === 'cardigan') pt.fill(L.shirt, [shQ(P([[0.06, 1.17], [0.105, 1.08], [0.1, hem], [0.085, hem], [0.08, 1.0]]))], { sw: 0, line: true });
  if (ts === 'maid') pt.fill('#ffffff', [shQ(P([[0.05, 1.06], [0.11, 1.04], [0.15, hipY - 0.22 - dy], [0.06, hipY - 0.22 - dy]]))], { sw: 0.18, line: true }); // エプロン
  if (L.hood) pt.fill('#fff4dc', [shE(...T(0.08, 0.86 + dy), 0.035, 0.1)], { sw: 0, line: true });
  if (L.bag === 'shoulder' || L.bag === 'sports') {
    const [bx, by] = T(-0.04, 0.78 + dy);
    pt.fill(L.bagC, [shQ([[bx - 0.1, by + 0.1], [bx + 0.08, by + 0.1], [bx + 0.09, by - 0.12], [bx - 0.11, by - 0.12]])], { sw: 0.24 });
    pt.fill(L.bag === 'sports' ? L.bagC : '#5a4038', [shL(...T(-0.02, 1.15 + dy), bx, by + 0.1, L.bag === 'sports' ? 0.016 : 0.009)], { sw: 0, edge: L.bag === 'sports' });
  }
  const hand = drawArm(0, false);
  if (L.bag === 'brief' || L.bag === 'hand') {
    const w = L.bag === 'brief' ? 0.15 : 0.12;
    pt.fill(L.bagC, [shR(hand[0] - w, hand[1] - 0.04, hand[0] + w * 0.8, hand[1] - 0.24)], { sw: 0.2 });
  }
  if (L.cane) pt.fill('#6b4a32', [shL(hand[0], hand[1], hand[0] + 0.1, 0.0, 0.012)], { sw: 0, edge: false });
  drawHeadSide(pt, L, hd);
}

// 1 人ぶんのドット絵（u = 1m あたりのドット）。pose: 'sit' | 'stand'（こちら向き）| 'back'（向こう向き）| 'walk'
function paxSprite(L, pose, u, seatH, grabY, frame = 0, blink = false, v = '') {
  const key = [L.seed, L.kind, pose, frame, blink ? 1 : 0, Math.round(u), Math.round(seatH * 100), L.kind === 'kid' ? 0 : Math.round((grabY || 0) * 100), v].join('|');
  if (paxCache.has(key)) return paxCache.get(key);
  const s = L.scale;
  const U = (u * s) / PAX_RES;
  const grab = grabY && L.kind !== 'kid' ? grabY / s : 0; // 子どもはつり革に手が届かない
  const W = 2 * Math.ceil(0.5 * U) + 8, H = Math.ceil(Math.max(L.witch || L.hoodEars === 'rabbit' ? 1.98 : 1.85, grab + 0.12) * U) + 6;
  const pt = new Painter(W, H, U, W / 2, H - 3);
  if (pose === 'walk') drawWalk(pt, L, frame);
  else drawFigure(pt, L, { sit: pose === 'sit', back: pose === 'back', seatH: seatH / s, grab, blink,
    look: v.includes('L') ? -1 : v.includes('R') ? 1 : 0, talk: v.includes('t'), nod: v.includes('n'), wake: v.includes('w'), up: v.includes('u'),
    surprise: v.includes('s'), turn: v.includes('T'), turnL: v.includes('<') });
  const sp = { c: pt.render(), ax: W / 2, ay: H - 3, res: PAX_RES };
  if (paxCache.size > 800) paxCache.clear();
  paxCache.set(key, sp);
  return sp;
}

// ---- 車内の場所: 左右の座席、つり革の下、ドアの前 ----
function paxSlots() {
  const S = SCN, X = S.X, Y = S.Y;
  const u = (S.winH0 || (S.SW.y1 - S.SW.y0)) / 1.0; // 側窓の高さ ≒ 1m（縦持ちで窓が伸びても元の高さ）
  const fl = S.floorY, seatTop = Y(0.77);
  const seatW = 0.46 * u;
  const seats = [], bench = [];
  for (let x = X(0.445) - seatW * 0.55, i = 0; x > seatW * 0.3; x -= seatW, i++) { seats.push(Math.round(x)); bench.push(['L', i]); }
  const visR = S.visR || LW; // その右は地図の下
  for (let x = X(0.895) + seatW * 0.55, i = 0; x < visR - seatW * 0.3; x += seatW, i++) { seats.push(Math.round(x)); bench.push(['R', i]); }
  const winH = S.winH0 || (S.SW.y1 - S.SW.y0);
  const grab = (st) => (fl - (st.y + Math.round(winH * 0.3) + Math.round(winH * 0.075))) / u;
  // 立つ場所: 1 本おきのつり革の下（手がつり革に来るよう体は少し左）と、ドアの前
  const stands = [];
  const left = STRAPS.filter((t) => t.x < X(0.445)), right = STRAPS.filter((t) => t.x > X(0.88));
  left.filter((t, i) => (left.length - 1 - i) % 2 === 0).forEach((t) => { if (t.x > 0.15 * u) stands.push({ x: t.x, grabY: grab(t) }); });
  right.filter((t, i) => i % 2 === 0).forEach((t) => { if (t.x < visR - 0.3 * u) stands.push({ x: t.x, grabY: grab(t) }); });
  const dw = S.DR.x1 - S.DR.x0;
  stands.push({ x: Math.round(S.DR.x0 + dw * 0.27), grabY: 0, door: true }, { x: Math.round(S.DR.x0 + dw * 0.73), grabY: 0, door: true });
  return { u, fl, seatH: (fl - seatTop) / u, seats, bench, stands, W: visR };
}

function paxNew(kind, r) { return { id: ++paxId, L: paxLook(kind, r), x: 0, tx: 0, mode: 'sit', slot: -1, state: 'in', t: 0, dir: 1, bt: 1 + hash(paxId, 77) * 4 }; }

function paxFree(sl, mode) {
  const used = new Set(PAX.filter((p) => p.mode === mode && p.state !== 'out' && p.state !== 'rise').map((p) => p.slot));
  if (mode === 'sit') for (const p of PAX) if (p.nextSeat !== undefined) used.add(p.nextSeat); // 前に立っていた人が座る予定の席
  const list = mode === 'sit' ? sl.seats : sl.stands;
  const free = [];
  for (let i = 0; i < list.length; i++) if (!used.has(i)) free.push(i);
  return free;
}

// 座る席を選ぶ（n 人で並んで）: まず座席のはし（袖仕切りのとなり）→ ひとつ空けて座れる席 → となり
function pickSeats(sl, n, seed) {
  const free = new Set(paxFree(sl, 'sit'));
  const at = (b, i) => sl.bench.findIndex((q) => q[0] === b && q[1] === i);
  const isFree = (b, i) => { const k = at(b, i); return k < 0 ? true : free.has(k); }; // 画面の外の席は空いているとみなす
  let best = null, bestScore = -1;
  for (let k = 0; k < sl.seats.length; k++) {
    const [b, i] = sl.bench[k];
    const ks = []; for (let j = 0; j < n; j++) ks.push(at(b, i + j));
    if (ks.some((q) => q < 0 || !free.has(q))) continue;
    let score;
    if (i === 0) score = 3;                                                     // はし
    else if (isFree(b, i - 1) && isFree(b, i + n)) score = 2 + (!isFree(b, i - 2) || !isFree(b, i + n + 1) ? 0.5 : 0); // ひとつ空けて（となりの人とひとつ空けるのが先）
    else score = 1;                                                             // となり
    score += hash(seed, k, PAX_SEED) * 0.1;                                     // 同じ順位ならばらばらに
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return best;
}

function slotX(sl, p) {
  if (p.mode === 'sit') return sl.seats[p.slot];
  const st = sl.stands[p.slot];
  return st.grabY && p.L.kind !== 'kid' ? st.x - Math.round(0.2 * sl.u * p.L.scale) : st.x;
}

function paxBoard(sl, n, seed) {
  let k = 0, made = 0;
  for (let i = 0; made < n && i < n * 3; i++) {
    const r = hash(seed * 7 + i, paxId + 3);
    const kind = PAX_KINDS[Math.floor(r * PAX_KINDS.length) % PAX_KINDS.length];
    const group = kind === 'couple' ? ['man', 'woman'] : kind === 'friends' ? ['student', 'student'] : [kind];
    let mode = 'sit', start = pickSeats(sl, group.length, seed + i);
    let free = [];
    if (start === null) {
      mode = 'stand'; free = paxFree(sl, 'stand');
      if (!free.length) return; // 満員
      if (free.length < group.length) continue;
      start = free[Math.floor(hash(seed, i + 9) * free.length)];
      if (group.length === 2) { const pair = free.find((f) => free.includes(f + 1)); if (pair === undefined) continue; start = pair; }
    }
    group.forEach((kd, j) => {
      const p = paxNew(kd, r + j * 0.31);
      p.mode = mode; p.slot = start + j;
      p.tx = slotX(sl, p);
      // 画面の左右どちらかの外から歩いてくる（行き先に近いほうから来ることが多い）
      const nearLeft = p.tx < sl.W / 2;
      const fromLeft = hash(seed, i + 41) < (nearLeft ? 0.75 : 0.25);
      if (j === 0) p.fromLeft = fromLeft; else p.fromLeft = PAX[PAX.length - 1].fromLeft;
      p.dir = p.fromLeft ? 1 : -1;
      p.x = p.fromLeft ? -0.5 * sl.u - j * 0.45 * sl.u : sl.W + 0.5 * sl.u + j * 0.45 * sl.u;
      p.state = 'walk';
      p.t = -0.5 - 0.65 * k - j * 0.05;
      if (j === 1) { const a = PAX[PAX.length - 1]; a.mate = p; p.mate = a; } // 2 人連れ: ときどき話す
      PAX.push(p);
      made++;
    });
    k++;
  }
}

// 駅に着いたとき（idx: 駅の番号）。乗った駅では空いていて、終点に近づくほど混む
window.paxStation = function (idx) {
  if (!SCN || !SC) return;
  const sl = paxSlots();
  const last = SC.sts.length - 1;
  if (idx >= last) return;
  const prog = Math.min(1, Math.max(0, (idx - PAX_FROM) / Math.max(1, last - 1 - PAX_FROM)));
  const cap = sl.seats.length + sl.stands.length;
  // 混雑度（左の欄）: すかすか＝座席がだんだん埋まり、立つ人は少し／こみこみ＝はじめから 6 割、後半は満員
  const crowd = (window.OPTS && G && G.opts ? G.opts.crowd : 'low');
  const target = crowd === 'high' ? Math.round(cap * Math.min(1, 0.65 + 0.6 * prog))
    : Math.round(sl.seats.length * Math.min(1, 0.2 + 0.8 * prog) + sl.stands.length * 0.3 * prog ** 1.5);
  // 降りる人（座っていた人は立ち上がってから、画面の外へ歩いていく）
  const inCar = PAX.filter((p) => p.state === 'in');
  const nOff = Math.min(inCar.length, Math.floor(inCar.length * 0.15 + hash(idx, 5, PAX_SEED) * 1.3));
  for (let i = 0; i < nOff; i++) {
    const p = inCar[Math.floor(hash(idx, i + 11, PAX_SEED) * inCar.length)];
    if (p.state !== 'in') continue;
    p.state = 'rise'; p.t = -0.5 * i;
    const toLeft = p.x < sl.W / 2 ? hash(idx, p.id) < 0.75 : hash(idx, p.id) < 0.25;
    p.dir = toLeft ? -1 : 1;
    p.tx = toLeft ? -0.8 * sl.u : sl.W + 0.8 * sl.u;
  }
  PAX.filter((p) => p.state === 'in' && p.mode === 'sit' && p.L.sitAct === 'sleep' && (p.sat || 0) >= (p.dozeAfter ?? 1e9)) // 寝ている人だけ
    .forEach((p, i) => { if (p.wakes && hash(idx, p.id, 3) < 0.7) p.wakeT = 0.15 + i * 0.35; });
  // 座っていた人が降りたら、その前（近く）に立っている人が座る
  for (const p of PAX) {
    if (p.state !== 'rise' || p.mode !== 'sit' || p.handed) continue;
    p.handed = true;
    const sx = sl.seats[p.slot];
    let q = null, qd = 0.8 * sl.u;
    for (const r of PAX) if (r.mode === 'stand' && r.state === 'in' && r.nextSeat === undefined && Math.abs(slotX(sl, r) - sx) < qd) { qd = Math.abs(slotX(sl, r) - sx); q = r; }
    if (q) { q.nextSeat = p.slot; q.seatWait = 0.9 + Math.max(0, -p.t); }
  }
  const stay = PAX.filter((p) => p.state !== 'rise' && p.state !== 'out').length;
  const before = PAX.length;
  paxBoard(sl, Math.max(0, target - stay), idx * 31 + 1 + PAX_SEED * 7);
  for (let i = before; i < PAX.length; i++) PAX[i].t -= 0.3 * Math.min(1, nOff); // 降りる人が出てから乗る
};

// 出発するとき: 乗った駅では車内は空
window.paxReset = function (from) {
  PAX = []; PAX_FROM = from || 0; PAX_SEED = Math.floor(Math.random() * 1e6);
  // こみこみ: 乗った駅から、もう 6 割ほど乗っている（座っている人・立っている人）
  if (window.OPTS && window.OPTS.crowd === 'high' && SCN && STRAPS.length) {
    const sl = paxSlots();
    paxBoard(sl, Math.round((sl.seats.length + sl.stands.length) * 0.65), PAX_SEED % 9973);
    for (const p of PAX) { p.x = p.tx; p.state = 'in'; p.t = 0; p.sat = 99; }
  }
};

// ---- しぐさ（人間らしさ）: 2 人連れはときどき話す、居眠りはこっくり→はっと目覚める、スマホから顔を上げる ----
const TALK = ['…', '♪', 'w', '！', '？', 'へぇ', 'ね〜', 'ふふ'];
function paxMood(p, dt) {
  if (p.state !== 'in') { p.talking = 0; return; }
  const r = (i) => hash(p.id, ((p.t * 3) | 0) + i);
  // 2 人連れ: 先に乗った人が間合いを決める。3.2 秒のあいだ、交互にしゃべり、相手のほうを見る
  if (p.mate && p.mate.mate === p && p.id < p.mate.id) {
    if (p.talkT === undefined) p.talkT = 2 + hash(p.id, 5) * 6;
    p.talkT -= dt;
    if (p.talkT <= 0 && p.mate.state === 'in' && !(p.talking > 0)) {
      p.talking = p.mate.talking = 3.2; p.topic = p.mate.topic = (p.topic || 0) + 1;
      p.talkT = 7 + r(1) * 12;
    }
  }
  if (p.talking > 0) p.talking -= dt;
  // 居眠り: ときどき（と駅に着いたとき）はっと目覚めて、またうとうと
  if (p.mode === 'sit' && p.L.sitAct === 'sleep') {
    // 座ってすぐには寝ない: 4〜12 秒は起きていて、それからうとうと
    p.sat = (p.sat || 0) + dt;
    if (p.dozeAfter === undefined) p.dozeAfter = 4 + hash(p.id, 13) * 8;
    if (p.sat < p.dozeAfter) return;
    if (p.wakes === undefined) p.wakes = hash(p.id, 19, PAX_SEED) < 0.5; // はっと起きるのは、寝ている人の半分くらい
    if (!p.wakes) return;
    if (p.wakeT === undefined) p.wakeT = 8 + hash(p.id, 7) * 18;
    p.wakeT -= dt;
    if (p.wakeT <= 0) { p.wake = 1.6; p.wakeT = 14 + r(2) * 22; }
    if (p.wake > 0) p.wake -= dt;
  }
  // スマホ・本: ときどき顔を上げる
  if (p.mode === 'sit' && (p.L.sitAct === 'phone' || p.L.sitAct === 'read')) {
    if (p.upT === undefined) p.upT = 4 + hash(p.id, 9) * 10;
    p.upT -= dt;
    if (p.upT <= 0) { p.up = 1.0; p.upT = 7 + r(3) * 12; }
    if (p.up > 0) p.up -= dt;
  }
}
// 吹き出し（x, y は吹き出しのしっぽの先、画面の座標）
function paxBubble(x, y, t, k, col = '#2b2233') {
  const fs = Math.max(16, Math.round(k * 7));
  ctx.font = `${fs}px DotGothic16, monospace`;
  const w = Math.max(fs * 1.4, ctx.measureText(t).width + fs * 0.8), h = fs * 1.35;
  const bx = Math.round(x - w * 0.3), by = Math.round(y - h - fs * 0.45);
  ctx.fillStyle = '#2b2530'; ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = '#2b2530'; ctx.fillRect(Math.round(x) - 2, by + h, 5, 2); ctx.fillRect(Math.round(x) - 1, by + h + 2, 3, 2);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x) - 1, by + h, 3, 2);
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t, bx + w / 2, by + h / 2 + 1);
}

// 毎フレーム: 歩いて席へ・画面の外へ
window.drawPax = function (dt, OX, OY, k) {
  if (!SCN || !SC || !PAX.length) return;
  const sl = paxSlots();
  const speed = 1.25 * sl.u;
  if (!paused) for (const p of PAX) {
    p.t += dt;
    p.bt -= dt;
    if (p.seatWait > 0) { // 前の人が立ってから、空いた席へ
      p.seatWait -= dt;
      if (p.seatWait <= 0) { p.mode = 'sit'; p.slot = p.nextSeat; p.nextSeat = undefined; p.tx = slotX(sl, p); p.state = 'walk'; p.t = 0; p.sat = 0; }
    }
    if (p.bt < -0.14) p.bt = 2 + hash(p.id, (p.t * 10) | 0) * 4;
    if (p.t < 0) continue;
    if (p.state === 'rise' && p.t > (p.mode === 'sit' ? 0.35 : 0.05)) { p.state = 'out'; p.t = 0; }
    if (p.state === 'walk' || p.state === 'out') {
      const d = p.tx - p.x;
      p.dir = d < 0 ? -1 : 1;
      const v = speed * p.L.scale ** 0.5 * (p.L.kind === 'elder' ? 0.7 : 1);
      p.x += Math.sign(d) * Math.min(Math.abs(d), v * dt);
      p.walked = (p.walked || 0) + v * dt;
      if (Math.abs(p.tx - p.x) < 1) {
        if (p.state === 'walk') { p.state = p.mode === 'sit' ? 'turn' : 'in'; p.t = 0; } else p.state = 'gone';
      }
    }
    if (p.state === 'turn' && p.t > 0.25) p.state = 'in';
    paxMood(p, dt);
  }
  PAX = PAX.filter((p) => p.state !== 'gone');
  // 座っている人 → 立っている人 → 歩いている人 の順に（手前ほどあと）
  const order = (p) => (p.mode === 'sit' && (p.state === 'in' || p.state === 'turn' || p.state === 'rise') ? 0 : p.state === 'in' || p.state === 'rise' ? 1 : 2);
  const list = PAX.filter((p) => !((p.state === 'walk' || p.state === 'out') && p.t < 0)).sort((a, b) => order(a) - order(b) || a.x - b.x);
  ctx.imageSmoothingEnabled = false;
  const bubbles = []; // 吹き出しは、人をみんな描いてから上に
  for (const p of list) {
    let pose = 'back', grabY = 0, frame = 0;
    if (p.mode === 'sit' && p.state === 'in') pose = 'sit';
    else if (p.mode === 'sit' && (p.state === 'turn' || p.state === 'rise')) pose = p.state === 'rise' && p.t < 0.12 ? 'sit' : 'stand';
    else if (p.state === 'in' || p.state === 'rise') grabY = sl.stands[p.slot] ? sl.stands[p.slot].grabY : 0;
    else {
      pose = 'walk';
      frame = Math.floor(((p.walked || 0) / (sl.u * p.L.scale)) / 0.19) % 6;
    }
    const blink = (pose === 'sit' || pose === 'stand') && p.bt < 0;
    // しぐさ: 話し相手のほうを見る・しゃべる・こっくり・はっ・顔を上げる
    let v = '';
    const talking = p.talking > 0 && p.mate;
    const speaking = talking && Math.floor((3.2 - p.talking) / 0.8) % 2 === (p.id < p.mate.id ? 0 : 1);
    if (pose === 'sit') {
      if (talking) v += (p.mate.x > p.x ? 'R' : 'L') + (speaking && Math.floor(p.talking * 8) % 2 ? 't' : '') + 'u'; // 話すときはスマホから顔を上げる
      const dozing = p.L.sitAct === 'sleep' && (p.sat || 0) >= (p.dozeAfter ?? 1e9);
      if (p.L.sitAct === 'sleep') v += !dozing || p.wake > 0 ? 'w' : Math.floor((G ? G.t : 0) * 0.8 + p.id * 0.37) % 3 === 0 ? 'n' : ''; // 座ったばかりは起きている
      if (p.up > 0 && !talking) v += 'u';
    }
    const clingU = G && G.skip && !G.skip.water && G.state === 'play' ? G.skip.u : -1;
    const nearWin = p.x < SCN.SW.x1 + 0.4 * sl.u && p.state === 'in';
    if (nearWin && pose === 'back' && clingU > 0.3 && clingU < 0.8 && hash(p.id, 77) < 0.5) v += 'Ts' + (p.x > leapSpotX() ? '<' : ''); // 半分ほどの人が、忍者のいるほうへふり向く
    const sp = paxSprite(p.L, pose, sl.u, sl.seatH, grabY, frame, blink, v);
    const sc = k * sp.res;
    const y = OY + sl.fl * k - sp.ay * sc;
    // 立っている人は電車の揺れで少し揺れる（つり革と同じ向き）
    const swayX = pose === 'back' && typeof sway !== 'undefined' ? Math.round(sway * 2.2 * p.L.scale) : 0;
    if (pose !== 'sit') { // 床の影
      ctx.fillStyle = 'rgba(40,30,50,0.18)';
      ctx.fillRect(Math.round(OX + (p.x - 0.2 * sl.u * p.L.scale) * k), Math.round(OY + (sl.fl - 1) * k), Math.round(0.4 * sl.u * p.L.scale * k), Math.round(2 * k));
    }
    if (pose === 'walk' && p.dir < 0) {
      ctx.save(); ctx.translate(Math.round(OX + p.x * k), 0); ctx.scale(-1, 1);
      ctx.drawImage(sp.c, -sp.ax * sc, y, sp.c.width * sc, sp.c.height * sc);
      ctx.restore();
    } else ctx.drawImage(sp.c, Math.round(OX + (p.x + swayX) * k - sp.ax * sc), Math.round(y), sp.c.width * sc, sp.c.height * sc);
    const headY = OY + (sl.fl - (pose === 'sit' ? sl.seatH + 0.98 * p.L.scale : 1.62 * p.L.scale) * sl.u) * k, headX = OX + (p.x + swayX) * k;
    if (speaking && (p.state === 'in')) bubbles.push([headX, headY, TALK[Math.floor(hash(p.id, p.topic || 0, Math.floor((3.2 - p.talking) / 1.6)) * TALK.length) % TALK.length], k]);
    if (pose === 'sit' && p.wake > 1.0) bubbles.push([headX, headY, '！', k, '#c0392b']);
    // 忍者が窓に貼りついたら、窓のほうを向いて立っている人がおどろく（座っている人は窓を背にしているので気づかない）
    const cling = G && G.skip && !G.skip.water && G.state === 'play' ? G.skip.u : -1;
    if (p.x < SCN.SW.x1 + 0.4 * sl.u && p.state === 'in') {
      if (pose === 'back' && cling > 0.27 && cling < 0.8) bubbles.push([headX, headY, cling < 0.5 ? '！' : '！？', k, '#c0392b']);
    }
    if (pose === 'sit' && p.L.sitAct === 'sleep' && !(p.wake > 0) && (p.sat || 0) >= (p.dozeAfter ?? 1e9)) { // 居眠りの「Z」
      const ph = ((G ? G.t : 0) * 0.6 + p.id * 0.37) % 1;
      const hx = OX + (p.x + 0.12 * sl.u * p.L.scale) * k, hy = OY + (sl.fl - (sl.seatH + 0.95 * p.L.scale) * sl.u) * k;
      ctx.font = `${Math.round(10 + ph * 6)}px DotGothic16, monospace`;
      ctx.fillStyle = `rgba(90,110,170,${(1 - ph).toFixed(2)})`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('Z', hx + ph * 14, hy - ph * 22);
    }
  }
  for (const b of bubbles) paxBubble(...b);
};

// 確認用: いまの車内をいっぱいにする（座席・立つ場所すべて）
window.paxFill = function () {
  const sl = paxSlots();
  PAX = [];
  paxBoard(sl, sl.seats.length + sl.stands.length, 7);
  for (const p of PAX) { p.x = p.tx; p.state = p.mode === 'sit' ? 'in' : 'in'; p.t = 0; }
};
